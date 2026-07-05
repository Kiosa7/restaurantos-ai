//! Asistente conversacional v1 (Fase 6 §10.8) — mismo principio que
//! pos-inteligente (`docs/ai/tools-conversacional.md`): el LLM NUNCA escribe
//! SQL, solo elige una tool tipada; el núcleo ejecuta una vista de reporte ya
//! escrita (0016) e inyecta el resultado de vuelta. Catálogo completo en
//! `docs/ai/tools-conversacional-restaurante.md`.
//!
//! Regla de oro (ADR, PLAN.md §5): la IA NUNCA bloquea el camino crítico de
//! una venta/comanda. Por eso el lock de la BD (`Mutex<Connection>`, ver
//! hub.rs) se toma y se suelta ANTES/DESPUÉS de cada `.await` a Ollama, nunca
//! durante — si no, una respuesta lenta de Ollama congelaría el WS de
//! mesero/KDS mientras dure la espera de red.
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Mutex;

const OLLAMA_URL: &str = "http://localhost:11434/api/chat";
const MODEL: &str = "qwen2.5:7b";

pub struct AiError(pub String);

fn tool_defs() -> Vec<Value> {
    vec![
        json!({
            "type": "function",
            "function": {
                "name": "get_dish_margins",
                "description": "Margen real por platillo: precio de venta menos costo de receta. Úsala para '¿qué platillo deja más/menos dinero?'.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_kitchen_queue",
                "description": "Comandas pendientes o en preparación ahora mismo en cocina, con segundos transcurridos. Úsala para '¿qué hay pendiente en cocina?'.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_dish_prep_time",
                "description": "Tiempo promedio de preparación por platillo (segundos), calculado de comandas ya listas. Úsala para '¿qué platillo se tarda más en cocina?'.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_tables_status",
                "description": "Estado actual de cada mesa (libre/ocupada/por_limpiar/reservada) y minutos ocupada si aplica. Úsala para '¿qué mesas están libres?'.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "get_tips_by_shift",
                "description": "Propinas totales por turno cerrado o abierto. Úsala para '¿cómo van las propinas?'.",
                "parameters": { "type": "object", "properties": {} }
            }
        }),
    ]
}

/// Ejecuta la vista SQL correspondiente a una tool — sin parámetros del
/// usuario (v1: son consultas de solo lectura sobre el local completo; el
/// filtrado por tenant/location ya está implícito porque el hub es
/// mono-tenant/mono-local en esta fase, ver docs/arquitectura-tecnica.md §5).
fn execute_tool(conn: &Connection, name: &str) -> Result<Value, AiError> {
    let sql = match name {
        "get_dish_margins" => "SELECT product_name, precio_venta_cents, costo_receta_cents, margen_cents FROM v_dish_sales_margin ORDER BY margen_cents DESC LIMIT 20",
        "get_kitchen_queue" => "SELECT table_number, name_snapshot, course, qty, status, segundos_transcurridos FROM v_kitchen_queue",
        "get_dish_prep_time" => "SELECT product_name, veces_preparado, segundos_promedio_preparacion FROM v_dish_prep_time ORDER BY segundos_promedio_preparacion DESC",
        "get_tables_status" => "SELECT number, zone, capacity, status, minutos_ocupada FROM v_tables_status ORDER BY number",
        "get_tips_by_shift" => "SELECT shift_id, employee_id, started_at, ended_at, num_propinas, total_propinas_cents FROM v_tips_by_shift ORDER BY started_at DESC LIMIT 20",
        _ => return Err(AiError(format!("tool desconocida: {name}"))),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| AiError(e.to_string()))?;
    let col_count = stmt.column_count();
    let col_names: Vec<String> = (0..col_count).map(|i| stmt.column_name(i).unwrap().to_string()).collect();

    let rows: Vec<Value> = stmt
        .query_map([], |row| {
            let mut obj = serde_json::Map::new();
            for (i, col) in col_names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(f) => json!(f),
                    rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t).into_owned()),
                    rusqlite::types::ValueRef::Blob(_) => Value::Null,
                };
                obj.insert(col.clone(), value);
            }
            Ok(Value::Object(obj))
        })
        .map_err(|e| AiError(e.to_string()))?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!(rows))
}

async fn ollama_chat(http: &reqwest::Client, messages: &[Value], tools: Option<&Vec<Value>>) -> Result<Value, AiError> {
    let mut body = json!({ "model": MODEL, "messages": messages, "stream": false });
    if let Some(t) = tools {
        body["tools"] = json!(t);
    }
    let resp = http
        .post(OLLAMA_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| AiError(format!("no se pudo contactar a Ollama: {e}")))?;
    if !resp.status().is_success() {
        return Err(AiError(format!("Ollama respondió {}", resp.status())));
    }
    let data: Value = resp.json().await.map_err(|e| AiError(e.to_string()))?;
    Ok(data["message"].clone())
}

const SYSTEM_PROMPT: &str = "Eres el copiloto de un restaurante en México. Respondes en \
español, en 2-4 líneas, con datos concretos (pesos, minutos, nombres de platillos). \
NUNCA inventes cifras: si necesitas datos, llama SIEMPRE a una tool antes de responder. \
Si el usuario pregunta algo que ninguna tool cubre, dilo claramente en vez de adivinar.";

/// Orquesta la conversación: pregunta → Ollama decide tool(s) → el hub las
/// ejecuta (lock de BD breve, sin `.await` de por medio) → Ollama redacta la
/// respuesta final citando qué tools usó.
pub async fn handle_chat(db: &Mutex<Connection>, http: &reqwest::Client, question: &str) -> Result<Value, AiError> {
    let mut messages = vec![
        json!({ "role": "system", "content": SYSTEM_PROMPT }),
        json!({ "role": "user", "content": question }),
    ];

    let tools = tool_defs();
    let first = ollama_chat(http, &messages, Some(&tools)).await?;

    let empty_calls = vec![];
    let tool_calls = first["tool_calls"].as_array().unwrap_or(&empty_calls);
    if tool_calls.is_empty() {
        return Ok(json!({ "answer": first["content"].as_str().unwrap_or(""), "toolsUsadas": [] }));
    }

    messages.push(first.clone());
    let mut tools_usadas = Vec::new();
    for call in tool_calls {
        let name = call["function"]["name"].as_str().unwrap_or("").to_string();
        let result = {
            // Lock breve y SÍNCRONO — se libera antes de volver a await Ollama.
            let conn = db.lock().unwrap();
            execute_tool(&conn, &name)
        };
        let result_json = match result {
            Ok(v) => v,
            Err(e) => json!({ "error": e.0 }),
        };
        tools_usadas.push(name.clone());
        messages.push(json!({ "role": "tool", "content": result_json.to_string() }));
    }

    let final_msg = ollama_chat(http, &messages, None).await?;
    Ok(json!({ "answer": final_msg["content"].as_str().unwrap_or(""), "toolsUsadas": tools_usadas }))
}
