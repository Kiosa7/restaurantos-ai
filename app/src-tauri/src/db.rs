//! Apertura de la BD del hub + runner de migraciones. Puerto a Rust del
//! mismo criterio que `app/src/infra/sqlite/{db,migrate}.ts` (Node): la
//! fuente de verdad del esquema son los archivos de `docs/db/migrations/`,
//! no algo duplicado en Rust — este módulo solo los APLICA.
use regex::Regex;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

/// Strippea las tablas `vec0` (sqlite-vec no está enlazada) — mismo criterio
/// que `skipVecTables` en migrate.ts.
fn strip_vec0_tables(sql: &str) -> String {
    let re = Regex::new(r"(?s)CREATE VIRTUAL TABLE IF NOT EXISTS vec_products_[a-z]+ USING vec0\([^;]*?\);").unwrap();
    re.replace_all(sql, "-- vec0 table skipped (sqlite-vec no cargada)").into_owned()
}

pub fn open_and_migrate(db_path: &str, migrations_dir: &Path) -> Connection {
    let conn = Connection::open(db_path).expect("no se pudo abrir la base de datos del hub");
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store = MEMORY;",
    )
    .expect("no se pudieron aplicar los PRAGMAs de arranque");

    let mut files: Vec<_> = fs::read_dir(migrations_dir)
        .unwrap_or_else(|e| panic!("no se pudo leer el directorio de migraciones {migrations_dir:?}: {e}"))
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.ends_with(".sql"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();

    // Idempotente entre reinicios: si el archivo ya se aplicó (su versión ya
    // está en schema_migrations), se saltea — a diferencia de migrate.ts
    // (Node), que siempre corre contra una BD nueva. El hub persiste entre
    // reinicios (Fase 6 §10.1), así que reabrir el MISMO archivo no debe
    // re-ejecutar `INSERT INTO schema_migrations` y romper su PK única.
    let table_exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'", [], |r| r.get(0))
        .unwrap_or(0);
    let applied: std::collections::HashSet<i64> = if table_exists > 0 {
        let mut stmt = conn.prepare("SELECT version FROM schema_migrations").unwrap();
        stmt.query_map([], |r| r.get::<_, i64>(0)).unwrap().filter_map(|r| r.ok()).collect()
    } else {
        Default::default()
    };

    let mut applied_now = 0;
    for file in &files {
        let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let version: i64 = stem.get(0..4).and_then(|p| p.parse().ok()).unwrap_or(-1);
        if applied.contains(&version) {
            continue;
        }
        let sql = fs::read_to_string(file).unwrap_or_else(|e| panic!("no se pudo leer {file:?}: {e}"));
        let sql = strip_vec0_tables(&sql);
        conn.execute_batch(&sql)
            .unwrap_or_else(|e| panic!("migración falló ({file:?}): {e}"));
        applied_now += 1;
    }

    log::info!("hub: {applied_now} migraciones nuevas aplicadas ({} ya estaban, {:?})", applied.len(), migrations_dir);
    conn
}
