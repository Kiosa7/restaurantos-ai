-- =============================================================================
-- 0010_triggers.sql
-- Triggers MECÁNICOS y deterministas:
--   1) Materialización del stock desde inventory_movements (append-only → cache)
--   2) Sincronización de la tabla FTS5 con products
--
-- NOTA DE DISEÑO IMPORTANTE:
--   updated_at, version, hlc, dirty y la escritura en `outbox` se realizan en la
--   CAPA DE DOMINIO dentro de la MISMA transacción que el cambio, NO en triggers.
--   Razón: el outbox necesita el HLC (Hybrid Logical Clock) y un payload
--   serializado consistente, lógica que vive mejor en código testeable que en
--   SQL. Los triggers se reservan para transformaciones puramente mecánicas.
--   (Se incluye abajo un trigger 'touch' de ejemplo, desactivado por defecto.)
-- =============================================================================

-- 1) Stock = suma de deltas ---------------------------------------------------
-- Cada movimiento ajusta la materialización `inventory`. La fila se crea si no
-- existe (upsert por la clave única lógica). `inventory` es DERIVADA y local:
-- la VERDAD que se sincroniza es `inventory_movements`. Ante duda, se recalcula:
--   UPDATE inventory SET qty=(SELECT COALESCE(SUM(qty_delta),0) FROM ...).
CREATE TRIGGER IF NOT EXISTS trg_inv_apply_movement
AFTER INSERT ON inventory_movements
FOR EACH ROW
BEGIN
    INSERT INTO inventory (
        id, tenant_id, location_id, product_id, variant_id,
        qty, avg_cost, created_at, updated_at, origin_node, dirty
    )
    VALUES (
        lower(hex(randomblob(16))), NEW.tenant_id, NEW.location_id,
        NEW.product_id, NEW.variant_id,
        NEW.qty_delta, COALESCE(NEW.unit_cost, 0),
        NEW.created_at, NEW.created_at, NEW.origin_node, 1
    )
    ON CONFLICT(location_id, product_id, IFNULL(variant_id,'')) DO UPDATE SET
        qty        = qty + NEW.qty_delta,
        updated_at = NEW.created_at,
        dirty      = 1;
END;

-- 2) FTS5 sincronizado con products (external content) ------------------------
CREATE TRIGGER IF NOT EXISTS trg_products_fts_ai
AFTER INSERT ON products
FOR EACH ROW
BEGIN
    INSERT INTO products_fts (rowid, name, name_normalized, description, sku, barcode)
    VALUES (NEW.rowid, NEW.name, NEW.name_normalized, NEW.description, NEW.sku, NEW.barcode);
END;

CREATE TRIGGER IF NOT EXISTS trg_products_fts_ad
AFTER DELETE ON products
FOR EACH ROW
BEGIN
    INSERT INTO products_fts (products_fts, rowid, name, name_normalized, description, sku, barcode)
    VALUES ('delete', OLD.rowid, OLD.name, OLD.name_normalized, OLD.description, OLD.sku, OLD.barcode);
END;

CREATE TRIGGER IF NOT EXISTS trg_products_fts_au
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
    INSERT INTO products_fts (products_fts, rowid, name, name_normalized, description, sku, barcode)
    VALUES ('delete', OLD.rowid, OLD.name, OLD.name_normalized, OLD.description, OLD.sku, OLD.barcode);
    INSERT INTO products_fts (rowid, name, name_normalized, description, sku, barcode)
    VALUES (NEW.rowid, NEW.name, NEW.name_normalized, NEW.description, NEW.sku, NEW.barcode);
END;

-- 3) (OPCIONAL / DESACTIVADO) 'touch' de updated_at/version en SQL ------------
-- Solo si decides NO manejar updated_at/version en el dominio. Funciona con el
-- default PRAGMA recursive_triggers = OFF (la UPDATE interna no re-dispara).
-- Descomenta por tabla si lo necesitas:
--
-- CREATE TRIGGER trg_products_touch
-- AFTER UPDATE ON products FOR EACH ROW
-- WHEN NEW.updated_at <= OLD.updated_at
-- BEGIN
--     UPDATE products
--        SET updated_at = unixepoch() * 1000,
--            version    = OLD.version + 1,
--            dirty      = 1
--      WHERE id = NEW.id;
-- END;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (10, 'triggers', unixepoch() * 1000, 'PENDING');
