//! Lógica de dominio del hub sobre SQLite: comandas, descuento de inventario
//! por receta, cobro (Caja) y turnos/propinas. Fase 6 §10, puntos 1/2/3/5.
//! Cada función abre su propia transacción — "TX atómica con outbox" (PLAN.md
//! §12), aunque aquí el "outbox" es `hub_events` (protocolo LAN), no el
//! `outbox` de sync hub↔nube (0001), que es un problema distinto.
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::seed;

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

pub fn uuid7() -> String {
    uuid::Uuid::now_v7().to_string()
}

#[derive(Debug)]
pub struct DomainError(pub String);
impl std::fmt::Display for DomainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
type Result<T> = std::result::Result<T, DomainError>;

fn err(msg: impl Into<String>) -> DomainError {
    DomainError(msg.into())
}

/// La API habla español (efectivo/tarjeta, como el ticket de spike 2); el
/// esquema (0006/0014) usa las claves en inglés que ya trae el CHECK
/// constraint de `tips.method` ('cash','card'). Se normaliza en la frontera.
fn normalize_payment_method(s: &str) -> &'static str {
    match s {
        "efectivo" | "cash" => "cash",
        "tarjeta" | "card" => "card",
        _ => "cash",
    }
}

// ---------------------------------------------------------------------------
// Comandos del protocolo LAN (nueva_comanda / bump_platillo)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ModifierRef {
    #[serde(rename = "groupId")]
    pub group_id: String,
    #[serde(rename = "optionId")]
    pub option_id: String,
}

#[derive(Deserialize)]
pub struct NuevaComandaItem {
    #[serde(rename = "productId")]
    pub product_id: String,
    pub cantidad: f64,
    #[serde(default)]
    pub modificadores: Vec<ModifierRef>,
    pub notas: Option<String>,
}

#[derive(Deserialize)]
pub struct NuevaComandaPayload {
    #[serde(rename = "tableNumber")]
    pub table_number: i64,
    pub items: Vec<NuevaComandaItem>,
}

