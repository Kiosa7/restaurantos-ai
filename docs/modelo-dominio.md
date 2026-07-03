# Modelo de dominio — RestaurantOS AI

> Vocabulario y reglas de negocio del dominio NUEVO (restaurantero). El
> dominio heredado (producto, venta, inventario por movimientos, caja) está
> documentado en `~/pos-inteligente/docs/db/schema-overview.md` y se reutiliza
> sin cambios de fondo. Este documento es la base conceptual para las
> migraciones de Fase 4 (`docs/db/`, aún no creadas).

## Entidades nuevas

- **Mesa (`Table`)**: identificada por número/nombre, pertenece a una zona
  (salón, terraza, barra), tiene estado (`libre`, `ocupada`, `por_limpiar`,
  `reservada` — Fase 7), capacidad, y posición en el plano (`FloorPlan`, ver
  `docs/ux/`).
- **Comanda (`Order`)**: se abre al sentar una mesa, vive mientras dura el
  servicio, se cierra al cobrar. Tiene un mesero asignado, una lista de
  `OrderItem`, y referencia a la mesa. A diferencia de una venta de
  mostrador, **no es atómica**: se construye incrementalmente a lo largo del
  servicio.
- **OrderItem**: un platillo dentro de una comanda, con cantidad,
  modificadores elegidos, notas libres, **tiempo** (`entrada`/`fuerte`/
  `postre`/`bebida`), y estado de cocina (`pendiente`→`en_preparacion`→
  `listo`→`entregado`). El estado de cocina es lo que alimenta el KDS.
- **Modificador (`Modifier` / `ModifierGroup`)**: grupos de opciones sobre un
  platillo (p. ej. "término de la carne": término medio/tres cuartos/bien
  cocido — selección única; "extras": queso/tocino — selección múltiple).
  Cada modificador puede tener su propio ajuste de precio (positivo, negativo
  o cero) y su propio impacto en receta (ver Receta).
- **Receta / Escandallo (`Recipe`)**: liga un platillo del menú con los
  insumos que consume y en qué cantidad. **El inventario NO se descuenta por
  unidad vendida del platillo — se descuenta por la suma de insumos de su
  receta** (esto es lo que distingue el inventario restaurantero del de
  mostrador). Un modificador puede alterar la receta efectiva (p. ej. "sin
  cebolla" resta el insumo cebolla de la receta base).
- **Turno (`Shift`)**: periodo de trabajo de un mesero, con propinas
  acumuladas y reglas de reparto CONFIGURABLES (individual, pool por turno,
  pool por porcentaje de ventas) — el PLAN.md es explícito en que el reparto
  no es una política fija del sistema, es configuración del negocio.
- **División de cuenta (`BillSplit`)**: al cerrar una comanda, puede dividirse
  por comensal, por ítem, o en partes iguales; genera N ventas (heredando el
  concepto de venta inmutable de pos-inteligente) que referencian la misma
  comanda origen.

## Reglas de negocio clave

1. **Una comanda pertenece a una mesa, una mesa puede tener varias comandas
   activas simultáneas solo durante una división de cuenta en curso** (nunca
   en operación normal — normalmente 1 mesa = 1 comanda activa a la vez).
2. **El estado de cocina de un `OrderItem` es un log de eventos, no un campo
   mutable suelto** — mismo principio append-only que `inventory_movements`
   en pos-inteligente, por la misma razón: auditoría y reconstrucción de
   tiempos reales para el KDS (cuánto tardó realmente cada platillo).
3. **El descuento de inventario por receta ocurre cuando el `OrderItem` pasa
   a `en_preparacion`** (no al agregarlo a la comanda, para no descontar
   platillos que se cancelan antes de empezar a cocinarse; no al entregarlo,
   porque el insumo ya se consumió al cocinar).
4. **Una comanda cerrada es inmutable.** Cambios post-cierre (p. ej. una
   devolución) son documentos nuevos que referencian la comanda original —
   mismo principio que ventas inmutables en pos-inteligente.
5. **El "86" (platillo agotado)** es un estado del `Product`/`Recipe`
   derivado de inventario insuficiente para al menos una porción — se
   calcula, no se mantiene como bandera manual (aunque el mesero/cocina puede
   forzarlo manualmente como override).

## Relación con CFDI (Fase 4 completa el modelo, Fase 7 lo activa)

El modelo de datos para CFDI (emisor, receptor, conceptos, impuestos,
complemento de pago) se diseña en Fase 4 siguiendo la estructura oficial CFDI
4.0 del SAT, independiente del PAC elegido (ver
`docs/spikes/spike-3-cfdi.md`). Una comanda cerrada/cobrada es la fuente de
los `Conceptos` de la factura; la factura es un documento derivado, nunca al
revés.
