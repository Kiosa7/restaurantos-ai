-- =============================================================================
-- 0014_turnos_propinas.sql
-- Turnos de mesero y propinas con reparto CONFIGURABLE (PLAN.md §7: "reparto
-- CONFIGURABLE, no política fija"). Un turno es independiente de cash_sessions
-- (0007): un mesero tiene turno aunque no abra caja; un cajero abre caja
-- aunque no tenga turno de mesero.
-- =============================================================================

CREATE TABLE IF NOT EXISTS shifts (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    employee_id TEXT NOT NULL REFERENCES employees(id),
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    status      TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','cerrado')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_shifts_employee ON shifts (employee_id, started_at);
CREATE INDEX IF NOT EXISTS idx_shifts_open ON shifts (location_id) WHERE status = 'abierto';

-- Propina capturada en una venta (informativa en el ticket, ver spike 2;
-- aquí es el registro real de cuánto se cobró de propina y cómo).
CREATE TABLE IF NOT EXISTS tips (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    sale_id     TEXT NOT NULL REFERENCES sales(id),
    shift_id    TEXT REFERENCES shifts(id),         -- turno del mesero que atendió
    amount      INTEGER NOT NULL,                   -- centavos, NO gravada (ADR-3)
    method      TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','card')),
    created_at  INTEGER NOT NULL,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tips_shift ON tips (shift_id);
CREATE INDEX IF NOT EXISTS idx_tips_sale ON tips (sale_id);

-- Configuración de reparto por local: el dueño decide la política, el sistema
-- solo la ejecuta. mode: 'individual' (cada quien lo suyo, sin reparto),
-- 'pool_turno' (se junta y se reparte parejo entre meseros del turno),
-- 'pool_ventas' (se reparte proporcional a las ventas de cada quien).
CREATE TABLE IF NOT EXISTS tip_pool_configs (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    mode        TEXT NOT NULL DEFAULT 'individual'
                CHECK (mode IN ('individual','pool_turno','pool_ventas')),
    -- porcentaje del pool que va a cocina/otros roles no-mesero, si aplica (0..1)
    kitchen_share REAL NOT NULL DEFAULT 0,
    active_from INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tip_pool_configs_location
    ON tip_pool_configs (location_id, active_from);

-- Distribución calculada al cerrar un turno (auditable: qué le tocó a quién y por qué regla).
CREATE TABLE IF NOT EXISTS shift_tip_distributions (
    id          TEXT PRIMARY KEY,
    shift_id    TEXT NOT NULL REFERENCES shifts(id),
    employee_id TEXT NOT NULL REFERENCES employees(id),
    amount      INTEGER NOT NULL,               -- centavos que le tocaron
    config_id   TEXT REFERENCES tip_pool_configs(id),  -- regla aplicada
    created_at  INTEGER NOT NULL,
    origin_node TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_shift_tip_distributions_shift ON shift_tip_distributions (shift_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (14, 'turnos_propinas', unixepoch() * 1000, 'PENDING');
