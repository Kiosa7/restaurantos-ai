//! Hub multi-terminal LAN — protocolo validado en el spike 1
//! (spikes/multiterminal/hub.mjs, docs/spikes/spike-1-multiterminal.md) y
//! ahora persistido en SQLite (Fase 6 §10.1, docs/spikes/spike-5-hub-rust.md):
//! el log de eventos y el ledger de deduplicación sobreviven a un reinicio
//! del proceso (`hub_events`/`hub_commands`, migración 0017). Los comandos
//! `nueva_comanda`/`bump_platillo` ya no son un passthrough genérico: se
//! traducen a escrituras reales sobre `orders`/`order_items`/inventario
//! (ver commands.rs).

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, mpsc};
use tower_http::services::ServeDir;

use crate::commands;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("el reloj del sistema está antes de 1970")
        .as_millis() as u64
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubEvent {
    pub id: String,
    pub cmd: String,
    pub payload: serde_json::Value,
    pub server_time: u64,
    pub caused_by: String,
    pub index: i64,
}

#[derive(Deserialize)]
struct IncomingCommand {
    #[serde(rename = "type")]
    kind: String,
    id: String,
    cmd: String,
    #[serde(default)]
    payload: serde_json::Value,
}

pub struct HubState {
    pub db: Mutex<Connection>,
    tx: broadcast::Sender<HubEvent>,
}

impl HubState {
    pub fn new(conn: Connection) -> Arc<Self> {
        let (tx, _rx) = broadcast::channel(1024);
        Arc::new(Self { db: Mutex::new(conn), tx })
    }
}

/// Difusión EN VIVO (spike 1: `broadcast(event, (m) => m.role === "kds" || m.role === "caja")`).
/// El emisor (típicamente "mesero") NO se autoescucha — solo cocina/caja.
fn live_routes_to_role(role: &str, _cmd: &str) -> bool {
    matches!(role, "kds" | "caja")
}

/// REPLAY al reconectar (spike 1: todo rol ve su historial completo, salvo
/// que el KDS solo necesita comandas/bumps — no cortes de caja, etc.).
fn replay_routes_to_role(role: &str, cmd: &str) -> bool {
    match role {
        "kds" => matches!(cmd, "nueva_comanda" | "bump_platillo"),
        _ => true,
    }
}

/// Ya procesado (por UUID de comando) — dedup DURABLE (sobrevive reinicios).
fn already_processed(conn: &Connection, command_id: &str) -> bool {
    conn.query_row("SELECT 1 FROM hub_commands WHERE id = ?1", params![command_id], |_| Ok(()))
        .optional()
        .unwrap()
        .is_some()
}

/// Inserta el evento en el log durable (`hub_events`) y marca el comando como
/// procesado (`hub_commands`) — reemplaza al Vec/HashSet en memoria del
/// prototipo original.
fn record_event(conn: &Connection, command_id: &str, cmd: &str, payload: &serde_json::Value) -> HubEvent {
    let now = now_ms();
    let event_id = uuid::Uuid::new_v4().to_string();
    let payload_str = payload.to_string();
    conn.execute(
        "INSERT INTO hub_events (id, cmd, payload_json, server_time, caused_by) VALUES (?1,?2,?3,?4,?5)",
        params![event_id, cmd, payload_str, now as i64, command_id],
    )
    .expect("no se pudo escribir hub_events");
    let idx = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO hub_commands (id, cmd, event_id, processed_at) VALUES (?1,?2,?3,?4)",
        params![command_id, cmd, event_id, now as i64],
    )
    .expect("no se pudo escribir hub_commands");
    HubEvent { id: event_id, cmd: cmd.to_string(), payload: payload.clone(), server_time: now, caused_by: command_id.to_string(), index: idx }
}

fn events_since(conn: &Connection, since_index: i64) -> Vec<HubEvent> {
    let mut stmt = conn
        .prepare("SELECT idx, id, cmd, payload_json, server_time, caused_by FROM hub_events WHERE idx > ?1 ORDER BY idx")
        .unwrap();
    stmt.query_map(params![since_index], |r| {
        let payload_str: String = r.get(3)?;
        Ok(HubEvent {
            index: r.get(0)?,
            id: r.get(1)?,
            cmd: r.get(2)?,
            payload: serde_json::from_str(&payload_str).unwrap_or(serde_json::Value::Null),
            server_time: r.get::<_, i64>(4)? as u64,
            caused_by: r.get(5)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

pub fn router(state: Arc<HubState>, pwa_dir: Option<&str>) -> Router {
    let mut router = Router::new()
        .route("/health", get(health))
        .route("/pair", post(pair))
        .route("/menu", get(get_menu))
        .route("/tables", get(get_tables))
        .route("/orders/open", get(get_open_orders))
        .route("/checkout", post(post_checkout))
        .route("/shifts/open", post(post_shift_open))
        .route("/shifts/close", post(post_shift_close))
        .route("/tips/summary", get(get_tips_summary))
        .route("/ws", get(ws_handler))
        .with_state(state);

    if let Some(dir) = pwa_dir {
        router = router.fallback_service(ServeDir::new(dir));
    }
    router
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "serverTime": now_ms() }))
}

async fn pair(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let role = body.get("role").and_then(|v| v.as_str()).unwrap_or("desconocido");
    let token = uuid::Uuid::new_v4().to_string();
    Json(serde_json::json!({ "token": token, "role": role, "issuedAt": now_ms() }))
}

async fn get_menu(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::menu_json(&conn))
}

async fn get_tables(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::tables_json(&conn))
}

