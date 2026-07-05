-- =============================================================================
-- 0017_hub_lan_log.sql
-- Persistencia del protocolo LAN (spike 1 / docs/spikes/spike-5-hub-rust.md).
-- Distinto del `outbox` de 0001 (que es para sync hub↔nube): aquí se guarda
-- el log de EVENTOS del protocolo multi-terminal (para replay por
-- since_index) y el ledger de deduplicación por UUID de comando. Sin esto,
-- el hub pierde su historial y su dedup cada vez que el proceso se reinicia
-- — el riesgo que Fase 6 §10.1 marcaba como pendiente.
-- =============================================================================

-- Ledger de deduplicación: un comando con este id YA fue procesado.
CREATE TABLE IF NOT EXISTS hub_commands (
    id            TEXT PRIMARY KEY,   -- UUID del comando (lo genera el cliente)
    cmd           TEXT NOT NULL,
    event_id      TEXT,               -- id del evento que produjo (NULL si no generó uno)
    processed_at  INTEGER NOT NULL
) STRICT;

-- Log de eventos difundidos a las terminales, en orden de `idx` (permite
-- "vi hasta idx N" en la reconexión — mismo protocolo que spike 1/Rust).
CREATE TABLE IF NOT EXISTS hub_events (
    idx           INTEGER PRIMARY KEY AUTOINCREMENT,
    id            TEXT NOT NULL UNIQUE,
    cmd           TEXT NOT NULL,
    payload_json  TEXT NOT NULL CHECK (json_valid(payload_json)),
    server_time   INTEGER NOT NULL,
    caused_by     TEXT NOT NULL       -- id del comando que lo originó
) STRICT;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (17, 'hub_lan_log', unixepoch() * 1000, 'PENDING');
