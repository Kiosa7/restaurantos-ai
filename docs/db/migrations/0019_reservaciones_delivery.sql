-- =============================================================================
-- 0019_reservaciones_delivery.sql
-- Fase 7 §10.1 puntos 5/6: reservaciones y delivery/para llevar. Módulos
-- genuinamente nuevos (no existían en pos-inteligente, mostrador puro).
--
-- DECISIÓN DE DISEÑO para delivery/para llevar: en vez de hacer `table_id`
-- opcional en `orders` (0012) — lo que obligaría a recrear esa tabla en
-- SQLite (no hay ALTER COLUMN) y a tocar todo el pipeline de comandas/KDS/
-- checkout que ya asume una mesa — se seedean MESAS VIRTUALES ("Para llevar",
-- "Domicilio", zone='virtual') y `delivery_orders` liga un `order_id` real
-- a esa mesa virtual. Así, para llevar/domicilio REUTILIZA sin cambios todo
-- el pipeline ya validado (comanda → KDS → checkout → CFDI).
-- =============================================================================

CREATE TABLE IF NOT EXISTS reservations (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    location_id     TEXT NOT NULL REFERENCES locations(id),
    table_id        TEXT REFERENCES tables(id),   -- se puede asignar después, o quedar null
    customer_name   TEXT NOT NULL,
    customer_phone  TEXT,
    party_size      INTEGER NOT NULL DEFAULT 2,
    reserved_at     INTEGER NOT NULL,              -- epoch ms de la hora reservada
    status          TEXT NOT NULL DEFAULT 'confirmada'
                    CHECK (status IN ('confirmada','sentada','cancelada','no_show')),
    notes           TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_reservations_reserved_at ON reservations (location_id, reserved_at);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);

CREATE TABLE IF NOT EXISTS delivery_orders (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    location_id     TEXT NOT NULL REFERENCES locations(id),
    order_id        TEXT NOT NULL REFERENCES orders(id),  -- la comanda real (mesa virtual)
    channel         TEXT NOT NULL CHECK (channel IN ('para_llevar','domicilio')),
    customer_name   TEXT NOT NULL,
    customer_phone  TEXT,
    address         TEXT,                          -- solo domicilio
    status          TEXT NOT NULL DEFAULT 'recibido'
                    CHECK (status IN ('recibido','preparando','listo','en_camino','entregado','cancelado')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    origin_node     TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders (location_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_orders_order ON delivery_orders (order_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (19, 'reservaciones_delivery', unixepoch() * 1000, 'PENDING');
