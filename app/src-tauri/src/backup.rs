//! Snapshot JSON del hub para respaldo cifrado (Fase 6 §10.7). El cifrado en
//! sí (AES-256-GCM + PBKDF2) vive en el navegador — mismo módulo que
//! pos-inteligente (`app/src/app/usecases/encryptedBackup.ts`, copiado tal
//! cual, ADR-1 §2.1) — porque Web Crypto ya resuelve esto sin dependencias
//! nuevas en Rust. Este módulo solo arma el JSON que se cifra.
use rusqlite::{types::ValueRef, Connection};
use serde_json::{json, Map, Value};

/// Tablas que forman el respaldo lógico del restaurante — deliberadamente
/// NO incluye `hub_events`/`hub_commands` (protocolo LAN, no datos de
/// negocio) ni `schema_migrations` (se reconstruye al aplicar migraciones).
const BACKUP_TABLES: &[&str] = &[
    "tenants", "locations", "registers", "roles", "employees",
    "taxes", "tax_profiles", "units", "categories", "products",
    "tables", "modifier_groups", "modifier_options",
    "recipes", "recipe_items", "modifier_recipe_deltas",
    "orders", "order_items", "order_item_events", "order_item_modifiers", "order_sales",
    "shifts", "tips", "tip_pool_configs", "shift_tip_distributions",
    "inventory", "inventory_movements",
    "sales", "sale_items", "payments",
];

fn dump_table(conn: &Connection, table: &str) -> Value {
    let mut col_stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
    let columns: Vec<String> = col_stmt
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let select = format!("SELECT {} FROM {table}", columns.join(","));
    let mut stmt = match conn.prepare(&select) {
        Ok(s) => s,
        Err(_) => return Value::Array(vec![]), // tabla no existe todavía en esta BD
    };

    let rows = stmt
        .query_map([], |row| {
            let mut obj = Map::new();
            for (i, col) in columns.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(f) => json!(f),
                    ValueRef::Text(t) => json!(String::from_utf8_lossy(t).into_owned()),
                    ValueRef::Blob(_) => Value::Null, // no hay columnas BLOB en este esquema
                };
                obj.insert(col.clone(), value);
            }
            Ok(Value::Object(obj))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();

    Value::Array(rows)
}

/// Snapshot completo: `{ "version": "restaurantos-1", "exportedAt": <ms>, "tables": { "orders": [...], ... } }`
pub fn build_snapshot(conn: &Connection, now_ms: i64) -> Value {
    let mut tables = Map::new();
    for &table in BACKUP_TABLES {
        tables.insert(table.to_string(), dump_table(conn, table));
    }
    json!({ "version": "restaurantos-1", "exportedAt": now_ms, "tables": Value::Object(tables) })
}
