//! Auditoría avanzada (Fase 8 §10.2 punto 3) — UI real sobre `audit_log`
//! (0001, hash-encadenado), que ya se escribe de verdad desde el punto 1 de
//! esta fase (`sync::apply_customer_lww` registra ahí cada resolución de
//! conflicto). Este módulo agrega: listado filtrable y verificación de
//! integridad de la cadena completa (mismo principio que la cadena de
//! `sales`, pero aplicado a la bitácora de auditoría general).
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub fn list(conn: &Connection, entity: Option<&str>, limit: i64) -> Value {
    let mut stmt = if entity.is_some() {
        conn.prepare("SELECT id,seq,actor,action,entity,entity_id,before_json,after_json,origin_node,ts FROM audit_log WHERE entity = ?1 ORDER BY seq DESC LIMIT ?2").unwrap()
    } else {
        conn.prepare("SELECT id,seq,actor,action,entity,entity_id,before_json,after_json,origin_node,ts FROM audit_log ORDER BY seq DESC LIMIT ?1").unwrap()
    };

    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<Value> {
        Ok(json!({
            "id": r.get::<_, String>(0)?, "seq": r.get::<_, i64>(1)?, "actor": r.get::<_, Option<String>>(2)?,
            "action": r.get::<_, String>(3)?, "entity": r.get::<_, String>(4)?, "entityId": r.get::<_, Option<String>>(5)?,
            "beforeJson": r.get::<_, Option<String>>(6)?.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
            "afterJson": r.get::<_, Option<String>>(7)?.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
            "originNode": r.get::<_, String>(8)?, "ts": r.get::<_, i64>(9)?,
        }))
    };

    let rows: Vec<Value> = if let Some(e) = entity {
        stmt.query_map(params![e, limit], map_row).unwrap().filter_map(|r| r.ok()).collect()
    } else {
        stmt.query_map(params![limit], map_row).unwrap().filter_map(|r| r.ok()).collect()
    };
    json!(rows)
}

/// Recalcula la cadena de hash completa desde `seq=1` y confirma que cada
/// registro coincide con lo que `sync::audit_log_write` habría producido —
/// si alguien edita o borra una fila de `audit_log` directamente en SQLite
/// (sin pasar por el código), la cadena deja de cuadrar desde ese punto.
pub fn verify_chain(conn: &Connection) -> Value {
    let mut stmt = conn
        .prepare("SELECT seq,action,entity_id,before_json,after_json,prev_hash,hash FROM audit_log ORDER BY seq ASC")
        .unwrap();
    let rows: Vec<(i64, String, String, Option<String>, Option<String>, Option<String>, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut expected_prev: Option<String> = None;
    for (seq, action, entity_id, before_json, after_json, prev_hash, hash) in &rows {
        if *prev_hash != expected_prev {
            return json!({ "valid": false, "brokenAtSeq": seq, "totalRecords": rows.len(), "reason": "prev_hash no encadena con el registro anterior" });
        }
        let mut hasher = Sha256::new();
        hasher.update(prev_hash.clone().unwrap_or_default().as_bytes());
        hasher.update(action.as_bytes());
        hasher.update(entity_id.as_bytes());
        hasher.update(before_json.clone().unwrap_or_default().as_bytes());
        hasher.update(after_json.clone().unwrap_or_default().as_bytes());
        let recomputed = format!("{:x}", hasher.finalize());
        if &recomputed != hash {
            return json!({ "valid": false, "brokenAtSeq": seq, "totalRecords": rows.len(), "reason": "hash no coincide con el contenido del registro" });
        }
        expected_prev = Some(hash.clone());
    }
    json!({ "valid": true, "brokenAtSeq": Value::Null, "totalRecords": rows.len() })
}
