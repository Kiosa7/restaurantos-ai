import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Aplica las migraciones SQL (fuente de verdad: docs/db/migrations/) a una BD.
 * Pensado para Node (`node:sqlite`) — tests y, a futuro, el bridge Tauri/Rust
 * embeberá el mismo SQL. `skipVecTables` omite las tablas vec0 cuando la
 * extensión sqlite-vec no está cargada (búsqueda vectorial = fase posterior).
 */
export interface MigratableDb {
  exec(sql: string): void;
}

const VEC0_BLOCK =
  /CREATE VIRTUAL TABLE IF NOT EXISTS vec_products_[a-z]+ USING vec0\([\s\S]*?\);/g;

export function applyMigrations(
  db: MigratableDb,
  opts: { dir: string; skipVecTables?: boolean },
): string[] {
  const files = readdirSync(opts.dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  for (const file of files) {
    let sql = readFileSync(join(opts.dir, file), "utf8");
    if (opts.skipVecTables) {
      sql = sql.replace(VEC0_BLOCK, "-- vec0 table skipped (sqlite-vec no cargada)");
    }
    db.exec(sql);
  }
  return files;
}
