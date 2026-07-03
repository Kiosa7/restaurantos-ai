-- =============================================================================
-- 0013_recetas.sql
-- Receta/escandallo: liga un platillo del menú (products) con los insumos que
-- consume. PRINCIPIO CLAVE (docs/modelo-dominio.md regla 3): el inventario NO
-- se descuenta por unidad de platillo vendida — se descuenta por la suma de
-- insumos de su receta, vía inventory_movements (0004), cuando el order_item
-- pasa a 'en_preparacion'. Los insumos SON products (mismo catálogo de 0003,
-- con track_stock=1); una receta es una lista de (insumo, cantidad, unidad).
-- =============================================================================

CREATE TABLE IF NOT EXISTS recipes (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    product_id  TEXT NOT NULL REFERENCES products(id),   -- el platillo del menú
    yield_qty   REAL NOT NULL DEFAULT 1,                 -- porciones que rinde esta receta
    notes       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_product
    ON recipes (product_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS recipe_items (
    id              TEXT PRIMARY KEY,
    recipe_id       TEXT NOT NULL REFERENCES recipes(id),
    ingredient_id   TEXT NOT NULL REFERENCES products(id),  -- insumo (track_stock=1)
    qty             REAL NOT NULL,                          -- por 1 porción (yield_qty=1)
    unit_id         TEXT REFERENCES units(id),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON recipe_items (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient ON recipe_items (ingredient_id);

-- Un modificador puede ALTERAR la receta efectiva (ej. "sin cebolla" resta el
-- insumo cebolla; "extra queso" suma queso). qty_delta puede ser negativo.
CREATE TABLE IF NOT EXISTS modifier_recipe_deltas (
    id              TEXT PRIMARY KEY,
    option_id       TEXT NOT NULL REFERENCES modifier_options(id),
    ingredient_id   TEXT NOT NULL REFERENCES products(id),
    qty_delta       REAL NOT NULL,               -- +suma / -resta insumo
    unit_id         TEXT REFERENCES units(id),
    created_at      INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_modifier_recipe_deltas_option ON modifier_recipe_deltas (option_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (13, 'recetas', unixepoch() * 1000, 'PENDING');
