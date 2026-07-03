//! Re-verifica en Rust las mismas 4 propiedades que el prototipo Node del
//! spike 1 (spikes/multiterminal/test.mjs), contra el hub REAL de producción
//! (axum embebido en Tauri) — cumple lo que el mini-informe del spike 1
//! prometía: "la implementación Rust de la Fase 5 debe pasar el mismo
//! test.mjs [...] así el protocolo queda probado antes y después del port".

use app_lib::hub::{router, HubState};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message};

async fn start_test_hub() -> u16 {
    start_test_hub_with_pwa(None).await
}

async fn start_test_hub_with_pwa(pwa_dir: Option<&str>) -> u16 {
    let state = HubState::new();
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
        "payload": { "mesa": 7, "items": [{ "producto": "Tacos al pastor", "cantidad": 3 }] }
    });
    mesero.send(Message::Text(cmd.to_string())).await.unwrap();

    let ack = next_json_matching(&mut mesero, |v| v["type"] == "ack" && v["id"] == cmd_id).await;
    assert_eq!(ack["status"], "ok");

    let kds_event = next_json_matching(&mut kds, |v| v["type"] == "event" && v["causedBy"] == cmd_id).await;
    assert_eq!(kds_event["cmd"], "nueva_comanda");
    assert!(kds_event["serverTime"].as_u64().unwrap() > 0, "el evento lleva serverTime del hub");

    // --- Propiedad 2: deduplicación por UUID ---
    mesero.send(Message::Text(cmd.to_string())).await.unwrap();
    let dup_ack = next_json_matching(&mut mesero, |v| v["type"] == "ack" && v["id"] == cmd_id).await;
    assert_eq!(dup_ack["status"], "duplicate", "reenviar el mismo UUID no crea un segundo evento");

    // --- Propiedad 3: reconexión — KDS se cae, se manda otra comanda, reconecta y hace replay ---
    drop(kds);
    let cmd_id_2 = uuid::Uuid::new_v4().to_string();
    let cmd2 = json!({ "type": "cmd", "id": cmd_id_2, "cmd": "nueva_comanda", "payload": { "mesa": 3 } });
    mesero.send(Message::Text(cmd2.to_string())).await.unwrap();
    let _ack2 = next_json_matching(&mut mesero, |v| v["type"] == "ack" && v["id"] == cmd_id_2).await;

    let mut kds_reconnected = connect(port, "kds", "cocina-1", 0).await;
    let replayed = next_json_matching(&mut kds_reconnected, |v| v["type"] == "event" && v["causedBy"] == cmd_id_2).await;
    assert_eq!(replayed["cmd"], "nueva_comanda", "el KDS reconectado recibe por replay lo que se perdió offline");
}
