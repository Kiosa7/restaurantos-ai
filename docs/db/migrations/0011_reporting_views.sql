-- =============================================================================
-- 0011_reporting_views.sql
-- Vistas de reporte que respaldan las "tools" (function calling) del asistente
-- de IA conversacional. El LLM NO escribe SQL libre: invoca una tool acotada que
-- consulta UNA de estas vistas con parámetros seguros. Esto da:
--   - seguridad (sin inyección, sin acceso arbitrario)
--   - determinismo y verificabilidad (la respuesta cita la vista usada)
--   - control de permisos por rol sobre qué tools se exponen
--
-- Mapa vista → pregunta de negocio del brief:
--   v_sales_by_day         → "¿Cuánto vendimos hoy / esta semana?"
--   v_top_products         → "¿Qué producto se vende más?"
--   v_product_margin       → "¿Qué productos son rentables / no rentables?"
--   v_low_stock            → "¿Qué debo comprar?" (por agotarse / agotado)
--   v_dead_stock           → "¿Qué no se mueve / sobre-inventariado?"
--   v_customer_activity     → "¿Qué cliente dejó de comprar?"
--   v_supplier_best_price  → "¿Qué proveedor tiene mejores precios?"
--   v_cash_session_summary → "¿Cómo cerró la caja? ¿Hubo faltante?"
--
-- Convención de tiempo: datetime/created_at están en epoch MS → /1000 para
-- las funciones de fecha de SQLite ('unixepoch').
-- =============================================================================

-- Ventas por día y sucursal --------------------------------------------------
DROP VIEW IF EXISTS v_sales_by_day;
CREATE VIEW v_sales_by_day AS
SELECT
    s.tenant_id,
    s.location_id,
    date(s.datetime / 1000, 'unixepoch', 'localtime') AS day,
    COUNT(*)                          AS tickets,
    SUM(s.total)                      AS revenue_cents,
    SUM(s.tax_total)                  AS tax_cents,
    SUM(s.discount_total)             AS discount_cents
FROM sales s
WHERE s.status = 'completed'
GROUP BY s.tenant_id, s.location_id, day;

-- Productos más vendidos (cantidad e ingreso) --------------------------------
DROP VIEW IF EXISTS v_top_products;
CREATE VIEW v_top_products AS
SELECT
    s.tenant_id,
    s.location_id,
    si.product_id,
    si.name_snapshot                          AS product_name,
    SUM(si.qty)                               AS qty_sold,
    SUM(si.line_total)                        AS revenue_cents,
    SUM(si.line_total - si.cost_snapshot * si.qty) AS margin_cents,
    COUNT(DISTINCT si.sale_id)                AS ticket_count,
    MAX(s.datetime)                           AS last_sold_at
FROM sale_items si
JOIN sales s ON s.id = si.sale_id AND s.status = 'completed'
WHERE si.product_id IS NOT NULL
GROUP BY s.tenant_id, s.location_id, si.product_id;

-- Margen / rentabilidad por producto -----------------------------------------
DROP VIEW IF EXISTS v_product_margin;
CREATE VIEW v_product_margin AS
SELECT
    tenant_id,
    location_id,
    product_id,
    product_name,
    qty_sold,
    revenue_cents,
    margin_cents,
    CASE WHEN revenue_cents > 0
         THEN ROUND(100.0 * margin_cents / revenue_cents, 2)
         ELSE NULL END AS margin_pct
FROM v_top_products;

-- Stock bajo / por agotarse / agotado ----------------------------------------
DROP VIEW IF EXISTS v_low_stock;
CREATE VIEW v_low_stock AS
SELECT
    i.tenant_id,
    i.location_id,
    i.product_id,
    p.name        AS product_name,
    p.barcode,
    i.qty,
    i.min_qty,
    i.max_qty,
    CASE
        WHEN i.qty <= 0          THEN 'agotado'
        WHEN i.qty <= i.min_qty  THEN 'por_agotarse'
        WHEN i.max_qty IS NOT NULL AND i.qty > i.max_qty THEN 'sobre_inventario'
        ELSE 'ok'
    END AS stock_status
