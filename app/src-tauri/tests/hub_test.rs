//! Re-verifica en Rust las mismas 4 propiedades que el prototipo Node del
//! spike 1 (spikes/multiterminal/test.mjs), contra el hub REAL de producción
//! (axum embebido en Tauri) — cumple lo que el mini-informe del spike 1
//! prometía: "la implementación Rust de la Fase 5 debe pasar el mismo
//! test.mjs [...] así el protocolo queda probado antes y después del port".

use app_lib::hub::{router, HubState};
use app_lib::{db, seed};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// BD fresca en memoria, migrada y sembrada (mismos ids que el frontend,
/// ver src/seed.rs) — cada test tiene su propia instancia aislada.
fn fresh_seeded_db() -> rusqlite::Connection {
    let conn = db::open_and_migrate(":memory:", Path::new("../../docs/db/migrations"));
    seed::seed(&conn, app_lib::commands::now_ms());
    conn
}

async fn start_test_hub() -> u16 {
    start_test_hub_with_pwa(None).await
}

async fn start_test_hub_with_pwa(pwa_dir: Option<&str>) -> u16 {
    let state = HubState::new(fresh_seeded_db());
    let app = router(state, pwa_dir);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    // pequeño margen para que el listener esté aceptando conexiones
    tokio::time::sleep(Duration::from_millis(20)).await;
    port
}

#[tokio::test]
async fn sirve_la_pwa_estatica_cuando_se_configura_el_directorio() {
    // Fase 5 §4: el hub sirve la PWA (mesero/KDS/caja) desde el mismo binario,
    // sin depender de un servidor web aparte. Aquí se prueba contra el build
    // real de `app/dist` (generado por `npm run build`, Fase 3/4).
    let port = start_test_hub_with_pwa(Some("../dist")).await;
    let resp = reqwest_like_get(port, "/").await;
    assert!(resp.contains("RestaurantOS AI"), "sirve el index.html real de la PWA");
}

/// GET manual por TCP crudo (sin depender de un cliente HTTP externo como
/// dev-dependency adicional): suficiente para verificar que el body llegó.
async fn reqwest_like_get(port: u16, path: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).await.unwrap();
    let mut buf = String::new();
    stream.read_to_string(&mut buf).await.unwrap();
    buf
}

async fn connect(port: u16, role: &str, device: &str, since_index: i64) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let url = format!("ws://127.0.0.1:{port}/ws?role={role}&device={device}&since_index={since_index}");
    let (ws, _resp) = connect_async(url).await.expect("no se pudo conectar al hub de prueba");
    ws
}

