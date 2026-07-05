//! Sincronización multi-sucursal (Fase 8 §10.2) — puerto del protocolo ya
//! validado por simulación en pos-inteligente (`docs/sync/protocolo.md`):
//! HLC para orden causal determinista, outbox transaccional (0001, ya en el
//! esquema pero sin usar hasta esta fase) y 3 estrategias de resolución de
//! conflicto por tipo de agregado (append-only, CRDT por suma de deltas,
//! LWW por fila). Un hub de RestaurantOS ahora puede jugar el rol de
//! "sucursal" del protocolo original; el rol de "nube" lo puede jugar
//! cualquier proceso que hable el mismo `POST /sync/push` / `GET
//! /sync/pull` — incluyendo otro hub, por eso el spike se verifica con dos
//! binarios reales sincronizando entre sí (ver PLAN.md bitácora).
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

use crate::commands::{now_ms, uuid7};

/// `(wall_ms, counter, node_id)` comparado lexicográficamente — el orden de
/// los campos del struct ya da el orden total correcto vía `derive(Ord)`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hlc {
    pub wall: i64,
    pub counter: i64,
    pub node: String,
}

impl Hlc {
    /// Forma serializable ordenable como TEXT (padding fijo, protocolo §3).
    pub fn to_key(&self) -> String {
        format!("{:020}:{:010}:{}", self.wall, self.counter, self.node)
    }

    pub fn parse(s: &str) -> Option<Hlc> {
        let mut parts = s.splitn(3, ':');
        let wall = parts.next()?.parse().ok()?;
        let counter = parts.next()?.parse().ok()?;
        let node = parts.next()?.to_string();
        Some(Hlc { wall, counter, node })
    }
}

/// Reloj HLC del proceso — un hub, un reloj, protegido por mutex porque
/// varias requests HTTP concurrentes pueden generar eventos a la vez.
pub struct HlcClock {
    last: Mutex<Hlc>,
}

impl HlcClock {
    pub fn new(node: impl Into<String>) -> Self {
        Self { last: Mutex::new(Hlc { wall: 0, counter: 0, node: node.into() }) }
    }

    /// Nuevo HLC para un evento LOCAL (protocolo §3, algoritmo "al generar").
    pub fn next_local(&self) -> Hlc {
        let mut last = self.last.lock().unwrap();
        let wall = now_ms().max(last.wall);
        let counter = if wall == last.wall { last.counter + 1 } else { 0 };
        let hlc = Hlc { wall, counter, node: last.node.clone() };
        *last = hlc.clone();
        hlc
    }

    /// Actualiza el reloj al recibir un evento remoto (protocolo §3,
    /// algoritmo "al recibir") — garantiza monotonía aunque el remoto traiga
    /// un wall más adelantado.
    pub fn observe_remote(&self, remote: &Hlc) {
        let mut last = self.last.lock().unwrap();
        let wall = now_ms().max(last.wall).max(remote.wall);
        let counter = if wall == last.wall && wall == remote.wall {
            last.counter.max(remote.counter) + 1
        } else if wall == last.wall {
            last.counter + 1
        } else if wall == remote.wall {
            remote.counter + 1
        } else {
            0
        };
        *last = Hlc { wall, counter, node: last.node.clone() };
    }
}

fn enqueue(conn: &Connection, hlc: &Hlc, aggregate: &str, aggregate_id: &str, op: &str, payload: &Value) {
    conn.execute(
        "INSERT INTO outbox (id,aggregate,aggregate_id,op,payload_json,hlc,origin_node,created_at,status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending')",
        params![uuid7(), aggregate, aggregate_id, op, payload.to_string(), hlc.to_key(), hlc.node, now_ms()],
    )
    .unwrap();
}

