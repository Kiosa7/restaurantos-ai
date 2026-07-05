# Esquema restaurantero — resumen (0012–0017)

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
| 0017 | hub_lan_log | `hub_commands` (dedup por UUID), `hub_events` (replay del protocolo LAN) — Fase 6 §10.1, ver `docs/spikes/spike-5-hub-rust.md` |

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

## Actualización Fase 6 (0017 + comandos reales sobre Rust)

El hub Rust (`app/src-tauri/src/commands.rs`) ya escribe de verdad sobre
`orders`/`order_items`/`order_item_modifiers` al procesar `nueva_comanda`, y
descuenta inventario por receta (0013) al procesar `bump_platillo` hacia
`en_preparacion` — el caso de uso `sendItemToKitchen` que este documento
marcaba como pendiente ya existe (`handle_bump_platillo`), verificado con
persistencia real entre "reinicios" (`persistencia_y_descuento_de_inventario_por_receta`
en `src-tauri/tests/hub_test.rs`, no un test manual). El cobro (`handle_checkout`)
genera venta(s) con hash chain real y cierra la comanda; turnos/propinas
(`open_shift`/`close_shift`) reparten en modo `individual` (0014).

## Pendiente

- `modifier_recipe_deltas` (cómo un modificador altera la receta efectiva)
  sigue sin ejercitarse con un caso real ("sin cebolla") — el modelo existe,
  falta el caso de uso que lo lea al calcular el descuento.
- Modos de reparto de propina `pool_turno`/`pool_ventas` (0014) no están
  implementados — `close_shift` cae a reparto individual con un log de
  advertencia (DECISIÓN AUTÓNOMA, ver PLAN.md bitácora Fase 6).
- Migraciones CFDI (0015) siguen sin ejercitarse con datos — Fase 7,
  cuando haya cuenta de PAC real (spike 3).
- División de cuenta (`partes_iguales`/`por_comensal`) genera ventas
  sintéticas de "N de M" sin desglose por ítem — simplificación de MVP,
  documentada en `commands.rs`.
