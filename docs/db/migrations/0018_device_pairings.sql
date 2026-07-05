-- =============================================================================
-- 0018_device_pairings.sql
-- Pairing real de dispositivos LAN (Fase 6 §10.9, docs/spikes/spike-5-hub-rust.md
-- "el endpoint /pair de hoy es un placeholder"). El hub genera un código
-- corto (QR/PIN) que una tablet nueva redime UNA vez para obtener un
-- `deviceId` persistente ligado a un rol — después de eso, el WS del
-- protocolo LAN puede identificar a ese dispositivo específico, no solo "un
-- string arbitrario que el cliente eligió" (que era el comportamiento del
-- prototipo desde el spike 1).
-- =============================================================================

-- Código de emparejamiento: de un solo uso, expira a los 5 minutos.
CREATE TABLE IF NOT EXISTS device_pairings (
    code        TEXT PRIMARY KEY,           -- 6 dígitos, generado por el hub
    role        TEXT NOT NULL CHECK (role IN ('mesero','kds','caja')),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    redeemed_at INTEGER,
    device_id   TEXT                        -- se llena al redimir
) STRICT;

CREATE INDEX IF NOT EXISTS idx_device_pairings_pending
    ON device_pairings (expires_at) WHERE redeemed_at IS NULL;

-- Dispositivo pareado: identidad persistente de una tablet/KDS/caja concreta.
CREATE TABLE IF NOT EXISTS devices (
    id            TEXT PRIMARY KEY,         -- UUID v7, el "device" que usa el WS
    role          TEXT NOT NULL CHECK (role IN ('mesero','kds','caja')),
    label         TEXT,                     -- nombre humano opcional ("Tablet mesero 2")
    paired_at     INTEGER NOT NULL,
    last_seen_at  INTEGER
) STRICT;

CREATE INDEX IF NOT EXISTS idx_devices_role ON devices (role);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (18, 'device_pairings', unixepoch() * 1000, 'PENDING');
