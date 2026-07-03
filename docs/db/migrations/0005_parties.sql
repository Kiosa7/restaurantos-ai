-- =============================================================================
-- 0005_parties.sql
-- Terceros: clientes, proveedores y lista de precios de proveedor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS customers (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    tax_id          TEXT,                    -- RFC/NIT para facturación
    address_json    TEXT CHECK (address_json IS NULL OR json_valid(address_json)),
    loyalty_points  INTEGER NOT NULL DEFAULT 0,
    credit_limit    INTEGER NOT NULL DEFAULT 0,  -- centavos
    balance         INTEGER NOT NULL DEFAULT 0,  -- saldo deudor (centavos)
    segment         TEXT,                        -- 'vip','frecuente','inactivo' (lo puede setear IA)
    last_purchase_at INTEGER,                    -- para detectar fuga de clientes
    attributes_json TEXT CHECK (attributes_json IS NULL OR json_valid(attributes_json)),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_last_purchase ON customers (last_purchase_at);

CREATE TABLE IF NOT EXISTS suppliers (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    contact_json    TEXT CHECK (contact_json IS NULL OR json_valid(contact_json)),
    tax_id          TEXT,
    payment_terms   TEXT,                    -- 'contado','30 días'
    lead_time_days  INTEGER NOT NULL DEFAULT 0,  -- para punto de reorden (IA compras)
    balance         INTEGER NOT NULL DEFAULT 0,
    attributes_json TEXT CHECK (attributes_json IS NULL OR json_valid(attributes_json)),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers (tenant_id, name);

-- Precios de proveedor por producto (historial) → "¿quién vende más barato?"
CREATE TABLE IF NOT EXISTS supplier_prices (
    id          TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL REFERENCES suppliers(id),
    product_id  TEXT NOT NULL REFERENCES products(id),
    cost        INTEGER NOT NULL,            -- centavos
    currency    TEXT NOT NULL DEFAULT 'MXN',
    min_order   REAL NOT NULL DEFAULT 1,
    valid_from  INTEGER NOT NULL,
    valid_to    INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_supplier_prices_product
    ON supplier_prices (product_id, cost);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_supplier
    ON supplier_prices (supplier_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (5, 'parties', unixepoch() * 1000, 'PENDING');
