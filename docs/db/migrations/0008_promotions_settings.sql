-- =============================================================================
-- 0008_promotions_settings.sql
-- Promociones (motor por reglas JSON) y configuración clave/valor por alcance.
-- =============================================================================

-- Promociones: el motor de reglas vive en el dominio; aquí se persiste la regla.
-- rules_json ej:
--   {"type":"percent_off","value":0.1,"scope":{"category_id":"..."},
--    "conditions":{"min_qty":3},"stack":false}
-- type: 'percent_off','amount_off','bogo','bundle','price_override','loyalty_mult'
CREATE TABLE IF NOT EXISTS promotions (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    rules_json  TEXT NOT NULL CHECK (json_valid(rules_json)),
    priority    INTEGER NOT NULL DEFAULT 100,  -- menor = se evalúa antes
    stackable   INTEGER NOT NULL DEFAULT 0,
    valid_from  INTEGER,
    valid_to    INTEGER,
    -- restricción horaria/sucursal opcional (happy hour, por tienda)
    constraints_json TEXT CHECK (constraints_json IS NULL OR json_valid(constraints_json)),
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_promotions_active
    ON promotions (tenant_id, is_active, priority);

-- Configuración: clave/valor JSON con alcance (global, sucursal, caja, plugin) -
CREATE TABLE IF NOT EXISTS settings (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    scope       TEXT NOT NULL DEFAULT 'global'
                CHECK (scope IN ('global','location','register','plugin','ai')),
    scope_id    TEXT,                        -- location_id/register_id/plugin_id
    key         TEXT NOT NULL,
    value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key
    ON settings (tenant_id, scope, IFNULL(scope_id,''), key) WHERE deleted_at IS NULL;

-- Registro de plugins instalados (verticales) --------------------------------
CREATE TABLE IF NOT EXISTS plugins (
    id           TEXT PRIMARY KEY,           -- 'pharmacy','hardware_store'...
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    core_compat  TEXT NOT NULL,              -- semver de núcleo compatible (ej '^1.0')
    manifest_json TEXT NOT NULL CHECK (json_valid(manifest_json)),
    enabled      INTEGER NOT NULL DEFAULT 1,
    signature    TEXT,                       -- firma del plugin
    installed_at INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    origin_node  TEXT NOT NULL
) STRICT;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (8, 'promotions_settings', unixepoch() * 1000, 'PENDING');