async fn next_json(ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) -> Value {
    loop {
        let msg = timeout(Duration::from_secs(2), ws.next())
            .await
            .expect("timeout esperando mensaje del hub")
            .expect("el stream del hub se cerró")
            .expect("error leyendo del websocket");
        if let Message::Text(text) = msg {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

async fn next_json_matching<F: Fn(&Value) -> bool>(
    ws: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    pred: F,
) -> Value {
    loop {
        let v = next_json(ws).await;
        if pred(&v) {
            return v;
        }
    }
}

#[tokio::test]
async fn protocolo_multiterminal_verde_en_rust() {
    let port = start_test_hub().await;

    let mut mesero = connect(port, "mesero", "tablet-1", -1).await;
    let mut kds = connect(port, "kds", "cocina-1", -1).await;

    let hello_mesero = next_json(&mut mesero).await;
    assert_eq!(hello_mesero["type"], "hello");
    assert!(hello_mesero["serverTime"].as_u64().unwrap() > 0);
    let _hello_kds = next_json(&mut kds).await;

    // --- Propiedad 1: comando idempotente visible en KDS ---
    let cmd_id = uuid::Uuid::new_v4().to_string();
    let cmd = json!({
        "type": "cmd", "id": cmd_id, "cmd": "nueva_comanda",
        "payload": { "tableNumber": 1, "items": [{ "productId": "mi_tacos_pastor", "cantidad": 3, "modificadores": [{"groupId":"mg_salsa","optionId":"op_salsa_roja"}] }] }
    });
    mesero.send(Message::Text(cmd.to_string())).await.unwrap();

    let ack = next_json_matching(&mut mesero, |v| v["type"] == "ack" && v["id"] == cmd_id).await;
    assert_eq!(ack["status"], "ok", "ack: {ack:?}");

    let kds_event = next_json_matching(&mut kds, |v| v["type"] == "event" && v["causedBy"] == cmd_id).await;
    assert_eq!(kds_event["cmd"], "nueva_comanda");
    assert_eq!(kds_event["payload"]["mesa"], 1);
    assert!(kds_event["serverTime"].as_u64().unwrap() > 0, "el evento lleva serverTime del hub");

    // --- Propiedad 2: deduplicación por UUID ---
    mesero.send(Message::Text(cmd.to_string())).await.unwrap();
    let dup_ack = next_json_matching(&mut mesero, |v| v["type"] == "ack" && v["id"] == cmd_id).await;
    assert_eq!(dup_ack["status"], "duplicate", "reenviar el mismo UUID no crea un segundo evento");

    // --- Propiedad 3: reconexión — KDS se cae, se manda otra comanda, reconecta y hace replay ---
    drop(kds);
    let cmd_id_2 = uuid::Uuid::new_v4().to_string();
    let cmd2 = json!({
        "type": "cmd", "id": cmd_id_2, "cmd": "nueva_comanda",
        "payload": { "tableNumber": 4, "items": [{ "productId": "mi_flan", "cantidad": 1 }] }
    });
    mesero.send(Message::Text(cmd2.to_string())).await.unwrap();
    let ack2 = next_json_matching(&mut mesero, |v| v["type"] == "ack" && v["id"] == cmd_id_2).await;
    assert_eq!(ack2["status"], "ok", "ack2: {ack2:?}");

    let mut kds_reconnected = connect(port, "kds", "cocina-1", 0).await;
    let replayed = next_json_matching(&mut kds_reconnected, |v| v["type"] == "event" && v["causedBy"] == cmd_id_2).await;
    assert_eq!(replayed["cmd"], "nueva_comanda", "el KDS reconectado recibe por replay lo que se perdió offline");
}

/// Fase 6 §10.1/§10.3: el hub persiste comandas en SQLite (sobrevive
/// reinicios, no solo el proceso vivo) y el bump a 'en_preparacion' descuenta
/// inventario por receta como caso de uso real (no un test manual aparte).
#[test]
fn persistencia_y_descuento_de_inventario_por_receta() {
    use app_lib::commands::*;
    use rusqlite::params;

    let dir = std::env::temp_dir().join(format!("restaurantos-hub-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("hub.db");
    let db_path_str = db_path.to_str().unwrap();

    // "Primer arranque": abre, migra, siembra, procesa una comanda.
    let order_id = {
        let conn = db::open_and_migrate(db_path_str, Path::new("../../docs/db/migrations"));
        seed::seed(&conn, now_ms());

        let payload: NuevaComandaPayload = serde_json::from_value(json!({
            "tableNumber": 2,
            "items": [{ "productId": "mi_tacos_pastor", "cantidad": 2, "modificadores": [{"groupId":"mg_salsa","optionId":"op_salsa_verde"}] }]
        })).unwrap();
        let result = handle_nueva_comanda(&conn, &payload).expect("nueva_comanda debe procesar sin error");
        let order_id = result["orderId"].as_str().unwrap().to_string();
        let item_id = result["items"][0]["orderItemId"].as_str().unwrap().to_string();

        // tortilla: 1000 iniciales - 3*2 = 994
        let tortilla_before: f64 = conn.query_row("SELECT qty FROM inventory WHERE product_id='insumo-tortilla'", [], |r| r.get(0)).unwrap();
        assert_eq!(tortilla_before, 1000.0, "aún no se ha preparado nada");

        let bump: BumpPlatilloPayload = serde_json::from_value(json!({ "orderItemId": item_id, "nextStatus": "en_preparacion" })).unwrap();
        handle_bump_platillo(&conn, &bump).expect("bump_platillo debe procesar sin error");

        let tortilla_after: f64 = conn.query_row("SELECT qty FROM inventory WHERE product_id='insumo-tortilla'", [], |r| r.get(0)).unwrap();
        assert_eq!(tortilla_after, 994.0, "el descuento por receta (3 tortillas x 2 piezas) se aplicó de verdad");

        order_id
        // `conn` se cierra aquí — simula el fin del proceso
    };

    // "Segundo arranque": abre el MISMO archivo — la comanda y el stock deben seguir ahí.
    {
        let conn = db::open_and_migrate(db_path_str, Path::new("../../docs/db/migrations"));
        let status: String = conn.query_row("SELECT status FROM orders WHERE id = ?1", params![order_id], |r| r.get(0)).unwrap();
        assert_eq!(status, "abierta", "la comanda sobrevivió al reinicio del proceso");

        let tortilla: f64 = conn.query_row("SELECT qty FROM inventory WHERE product_id='insumo-tortilla'", [], |r| r.get(0)).unwrap();
        assert_eq!(tortilla, 994.0, "el inventario descontado también sobrevivió al reinicio");

        // Fase 6 §10.2: cobrar la comanda genera una venta real y la cierra.
        let checkout: CheckoutPayload = serde_json::from_value(json!({
            "orderId": order_id, "paymentMethod": "efectivo", "tipCents": 1000
        })).unwrap();
        let sale = handle_checkout(&conn, &checkout).expect("el cobro debe procesar sin error");
        assert_eq!(sale["saleIds"].as_array().unwrap().len(), 1);
        assert!(sale["totalCents"].as_i64().unwrap() > 0);

        let order_status: String = conn.query_row("SELECT status FROM orders WHERE id = ?1", params![order_id], |r| r.get(0)).unwrap();
        assert_eq!(order_status, "cerrada", "cobrar cierra la comanda (dispara el trigger de mesa 'por_limpiar')");

        let table_status: String = conn.query_row(
            "SELECT t.status FROM tables t JOIN orders o ON o.table_id = t.id WHERE o.id = ?1",
            params![order_id], |r| r.get(0),
        ).unwrap();
        assert_eq!(table_status, "por_limpiar");
    }

    std::fs::remove_dir_all(&dir).ok();
}

/// Fase 6 §10.5: turno + propina con reparto (modo 'individual' del seed).
#[test]
fn turno_y_propina_se_reparten_al_cerrar() {
    use app_lib::commands::*;

    let conn = fresh_seeded_db();
    let opened = open_shift(&conn, seed::EMPLOYEE_MESERO).expect("abrir turno");
    let shift_id = opened["shiftId"].as_str().unwrap().to_string();

    let payload: NuevaComandaPayload = serde_json::from_value(json!({
        "tableNumber": 1, "items": [{ "productId": "mi_flan", "cantidad": 1 }]
    })).unwrap();
    let order = handle_nueva_comanda(&conn, &payload).unwrap();
    let checkout: CheckoutPayload = serde_json::from_value(json!({
        "orderId": order["orderId"], "paymentMethod": "efectivo", "tipCents": 2000, "shiftId": shift_id
    })).unwrap();
    handle_checkout(&conn, &checkout).unwrap();

    let closed = close_shift(&conn, &shift_id).expect("cerrar turno");
    assert_eq!(closed["totalTipsCents"], 2000);

    let summary = tips_summary_json(&conn);
    let dist = summary.as_array().unwrap().iter().find(|d| d["shiftId"] == shift_id).unwrap();
    assert_eq!(dist["amountCents"], 2000, "modo individual: el mesero se queda el 100% de su propina");
}

/// Fase 6 §10.6: RBAC/PIN — el hub identifica al empleado por su PIN
/// (cualquier terminal, no un dispositivo fijo) y expone sus permisos.
#[test]
fn login_por_pin_identifica_al_empleado_y_sus_permisos() {
    use app_lib::commands::pin_login;

    let conn = fresh_seeded_db();

    let ok = pin_login(&conn, "3333").expect("PIN de Carla (cajera) debe autenticar");
    assert_eq!(ok["employeeId"], seed::EMPLOYEE_CAJERO);
    assert_eq!(ok["roleNombre"], "Cajero");
    assert!(ok["permisos"].as_array().unwrap().iter().any(|p| p == "cash.checkout"));

    let bad = pin_login(&conn, "0000");
    assert!(bad.is_err(), "un PIN que no existe debe rechazarse");
}

/// Fase 6 §10.7: el snapshot de respaldo incluye datos reales sembrados
/// (el cifrado en sí vive en el navegador, ver encryptedBackup.ts).
#[test]
fn snapshot_de_respaldo_incluye_catalogo_y_mesas_sembradas() {
    use app_lib::{backup, commands::now_ms};

    let conn = fresh_seeded_db();
    let snapshot = backup::build_snapshot(&conn, now_ms());

    assert_eq!(snapshot["version"], "restaurantos-1");
    let tables = &snapshot["tables"];
    assert!(tables["products"].as_array().unwrap().len() >= 4, "incluye el menú sembrado");
    assert!(tables["tables"].as_array().unwrap().len() == 5, "incluye las 5 mesas sembradas");
    assert!(tables["employees"].as_array().unwrap().iter().any(|e| e["id"] == seed::EMPLOYEE_CAJERO));
}

/// Fase 6 §10.9: pairing real — un código de un solo uso crea un `deviceId`
/// persistente; redimirlo dos veces debe fallar la segunda.
#[test]
fn pairing_genera_y_redime_un_codigo_de_un_solo_uso() {
    use app_lib::commands::{generate_pairing, redeem_pairing, list_devices};

    let conn = fresh_seeded_db();

    let generated = generate_pairing(&conn, "kds").expect("debe generar un código para rol válido");
    let code = generated["code"].as_str().unwrap().to_string();
    assert_eq!(code.len(), 6);

    let redeemed = redeem_pairing(&conn, &code, Some("KDS de cocina")).expect("el código recién generado debe redimirse");
    assert_eq!(redeemed["role"], "kds");
    assert!(redeemed["deviceId"].as_str().unwrap().len() > 0);

    let second_attempt = redeem_pairing(&conn, &code, None);
    assert!(second_attempt.is_err(), "un código ya redimido no debe volver a funcionar");

    let devices = list_devices(&conn);
    assert_eq!(devices.as_array().unwrap().len(), 1);
    assert_eq!(devices[0]["label"], "KDS de cocina");

    assert!(generate_pairing(&conn, "rol_invalido").is_err());
}

/// Fase 7 (arranque): generar un CFDI real a partir de una venta ya cobrada.
/// El timbrado (llamar al PAC) sigue ⛔ bloqueado (spike 3) — esto valida
/// que el documento estructural (conceptos, totales) se arma correctamente.
#[test]
fn genera_cfdi_a_partir_de_una_venta_cobrada() {
    use app_lib::commands::*;

    let conn = fresh_seeded_db();

    let payload: NuevaComandaPayload = serde_json::from_value(json!({
        "tableNumber": 5,
        "items": [{ "productId": "mi_tacos_pastor", "cantidad": 2, "modificadores": [{"groupId":"mg_salsa","optionId":"op_salsa_verde"}] }]
    })).unwrap();
    let order = handle_nueva_comanda(&conn, &payload).unwrap();

    let checkout_payload: CheckoutPayload = serde_json::from_value(json!({
        "orderId": order["orderId"], "paymentMethod": "tarjeta"
    })).unwrap();
    let sale = handle_checkout(&conn, &checkout_payload).unwrap();
    let sale_id = sale["saleIds"][0].as_str().unwrap().to_string();
    let total_cents = sale["totalCents"].as_i64().unwrap();

    let cfdi_payload = GenerateCfdiPayload {
        sale_id: sale_id.clone(),
        rfc_receptor: "XEXX010101000".into(),
        nombre_receptor: "PUBLICO EN GENERAL".into(),
        uso_cfdi: "G03".into(),
    };
    let doc = generate_cfdi(&conn, &cfdi_payload).expect("debe generar el CFDI sin error");
    assert_eq!(doc["estado"], "pendiente", "el timbrado real sigue bloqueado (⛔ spike 3)");
    assert_eq!(doc["totalCents"], total_cents, "el total del CFDI debe coincidir con el de la venta");
    assert_eq!(doc["conceptos"].as_array().unwrap().len(), 1);

    // No se puede generar dos veces para la misma venta.
    assert!(generate_cfdi(&conn, &cfdi_payload).is_err());

    let fetched = get_cfdi_document(&conn, &sale_id);
    assert_eq!(fetched["folio"], doc["folio"]);
}

/// Fase 7: cliente real, promoción activa y redención de puntos aplicados
/// en un cobro real (no solo el cálculo aislado).
#[test]
fn cliente_promocion_y_puntos_se_aplican_en_el_cobro() {
    use app_lib::commands::*;
    use app_lib::commerce::*;

    let conn = fresh_seeded_db();

    // Cliente con puntos ya acumulados (simula compras previas).
    let customer = create_customer(&conn, &CreateCustomerPayload {
        name: "Juan Pérez".into(), phone: Some("5512345678".into()), email: None, tax_id: None,
    }).unwrap();
    let customer_id = customer["customerId"].as_str().unwrap().to_string();
    conn.execute("UPDATE customers SET loyalty_points = 20 WHERE id = ?1", rusqlite::params![customer_id]).unwrap();

    // Promoción activa: 10% off global.
    create_promotion(&conn, &CreatePromotionPayload { name: "10% de descuento".into(), percent_off: 0.10, priority: 1 }).unwrap();

    let payload: NuevaComandaPayload = serde_json::from_value(json!({
        "tableNumber": 2, "items": [{ "productId": "mi_tacos_pastor", "cantidad": 2 }]
    })).unwrap();
    let order = handle_nueva_comanda(&conn, &payload).unwrap();

    let checkout_payload: CheckoutPayload = serde_json::from_value(json!({
        "orderId": order["orderId"], "paymentMethod": "efectivo",
        "customerId": customer_id, "redeemPoints": 5
    })).unwrap();
    let sale = handle_checkout(&conn, &checkout_payload).unwrap();

    // Bruto: 2 x $90 = $180 = 18000 centavos. 10% off = 1800. 5 puntos = $5 = 500 centavos.
    assert_eq!(sale["grossTotalCents"], 18000);
    assert_eq!(sale["discountCents"], 1800 + 500);
    assert_eq!(sale["totalCents"], 18000 - 1800 - 500);

    // Puntos: se descontaron los 5 redimidos y se ganaron por el monto cobrado.
    let customers = list_customers(&conn);
    let updated = customers.as_array().unwrap().iter().find(|c| c["customerId"] == customer_id).unwrap();
    let esperados_ganados = sale["puntosGanados"].as_i64().unwrap();
    assert_eq!(updated["puntos"], 20 - 5 + esperados_ganados);
}

/// Fase 7: comprar a un proveedor suma inventario de verdad (mismo patrón
/// que el descuento por receta: TX explícita, no un trigger).
#[test]
fn compra_a_proveedor_suma_inventario_real() {
    use app_lib::commands::now_ms;
    use app_lib::commerce::*;

    let conn = fresh_seeded_db();
    let supplier = create_supplier(&conn, &CreateSupplierPayload { name: "Carnes del Valle".into(), lead_time_days: 2 }).unwrap();

    let before: f64 = conn.query_row("SELECT qty FROM inventory WHERE product_id='insumo-carne-pastor'", [], |r| r.get(0)).unwrap();

    let purchase: CreatePurchasePayload = serde_json::from_value(json!({
        "supplierId": supplier["supplierId"],
        "items": [{ "productId": "insumo-carne-pastor", "qty": 10.0, "unitCostCents": 8500 }]
    })).unwrap();
    let result = create_purchase(&conn, &purchase).unwrap();
    assert_eq!(result["totalCents"], 85000);
    let _ = now_ms();

    let after: f64 = conn.query_row("SELECT qty FROM inventory WHERE product_id='insumo-carne-pastor'", [], |r| r.get(0)).unwrap();
    assert_eq!(after, before + 10.0, "la compra sumó 10kg de carne al inventario real");
}
