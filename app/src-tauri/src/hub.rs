//! Hub multi-terminal LAN — puerto Rust/axum del protocolo validado en el
//! spike 1 (ver spikes/multiterminal/hub.mjs y
//! docs/spikes/spike-1-multiterminal.md). Mismo protocolo JSON por WebSocket:
//! comando idempotente (UUID) → ack → evento con serverTime autoritativo,
//! enrutado por rol, con replay para clientes que reconectan.
//!
//! DECISIÓN AUTÓNOMA (Fase 2, spike 1): este runtime, no un sidecar Node, es
//! el hub de producción — un solo exe que empaquetar (PLAN.md, riesgo
//! "Update skew hub↔PWA" y "Hub cae en pleno servicio").

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
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, mpsc};
use tower_http::services::ServeDir;

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
    pub index: usize,
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

struct HubInner {
    event_log: Vec<HubEvent>,
    seen_command_ids: HashSet<String>,
}

pub struct HubState {
    inner: Mutex<HubInner>,
    tx: broadcast::Sender<HubEvent>,
}

impl HubState {
    pub fn new() -> Arc<Self> {
        let (tx, _rx) = broadcast::channel(1024);
        Arc::new(Self {
            inner: Mutex::new(HubInner {
                event_log: Vec::new(),
                seen_command_ids: HashSet::new(),
            }),
            tx,
        })
    }

    #[cfg(test)]
    pub fn event_count(&self) -> usize {
        self.inner.lock().unwrap().event_log.len()
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

pub fn router(state: Arc<HubState>, pwa_dir: Option<&str>) -> Router {
    let mut router = Router::new()
        .route("/health", get(health))
        .route("/pair", post(pair))
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

/// Pairing MVP: entrega un token de sesión de dispositivo. La UI del hub
/// (Fase 6) lo presenta como QR/PIN; validación de token contra `employees`/
/// rol queda pendiente para cuando exista la pantalla de gestión de
/// dispositivos — aquí se resuelve el transporte, no la política de acceso.
async fn pair(Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let role = body.get("role").and_then(|v| v.as_str()).unwrap_or("desconocido");
    let token = uuid::Uuid::new_v4().to_string();
    Json(serde_json::json!({ "token": token, "role": role, "issuedAt": now_ms() }))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<Arc<HubState>>,
) -> impl IntoResponse {
    let role = params.get("role").cloned().unwrap_or_else(|| "unknown".into());
    let device = params.get("device").cloned().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let since_index: i64 = params
        .get("since_index")
        .and_then(|v| v.parse().ok())
        .unwrap_or(-1);

    ws.on_upgrade(move |socket| handle_socket(socket, role, device, since_index, state))
}

async fn handle_socket(socket: WebSocket, role: String, _device: String, since_index: i64, state: Arc<HubState>) {
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();

    // Tarea escritora única: todo lo que se manda al cliente pasa por este canal
    // (hello, replay, acks, y eventos reenviados desde el broadcast).
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // hello: reloj autoritativo del hub (spike 1, propiedad 4).
    let hello = serde_json::json!({
        "type": "hello",
        "serverTime": now_ms(),
        "minClientVersion": 1,
    });
    let _ = out_tx.send(Message::Text(hello.to_string()));

    // Replay de eventos perdidos (spike 1, propiedad "replay tras reconexión").
    {
        let inner = state.inner.lock().unwrap();
        for evt in inner.event_log.iter().skip((since_index + 1).max(0) as usize) {
            if replay_routes_to_role(&role, &evt.cmd) {
                let mut payload = serde_json::to_value(evt).unwrap();
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

            let mut inner = state.inner.lock().unwrap();
            if inner.seen_command_ids.contains(&incoming.id) {
                let ack = serde_json::json!({ "type": "ack", "id": incoming.id, "status": "duplicate" });
                let _ = out_tx.send(Message::Text(ack.to_string()));
                continue;
            }
            inner.seen_command_ids.insert(incoming.id.clone());

            let index = inner.event_log.len();
            let event = HubEvent {
                id: uuid::Uuid::new_v4().to_string(),
                cmd: incoming.cmd.clone(),
                payload: incoming.payload.clone(),
                server_time: now_ms(),
                caused_by: incoming.id.clone(),
                index,
            };
            inner.event_log.push(event.clone());
            drop(inner);

            let ack = serde_json::json!({ "type": "ack", "id": incoming.id, "status": "ok" });
            let _ = out_tx.send(Message::Text(ack.to_string()));

            let _ = state.tx.send(event);
        }
    }

    broadcast_task.abort();
    writer.abort();
}
