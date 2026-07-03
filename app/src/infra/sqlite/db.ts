import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncCtor } from "node:sqlite";
import { applyMigrations } from "./migrate";

// Carga node:sqlite vía require para evitar que el bundler (Vite/Vitest) intente
// resolverlo como paquete; los tipos se conservan con `import type`.
const nodeSqlite = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncCtor;
};
const DatabaseSync = nodeSqlite.DatabaseSync;

/**
 * Apertura de la BD local con los PRAGMAs de arranque (docs/db/README.md) y las
 * migraciones aplicadas. En desarrollo/tests usa `node:sqlite`; en producción el
 * shell Tauri abrirá SQLCipher con la misma estructura.
 */
export type SqliteDatabase = InstanceType<typeof DatabaseSync>;

export function openDatabase(opts: {
  path?: string; // ':memory:' por defecto
  migrationsDir: string;
  skipVecTables?: boolean;
}): SqliteDatabase {
  const db = new DatabaseSync(opts.path ?? ":memory:");
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
  `);
  applyMigrations(db, { dir: opts.migrationsDir, skipVecTables: opts.skipVecTables ?? true });
  return db;
}