/// Procesa `nueva_comanda`: abre (o reutiliza) la comanda de la mesa y agrega
/// los ítems con sus modificadores (snapshot). Devuelve el payload enriquecido
/// que se difunde a KDS/Caja (con nombres, no solo ids).
pub fn handle_nueva_comanda(conn: &Connection, payload: &NuevaComandaPayload) -> Result<Value> {
    let now = now_ms();

    let table_id: String = conn
        .query_row(
            "SELECT id FROM tables WHERE location_id = ?1 AND number = ?2",
            params![seed::LOCATION, payload.table_number],
            |r| r.get(0),
        )
        .map_err(|_| err(format!("mesa {} no existe", payload.table_number)))?;

    let order_id: String = conn
        .query_row(
            "SELECT id FROM orders WHERE table_id = ?1 AND status = 'abierta'",
            params![table_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| err(e.to_string()))?
        .unwrap_or_else(|| {
            let id = uuid7();
            conn.execute(
                "INSERT INTO orders (id,tenant_id,location_id,table_id,employee_id,guests,status,opened_at,created_at,updated_at,origin_node)
                 VALUES (?1,?2,?3,?4,?5,1,'abierta',?6,?6,?6,?7)",
                params![id, seed::TENANT, seed::LOCATION, table_id, seed::EMPLOYEE_MESERO, now, seed::NODE],
            ).unwrap();
            id
        });

    let mut item_summaries = Vec::new();

    for item in &payload.items {
        let (name, price_cents, category_id): (String, i64, String) = conn
            .query_row(
                "SELECT name, price, category_id FROM products WHERE id = ?1",
                params![item.product_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| err(format!("producto {} no existe", item.product_id)))?;

        let order_item_id = uuid7();
        let course = seed::course_for_category(&category_id);
        conn.execute(
            "INSERT INTO order_items (id,order_id,product_id,name_snapshot,course,qty,unit_price,notes,status,sent_at,created_at,updated_at,origin_node)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pendiente',?9,?9,?9,?10)",
            params![order_item_id, order_id, item.product_id, name, course, item.cantidad, price_cents, item.notas, now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;

        let mut modificadores_json = Vec::new();
        for m in &item.modificadores {
            let (opt_name, delta): (String, i64) = conn
                .query_row(
                    "SELECT name, price_delta FROM modifier_options WHERE id = ?1",
                    params![m.option_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| err(format!("modificador {} no existe", m.option_id)))?;
            conn.execute(
                "INSERT INTO order_item_modifiers (id,order_item_id,group_id,option_id,name_snapshot,price_delta_snapshot,created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![uuid7(), order_item_id, m.group_id, m.option_id, opt_name, delta, now],
            ).map_err(|e| err(e.to_string()))?;
            modificadores_json.push(json!({ "nombre": opt_name, "ajusteCents": delta }));
        }

        item_summaries.push(json!({
            "orderItemId": order_item_id,
            "productId": item.product_id,
            "nombre": name,
            "cantidad": item.cantidad,
            "unitPriceCents": price_cents,
            "modificadores": modificadores_json,
            "notas": item.notas,
            "estado": "pendiente",
        }));
    }

    Ok(json!({
        "orderId": order_id,
        "mesa": payload.table_number,
        "items": item_summaries,
    }))
}

#[derive(Deserialize)]
pub struct BumpPlatilloPayload {
    #[serde(rename = "orderItemId")]
    pub order_item_id: String,
    #[serde(rename = "nextStatus")]
    pub next_status: String,
}

/// Procesa `bump_platillo`. Al entrar a 'en_preparacion' descuenta inventario
/// por receta (docs/modelo-dominio.md regla 3) — NO es un trigger SQL, es
/// lógica de dominio explícita, mismo criterio que 0010/checkoutSale.
pub fn handle_bump_platillo(conn: &Connection, payload: &BumpPlatilloPayload) -> Result<Value> {
    let now = now_ms();

    let (product_id, qty, order_id): (String, f64, String) = conn
        .query_row(
            "SELECT product_id, qty, order_id FROM order_items WHERE id = ?1",
            params![payload.order_item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| err(format!("order_item {} no existe", payload.order_item_id)))?;

    let table_number: i64 = conn
        .query_row(
            "SELECT t.number FROM orders o JOIN tables t ON t.id = o.table_id WHERE o.id = ?1",
            params![order_id],
            |r| r.get(0),
        )
        .map_err(|e| err(e.to_string()))?;

    if payload.next_status == "en_preparacion" {
        let recipe_id: Option<String> = conn
            .query_row("SELECT id FROM recipes WHERE product_id = ?1", params![product_id], |r| r.get(0))
            .optional()
            .map_err(|e| err(e.to_string()))?;

        if let Some(recipe_id) = recipe_id {
            let mut stmt = conn
                .prepare("SELECT ingredient_id, qty FROM recipe_items WHERE recipe_id = ?1")
                .map_err(|e| err(e.to_string()))?;
            let rows: Vec<(String, f64)> = stmt
                .query_map(params![recipe_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| err(e.to_string()))?
                .filter_map(|r| r.ok())
                .collect();
            for (ingredient_id, recipe_qty) in rows {
                let delta = -(recipe_qty * qty);
                conn.execute(
                    "INSERT INTO inventory_movements (id,tenant_id,location_id,product_id,type,qty_delta,created_at,origin_node)
                     VALUES (?1,?2,?3,?4,'sale',?5,?6,?7)",
                    params![uuid7(), seed::TENANT, seed::LOCATION, ingredient_id, delta, now, seed::NODE],
                ).map_err(|e| err(e.to_string()))?;
            }
        }
    }

    conn.execute(
        "UPDATE order_items SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![payload.next_status, now, payload.order_item_id],
    ).map_err(|e| err(e.to_string()))?;
    conn.execute(
        "INSERT INTO order_item_events (id,order_item_id,status,at,employee_id,created_at,origin_node) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![uuid7(), payload.order_item_id, payload.next_status, now, seed::EMPLOYEE_COCINA, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;

    Ok(json!({
        "orderItemId": payload.order_item_id,
        "nextStatus": payload.next_status,
        "mesa": table_number,
    }))
}

// ---------------------------------------------------------------------------
// Consultas para Caja (HTTP)
// ---------------------------------------------------------------------------

pub fn menu_json(conn: &Connection) -> Value {
    let mut cat_stmt = conn.prepare("SELECT id, name FROM categories WHERE id != 'cat_insumos' ORDER BY name").unwrap();
    let categorias: Vec<Value> = cat_stmt
        .query_map([], |r| Ok(json!({ "id": r.get::<_, String>(0)?, "nombre": r.get::<_, String>(1)? })))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut prod_stmt = conn
        .prepare("SELECT id, name, category_id, price FROM products WHERE category_id != 'cat_insumos' ORDER BY name")
        .unwrap();
    let items: Vec<Value> = prod_stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            let name: String = r.get(1)?;
            let category_id: String = r.get(2)?;
            let price: i64 = r.get(3)?;
            Ok((id, name, category_id, price))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .map(|(id, name, category_id, price)| {
            let mut grp_stmt = conn
                .prepare("SELECT id, name, single_choice, required FROM modifier_groups WHERE product_id = ?1 ORDER BY sort_order")
                .unwrap();
            let groups: Vec<Value> = grp_stmt
                .query_map(params![id], |r| {
                    let gid: String = r.get(0)?;
                    let gname: String = r.get(1)?;
                    let single: i64 = r.get(2)?;
                    let required: i64 = r.get(3)?;
                    Ok((gid, gname, single, required))
                })
                .unwrap()
                .filter_map(|r| r.ok())
                .map(|(gid, gname, single, required)| {
                    let mut opt_stmt = conn
                        .prepare("SELECT id, name, price_delta FROM modifier_options WHERE group_id = ?1 ORDER BY sort_order")
                        .unwrap();
                    let opciones: Vec<Value> = opt_stmt
                        .query_map(params![gid], |r| {
                            Ok(json!({ "id": r.get::<_, String>(0)?, "nombre": r.get::<_, String>(1)?, "ajusteCents": r.get::<_, i64>(2)? }))
                        })
                        .unwrap()
                        .filter_map(|r| r.ok())
                        .collect();
                    json!({ "id": gid, "nombre": gname, "seleccionUnica": single == 1, "requerido": required == 1, "opciones": opciones })
                })
                .collect();
            json!({
                "id": id, "nombre": name, "categoria": category_id,
                "tiempo": seed::course_for_category(&category_id),
                "precioCents": price, "modifierGroups": groups,
            })
        })
        .collect();

    json!({ "categorias": categorias, "items": items })
}

pub fn tables_json(conn: &Connection) -> Value {
    let mut stmt = conn.prepare("SELECT id, number, status, capacity FROM tables WHERE deleted_at IS NULL ORDER BY number").unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "numero": r.get::<_, i64>(1)?,
                "estado": r.get::<_, String>(2)?,
                "capacidad": r.get::<_, i64>(3)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}

fn order_item_total_cents(conn: &Connection, order_item_id: &str, unit_price: i64, qty: f64) -> i64 {
    let delta_sum: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(price_delta_snapshot),0) FROM order_item_modifiers WHERE order_item_id = ?1",
            params![order_item_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    ((unit_price + delta_sum) as f64 * qty).round() as i64
}

pub fn open_orders_json(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT o.id, t.number, o.opened_at FROM orders o JOIN tables t ON t.id = o.table_id WHERE o.status = 'abierta' ORDER BY o.opened_at")
        .unwrap();
    let orders: Vec<(String, i64, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let result: Vec<Value> = orders
        .into_iter()
        .map(|(order_id, table_number, opened_at)| order_summary_json(conn, &order_id, table_number, opened_at))
        .collect();
    Value::Array(result)
}

fn order_summary_json(conn: &Connection, order_id: &str, table_number: i64, opened_at: i64) -> Value {
    let mut stmt = conn
        .prepare("SELECT id, product_id, name_snapshot, qty, unit_price, status, notes FROM order_items WHERE order_id = ?1 AND status != 'cancelado'")
        .unwrap();
    let mut total_cents = 0_i64;
    let items: Vec<Value> = stmt
        .query_map(params![order_id], |r| {
            let id: String = r.get(0)?;
            let product_id: String = r.get(1)?;
            let name: String = r.get(2)?;
            let qty: f64 = r.get(3)?;
            let unit_price: i64 = r.get(4)?;
            let status: String = r.get(5)?;
            let notas: Option<String> = r.get(6)?;
            Ok((id, product_id, name, qty, unit_price, status, notas))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .map(|(id, product_id, name, qty, unit_price, status, notas)| {
            let line_total = order_item_total_cents(conn, &id, unit_price, qty);
            total_cents += line_total;
            json!({
                "orderItemId": id, "productId": product_id, "nombre": name, "cantidad": qty,
                "unitPriceCents": unit_price, "lineTotalCents": line_total, "estado": status, "notas": notas,
            })
        })
        .collect();

    json!({ "orderId": order_id, "mesa": table_number, "openedAt": opened_at, "items": items, "totalCents": total_cents })
}

// ---------------------------------------------------------------------------
// Cobro (Caja) — genera venta(s) inmutable(s) + cierra la comanda
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CheckoutPayload {
    #[serde(rename = "orderId")]
    pub order_id: String,
    #[serde(rename = "splitMode", default = "default_split_mode")]
    pub split_mode: String,
    #[serde(default = "default_partes")]
    pub partes: i64,
    #[serde(rename = "paymentMethod")]
    pub payment_method: String,
    #[serde(rename = "tipCents", default)]
    pub tip_cents: i64,
    #[serde(rename = "shiftId")]
    pub shift_id: Option<String>,
}
fn default_split_mode() -> String { "completo".into() }
fn default_partes() -> i64 { 1 }

fn next_hash(conn: &Connection, location_id: &str, seq: i64, payload: &str) -> (Option<String>, String) {
    let prev_hash: Option<String> = conn
        .query_row(
            "SELECT hash FROM sales WHERE location_id = ?1 ORDER BY seq DESC LIMIT 1",
            params![location_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
        .flatten();
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.clone().unwrap_or_default().as_bytes());
    hasher.update(seq.to_string().as_bytes());
    hasher.update(payload.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    (prev_hash, hash)
}

pub fn handle_checkout(conn: &Connection, payload: &CheckoutPayload) -> Result<Value> {
    let now = now_ms();
    let table_number: i64 = conn
        .query_row(
            "SELECT t.number FROM orders o JOIN tables t ON t.id = o.table_id WHERE o.id = ?1 AND o.status = 'abierta'",
            params![payload.order_id],
            |r| r.get(0),
        )
        .map_err(|_| err("comanda no existe o ya está cerrada"))?;

    let summary = order_summary_json(conn, &payload.order_id, table_number, 0);
    let total_cents = summary["totalCents"].as_i64().unwrap_or(0);
    if total_cents <= 0 {
        return Err(err("la comanda no tiene ítems por cobrar"));
    }

    let partes = if payload.split_mode == "completo" { 1 } else { payload.partes.max(2) };
    let mut sale_ids = Vec::new();
    let mut remaining = total_cents;

    for i in 0..partes {
        let monto = if i == partes - 1 { remaining } else { (total_cents as f64 / partes as f64).round() as i64 };
        remaining -= monto;

        let subtotal = (monto as f64 / 1.16).round() as i64;
        let tax = monto - subtotal;
        let seq: i64 = conn
            .query_row("SELECT COALESCE(MAX(seq),0) + 1 FROM sales WHERE location_id = ?1", params![seed::LOCATION], |r| r.get(0))
            .unwrap();
        let sale_id = uuid7();
        let folio = format!("F-{:06}", seq);
        let (prev_hash, hash) = next_hash(conn, seed::LOCATION, seq, &format!("{sale_id}{monto}"));

        conn.execute(
            "INSERT INTO sales (id,tenant_id,location_id,register_id,employee_id,folio,datetime,subtotal,tax_total,total,payment_status,status,seq,prev_hash,hash,created_at,origin_node)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'paid','completed',?11,?12,?13,?14,?15)",
            params![sale_id, seed::TENANT, seed::LOCATION, seed::REGISTER, seed::EMPLOYEE_CAJERO, folio, now, subtotal, tax, monto, seq, prev_hash, hash, now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;

        if partes == 1 {
            for item in summary["items"].as_array().unwrap() {
                conn.execute(
                    "INSERT INTO sale_items (id,sale_id,product_id,name_snapshot,unit_price,qty,line_total,created_at,origin_node)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    params![
                        uuid7(), sale_id, item["productId"].as_str().unwrap(), item["nombre"].as_str().unwrap(),
                        item["unitPriceCents"].as_i64().unwrap(), item["cantidad"].as_f64().unwrap(),
                        item["lineTotalCents"].as_i64().unwrap(), now, seed::NODE,
                    ],
                ).map_err(|e| err(e.to_string()))?;
            }
        } else {
            conn.execute(
                "INSERT INTO sale_items (id,sale_id,name_snapshot,unit_price,qty,line_total,created_at,origin_node)
                 VALUES (?1,?2,?3,?4,1,?4,?5,?6)",
                params![uuid7(), sale_id, format!("División de cuenta ({}/{})", i + 1, partes), monto, now, seed::NODE],
            ).map_err(|e| err(e.to_string()))?;
        }

        conn.execute(
            "INSERT INTO payments (id,sale_id,method,amount,created_at,origin_node) VALUES (?1,?2,?3,?4,?5,?6)",
            params![uuid7(), sale_id, normalize_payment_method(&payload.payment_method), monto, now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;
        conn.execute(
            "INSERT INTO order_sales (id,order_id,sale_id,created_at) VALUES (?1,?2,?3,?4)",
            params![uuid7(), payload.order_id, sale_id, now],
        ).map_err(|e| err(e.to_string()))?;

        sale_ids.push(sale_id);
    }

    if payload.tip_cents > 0 {
        conn.execute(
            "INSERT INTO tips (id,tenant_id,sale_id,shift_id,amount,method,created_at,origin_node) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![uuid7(), seed::TENANT, sale_ids.last().unwrap(), payload.shift_id, payload.tip_cents, normalize_payment_method(&payload.payment_method), now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;
    }

    conn.execute(
        "UPDATE orders SET status = 'cerrada', closed_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, payload.order_id],
    ).map_err(|e| err(e.to_string()))?;

    Ok(json!({ "saleIds": sale_ids, "totalCents": total_cents, "partes": partes, "mesa": table_number }))
}

// ---------------------------------------------------------------------------
// Turnos y propinas
// ---------------------------------------------------------------------------

pub fn open_shift(conn: &Connection, employee_id: &str) -> Result<Value> {
    let now = now_ms();
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM shifts WHERE employee_id = ?1 AND status = 'abierto'",
            params![employee_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| err(e.to_string()))?;
    if let Some(id) = existing {
        return Ok(json!({ "shiftId": id, "reused": true }));
    }
    let id = uuid7();
    conn.execute(
        "INSERT INTO shifts (id,tenant_id,location_id,employee_id,started_at,status,created_at,updated_at,origin_node)
         VALUES (?1,?2,?3,?4,?5,'abierto',?5,?5,?6)",
        params![id, seed::TENANT, seed::LOCATION, employee_id, now, seed::NODE],
    ).map_err(|e| err(e.to_string()))?;
    Ok(json!({ "shiftId": id, "reused": false }))
}

pub fn close_shift(conn: &Connection, shift_id: &str) -> Result<Value> {
    let now = now_ms();
    let employee_id: String = conn
        .query_row("SELECT employee_id FROM shifts WHERE id = ?1", params![shift_id], |r| r.get(0))
        .map_err(|_| err("turno no existe"))?;

    let total_tips: i64 = conn
        .query_row("SELECT COALESCE(SUM(amount),0) FROM tips WHERE shift_id = ?1", params![shift_id], |r| r.get(0))
        .unwrap_or(0);

    let config_id: Option<String> = conn
        .query_row(
            "SELECT id FROM tip_pool_configs WHERE location_id = ?1 ORDER BY active_from DESC LIMIT 1",
            params![seed::LOCATION],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
        .flatten();

    // Modo soportado en Fase 6: 'individual' (el mesero se queda su propina).
    // 'pool_turno'/'pool_ventas' requieren repartir entre VARIOS turnos
    // simultáneos — no implementado aún, se aplica individual como fallback
    // documentado (DECISIÓN AUTÓNOMA, ver PLAN.md bitácora).
    if total_tips > 0 {
        conn.execute(
            "INSERT INTO shift_tip_distributions (id,shift_id,employee_id,amount,config_id,created_at,origin_node)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![uuid7(), shift_id, employee_id, total_tips, config_id, now, seed::NODE],
        ).map_err(|e| err(e.to_string()))?;
    }

    conn.execute(
        "UPDATE shifts SET status = 'cerrado', ended_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, shift_id],
    ).map_err(|e| err(e.to_string()))?;

    Ok(json!({ "shiftId": shift_id, "employeeId": employee_id, "totalTipsCents": total_tips }))
}

pub fn tips_summary_json(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT shift_id, employee_id, amount FROM shift_tip_distributions ORDER BY created_at DESC")
        .unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            Ok(json!({ "shiftId": r.get::<_, String>(0)?, "employeeId": r.get::<_, String>(1)?, "amountCents": r.get::<_, i64>(2)? }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    Value::Array(rows)
}
