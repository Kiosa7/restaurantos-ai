//! API pública (Fase 8 §10.2 punto 4): un subconjunto de solo-lectura de los
//! endpoints ya existentes, para integraciones de terceros (contabilidad,
//! agregadores de delivery reales) — protegido por API key con scopes, NO
//! el hub LAN completo (ese está pensado para tablets de confianza dentro
//! de la red del restaurante, sin auth de token — exponerlo tal cual a
//! Internet sería el error).
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::commands::{err, now_ms, uuid7, DomainError};
type Result<T> = std::result::Result<T, DomainError>;

fn hash_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("restaurantos:apikey:{key}").as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Deserialize)]
pub struct CreateApiKeyPayload {
    pub name: String,
    pub scopes: Vec<String>,
}

/// Genera una key en claro de una sola vez (como un pairing code, pero sin
/// expiración) — el hub SOLO guarda el hash, igual que con los PIN.
pub fn create_api_key(conn: &Connection, payload: &CreateApiKeyPayload) -> Result<Value> {
    if payload.name.trim().is_empty() {
        return Err(err("la API key necesita un nombre (para qué integración es)"));
    }
    let valid_scopes = ["sales.read", "menu.read"];
    for s in &payload.scopes {
        if !valid_scopes.contains(&s.as_str()) {
            return Err(err(format!("scope inválido: {s} (válidos: {})", valid_scopes.join(", "))));
        }
    }
    let mut raw = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut raw);
    let key = format!("rak_{}", raw.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let id = uuid7();
    let now = now_ms();
    conn.execute(
        "INSERT INTO api_keys (id,name,key_hash,scopes_json,created_at,origin_node) VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, payload.name, hash_key(&key), json!(payload.scopes).to_string(), now, crate::seed::node()],
    ).map_err(|e| err(e.to_string()))?;
    Ok(json!({ "id": id, "name": payload.name, "key": key, "nota": "Esta key en claro solo se muestra una vez — guárdala ahora." }))
}

pub fn list_api_keys(conn: &Connection) -> Value {
    let mut stmt = conn.prepare("SELECT id, name, scopes_json, created_at, revoked_at, last_used_at FROM api_keys ORDER BY created_at DESC").unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            let scopes: String = r.get(2)?;
            Ok(json!({
                "id": r.get::<_, String>(0)?, "name": r.get::<_, String>(1)?,
                "scopes": serde_json::from_str::<Value>(&scopes).unwrap_or(json!([])),
                "createdAt": r.get::<_, i64>(3)?, "revokedAt": r.get::<_, Option<i64>>(4)?, "lastUsedAt": r.get::<_, Option<i64>>(5)?,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    json!(rows)
}

pub fn revoke_api_key(conn: &Connection, id: &str) -> Result<Value> {
    let now = now_ms();
    let updated = conn
        .execute("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2 AND revoked_at IS NULL", params![now, id])
        .map_err(|e| err(e.to_string()))?;
    if updated == 0 {
        return Err(err("la API key no existe o ya estaba revocada"));
    }
    Ok(json!({ "id": id, "revoked": true }))
}

/// Valida el header `Authorization: Bearer <key>` contra `api_keys` y
/// confirma que el scope pedido está autorizado — usado por cada endpoint
/// de `/api/v1/*` antes de responder.
pub fn authenticate(conn: &Connection, bearer_key: &str, required_scope: &str) -> Result<()> {
    let row: Option<(String, String, Option<i64>)> = conn
        .query_row("SELECT id, scopes_json, revoked_at FROM api_keys WHERE key_hash = ?1", params![hash_key(bearer_key)], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()
        .map_err(|e| err(e.to_string()))?;
    let Some((id, scopes_json, revoked_at)) = row else {
        return Err(err("API key inválida"));
    };
    if revoked_at.is_some() {
        return Err(err("API key revocada"));
    }
    let scopes: Vec<String> = serde_json::from_str(&scopes_json).unwrap_or_default();
    if !scopes.iter().any(|s| s == required_scope) {
        return Err(err(format!("esta API key no tiene el scope '{required_scope}'")));
    }
    conn.execute("UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2", params![now_ms(), id]).ok();
    Ok(())
}

/// `GET /api/v1/sales` (scope `sales.read`) — ventas recientes, formato
/// pensado para un sistema contable externo, no el JSON interno de `sales`.
pub fn public_sales(conn: &Connection, limit: i64) -> Value {
    let mut stmt = conn.prepare("SELECT id, folio, datetime, subtotal, tax_total, total, status FROM sales ORDER BY datetime DESC LIMIT ?1").unwrap();
    let rows: Vec<Value> = stmt
        .query_map(params![limit], |r| Ok(json!({
            "saleId": r.get::<_, String>(0)?, "folio": r.get::<_, String>(1)?, "datetime": r.get::<_, i64>(2)?,
            "subtotalCents": r.get::<_, i64>(3)?, "taxCents": r.get::<_, i64>(4)?, "totalCents": r.get::<_, i64>(5)?, "status": r.get::<_, String>(6)?,
        })))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    json!(rows)
}