async fn get_open_orders(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::open_orders_json(&conn))
}

fn domain_error_response(msg: String) -> axum::response::Response {
    (axum::http::StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response()
}

async fn post_checkout(State(state): State<Arc<HubState>>, Json(payload): Json<commands::CheckoutPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match commands::handle_checkout(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_shift_open(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let employee_id = body.get("employeeId").and_then(|v| v.as_str()).unwrap_or(crate::seed::EMPLOYEE_MESERO);
    let conn = state.db.lock().unwrap();
    match commands::open_shift(&conn, employee_id) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_shift_close(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(shift_id) = body.get("shiftId").and_then(|v| v.as_str()) else {
        return domain_error_response("falta shiftId".into());
    };
    let conn = state.db.lock().unwrap();
    match commands::close_shift(&conn, shift_id) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_tips_summary(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::tips_summary_json(&conn))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<HubState>>,
) -> impl IntoResponse {
    let role = params.get("role").cloned().unwrap_or_else(|| "unknown".into());
    let device = params.get("device").cloned().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let since_index: i64 = params.get("since_index").and_then(|v| v.parse().ok()).unwrap_or(-1);

    ws.on_upgrade(move |socket| handle_socket(socket, role, device, since_index, state))
}

async fn handle_socket(socket: WebSocket, role: String, _device: String, since_index: i64, state: Arc<HubState>) {
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();

    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let hello = serde_json::json!({ "type": "hello", "serverTime": now_ms(), "minClientVersion": 1 });
    let _ = out_tx.send(Message::Text(hello.to_string()));

    {
        let conn = state.db.lock().unwrap();
        for evt in events_since(&conn, since_index) {
            if replay_routes_to_role(&role, &evt.cmd) {
                let mut payload = serde_json::to_value(&evt).unwrap();
                payload["type"] = serde_json::json!("event");
                let _ = out_tx.send(Message::Text(payload.to_string()));
            }
        }
    }

    let mut broadcast_rx = state.tx.subscribe();
    let role_for_broadcast = role.clone();
    let out_tx_broadcast = out_tx.clone();
    let broadcast_task = tokio::spawn(async move {
        while let Ok(evt) = broadcast_rx.recv().await {
            if live_routes_to_role(&role_for_broadcast, &evt.cmd) {
                let mut payload = serde_json::to_value(&evt).unwrap();
                payload["type"] = serde_json::json!("event");
                if out_tx_broadcast.send(Message::Text(payload.to_string())).is_err() {
                    break;
                }
            }
        }
    });

    while let Some(Ok(msg)) = stream.next().await {
        if let Message::Text(text) = msg {
            let Ok(incoming) = serde_json::from_str::<IncomingCommand>(&text) else { continue };
            if incoming.kind != "cmd" {
                continue;
            }

            let conn = state.db.lock().unwrap();
            if already_processed(&conn, &incoming.id) {
                let ack = serde_json::json!({ "type": "ack", "id": incoming.id, "status": "duplicate" });
                let _ = out_tx.send(Message::Text(ack.to_string()));
                continue;
            }

            let processed = match incoming.cmd.as_str() {
                "nueva_comanda" => serde_json::from_value::<commands::NuevaComandaPayload>(incoming.payload.clone())
                    .map_err(|e| commands::DomainError(e.to_string()))
                    .and_then(|p| commands::handle_nueva_comanda(&conn, &p)),
                "bump_platillo" => serde_json::from_value::<commands::BumpPlatilloPayload>(incoming.payload.clone())
                    .map_err(|e| commands::DomainError(e.to_string()))
                    .and_then(|p| commands::handle_bump_platillo(&conn, &p)),
                _ => Err(commands::DomainError(format!("comando desconocido: {}", incoming.cmd))),
            };

            match processed {
                Ok(enriched_payload) => {
                    let ack = serde_json::json!({ "type": "ack", "id": incoming.id, "status": "ok" });
                    let _ = out_tx.send(Message::Text(ack.to_string()));

                    let event = record_event(&conn, &incoming.id, &incoming.cmd, &enriched_payload);
                    drop(conn);
                    let _ = state.tx.send(event);
                }
                Err(e) => {
                    log::warn!("comando {} rechazado: {}", incoming.cmd, e);
                    let ack = serde_json::json!({ "type": "ack", "id": incoming.id, "status": "error", "message": e.0 });
                    let _ = out_tx.send(Message::Text(ack.to_string()));
                }
            }
        }
    }

    broadcast_task.abort();
    writer.abort();
}
