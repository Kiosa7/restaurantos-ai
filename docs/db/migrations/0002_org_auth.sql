-- =============================================================================
-- 0002_org_auth.sql
-- Organización (tenant / sucursales / cajas) y autenticación local (roles /
-- empleados). El plano local normalmente opera UN tenant; tenant_id se mantiene
-- para homogeneidad con la nube multi-tenant y futura consolidación.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tax_id      TEXT,
    country     TEXT,                        -- ISO 3166-1 (afecta plugin fiscal)
    currency    TEXT NOT NULL DEFAULT 'MXN', -- ISO 4217 por defecto
    settings_json TEXT CHECK (settings_json IS NULL OR json_valid(settings_json)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS locations (
    id          TEXT PRIMARY KEY,            -- = sucursal
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,
    code        TEXT,                        -- código corto de sucursal
    address_json TEXT CHECK (address_json IS NULL OR json_valid(address_json)),
    timezone    TEXT NOT NULL DEFAULT 'America/Mexico_City',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_locations_tenant ON locations (tenant_id);

CREATE TABLE IF NOT EXISTS registers (
    id          TEXT PRIMARY KEY,            -- caja física / terminal
    location_id TEXT NOT NULL REFERENCES locations(id),
    name        TEXT NOT NULL,
    device_node TEXT,                        -- nodo de sync asociado a esta caja
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_registers_location ON registers (location_id);

-- Roles: permisos como arreglo JSON de capacidades (capability-based) ---------
-- Ej: ["sale.create","sale.refund","price.edit","cash.close","inventory.adjust",
--      "report.view","ai.train","plugin.install","employee.manage"]
CREATE TABLE IF NOT EXISTS roles (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    name        TEXT NOT NULL,               -- Owner, Admin, Gerente, Cajero...
    permissions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions_json)),
    is_system   INTEGER NOT NULL DEFAULT 0,  -- roles base no editables
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE IF NOT EXISTS employees (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    role_id     TEXT NOT NULL REFERENCES roles(id),
    name        TEXT NOT NULL,
    email       TEXT,
    pin_hash    TEXT,                        -- Argon2/bcrypt del PIN (auth offline)
    password_hash TEXT,
    -- alcance de acceso del empleado (sucursales permitidas), JSON array de location_id
    scope_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(scope_json)),
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','disabled')),
    last_login_at INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    version     INTEGER NOT NULL DEFAULT 1,
    origin_node TEXT NOT NULL,
    hlc         TEXT,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_employees_tenant ON employees (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees (email) WHERE email IS NOT NULL;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (2, 'org_auth', unixepoch() * 1000, 'PENDING');
