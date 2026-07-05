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
        Path, Query, State,
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
    http: reqwest::Client,
    pub sync_clock: crate::sync::HlcClock,
}

impl HubState {
    pub fn new(conn: Connection) -> Arc<Self> {
        let (tx, _rx) = broadcast::channel(1024);
        let sync_clock = crate::sync::HlcClock::new(crate::seed::node());
        Arc::new(Self { db: Mutex::new(conn), tx, http: reqwest::Client::new(), sync_clock })
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
        .route("/pair/generate", post(post_pair_generate))
        .route("/pair/redeem", post(post_pair_redeem))
        .route("/pair/devices", get(get_pair_devices))
        .route("/auth/pin", post(post_auth_pin))
        .route("/menu", get(get_menu))
        .route("/tables", get(get_tables))
        .route("/orders/open", get(get_open_orders))
        .route("/checkout", post(post_checkout))
        .route("/shifts/open", post(post_shift_open))
        .route("/shifts/close", post(post_shift_close))
        .route("/tips/summary", get(get_tips_summary))
        .route("/backup/export", get(get_backup_export))
        .route("/ai/chat", post(post_ai_chat))
        .route("/cfdi/generate", post(post_cfdi_generate))
        .route("/cfdi/by-sale/:sale_id", get(get_cfdi_by_sale))
        .route("/cfdi/global", post(post_cfdi_global))
        .route("/cfdi/uninvoiced-sales", get(get_uninvoiced_sales))
        .route("/customers", get(get_customers).post(post_customer))
        .route("/promotions", get(get_promotions).post(post_promotion))
        .route("/suppliers", get(get_suppliers).post(post_supplier))
        .route("/purchases", post(post_purchase))
        .route("/purchases/ocr", post(post_purchase_ocr))
        .route("/reservations", get(get_reservations).post(post_reservation))
        .route("/reservations/:id/status", post(post_reservation_status))
        .route("/delivery-orders", get(get_delivery_orders).post(post_delivery_order))
        .route("/delivery-orders/:id/status", post(post_delivery_order_status))
        .route("/reports/dashboard", get(get_reports_dashboard))
        .route("/sync/pull", get(get_sync_pull))
        .route("/sync/push", post(post_sync_push))
        .route("/plugins", get(get_plugins))
        .route("/plugins/:id/toggle", post(post_plugin_toggle))
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

async fn post_cfdi_generate(State(state): State<Arc<HubState>>, Json(payload): Json<commands::GenerateCfdiPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match commands::generate_cfdi(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_cfdi_by_sale(State(state): State<Arc<HubState>>, Path(sale_id): Path<String>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::get_cfdi_document(&conn, &sale_id))
}

async fn post_cfdi_global(State(state): State<Arc<HubState>>, Json(payload): Json<commands::GenerateGlobalInvoicePayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match commands::generate_global_invoice(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_uninvoiced_sales(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::list_uninvoiced_sales(&conn))
}

async fn get_reports_dashboard(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::reports::dashboard(&conn))
}

#[derive(Deserialize)]
struct SyncPullQuery {
    #[serde(rename = "sinceHlc", default)]
    since_hlc: String,
    #[serde(default = "default_pull_limit")]
    limit: i64,
}
fn default_pull_limit() -> i64 { 500 }

/// `GET /sync/pull` — el lado "otro nodo lee mi outbox" del protocolo
/// (Fase 8 §10.2). Cursor incremental por HLC, reanudable.
async fn get_sync_pull(State(state): State<Arc<HubState>>, Query(q): Query<SyncPullQuery>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::sync::pull(&conn, &q.since_hlc, q.limit))
}

#[derive(Deserialize)]
struct SyncPushBody {
    events: Vec<crate::sync::SyncEvent>,
}

/// `POST /sync/push` — el lado "otro nodo me manda sus eventos" del
/// protocolo. Idempotente por `aggregate_id` ya existente localmente.
async fn post_sync_push(State(state): State<Arc<HubState>>, Json(body): Json<SyncPushBody>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::sync::push(&conn, &state.sync_clock, &body.events))
}

async fn get_plugins(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::plugins::list(&conn))
}

#[derive(Deserialize)]
struct TogglePluginBody {
    enabled: bool,
}

async fn post_plugin_toggle(State(state): State<Arc<HubState>>, Path(id): Path<String>, Json(body): Json<TogglePluginBody>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::plugins::set_enabled(&conn, &id, body.enabled) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_customers(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::commerce::list_customers(&conn))
}

