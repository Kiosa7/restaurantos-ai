# Esquema restaurantero — resumen (0012–0016)

> Complementa `docs/db/README.md` (convenciones, heredadas tal cual de
> pos-inteligente) y `~/pos-inteligente/docs/db/schema-overview.md` (0001-0011,
> copiadas verbatim a `docs/db/migrations/` de este repo como base). Aquí solo
> se documenta lo NUEVO.

## Migraciones nuevas

| # | Archivo | Contenido |
|---|---|---|
| 0012 | mesas_comandas | `tables`, `modifier_groups`, `modifier_options`, `orders`, `order_items`, `order_item_events`, `order_item_modifiers`, `order_sales` |
| 0013 | recetas | `recipes`, `recipe_items`, `modifier_recipe_deltas` |
| 0014 | turnos_propinas | `shifts`, `tips`, `tip_pool_configs`, `shift_tip_distributions` |
| 0015 | cfdi | `cfdi_issuers`, `cfdi_documents`, `cfdi_conceptos`, `cfdi_pago_complementos` |
| 0016 | triggers_vistas_restaurante | 2 triggers mecánicos (mesa↔comanda) + 6 vistas de reporte |

## Relación con el esquema heredado

Un **platillo del menú ES un `products`** (0003) — no se duplicó el concepto.
Un **insumo también ES un `products`** (con `track_stock=1`, sin aparecer en
el menú del mesero por categoría/uso). Esto es deliberado: reutiliza FTS5,
`inventory`/`inventory_movements` (0004) y `sale_items` (0006) sin cambios.
Lo nuevo es exclusivamente la capa de "cómo se sirve" (mesas/comandas/tiempos)
y "de qué está hecho" (recetas), no un catálogo paralelo.

## Vistas nuevas (alimentan tools de IA, mismo principio que 0011)

| Vista | Pregunta de negocio |
|---|---|
| `v_tables_status` | "¿qué mesas están libres ahora?" |
| `v_kitchen_queue` | cola del KDS (pendiente/en_preparacion, ordenada por antigüedad) |
| `v_dish_prep_time` | "¿qué platillo se tarda más en cocina?" (insumo para 86 predictivo) |
| `v_dish_sales_margin` | "¿qué platillo deja más margen real?" (precio − costo de receta) |
| `v_tips_by_shift` | "¿cómo cerró de propinas este turno?" |
| `v_table_turnover` | rotación promedio por mesa |

## Validación

`app/src/infra/sqlite/seedRestaurant.ts` siembra un menú con receta completa
(tacos al pastor: 3 tortillas + 0.15kg carne + 0.02kg cebolla) y un
modificador requerido (salsa). `restaurantSchema.test.ts` simula un servicio
completo contra `node:sqlite` real —abrir mesa (trigger→ocupada) → comanda →
bump a en_preparacion (descuento de inventario por receta, verificado en
`inventory.qty`) → bump a listo (verificado en `v_dish_prep_time`) → cerrar
comanda (trigger→por_limpiar) → venta+pago → turno+propina
(`v_tips_by_shift`) → margen del platillo (`v_dish_sales_margin`)— y pasa
(20/20 tests, typecheck y build limpios).

## Pendiente (no bloquea Fase 5)

- `modifier_recipe_deltas` (cómo un modificador altera la receta efectiva) se
  modeló pero no se ejercitó en el test end-to-end — el ejemplo sembrado
  (salsa) no tiene impacto de receta. Cubrir con un caso "sin cebolla" cuando
  se construya el caso de uso real de Fase 6.
- El descuento de inventario en el test se hizo a mano (simulando la TX);
  Fase 6 lo envuelve en un caso de uso `sendItemToKitchen` real con outbox,
  igual patrón que `checkoutSale` de pos-inteligente.
- Migraciones CFDI (0015) no se ejercitaron con datos en este spike — se
  activan hasta Fase 7 cuando haya cuenta de PAC real (spike 3).
