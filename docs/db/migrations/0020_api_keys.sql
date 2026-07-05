-- =============================================================================
-- 0020_api_keys.sql
-- Fase 8 §10.2 punto 4: API pública para integraciones de terceros
-- (contabilidad, agregadores de delivery reales) sobre un subconjunto de
-- endpoints ya existentes, protegido por API key con scopes — no exponer el
-- hub LAN completo (pensado para tablets de confianza dentro de la red del
-- restaurante) a Internet sin control de acceso.
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,            -- 'Contpaqi', 'Uber Eats'... (para qué integración es)
    key_hash     TEXT NOT NULL,            -- sha256(key), mismo patrón que pin_hash — la key en claro solo se ve una vez, al crearla
    scopes_json  TEXT NOT NULL CHECK (json_valid(scopes_json)), -- ej. '["sales.read","menu.read"]'
    created_at   INTEGER NOT NULL,
    revoked_at   INTEGER,
    last_used_at INTEGER,
    origin_node  TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE revoked_at IS NULL;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (20, 'api_keys', unixepoch() * 1000, 'PENDING');
