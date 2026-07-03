-- =============================================================================
-- 0001_meta_sync_audit.sql
-- Infraestructura: control de migraciones, outbox de sync, estado de sync,
-- y bitácora de auditoría firmada/encadenada.
-- =============================================================================

-- Control de versiones del esquema -------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,        -- 1, 2, 3...
    name        TEXT    NOT NULL,
    applied_at  INTEGER NOT NULL,           -- epoch ms
    checksum    TEXT    NOT NULL            -- hash del archivo aplicado
) STRICT;

-- Outbox transaccional -------------------------------------------------------
-- Cada cambio de una entidad sincronizable escribe AQUÍ en la MISMA transacción
-- que el cambio de estado. Garantiza que ningún cambio se pierda aunque el
-- proceso muera justo después. El sync worker consume esta cola.
CREATE TABLE IF NOT EXISTS outbox (
    id            TEXT    PRIMARY KEY,       -- UUID v7 del evento (idempotencia)
    aggregate     TEXT    NOT NULL,          -- 'sale', 'product', 'inventory_movement'...
    aggregate_id  TEXT    NOT NULL,          -- id de la entidad afectada
    op            TEXT    NOT NULL CHECK (op IN ('insert','update','delete')),
    payload_json  TEXT    NOT NULL CHECK (json_valid(payload_json)),
    hlc           TEXT    NOT NULL,          -- Hybrid Logical Clock del cambio
    origin_node   TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,                   -- backoff exponencial + jitter
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_flight','synced','failed','dead')),
    last_error    TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox (status, next_retry_at)
    WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox (aggregate, aggregate_id);

-- Estado del pull incremental por entidad ------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
    entity          TEXT    PRIMARY KEY,     -- 'products', 'sales'...
    last_pulled_hlc TEXT,                    -- cursor incremental remoto
    last_pulled_at  INTEGER,
    last_pushed_at  INTEGER,
    full_sync_at    INTEGER                  -- última sincronización completa
) STRICT;

-- Cola de conflictos que requieren decisión humana ---------------------------
CREATE TABLE IF NOT EXISTS sync_conflicts (
    id            TEXT    PRIMARY KEY,
    entity        TEXT    NOT NULL,
    entity_id     TEXT    NOT NULL,
    local_json    TEXT    NOT NULL CHECK (json_valid(local_json)),
    remote_json   TEXT    NOT NULL CHECK (json_valid(remote_json)),
    strategy      TEXT    NOT NULL,          -- 'lww','crdt','manual'
    resolved      INTEGER NOT NULL DEFAULT 0,
    resolution    TEXT,                      -- 'local','remote','merged'
    created_at    INTEGER NOT NULL,
    resolved_at   INTEGER,
    resolved_by   TEXT
) STRICT;

-- Bitácora de auditoría (append-only, encadenada por hash) -------------------
-- prev_hash + hash forman una cadena: alterar/borrar un registro rompe la
-- cadena y se vuelve detectable. 'sig' permite firma HMAC adicional.
CREATE TABLE IF NOT EXISTS audit_log (
    id          TEXT    PRIMARY KEY,         -- UUID v7
    seq         INTEGER NOT NULL,            -- secuencia monotónica local
    actor       TEXT,                        -- employee_id o 'system'
    action      TEXT    NOT NULL,            -- 'sale.refund','price.edit'...
    entity      TEXT    NOT NULL,
    entity_id   TEXT,
    before_json TEXT    CHECK (before_json IS NULL OR json_valid(before_json)),
    after_json  TEXT    CHECK (after_json  IS NULL OR json_valid(after_json)),
    location_id TEXT,
    origin_node TEXT    NOT NULL,
    ts          INTEGER NOT NULL,            -- epoch ms
    prev_hash   TEXT,                        -- hash del registro anterior (cadena)
    hash        TEXT    NOT NULL,            -- hash de este registro
    sig         TEXT                         -- firma HMAC opcional
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_seq ON audit_log (seq);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (1, 'meta_sync_audit', unixepoch() * 1000, 'PENDING');
