pub mod ai;
pub mod api_public;
pub mod audit;
pub mod backup;
pub mod commands;
pub mod commerce;
pub mod db;
pub mod hub;
pub mod plugins;
pub mod reports;
pub mod seed;
pub mod sync;

use std::path::PathBuf;

/// Puerto del hub LAN (PLAN.md §12: 5190 por default, evita 3000 y 5180
/// ocupados por otras apps del usuario). Escucha en 0.0.0.0 para que
/// tablets/KDS en la misma red lo alcancen — no solo localhost.
/// Configurable (Fase 8): correr dos hubs (dos "sucursales") en la misma
/// máquina para probar sync multi-sucursal necesita puertos distintos.
fn hub_port() -> u16 {
    std::env::var("RESTAURANTOS_HUB_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(5190)
}

fn spawn_hub_server() {
    std::thread::spawn(|| {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("no se pudo iniciar el runtime async del hub");

        rt.block_on(async {
            // BD del hub: persiste comandas/inventario/ventas/turnos entre
            // reinicios (Fase 6 §10.1). Ruta configurable para dev/tests;
            // producción empaquetada la resuelve contra el resource dir
            // (pendiente, ver docs/spikes/spike-5-hub-rust.md).
            let db_path = std::env::var("RESTAURANTOS_DB_PATH").unwrap_or_else(|_| "restaurantos-hub.db".into());
            let migrations_dir = std::env::var("RESTAURANTOS_MIGRATIONS_DIR").unwrap_or_else(|_| "../../docs/db/migrations".into());
            let conn = db::open_and_migrate(&db_path, std::path::Path::new(&migrations_dir));
            seed::seed(&conn, commands::now_ms());

            let state = hub::HubState::new(conn);

            // En dev, la PWA la sirve `vite` (puerto 5190 de app/vite.config.ts,
            // que por eso NO corre al mismo tiempo que este binario en dev);
            // en producción empaquetada, el hub sirve el build estático desde
            // el resource dir del bundle. Empaquetado real queda documentado
            // como pendiente en docs/spikes/spike-5-hub-rust.md.
            let pwa_dir: Option<PathBuf> = std::env::var("RESTAURANTOS_PWA_DIR").ok().map(PathBuf::from);
            let router = hub::router(state, pwa_dir.as_deref().and_then(|p| p.to_str()));

            let addr = format!("0.0.0.0:{}", hub_port());
            match tokio::net::TcpListener::bind(&addr).await {
                Ok(listener) => {
                    log::info!("hub LAN escuchando en {addr}");
                    if let Err(e) = axum::serve(listener, router).await {
                        log::error!("hub LAN terminó con error: {e}");
                    }
                }
                Err(e) => log::error!("no se pudo abrir el puerto del hub {addr}: {e}"),
            }
        });
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            spawn_hub_server();
            Ok(())
        })
        // Plugin SQL — el frontend carga la BD con Database.load("sqlite:pos.db")
        // Las migraciones las corre el TypeScript usando ?raw imports + execute()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
