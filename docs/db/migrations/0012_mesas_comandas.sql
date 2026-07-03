-- =============================================================================
-- 0012_mesas_comandas.sql
-- Dominio NUEVO de RestaurantOS AI (no existe en pos-inteligente): mesas,
-- modificadores de menú, y comandas con ciclo de vida largo. Ver
-- docs/modelo-dominio.md para las reglas de negocio completas.
--
-- Un platillo del menú ES un `products` de 0003 (mismo catálogo, mismas
-- convenciones: precio en centavos, tax_profile, etc.) — no se duplica el
-- concepto de producto. Lo nuevo es: mesas, grupos de modificadores por
-- producto, y comandas (que NO son ventas: una comanda vive todo el
-- servicio, una venta es el documento inmutable que se genera al cobrar).
-- =============================================================================

-- Mesas ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tables (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    number      INTEGER NOT NULL,
    name        TEXT,                        -- alias opcional ("Terraza 2")
    zone        TEXT,                        -- 'salon','terraza','barra'
    capacity    INTEGER NOT NULL DEFAULT 4,
    pos_x       REAL,                        -- posición en el FloorPlan (0..1)
    pos_y       REAL,
    status      TEXT NOT NULL DEFAULT 'libre'
                CHECK (status IN ('libre','ocupada','por_limpiar','reservada')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tables_number
    ON tables (location_id, number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables (location_id, status);

-- Grupos de modificadores por producto (menú) -----------------------------
-- Ej: "Salsa" (única, requerida), "Extras" (múltiple, opcional).
CREATE TABLE IF NOT EXISTS modifier_groups (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    product_id  TEXT NOT NULL REFERENCES products(id),
    name        TEXT NOT NULL,
    single_choice INTEGER NOT NULL DEFAULT 1,   -- 1 = radio, 0 = checkboxes
    required    INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_modifier_groups_product ON modifier_groups (product_id);

CREATE TABLE IF NOT EXISTS modifier_options (
    id          TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL REFERENCES modifier_groups(id),
    name        TEXT NOT NULL,
    price_delta INTEGER NOT NULL DEFAULT 0,     -- centavos, +/-/0
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_modifier_options_group ON modifier_options (group_id);

-- Comandas (ciclo de vida largo, NO es una venta) -------------------------
CREATE TABLE IF NOT EXISTS orders (
    id          TEXT PRIMARY KEY,               -- UUID v7
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    table_id    TEXT NOT NULL REFERENCES tables(id),
    employee_id TEXT REFERENCES employees(id),   -- mesero que abrió la comanda
    guests      INTEGER NOT NULL DEFAULT 1,
    status      TEXT NOT NULL DEFAULT 'abierta'
                CHECK (status IN ('abierta','cobrando','cerrada','cancelada')),
    opened_at   INTEGER NOT NULL,
    closed_at   INTEGER,
    -- referencia lógica a la(s) venta(s) que la cobraron (división de cuenta = N ventas)
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_orders_table ON orders (table_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_location_status ON orders (location_id, status);

-- Ítems de la comanda: estado de cocina como LOG append-only (ver 0012 trigger
-- en 0010-style — aquí se registra en order_item_events, no como campo mutable
-- suelto) para reconstruir tiempos reales del KDS.
CREATE TABLE IF NOT EXISTS order_items (
    id              TEXT PRIMARY KEY,
    order_id        TEXT NOT NULL REFERENCES orders(id),
    product_id      TEXT NOT NULL REFERENCES products(id),
    name_snapshot   TEXT NOT NULL,
    course          TEXT NOT NULL DEFAULT 'fuerte'
                    CHECK (course IN ('entrada','fuerte','postre','bebida')),
    qty             REAL NOT NULL DEFAULT 1,
    unit_price      INTEGER NOT NULL,            -- centavos, precio base al momento de agregar
    notes           TEXT,
    status          TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (status IN ('pendiente','en_preparacion','listo','entregado','cancelado')),
    sent_at         INTEGER,                     -- cuándo se envió a cocina (reloj del hub)
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items (status, sent_at);

-- Log append-only de cambios de estado de cocina (para KDS y tiempos reales).
CREATE TABLE IF NOT EXISTS order_item_events (
    id              TEXT PRIMARY KEY,
    order_item_id   TEXT NOT NULL REFERENCES order_items(id),
    status          TEXT NOT NULL
                    CHECK (status IN ('pendiente','en_preparacion','listo','entregado','cancelado')),
    at              INTEGER NOT NULL,            -- epoch ms, SIEMPRE del reloj del hub
    employee_id     TEXT REFERENCES employees(id),
    created_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL
    -- inmutable: sin updated_at/deleted_at/version
) STRICT;

CREATE INDEX IF NOT EXISTS idx_order_item_events_item ON order_item_events (order_item_id, at);

-- Modificadores elegidos por línea de comanda (snapshot, igual que sale_items) -
CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id              TEXT PRIMARY KEY,
    order_item_id   TEXT NOT NULL REFERENCES order_items(id),
    group_id        TEXT REFERENCES modifier_groups(id),
    option_id       TEXT REFERENCES modifier_options(id),
    name_snapshot   TEXT NOT NULL,
    price_delta_snapshot INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_item ON order_item_modifiers (order_item_id);

-- Liga una comanda con la(s) venta(s) que la cobraron (división de cuenta) ---
CREATE TABLE IF NOT EXISTS order_sales (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES orders(id),
    sale_id     TEXT NOT NULL REFERENCES sales(id),
    created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_order_sales_order ON order_sales (order_id);
CREATE INDEX IF NOT EXISTS idx_order_sales_sale ON order_sales (sale_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (12, 'mesas_comandas', unixepoch() * 1000, 'PENDING');
