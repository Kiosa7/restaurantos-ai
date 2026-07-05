//! Fase 7 (Comercial): clientes, fidelización, promociones, compras y
//! proveedores. Reutiliza tablas heredadas de pos-inteligente (`customers`,
//! `suppliers`, `supplier_prices`, `purchases`, `purchase_items`,
//! `promotions` — 0005/0007/0008) que existían sin UI restaurantera.
use crate::commands::{err, now_ms, uuid7, DomainError};
use crate::seed;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

type Result<T> = std::result::Result<T, DomainError>;

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateCustomerPayload {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    #[serde(rename = "taxId")]
    pub tax_id: Option<String>,
}

pub fn create_customer(conn: &Connection, payload: &CreateCustomerPayload) -> Result<Value> {
    if payload.name.trim().is_empty() {
        return Err(err("el cliente necesita un nombre"));
    }
    let now = now_ms();
    let id = uuid7();
    conn.execute(
        "INSERT INTO customers (id,tenant_id,name,phone,email,tax_id,loyalty_points,credit_limit,balance,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,?4,?5,?6,0,0,0,?7,?7,?8)",
        params![id, seed::TENANT, payload.name, payload.phone, payload.email, payload.tax_id, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;
    Ok(json!({ "customerId": id }))
}

pub fn list_customers(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT id, name, phone, email, loyalty_points, last_purchase_at FROM customers WHERE deleted_at IS NULL ORDER BY name")
        .unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "customerId": r.get::<_, String>(0)?,
                "nombre": r.get::<_, String>(1)?,
                "telefono": r.get::<_, Option<String>>(2)?,
                "email": r.get::<_, Option<String>>(3)?,
                "puntos": r.get::<_, i64>(4)?,
                "ultimaCompra": r.get::<_, Option<i64>>(5)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}

/// Fidelización: 1 punto por cada $10 MXN de compra (política de ejemplo,
/// documentada — configurar tasa real queda para cuando exista Settings UI).
const PUNTOS_POR_CENTAVO: f64 = 1.0 / 1000.0; // $10 = 1000 centavos = 1 punto
const CENTAVOS_POR_PUNTO_REDIMIDO: i64 = 100; // 1 punto = $1 MXN de descuento

pub fn accrue_loyalty(conn: &Connection, customer_id: &str, total_cents: i64) -> Result<i64> {
    let now = now_ms();
    let points_earned = (total_cents as f64 * PUNTOS_POR_CENTAVO).floor() as i64;
    conn.execute(
        "UPDATE customers SET loyalty_points = loyalty_points + ?1, last_purchase_at = ?2, updated_at = ?2 WHERE id = ?3",
        params![points_earned, now, customer_id],
    ).map_err(|e| err(e.to_string()))?;
    Ok(points_earned)
}

/// Convierte puntos a descuento en centavos; falla si el cliente no tiene
/// suficientes. Se descuentan los puntos de inmediato (no hay reversa si el
/// cobro falla después — limitación aceptada de v1, documentada).
pub fn redeem_loyalty(conn: &Connection, customer_id: &str, points: i64) -> Result<i64> {
    if points <= 0 {
        return Ok(0);
    }
    let available: i64 = conn
        .query_row("SELECT loyalty_points FROM customers WHERE id = ?1", params![customer_id], |r| r.get(0))
        .map_err(|_| err("cliente no existe"))?;
    if points > available {
        return Err(err(format!("el cliente solo tiene {available} puntos")));
    }
    let now = now_ms();
    conn.execute(
        "UPDATE customers SET loyalty_points = loyalty_points - ?1, updated_at = ?2 WHERE id = ?3",
        params![points, now, customer_id],
    ).map_err(|e| err(e.to_string()))?;
    Ok(points * CENTAVOS_POR_PUNTO_REDIMIDO)
}

// ---------------------------------------------------------------------------
// Promociones — motor mínimo v1: SOLO 'percent_off' sin alcance (aplica al
// subtotal completo), la primera activa por prioridad. Alcance por categoría,
// condiciones (min_qty), y apilado (`stackable`) quedan documentados como
// pendientes — el modelo de datos (`rules_json`) ya los soporta.
// ---------------------------------------------------------------------------

pub fn active_percent_off_promotion(conn: &Connection) -> Option<(String, f64)> {
    let now = now_ms();
    conn.query_row(
        "SELECT id, rules_json FROM promotions
         WHERE tenant_id = ?1 AND is_active = 1 AND type = 'percent_off'
           AND (valid_from IS NULL OR valid_from <= ?2) AND (valid_to IS NULL OR valid_to >= ?2)
         ORDER BY priority ASC LIMIT 1",
        params![seed::TENANT, now],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    )
    .optional()
    .unwrap()
    .and_then(|(id, rules_json)| {
        let rules: Value = serde_json::from_str(&rules_json).ok()?;
        let value = rules.get("value")?.as_f64()?;
        Some((id, value))
    })
}

#[derive(Deserialize)]
pub struct CreatePromotionPayload {
    pub name: String,
    #[serde(rename = "percentOff")]
    pub percent_off: f64,
    #[serde(default)]
    pub priority: i64,
}

pub fn create_promotion(conn: &Connection, payload: &CreatePromotionPayload) -> Result<Value> {
    let now = now_ms();
    let id = uuid7();
    let rules = json!({ "type": "percent_off", "value": payload.percent_off });
    conn.execute(
        "INSERT INTO promotions (id,tenant_id,name,type,rules_json,priority,stackable,is_active,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,'percent_off',?4,?5,0,1,?6,?6,?7)",
        params![id, seed::TENANT, payload.name, rules.to_string(), payload.priority, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;
    Ok(json!({ "promotionId": id }))
}

pub fn list_promotions(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT id, name, rules_json, is_active FROM promotions WHERE tenant_id = ?1 ORDER BY priority")
        .unwrap();
    let rows: Vec<Value> = stmt
        .query_map(params![seed::TENANT], |r| {
            let rules_json: String = r.get(2)?;
            Ok(json!({
                "promotionId": r.get::<_, String>(0)?,
                "nombre": r.get::<_, String>(1)?,
                "reglas": serde_json::from_str::<Value>(&rules_json).unwrap_or(Value::Null),
                "activa": r.get::<_, i64>(3)? == 1,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}

// ---------------------------------------------------------------------------
// Proveedores y compras — registrar una compra actualiza inventario de
// verdad (misma filosofía que el descuento de inventario por receta: TX
// explícita, no un trigger).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateSupplierPayload {
    pub name: String,
    #[serde(rename = "leadTimeDays", default)]
    pub lead_time_days: i64,
}

pub fn create_supplier(conn: &Connection, payload: &CreateSupplierPayload) -> Result<Value> {
    let now = now_ms();
    let id = uuid7();
    conn.execute(
        "INSERT INTO suppliers (id,tenant_id,name,lead_time_days,balance,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,?4,0,?5,?5,?6)",
        params![id, seed::TENANT, payload.name, payload.lead_time_days, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;
    Ok(json!({ "supplierId": id }))
}

pub fn list_suppliers(conn: &Connection) -> Value {
    let mut stmt = conn.prepare("SELECT id, name, lead_time_days FROM suppliers WHERE deleted_at IS NULL ORDER BY name").unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({ "supplierId": r.get::<_, String>(0)?, "nombre": r.get::<_, String>(1)?, "leadTimeDays": r.get::<_, i64>(2)? }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}

#[derive(Deserialize)]
pub struct PurchaseItemPayload {
    #[serde(rename = "productId")]
    pub product_id: String,
    pub qty: f64,
    #[serde(rename = "unitCostCents")]
    pub unit_cost_cents: i64,
}

#[derive(Deserialize)]
pub struct CreatePurchasePayload {
    #[serde(rename = "supplierId")]
    pub supplier_id: String,
    pub items: Vec<PurchaseItemPayload>,
}

/// Registra la compra (con sus líneas) Y descuenta... perdón, SUMA
/// inventario de verdad vía `inventory_movements` tipo 'purchase' (el
/// trigger 0010 ya materializa `inventory.qty`).
pub fn create_purchase(conn: &Connection, payload: &CreatePurchasePayload) -> Result<Value> {
    if payload.items.is_empty() {
        return Err(err("la compra necesita al menos un ítem"));
    }
    let now = now_ms();
    let purchase_id = uuid7();
    let mut subtotal = 0_i64;

    let folio_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM purchases WHERE location_id = ?1", params![seed::LOCATION], |r| r.get(0))
        .unwrap_or(0);
    let folio = format!("C-{:06}", folio_count + 1);

    conn.execute(
        "INSERT INTO purchases (id,tenant_id,location_id,supplier_id,employee_id,folio,datetime,subtotal,tax_total,total,status,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,?4,?5,?6,?7,0,0,0,'received',?7,?7,?8)",
        params![purchase_id, seed::TENANT, seed::LOCATION, payload.supplier_id, seed::EMPLOYEE_CAJERO, folio, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;

    for item in &payload.items {
        let name: String = conn
            .query_row("SELECT name FROM products WHERE id = ?1", params![item.product_id], |r| r.get(0))
            .map_err(|_| err(format!("producto {} no existe", item.product_id)))?;
        let line_total = (item.unit_cost_cents as f64 * item.qty).round() as i64;
        subtotal += line_total;

        conn.execute(
            "INSERT INTO purchase_items (id,purchase_id,product_id,name_snapshot,qty,unit_cost,line_total,created_at,origin_node)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![uuid7(), purchase_id, item.product_id, name, item.qty, item.unit_cost_cents, line_total, now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;

        conn.execute(
            "INSERT INTO inventory_movements (id,tenant_id,location_id,product_id,type,qty_delta,unit_cost,ref_doc,created_at,origin_node)
             VALUES (?1,?2,?3,?4,'purchase',?5,?6,?7,?8,?9)",
            params![uuid7(), seed::TENANT, seed::LOCATION, item.product_id, item.qty, item.unit_cost_cents, format!("purchase:{purchase_id}"), now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;
    }

    conn.execute(
        "UPDATE purchases SET subtotal = ?1, total = ?1, updated_at = ?2 WHERE id = ?3",
        params![subtotal, now, purchase_id],
    ).map_err(|e| err(e.to_string()))?;

    Ok(json!({ "purchaseId": purchase_id, "folio": folio, "totalCents": subtotal }))
}

// ---------------------------------------------------------------------------
// Reservaciones (Fase 7 §10.1 punto 5) — módulo nuevo, migración 0019.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateReservationPayload {
    #[serde(rename = "customerName")]
    pub customer_name: String,
    #[serde(rename = "customerPhone")]
    pub customer_phone: Option<String>,
    #[serde(rename = "partySize", default = "default_party_size")]
    pub party_size: i64,
    #[serde(rename = "reservedAt")]
    pub reserved_at: i64,
    pub notes: Option<String>,
}
fn default_party_size() -> i64 { 2 }

pub fn create_reservation(conn: &Connection, payload: &CreateReservationPayload) -> Result<Value> {
    let now = now_ms();
    let id = uuid7();
    conn.execute(
        "INSERT INTO reservations (id,tenant_id,location_id,customer_name,customer_phone,party_size,reserved_at,status,notes,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'confirmada',?8,?9,?9,?10)",
        params![id, seed::TENANT, seed::LOCATION, payload.customer_name, payload.customer_phone, payload.party_size, payload.reserved_at, payload.notes, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;
    Ok(json!({ "reservationId": id }))
}

pub fn list_reservations(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT id, customer_name, customer_phone, party_size, reserved_at, status, notes FROM reservations WHERE location_id = ?1 ORDER BY reserved_at")
        .unwrap();
    let rows: Vec<Value> = stmt
        .query_map(params![seed::LOCATION], |r| {
            Ok(json!({
                "reservationId": r.get::<_, String>(0)?,
                "cliente": r.get::<_, String>(1)?,
                "telefono": r.get::<_, Option<String>>(2)?,
                "personas": r.get::<_, i64>(3)?,
                "horaReservada": r.get::<_, i64>(4)?,
                "estado": r.get::<_, String>(5)?,
                "notas": r.get::<_, Option<String>>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}

pub fn update_reservation_status(conn: &Connection, id: &str, status: &str) -> Result<Value> {
    if !matches!(status, "confirmada" | "sentada" | "cancelada" | "no_show") {
        return Err(err(format!("estado inválido: {status}")));
    }
    let now = now_ms();
    let updated = conn
        .execute("UPDATE reservations SET status = ?1, updated_at = ?2 WHERE id = ?3", params![status, now, id])
        .map_err(|e| err(e.to_string()))?;
    if updated == 0 {
        return Err(err("la reservación no existe"));
    }
    Ok(json!({ "reservationId": id, "estado": status }))
}

// ---------------------------------------------------------------------------
// Delivery / para llevar (Fase 7 §10.1 punto 6) — reutiliza TODO el pipeline
// de comandas vía mesas virtuales (ver migración 0019).
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateDeliveryOrderPayload {
    pub channel: String, // 'para_llevar' | 'domicilio'
    #[serde(rename = "customerName")]
    pub customer_name: String,
    #[serde(rename = "customerPhone")]
    pub customer_phone: Option<String>,
    pub address: Option<String>,
    pub items: Vec<crate::commands::NuevaComandaItem>,
}

pub fn create_delivery_order(conn: &Connection, payload: &CreateDeliveryOrderPayload) -> Result<Value> {
    let table_number = match payload.channel.as_str() {
        "para_llevar" => 90,
        "domicilio" => 91,
        other => return Err(err(format!("canal inválido: {other}"))),
    };
    if payload.channel == "domicilio" && payload.address.as_deref().unwrap_or("").trim().is_empty() {
        return Err(err("a domicilio necesita una dirección"));
    }

    let comanda_payload = crate::commands::NuevaComandaPayload { table_number, items: clone_items(&payload.items) };
    let comanda = crate::commands::handle_nueva_comanda(conn, &comanda_payload)?;
    let order_id = comanda["orderId"].as_str().unwrap().to_string();

    let now = now_ms();
    let id = uuid7();
    conn.execute(
        "INSERT INTO delivery_orders (id,tenant_id,location_id,order_id,channel,customer_name,customer_phone,address,status,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'recibido',?9,?9,?10)",
        params![id, seed::TENANT, seed::LOCATION, order_id, payload.channel, payload.customer_name, payload.customer_phone, payload.address, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;

    Ok(json!({ "deliveryOrderId": id, "orderId": order_id, "channel": payload.channel }))
}

fn clone_items(items: &[crate::commands::NuevaComandaItem]) -> Vec<crate::commands::NuevaComandaItem> {
    items
        .iter()
        .map(|it| crate::commands::NuevaComandaItem {
            product_id: it.product_id.clone(),
            cantidad: it.cantidad,
            modificadores: it.modificadores.iter().map(|m| crate::commands::ModifierRef { group_id: m.group_id.clone(), option_id: m.option_id.clone() }).collect(),
            notas: it.notas.clone(),
        })
        .collect()
}

pub fn list_delivery_orders(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.order_id, d.channel, d.customer_name, d.customer_phone, d.address, d.status
             FROM delivery_orders d WHERE d.location_id = ?1 ORDER BY d.created_at DESC",
        )
        .unwrap();
    let rows: Vec<Value> = stmt
        .query_map(params![seed::LOCATION], |r| {
            Ok(json!({
                "deliveryOrderId": r.get::<_, String>(0)?,
                "orderId": r.get::<_, String>(1)?,
                "canal": r.get::<_, String>(2)?,
                "cliente": r.get::<_, String>(3)?,
                "telefono": r.get::<_, Option<String>>(4)?,
                "direccion": r.get::<_, Option<String>>(5)?,
                "estado": r.get::<_, String>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}

pub fn update_delivery_status(conn: &Connection, id: &str, status: &str) -> Result<Value> {
    if !matches!(status, "recibido" | "preparando" | "listo" | "en_camino" | "entregado" | "cancelado") {
        return Err(err(format!("estado inválido: {status}")));
    }
    let now = now_ms();
    let updated = conn
        .execute("UPDATE delivery_orders SET status = ?1, updated_at = ?2 WHERE id = ?3", params![status, now, id])
        .map_err(|e| err(e.to_string()))?;
    if updated == 0 {
        return Err(err("el pedido no existe"));
    }
    Ok(json!({ "deliveryOrderId": id, "estado": status }))
}