FROM inventory i
JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
WHERE i.deleted_at IS NULL;

-- Stock sin movimiento (baja rotación) ---------------------------------------
-- days_since_last_sale: NULL = nunca vendido. La tool filtra por umbral.
DROP VIEW IF EXISTS v_dead_stock;
CREATE VIEW v_dead_stock AS
SELECT
    i.tenant_id,
    i.location_id,
    i.product_id,
    p.name AS product_name,
    i.qty,
    last_sale.last_sold_at,
    CASE WHEN last_sale.last_sold_at IS NULL THEN NULL
         ELSE (unixepoch() * 1000 - last_sale.last_sold_at) / 86400000
    END AS days_since_last_sale
FROM inventory i
JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
LEFT JOIN (
    SELECT si.product_id, s.location_id, MAX(s.datetime) AS last_sold_at
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id AND s.status = 'completed'
    GROUP BY si.product_id, s.location_id
) last_sale ON last_sale.product_id = i.product_id
           AND last_sale.location_id = i.location_id
WHERE i.deleted_at IS NULL AND i.qty > 0;

-- Actividad de clientes (detectar fuga) --------------------------------------
DROP VIEW IF EXISTS v_customer_activity;
CREATE VIEW v_customer_activity AS
SELECT
    c.tenant_id,
    c.id            AS customer_id,
    c.name,
    c.segment,
    c.last_purchase_at,
    CASE WHEN c.last_purchase_at IS NULL THEN NULL
         ELSE (unixepoch() * 1000 - c.last_purchase_at) / 86400000
    END             AS days_since_last_purchase,
    agg.lifetime_revenue_cents,
    agg.lifetime_tickets
FROM customers c
LEFT JOIN (
    SELECT customer_id,
           SUM(total) AS lifetime_revenue_cents,
           COUNT(*)   AS lifetime_tickets
    FROM sales
    WHERE status = 'completed' AND customer_id IS NOT NULL
    GROUP BY customer_id
) agg ON agg.customer_id = c.id
WHERE c.deleted_at IS NULL;

-- Mejor precio de proveedor vigente por producto -----------------------------
DROP VIEW IF EXISTS v_supplier_best_price;
CREATE VIEW v_supplier_best_price AS
SELECT product_id, supplier_id, supplier_name, cost, currency, min_order, lead_time_days
FROM (
    SELECT
        sp.product_id,
        sp.supplier_id,
        su.name AS supplier_name,
        sp.cost,
        sp.currency,
        sp.min_order,
        su.lead_time_days,
        RANK() OVER (PARTITION BY sp.product_id ORDER BY sp.cost ASC) AS rnk
    FROM supplier_prices sp
    JOIN suppliers su ON su.id = sp.supplier_id AND su.deleted_at IS NULL
    WHERE sp.deleted_at IS NULL
      AND sp.valid_from <= unixepoch() * 1000
      AND (sp.valid_to IS NULL OR sp.valid_to >= unixepoch() * 1000)
)
WHERE rnk = 1;

-- Resumen de sesiones de caja (arqueo) ---------------------------------------
DROP VIEW IF EXISTS v_cash_session_summary;
CREATE VIEW v_cash_session_summary AS
SELECT
    cs.id AS cash_session_id,
    cs.tenant_id,
    cs.location_id,
    cs.register_id,
    cs.employee_id,
    cs.opened_at,
    cs.closed_at,
    cs.opening_amount,
    cs.expected_amount,
    cs.counted_amount,
    cs.diff_amount,
    cs.status,
    COALESCE(mv.cash_in, 0)  AS cash_movements_in,
    COALESCE(mv.cash_out, 0) AS cash_movements_out
FROM cash_sessions cs
LEFT JOIN (
    SELECT cash_session_id,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS cash_in,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS cash_out
    FROM cash_movements
    GROUP BY cash_session_id
) mv ON mv.cash_session_id = cs.id
WHERE cs.deleted_at IS NULL;

-- Índices de apoyo a reportes pesados ----------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_status_datetime
    ON sales (status, datetime);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_sale
    ON sale_items (product_id, sale_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (11, 'reporting_views', unixepoch() * 1000, 'PENDING');
