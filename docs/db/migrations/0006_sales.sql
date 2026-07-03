-- =============================================================================
-- 0006_sales.sql
-- Ventas, líneas de venta y pagos.
-- PRINCIPIOS:
--   - Las ventas son HECHOS INMUTABLES (append-only): no se editan; una
--     devolución/cancelación es OTRO documento que referencia al original.
--     => dos sucursales NUNCA generan un conflicto de venta (cada una es única).
--   - Las líneas guardan SNAPSHOTS (nombre/precio/impuesto del momento) para
--     que el histórico sea inmutable aunque el catálogo cambie luego.
--   - Encadenamiento por hash (prev_hash/hash) → anti-manipulación fiscal.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales (
    id              TEXT PRIMARY KEY,        -- UUID v7 (global, sin colisión multi-sucursal)
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    location_id     TEXT NOT NULL REFERENCES locations(id),
    register_id     TEXT REFERENCES registers(id),
    cash_session_id TEXT,                    -- FK lógica a cash_sessions (0007)
    employee_id     TEXT REFERENCES employees(id),
    customer_id     TEXT REFERENCES customers(id),
    folio           TEXT NOT NULL,           -- folio legible por sucursal (location_id+secuencia)
    datetime        INTEGER NOT NULL,        -- epoch ms de la venta
    channel         TEXT NOT NULL DEFAULT 'pos'
                    CHECK (channel IN ('pos','online','phone','vision_cam')),
    subtotal        INTEGER NOT NULL DEFAULT 0,  -- centavos (antes de impuestos)
    discount_total  INTEGER NOT NULL DEFAULT 0,
    tax_total       INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    currency        TEXT NOT NULL DEFAULT 'MXN',
    payment_status  TEXT NOT NULL DEFAULT 'paid'
                    CHECK (payment_status IN ('paid','partial','pending','refunded')),
    status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('draft','completed','voided','refunded')),
    -- referencia al documento original si esta venta es devolución/nota de crédito
    refunds_sale_id TEXT REFERENCES sales(id),
    notes           TEXT,
    -- cadena de integridad anti-fraude
    seq             INTEGER NOT NULL,        -- secuencia monotónica por (location_id)
    prev_hash       TEXT,
    hash            TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
    -- inmutable: sin updated_at/deleted_at/version (un cambio = nuevo documento)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_folio ON sales (location_id, folio);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_seq ON sales (location_id, seq);
CREATE INDEX IF NOT EXISTS idx_sales_datetime ON sales (location_id, datetime);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_session ON sales (cash_session_id);
CREATE INDEX IF NOT EXISTS idx_sales_dirty ON sales (dirty) WHERE dirty = 1;

CREATE TABLE IF NOT EXISTS sale_items (
    id              TEXT PRIMARY KEY,
    sale_id         TEXT NOT NULL REFERENCES sales(id),
    product_id      TEXT REFERENCES products(id),   -- NULL permitido (venta libre)
    variant_id      TEXT REFERENCES product_variants(id),
    -- SNAPSHOTS: congelan el estado al momento de vender
    name_snapshot   TEXT NOT NULL,
    sku_snapshot    TEXT,
    unit_price      INTEGER NOT NULL,        -- centavos, precio unitario aplicado
    qty             REAL NOT NULL,
    discount        INTEGER NOT NULL DEFAULT 0,
    tax_snapshot_json TEXT CHECK (tax_snapshot_json IS NULL OR json_valid(tax_snapshot_json)),
    tax_amount      INTEGER NOT NULL DEFAULT 0,
    line_total      INTEGER NOT NULL,        -- (unit_price*qty - discount) (+/- imp según included)
    cost_snapshot   INTEGER NOT NULL DEFAULT 0,  -- para margen histórico
    created_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items (product_id);

CREATE TABLE IF NOT EXISTS payments (
    id          TEXT PRIMARY KEY,
    sale_id     TEXT NOT NULL REFERENCES sales(id),
    method      TEXT NOT NULL,               -- 'cash','card','transfer','wallet','credit'
    amount      INTEGER NOT NULL,            -- centavos
    currency    TEXT NOT NULL DEFAULT 'MXN',
    tendered    INTEGER,                     -- efectivo recibido (para calcular cambio)
    change_due  INTEGER,                     -- cambio entregado
    reference   TEXT,                        -- folio de terminal, autorización
    created_at  INTEGER NOT NULL,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments (sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments (method, created_at);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (6, 'sales', unixepoch() * 1000, 'PENDING');