/// Encola una venta ya cobrada como hecho append-only (protocolo §5: dos
/// sucursales generan ids distintos, nunca chocan). Se llama DESPUÉS de que
/// `handle_checkout` ya insertó `sales`/`sale_items`/`payments` en la misma
/// transacción — el evento de outbox se graba en esa misma TX (mismo `conn`),
/// cumpliendo la garantía de "outbox transaccional" del protocolo.
pub fn enqueue_sale(conn: &Connection, clock: &HlcClock, sale_id: &str) {
    let hlc = clock.next_local();
    conn.execute("UPDATE sales SET hlc = ?1 WHERE id = ?2", params![hlc.to_key(), sale_id]).unwrap();

    let sale: Value = conn
        .query_row(
            "SELECT id,tenant_id,location_id,register_id,employee_id,customer_id,folio,datetime,subtotal,discount_total,tax_total,total,payment_status,status,seq,prev_hash,hash,created_at
             FROM sales WHERE id = ?1",
            params![sale_id],
            |r| Ok(json!({
                "id": r.get::<_, String>(0)?, "tenantId": r.get::<_, String>(1)?, "locationId": r.get::<_, String>(2)?,
                "registerId": r.get::<_, Option<String>>(3)?, "employeeId": r.get::<_, Option<String>>(4)?,
                "customerId": r.get::<_, Option<String>>(5)?, "folio": r.get::<_, String>(6)?, "datetime": r.get::<_, i64>(7)?,
                "subtotal": r.get::<_, i64>(8)?, "discountTotal": r.get::<_, i64>(9)?, "taxTotal": r.get::<_, i64>(10)?, "total": r.get::<_, i64>(11)?,
                "paymentStatus": r.get::<_, String>(12)?, "status": r.get::<_, String>(13)?, "seq": r.get::<_, i64>(14)?,
                "prevHash": r.get::<_, Option<String>>(15)?, "hash": r.get::<_, String>(16)?, "createdAt": r.get::<_, i64>(17)?,
            })),
        )
        .unwrap();

    let mut items_stmt = conn.prepare("SELECT id,product_id,name_snapshot,unit_price,qty,line_total,created_at FROM sale_items WHERE sale_id = ?1").unwrap();
    let items: Vec<Value> = items_stmt
        .query_map(params![sale_id], |r| Ok(json!({
            "id": r.get::<_, String>(0)?, "productId": r.get::<_, Option<String>>(1)?, "nameSnapshot": r.get::<_, String>(2)?,
            "unitPrice": r.get::<_, i64>(3)?, "qty": r.get::<_, f64>(4)?, "lineTotal": r.get::<_, i64>(5)?, "createdAt": r.get::<_, i64>(6)?,
        })))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut payments_stmt = conn.prepare("SELECT id,method,amount,created_at FROM payments WHERE sale_id = ?1").unwrap();
    let payments: Vec<Value> = payments_stmt
        .query_map(params![sale_id], |r| Ok(json!({
            "id": r.get::<_, String>(0)?, "method": r.get::<_, String>(1)?, "amount": r.get::<_, i64>(2)?, "createdAt": r.get::<_, i64>(3)?,
        })))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    enqueue(conn, &hlc, "sale", sale_id, "insert", &json!({ "sale": sale, "items": items, "payments": payments }));
}

/// Encola un movimiento de inventario ya insertado. CRDT por suma de deltas
/// (protocolo §5.1): aplicarlo en cualquier nodo/orden converge al mismo
/// stock porque `inventory.qty` se recalcula por trigger (0010) sobre
/// `SUM(qty_delta)`, nunca se sobrescribe.
pub fn enqueue_inventory_movement(conn: &Connection, clock: &HlcClock, movement_id: &str) {
    let hlc = clock.next_local();
    conn.execute("UPDATE inventory_movements SET hlc = ?1 WHERE id = ?2", params![hlc.to_key(), movement_id]).unwrap();

    let payload: Value = conn
        .query_row(
            "SELECT id,tenant_id,location_id,product_id,variant_id,type,qty_delta,unit_cost,ref_doc,reason,employee_id,lot,expires_at,created_at
             FROM inventory_movements WHERE id = ?1",
            params![movement_id],
            |r| Ok(json!({
                "id": r.get::<_, String>(0)?, "tenantId": r.get::<_, String>(1)?, "locationId": r.get::<_, String>(2)?,
                "productId": r.get::<_, String>(3)?, "variantId": r.get::<_, Option<String>>(4)?, "type": r.get::<_, String>(5)?,
                "qtyDelta": r.get::<_, f64>(6)?, "unitCost": r.get::<_, Option<i64>>(7)?, "refDoc": r.get::<_, Option<String>>(8)?,
                "reason": r.get::<_, Option<String>>(9)?, "employeeId": r.get::<_, Option<String>>(10)?, "lot": r.get::<_, Option<String>>(11)?,
                "expiresAt": r.get::<_, Option<i64>>(12)?, "createdAt": r.get::<_, i64>(13)?,
            })),
        )
        .unwrap();

    enqueue(conn, &hlc, "inventory_movement", movement_id, "insert", &payload);
}

