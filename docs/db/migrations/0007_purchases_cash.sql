-- =============================================================================
-- 0007_purchases_cash.sql
-- Compras a proveedor y manejo de caja (sesiones + movimientos).
-- =============================================================================

CREATE TABLE IF NOT EXISTS purchases (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    supplier_id TEXT REFERENCES suppliers(id),
    employee_id TEXT REFERENCES employees(id),
    folio       TEXT,
    datetime    INTEGER NOT NULL,
    subtotal    INTEGER NOT NULL DEFAULT 0,
    tax_total   INTEGER NOT NULL DEFAULT 0,
    total       INTEGER NOT NULL DEFAULT 0,
    currency    TEXT NOT NULL DEFAULT 'MXN',
    status      TEXT NOT NULL DEFAULT 'received'
                CHECK (status IN ('draft','ordered','received','cancelled')),
    notes       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_datetime ON purchases (location_id, datetime);

CREATE TABLE IF NOT EXISTS purchase_items (
    id          TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id),
    product_id  TEXT REFERENCES products(id),
    variant_id  TEXT REFERENCES product_variants(id),
    name_snapshot TEXT NOT NULL,
    qty         REAL NOT NULL,
    unit_cost   INTEGER NOT NULL,           -- centavos
    tax_amount  INTEGER NOT NULL DEFAULT 0,
    line_total  INTEGER NOT NULL,
    lot         TEXT,
    expires_at  INTEGER,
    created_at  INTEGER NOT NULL,
    origin_node TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON purchase_items (product_id);

-- Sesión de caja (turno): apertura → cierre con arqueo --------------------------
CREATE TABLE IF NOT EXISTS cash_sessions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    location_id     TEXT NOT NULL REFERENCES locations(id),
    register_id     TEXT NOT NULL REFERENCES registers(id),
    employee_id     TEXT NOT NULL REFERENCES employees(id),
    opened_at       INTEGER NOT NULL,
    closed_at       INTEGER,
    opening_amount  INTEGER NOT NULL DEFAULT 0,  -- fondo inicial (centavos)
    expected_amount INTEGER,                     -- calculado del sistema al cierre
    counted_amount  INTEGER,                     -- contado físicamente
    diff_amount     INTEGER,                      -- counted - expected (faltante/sobrante)
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','closed')),
    notes           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_register
    ON cash_sessions (register_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_open
    ON cash_sessions (register_id) WHERE status = 'open';

-- Movimientos de caja distintos a ventas (entradas/salidas de efectivo) -------
CREATE TABLE IF NOT EXISTS cash_movements (
    id              TEXT PRIMARY KEY,
    cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
    type            TEXT NOT NULL CHECK (type IN
                      ('sale_cash','refund','payout','deposit','withdrawal','adjustment')),
    amount          INTEGER NOT NULL,        -- centavos (+ entra / - sale)
    reason          TEXT,
    ref_doc         TEXT,                    -- 'sale:<id>' cuando aplica
    employee_id     TEXT REFERENCES employees(id),
    created_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cash_movements_session
    ON cash_movements (cash_session_id, created_at);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (7, 'purchases_cash', unixepoch() * 1000, 'PENDING');
