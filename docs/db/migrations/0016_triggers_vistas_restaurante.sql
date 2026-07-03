-- =============================================================================
-- 0016_triggers_vistas_restaurante.sql
-- Trigger mecánico (mismo criterio que 0010: solo transformaciones puramente
-- deterministas van en SQL) + vistas de reporte restauranteras que alimentan
-- nuevas tools de IA (docs/arquitectura-tecnica.md §5).
--
-- NOTA DE DISEÑO: el descuento de inventario por receta al pasar un
-- order_item a 'en_preparacion' (docs/modelo-dominio.md regla 3) NO es un
-- trigger — es lógica de dominio (una TX que lee recipe_items + deltas de
-- modificadores e inserta inventory_movements), igual que checkoutSale en
-- pos-inteligente. Un trigger no puede "leer la receta y decidir" con la
-- claridad de código testeable.
-- =============================================================================

-- Mantener tables.status en sync cuando se abre/cierra una comanda -----------
CREATE TRIGGER IF NOT EXISTS trg_orders_open_marks_table_ocupada
AFTER INSERT ON orders
FOR EACH ROW
WHEN NEW.status = 'abierta'
BEGIN
    UPDATE tables SET status = 'ocupada', updated_at = NEW.created_at, dirty = 1
    WHERE id = NEW.table_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_closed_marks_table_por_limpiar
AFTER UPDATE ON orders
FOR EACH ROW
WHEN NEW.status = 'cerrada' AND OLD.status != 'cerrada'
BEGIN
    UPDATE tables SET status = 'por_limpiar', updated_at = NEW.updated_at, dirty = 1
    WHERE id = NEW.table_id;
END;

-- Vistas de reporte -----------------------------------------------------------
-- v_tables_status       → "¿qué mesas están libres/ocupadas ahora?"
-- v_kitchen_queue       → cola del KDS: ítems pendientes/en preparación ordenados
-- v_dish_prep_time      → "¿qué platillo se tarda más en cocina?" (86 predictivo usa esto)
-- v_dish_sales_margin   → margen real por platillo (precio venta - costo de receta)
-- v_tips_by_shift       → "¿cómo cerró de propinas este turno?"
-- v_table_turnover      → tiempo promedio de ocupación por mesa (rotación)

DROP VIEW IF EXISTS v_tables_status;
CREATE VIEW v_tables_status AS
SELECT
    t.id, t.location_id, t.number, t.zone, t.capacity, t.status,
    o.id   AS open_order_id,
    o.opened_at,
    (unixepoch() * 1000 - o.opened_at) / 60000 AS minutos_ocupada
FROM tables t
LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'abierta'
WHERE t.deleted_at IS NULL;

DROP VIEW IF EXISTS v_kitchen_queue;
CREATE VIEW v_kitchen_queue AS
SELECT
    oi.id AS order_item_id,
    o.table_id,
    t.number AS table_number,
    oi.name_snapshot,
    oi.course,
    oi.qty,
    oi.status,
    oi.sent_at,
    (unixepoch() * 1000 - oi.sent_at) / 1000 AS segundos_transcurridos
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN tables t ON t.id = o.table_id
WHERE oi.status IN ('pendiente', 'en_preparacion')
ORDER BY oi.sent_at ASC;

DROP VIEW IF EXISTS v_dish_prep_time;
CREATE VIEW v_dish_prep_time AS
SELECT
    oi.product_id,
    oi.name_snapshot AS product_name,
    COUNT(*) AS veces_preparado,
    AVG((ready.at - oi.sent_at) / 1000.0) AS segundos_promedio_preparacion
FROM order_items oi
JOIN order_item_events ready
    ON ready.order_item_id = oi.id AND ready.status = 'listo'
WHERE oi.sent_at IS NOT NULL
GROUP BY oi.product_id, oi.name_snapshot;

DROP VIEW IF EXISTS v_dish_sales_margin;
CREATE VIEW v_dish_sales_margin AS
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.price AS precio_venta_cents,
    COALESCE(SUM(ri.qty * ing.cost), 0) AS costo_receta_cents,
    p.price - COALESCE(SUM(ri.qty * ing.cost), 0) AS margen_cents
FROM products p
LEFT JOIN recipes r ON r.product_id = p.id AND r.deleted_at IS NULL
LEFT JOIN recipe_items ri ON ri.recipe_id = r.id AND ri.deleted_at IS NULL
LEFT JOIN products ing ON ing.id = ri.ingredient_id
GROUP BY p.id, p.name, p.price;

DROP VIEW IF EXISTS v_tips_by_shift;
CREATE VIEW v_tips_by_shift AS
SELECT
    sh.id AS shift_id,
    sh.employee_id,
    sh.started_at,
    sh.ended_at,
    COUNT(tp.id) AS num_propinas,
    COALESCE(SUM(tp.amount), 0) AS total_propinas_cents
FROM shifts sh
LEFT JOIN tips tp ON tp.shift_id = sh.id
GROUP BY sh.id, sh.employee_id, sh.started_at, sh.ended_at;

DROP VIEW IF EXISTS v_table_turnover;
CREATE VIEW v_table_turnover AS
SELECT
    o.table_id,
    t.number AS table_number,
    COUNT(*) AS comandas_cerradas,
    AVG((o.closed_at - o.opened_at) / 60000.0) AS minutos_promedio_ocupacion
FROM orders o
JOIN tables t ON t.id = o.table_id
WHERE o.status = 'cerrada' AND o.closed_at IS NOT NULL
GROUP BY o.table_id, t.number;

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (16, 'triggers_vistas_restaurante', unixepoch() * 1000, 'PENDING');