/// Encola la fila completa de un cliente (catálogo, LWW por fila — v1
/// simplificado respecto al LWW-por-campo del protocolo §5.2, documentado
/// como limitación conocida: dos ediciones concurrentes a campos DISTINTOS
/// del mismo cliente hacen que una pise a la otra en vez de fusionarse).
pub fn enqueue_customer(conn: &Connection, clock: &HlcClock, customer_id: &str) {
    let hlc = clock.next_local();
    conn.execute("UPDATE customers SET hlc = ?1, dirty = 1 WHERE id = ?2", params![hlc.to_key(), customer_id]).unwrap();
    let payload = customer_row_json(conn, customer_id).unwrap();
    enqueue(conn, &hlc, "customer", customer_id, "update", &payload);
}

fn customer_row_json(conn: &Connection, customer_id: &str) -> Option<Value> {
    conn.query_row(
        "SELECT id,tenant_id,name,phone,email,tax_id,loyalty_points,credit_limit,balance,segment,created_at,updated_at,hlc,origin_node
         FROM customers WHERE id = ?1",
        params![customer_id],
        |r| Ok(json!({
            "id": r.get::<_, String>(0)?, "tenantId": r.get::<_, String>(1)?, "name": r.get::<_, String>(2)?,
            "phone": r.get::<_, Option<String>>(3)?, "email": r.get::<_, Option<String>>(4)?, "taxId": r.get::<_, Option<String>>(5)?,
            "loyaltyPoints": r.get::<_, i64>(6)?, "creditLimit": r.get::<_, i64>(7)?, "balance": r.get::<_, i64>(8)?,
            "segment": r.get::<_, Option<String>>(9)?, "createdAt": r.get::<_, i64>(10)?, "updatedAt": r.get::<_, i64>(11)?,
            "hlc": r.get::<_, Option<String>>(12)?, "originNode": r.get::<_, String>(13)?,
        })),
    )
    .optional()
    .unwrap()
}

