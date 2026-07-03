-- =============================================================================
-- 0004_inventory.sql
-- Inventario por sucursal. PRINCIPIO CLAVE: el stock real es la SUMA de
-- inventory_movements (append-only). 'inventory.qty' es una MATERIALIZACIÓN
-- (cache) recalculable, actualizada por trigger. Esto:
--   - evita corrupción (un número mutable suelto)
--   - hace el sync de stock conmutativo (CRDT por suma de deltas)
--   - da trazabilidad total de cada cambio de existencias
-- =============================================================================

-- Materialización del stock (rápida de leer en la venta) ---------------------
CREATE TABLE IF NOT EXISTS inventory (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    location_id   TEXT NOT NULL REFERENCES locations(id),
    product_id    TEXT NOT NULL REFERENCES products(id),
    variant_id    TEXT REFERENCES product_variants(id),
    qty           REAL NOT NULL DEFAULT 0,   -- existencia actual (cache)
    qty_reserved  REAL NOT NULL DEFAULT 0,   -- apartado (ventas en proceso)
    min_qty       REAL NOT NULL DEFAULT 0,   -- punto de reorden
    max_qty       REAL,                      -- sobre-inventario por encima de esto
    avg_cost      INTEGER NOT NULL DEFAULT 0,-- costo promedio (centavos)
    last_counted_at INTEGER,                 -- último conteo físico
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    version       INTEGER NOT NULL DEFAULT 1,
    origin_node   TEXT NOT NULL,
    hlc           TEXT,
    dirty         INTEGER NOT NULL DEFAULT 1
) STRICT;

-- una fila de stock por (sucursal, producto, variante)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_unique
    ON inventory (location_id, product_id, IFNULL(variant_id,''));
CREATE INDEX IF NOT EXISTS idx_inventory_low
    ON inventory (location_id) WHERE qty <= min_qty;
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory (product_id);

-- Movimientos de inventario (append-only = verdad del stock) -----------------
-- type: 'sale','purchase','adjustment','return','transfer_in','transfer_out',
--       'initial','waste','count_correction'
-- qty_delta: POSITIVO suma, NEGATIVO resta. La suma de deltas = inventory.qty.
CREATE TABLE IF NOT EXISTS inventory_movements (
    id            TEXT PRIMARY KEY,          -- UUID v7
    tenant_id     TEXT NOT NULL REFERENCES tenants(id),
    location_id   TEXT NOT NULL REFERENCES locations(id),
    product_id    TEXT NOT NULL REFERENCES products(id),
    variant_id    TEXT REFERENCES product_variants(id),
    type          TEXT NOT NULL CHECK (type IN
                    ('sale','purchase','adjustment','return','transfer_in',
                     'transfer_out','initial','waste','count_correction')),
    qty_delta     REAL NOT NULL,             -- +entra / -sale
    unit_cost     INTEGER,                   -- costo del movimiento (centavos)
    ref_doc       TEXT,                      -- 'sale:<id>', 'purchase:<id>'
    reason        TEXT,
    employee_id   TEXT REFERENCES employees(id),
    -- lote/caducidad para verticales que lo requieran (farmacia, abarrotes)
    lot           TEXT,
    expires_at    INTEGER,
    created_at    INTEGER NOT NULL,
    origin_node   TEXT NOT NULL,
    hlc           TEXT,
    dirty         INTEGER NOT NULL DEFAULT 1
    -- NOTA: sin updated_at/deleted_at/version: es inmutable (append-only)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_movements_product
    ON inventory_movements (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_location
    ON inventory_movements (location_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_ref ON inventory_movements (ref_doc);
CREATE INDEX IF NOT EXISTS idx_movements_expiry
    ON inventory_movements (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movements_dirty
    ON inventory_movements (dirty) WHERE dirty = 1;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (4, 'inventory', unixepoch() * 1000, 'PENDING');
