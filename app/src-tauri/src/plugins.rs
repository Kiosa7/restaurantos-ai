//! Registro de plugins (Fase 8 §10.2 punto 2, docs/permisos-plugins.md)
//! sobre la tabla `plugins` que ya existía desde 0008 (heredada de
//! pos-inteligente) sin usar hasta ahora. v1 acotado: enable/disable de los
//! módulos de Fase 7 que ya son independientes del núcleo (dogfooding del
//! propio modelo), no un runtime de plugins de terceros fuera de proceso.
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use crate::commands::{err, now_ms, DomainError};
type Result<T> = std::result::Result<T, DomainError>;

pub fn list(conn: &Connection) -> Value {
    let mut stmt = conn.prepare("SELECT id, name, manifest_json, enabled FROM plugins ORDER BY name").unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| {
            let manifest: String = r.get(2)?;
            let manifest: Value = serde_json::from_str(&manifest).unwrap_or(Value::Null);
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "name": r.get::<_, String>(1)?,
                "description": manifest["description"].as_str().unwrap_or(""),
                "enabled": r.get::<_, i64>(3)? != 0,
            }))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    json!(rows)
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> Result<Value> {
    let now = now_ms();
    let updated = conn
        .execute("UPDATE plugins SET enabled = ?1, updated_at = ?2 WHERE id = ?3", params![enabled as i64, now, id])
        .map_err(|e| err(e.to_string()))?;
    if updated == 0 {
        return Err(err(format!("plugin {id} no existe")));
    }
    Ok(json!({ "id": id, "enabled": enabled }))
}