fn audit_log_write(conn: &Connection, action: &str, entity: &str, entity_id: &str, before: Option<&Value>, after: Option<&Value>, origin_node: &str) {
    let now = now_ms();
    let seq: i64 = conn.query_row("SELECT COALESCE(MAX(seq),0) + 1 FROM audit_log", [], |r| r.get(0)).unwrap();
    let prev_hash: Option<String> = conn.query_row("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1", [], |r| r.get(0)).optional().unwrap().flatten();
    let before_json = before.map(|v| v.to_string());
    let after_json = after.map(|v| v.to_string());
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.clone().unwrap_or_default().as_bytes());
    hasher.update(action.as_bytes());
    hasher.update(entity_id.as_bytes());
    hasher.update(before_json.clone().unwrap_or_default().as_bytes());
    hasher.update(after_json.clone().unwrap_or_default().as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    conn.execute(
        "INSERT INTO audit_log (id,seq,actor,action,entity,entity_id,before_json,after_json,origin_node,ts,prev_hash,hash)
         VALUES (?1,?2,'sync',?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![uuid7(), seq, action, entity, entity_id, before_json, after_json, origin_node, now, prev_hash, hash],
    ).unwrap();
}

#[derive(Deserialize, Serialize, Clone)]
pub struct SyncEvent {
    pub id: String,
    pub aggregate: String,
    #[serde(rename = "aggregateId")]
    pub aggregate_id: String,
    pub op: String,
    #[serde(rename = "payloadJson")]
    pub payload_json: Value,
    pub hlc: String,
    #[serde(rename = "originNode")]
    pub origin_node: String,
}

/// `GET /sync/pull?since_hlc=X&limit=N` — lee el outbox local, el evento que
/// otro nodo (u otra "nube") consumiría de ESTE hub.
pub fn pull(conn: &Connection, since_hlc: &str, limit: i64) -> Value {
    let mut stmt = conn
        .prepare("SELECT id,aggregate,aggregate_id,op,payload_json,hlc,origin_node FROM outbox WHERE hlc > ?1 ORDER BY hlc ASC LIMIT ?2")
        .unwrap();
    let events: Vec<Value> = stmt
        .query_map(params![since_hlc, limit], |r| {
            let payload_str: String = r.get(4)?;
            Ok(json!({
                "id": r.get::<_, String>(0)?, "aggregate": r.get::<_, String>(1)?, "aggregateId": r.get::<_, String>(2)?,
                "op": r.get::<_, String>(3)?, "payloadJson": serde_json::from_str::<Value>(&payload_str).unwrap_or(Value::Null),
                "hlc": r.get::<_, String>(5)?, "originNode": r.get::<_, String>(6)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    let next_cursor = events.last().and_then(|e| e["hlc"].as_str()).unwrap_or(since_hlc).to_string();
    let has_more = events.len() as i64 == limit;
    json!({ "events": events, "nextCursor": next_cursor, "hasMore": has_more })
}

/// `POST /sync/push` — aplica eventos remotos, uno por transacción implícita
/// (la conexión ya opera en modo autocommit por statement, igual que el
/// resto del hub). Idempotente por `aggregate_id` existente localmente.
pub fn push(conn: &Connection, clock: &HlcClock, events: &[SyncEvent]) -> Value {
    let mut accepted = Vec::new();
    let mut duplicates = Vec::new();
    let mut rejected = Vec::new();

    for ev in events {
        let Some(remote_hlc) = Hlc::parse(&ev.hlc) else {
            rejected.push(json!({ "id": ev.id, "reason": "hlc inválido" }));
            continue;
        };
        clock.observe_remote(&remote_hlc);

        let result = match ev.aggregate.as_str() {
            "sale" => apply_sale(conn, &ev.aggregate_id, &ev.payload_json, &ev.origin_node),
            "inventory_movement" => apply_inventory_movement(conn, &ev.aggregate_id, &ev.payload_json, &ev.origin_node),
            "customer" => apply_customer_lww(conn, &ev.aggregate_id, &ev.payload_json, &ev.hlc, &ev.origin_node),
            other => Err(format!("aggregate desconocido: {other}")),
        };
        match result {
            Ok(true) => accepted.push(ev.id.clone()),
            Ok(false) => duplicates.push(ev.id.clone()),
            Err(reason) => rejected.push(json!({ "id": ev.id, "reason": reason })),
        }
    }

    json!({ "accepted": accepted, "duplicates": duplicates, "rejected": rejected })
}

/// `Ok(true)` = aplicado, `Ok(false)` = duplicado (no-op, ya existía).
fn apply_sale(conn: &Connection, sale_id: &str, payload: &Value, origin_node: &str) -> std::result::Result<bool, String> {
    let exists: bool = conn.query_row("SELECT 1 FROM sales WHERE id = ?1", params![sale_id], |_| Ok(true)).optional().map_err(|e| e.to_string())?.unwrap_or(false);
    if exists {
        return Ok(false);
    }
    let sale = &payload["sale"];
    conn.execute(
        "INSERT INTO sales (id,tenant_id,location_id,register_id,employee_id,customer_id,folio,datetime,subtotal,discount_total,tax_total,total,payment_status,status,seq,prev_hash,hash,created_at,origin_node,dirty)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,0)",
        params![
            sale_id, sale["tenantId"].as_str(), sale["locationId"].as_str(), sale["registerId"].as_str(), sale["employeeId"].as_str(),
            sale["customerId"].as_str(), sale["folio"].as_str(), sale["datetime"].as_i64(), sale["subtotal"].as_i64(), sale["discountTotal"].as_i64(),
            sale["taxTotal"].as_i64(), sale["total"].as_i64(), sale["paymentStatus"].as_str(), sale["status"].as_str(), sale["seq"].as_i64(),
            sale["prevHash"].as_str(), sale["hash"].as_str(), sale["createdAt"].as_i64(), origin_node,
        ],
    ).map_err(|e| e.to_string())?;

    for item in payload["items"].as_array().unwrap_or(&Vec::new()) {
        conn.execute(
            "INSERT INTO sale_items (id,sale_id,product_id,name_snapshot,unit_price,qty,line_total,created_at,origin_node)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![item["id"].as_str(), sale_id, item["productId"].as_str(), item["nameSnapshot"].as_str(), item["unitPrice"].as_i64(), item["qty"].as_f64(), item["lineTotal"].as_i64(), item["createdAt"].as_i64(), origin_node],
        ).map_err(|e| e.to_string())?;
    }
    for pay in payload["payments"].as_array().unwrap_or(&Vec::new()) {
        conn.execute(
            "INSERT INTO payments (id,sale_id,method,amount,created_at,origin_node) VALUES (?1,?2,?3,?4,?5,?6)",
            params![pay["id"].as_str(), sale_id, pay["method"].as_str(), pay["amount"].as_i64(), pay["createdAt"].as_i64(), origin_node],
        ).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

fn apply_inventory_movement(conn: &Connection, movement_id: &str, payload: &Value, origin_node: &str) -> std::result::Result<bool, String> {
    let exists: bool = conn.query_row("SELECT 1 FROM inventory_movements WHERE id = ?1", params![movement_id], |_| Ok(true)).optional().map_err(|e| e.to_string())?.unwrap_or(false);
    if exists {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO inventory_movements (id,tenant_id,location_id,product_id,variant_id,type,qty_delta,unit_cost,ref_doc,reason,employee_id,lot,expires_at,created_at,origin_node)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            movement_id, payload["tenantId"].as_str(), payload["locationId"].as_str(), payload["productId"].as_str(), payload["variantId"].as_str(),
            payload["type"].as_str(), payload["qtyDelta"].as_f64(), payload["unitCost"].as_i64(), payload["refDoc"].as_str(), payload["reason"].as_str(),
            payload["employeeId"].as_str(), payload["lot"].as_str(), payload["expiresAt"].as_i64(), payload["createdAt"].as_i64(), origin_node,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(true) // el trigger de 0010 recalcula `inventory.qty` — convergencia CRDT automática
}

/// LWW por fila (protocolo §5.2, simplificado de por-campo a por-fila — ver
/// nota en `enqueue_customer`). El HLC más alto gana; el valor perdedor
/// siempre se conserva en `audit_log`, nunca se descarta en silencio.
fn apply_customer_lww(conn: &Connection, customer_id: &str, payload: &Value, remote_hlc_str: &str, remote_node: &str) -> std::result::Result<bool, String> {
    let local = customer_row_json(conn, customer_id);
    let remote_hlc = Hlc::parse(remote_hlc_str).ok_or("hlc inválido")?;

    let remota_gana = match &local {
        None => true,
        Some(row) => match row["hlc"].as_str().and_then(Hlc::parse) {
            Some(local_hlc) => remote_hlc > local_hlc,
            None => true, // fila local nunca sincronizada (hlc NULL) pierde ante cualquier evento remoto con HLC real
        },
    };

    if remota_gana {
        conn.execute(
            "INSERT INTO customers (id,tenant_id,name,phone,email,tax_id,loyalty_points,credit_limit,balance,segment,created_at,updated_at,origin_node,hlc,dirty)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,0)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, phone=excluded.phone, email=excluded.email, tax_id=excluded.tax_id,
               loyalty_points=excluded.loyalty_points, credit_limit=excluded.credit_limit, balance=excluded.balance,
               segment=excluded.segment, updated_at=excluded.updated_at, origin_node=excluded.origin_node, hlc=excluded.hlc, dirty=0",
            params![
                customer_id, payload["tenantId"].as_str(), payload["name"].as_str(), payload["phone"].as_str(), payload["email"].as_str(),
                payload["taxId"].as_str(), payload["loyaltyPoints"].as_i64(), payload["creditLimit"].as_i64(), payload["balance"].as_i64(),
                payload["segment"].as_str(), payload["createdAt"].as_i64(), payload["updatedAt"].as_i64(), remote_node, remote_hlc_str,
            ],
        ).map_err(|e| e.to_string())?;
        if let Some(before) = &local {
            audit_log_write(conn, "sync.lww_overwrite", "customer", customer_id, Some(before), Some(payload), remote_node);
        }
    } else {
        audit_log_write(conn, "sync.lww_overwrite", "customer", customer_id, Some(payload), local.as_ref(), remote_node);
    }
    Ok(true)
}