async fn post_customer(State(state): State<Arc<HubState>>, Json(payload): Json<crate::commerce::CreateCustomerPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::commerce::create_customer(&conn, &payload) {
        Ok(v) => {
            if let Some(id) = v["customerId"].as_str() {
                crate::sync::enqueue_customer(&conn, &state.sync_clock, id);
            }
            Json(v).into_response()
        }
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_promotions(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::commerce::list_promotions(&conn))
}

async fn post_promotion(State(state): State<Arc<HubState>>, Json(payload): Json<crate::commerce::CreatePromotionPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::commerce::create_promotion(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_suppliers(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::commerce::list_suppliers(&conn))
}

async fn post_supplier(State(state): State<Arc<HubState>>, Json(payload): Json<crate::commerce::CreateSupplierPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::commerce::create_supplier(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_purchase(State(state): State<Arc<HubState>>, Json(payload): Json<crate::commerce::CreatePurchasePayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    let result = crate::commerce::create_purchase(&conn, &payload);
    if let Ok(v) = &result {
        for id in v["inventoryMovementIds"].as_array().unwrap_or(&Vec::new()) {
            if let Some(id) = id.as_str() {
                crate::sync::enqueue_inventory_movement(&conn, &state.sync_clock, id);
            }
        }
    }
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_purchase_ocr(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(image_base64) = body.get("imageBase64").and_then(|v| v.as_str()) else {
        return domain_error_response("falta imageBase64".into());
    };
    // Sin lock de BD durante el `.await` — es una llamada de red pura (30-60s).
    match crate::ai::extract_invoice_from_image(&state.http, image_base64).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (axum::http::StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": e.0 }))).into_response(),
    }
}

async fn get_reservations(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::commerce::list_reservations(&conn))
}

async fn post_reservation(State(state): State<Arc<HubState>>, Json(payload): Json<crate::commerce::CreateReservationPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::commerce::create_reservation(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_reservation_status(State(state): State<Arc<HubState>>, Path(id): Path<String>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(status) = body.get("status").and_then(|v| v.as_str()) else {
        return domain_error_response("falta status".into());
    };
    let conn = state.db.lock().unwrap();
    match crate::commerce::update_reservation_status(&conn, &id, status) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_delivery_orders(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::commerce::list_delivery_orders(&conn))
}

async fn post_delivery_order(State(state): State<Arc<HubState>>, Json(payload): Json<crate::commerce::CreateDeliveryOrderPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match crate::commerce::create_delivery_order(&conn, &payload) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_delivery_order_status(State(state): State<Arc<HubState>>, Path(id): Path<String>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(status) = body.get("status").and_then(|v| v.as_str()) else {
        return domain_error_response("falta status".into());
    };
    let conn = state.db.lock().unwrap();
    match crate::commerce::update_delivery_status(&conn, &id, status) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_pair_generate(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let role = body.get("role").and_then(|v| v.as_str()).unwrap_or("");
    let conn = state.db.lock().unwrap();
    match commands::generate_pairing(&conn, role) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn post_pair_redeem(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(code) = body.get("code").and_then(|v| v.as_str()) else {
        return domain_error_response("falta code".into());
    };
    let label = body.get("label").and_then(|v| v.as_str());
    let conn = state.db.lock().unwrap();
    match commands::redeem_pairing(&conn, code, label) {
        Ok(v) => Json(v).into_response(),
        Err(e) => domain_error_response(e.0),
    }
}

async fn get_pair_devices(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(commands::list_devices(&conn))
}

async fn post_auth_pin(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(pin) = body.get("pin").and_then(|v| v.as_str()) else {
        return domain_error_response("falta pin".into());
    };
    let conn = state.db.lock().unwrap();
    match commands::pin_login(&conn, pin) {
        Ok(v) => Json(v).into_response(),
        Err(e) => (axum::http::StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "error": e.0 }))).into_response(),
    }
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

async fn get_backup_export(State(state): State<Arc<HubState>>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    Json(crate::backup::build_snapshot(&conn, now_ms() as i64))
}

async fn post_ai_chat(State(state): State<Arc<HubState>>, Json(body): Json<serde_json::Value>) -> impl IntoResponse {
    let Some(question) = body.get("question").and_then(|v| v.as_str()) else {
        return domain_error_response("falta question".into());
    };
    // OJO: NO se toma el lock de `state.db` aquí — `handle_chat` lo toma y
    // suelta internamente solo para las tools, nunca durante el `.await` a
    // Ollama (regla de oro: la IA no bloquea el camino crítico de mesero/KDS).
    match crate::ai::handle_chat(&state.db, &state.http, question).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => (axum::http::StatusCode::BAD_GATEWAY, Json(serde_json::json!({ "error": e.0 }))).into_response(),
    }
}

fn domain_error_response(msg: String) -> axum::response::Response {
    (axum::http::StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": msg }))).into_response()
}

async fn post_checkout(State(state): State<Arc<HubState>>, Json(payload): Json<commands::CheckoutPayload>) -> impl IntoResponse {
    let conn = state.db.lock().unwrap();
    match commands::handle_checkout(&conn, &payload) {
        Ok(v) => {
            for sale_id in v["saleIds"].as_array().unwrap_or(&Vec::new()) {
                if let Some(id) = sale_id.as_str() {
                    crate::sync::enqueue_sale(&conn, &state.sync_clock, id);
                }
            }
            Json(v).into_response()
        }
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

async fn handle_socket(socket: WebSocket, role: String, device: String, since_index: i64, state: Arc<HubState>) {
    // Pairing real (Fase 6 §10.9): si el device ya está pareado, se registra
    // su actividad. Si NO lo está, la conexión igual se permite (⛔
    // enforcement estricto pendiente — romperlo exige que las 3 pantallas
    // hagan el handshake de pairing antes de conectar, ver PLAN.md) pero
    // queda en el log para saber qué tan lejos está el sistema de exigirlo.
    {
        let conn = state.db.lock().unwrap();
        if !commands::touch_device_if_paired(&conn, &device) {
            log::info!("WS: dispositivo no pareado conectado (role={role}, device={device})");
        }
    }

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

                    // Descuento de inventario por receta (bump a en_preparacion):
                    // se sincroniza igual que una compra, CRDT por suma de deltas.
                    for id in enriched_payload["inventoryMovementIds"].as_array().unwrap_or(&Vec::new()) {
                        if let Some(id) = id.as_str() {
                            crate::sync::enqueue_inventory_movement(&conn, &state.sync_clock, id);
                        }
                    }

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
