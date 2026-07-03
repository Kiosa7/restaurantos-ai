-- =============================================================================
-- 0003_tax_catalog.sql
-- Impuestos y catálogo de productos (marcas, categorías, unidades, productos,
-- variantes, códigos de barras múltiples).
-- =============================================================================

-- Impuestos individuales -----------------------------------------------------
CREATE TABLE IF NOT EXISTS taxes (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,               -- 'IVA 16%', 'IEPS', 'Exento'
    rate        REAL NOT NULL DEFAULT 0,     -- 0.16 = 16%
    kind        TEXT NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','fixed')),
    included    INTEGER NOT NULL DEFAULT 1,  -- 1 = precio incluye impuesto
    jurisdiction TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Perfil de impuestos: combina varios impuestos (ej. IVA + IEPS) -------------
CREATE TABLE IF NOT EXISTS tax_profiles (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    -- JSON array de tax_id con orden de aplicación: ["tax_a","tax_b"]
    tax_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tax_ids_json)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS brands (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Categorías jerárquicas (parent_id) -----------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    parent_id   TEXT REFERENCES categories(id),
    name        TEXT NOT NULL,
    vertical    TEXT,                        -- plugin que la introdujo (nullable)
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories (parent_id);

-- Unidades de medida con conversión a unidad base ----------------------------
CREATE TABLE IF NOT EXISTS units (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL REFERENCES tenants(id),
    name         TEXT NOT NULL,              -- 'pieza','kg','litro','caja-12'
    base_unit_id TEXT REFERENCES units(id),  -- NULL si es base
    factor       REAL NOT NULL DEFAULT 1,    -- 1 caja-12 = 12 piezas → factor 12
    allow_fraction INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    version      INTEGER NOT NULL DEFAULT 1,
    origin_node  TEXT NOT NULL,
    hlc          TEXT,
    dirty        INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Producto (cabecera de catálogo) --------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    sku             TEXT,                    -- único por tenant (índice abajo)
    barcode         TEXT,                    -- código principal (otros en product_barcodes)
    name            TEXT NOT NULL,
    name_normalized TEXT NOT NULL,           -- minúsculas/sin acentos para match
    description     TEXT,
    brand_id        TEXT REFERENCES brands(id),
    category_id     TEXT REFERENCES categories(id),
    unit_id         TEXT REFERENCES units(id),
    cost            INTEGER NOT NULL DEFAULT 0,  -- centavos
    price           INTEGER NOT NULL DEFAULT 0,  -- centavos (precio de venta base)
    currency        TEXT NOT NULL DEFAULT 'MXN',
    tax_profile_id  TEXT REFERENCES tax_profiles(id),
    track_stock     INTEGER NOT NULL DEFAULT 1,  -- 0 para servicios
    is_variable     INTEGER NOT NULL DEFAULT 0,  -- tiene variantes
    image_ref       TEXT,                        -- ruta/clave de imagen local
    embedding_id    TEXT,                        -- enlace a embeddings (IA)
    attributes_json TEXT CHECK (attributes_json IS NULL OR json_valid(attributes_json)),
    source          TEXT NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','ai_vision','ai_ocr','import','barcode_db')),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','archived','draft')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku
    ON products (tenant_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_name_norm ON products (tenant_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_dirty ON products (dirty) WHERE dirty = 1;

-- Variantes (talla/color/sabor): heredan del producto, sobreescriben precio ---
CREATE TABLE IF NOT EXISTS product_variants (
    id              TEXT PRIMARY KEY,
    product_id      TEXT NOT NULL REFERENCES products(id),
    sku             TEXT,
    barcode         TEXT,
    name            TEXT,                    -- 'Rojo / M'
    attributes_json TEXT CHECK (attributes_json IS NULL OR json_valid(attributes_json)),
    cost            INTEGER,                 -- NULL = hereda del producto
    price           INTEGER,                 -- NULL = hereda
    image_ref       TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_variants_barcode ON product_variants (barcode) WHERE barcode IS NOT NULL;

-- Múltiples códigos de barras por producto/variante --------------------------
-- (un producto puede tener varios EAN: presentación, importado, reempaquetado)
CREATE TABLE IF NOT EXISTS product_barcodes (
    id          TEXT PRIMARY KEY,
    product_id  TEXT NOT NULL REFERENCES products(id),
    variant_id  TEXT REFERENCES product_variants(id),
    barcode     TEXT NOT NULL,
    symbology   TEXT,                        -- 'EAN13','UPCA','CODE128','QR'
    pack_qty    REAL NOT NULL DEFAULT 1,     -- este código = N unidades base
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_barcodes_code
    ON product_barcodes (barcode) WHERE deleted_at IS NULL;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (3, 'tax_catalog', unixepoch() * 1000, 'PENDING');
