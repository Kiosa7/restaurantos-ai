# Extensión del Design System — Fase 3

Nuevas primitivas restauranteras en `app/src/ui/components/restaurant/`,
construidas sobre las mismas primitivas y tokens de
`app/src/ui/components/ui/` heredadas de pos-inteligente (mismo `cn`, mismos
tokens OKLCH de `index.css`, mismo mínimo de 44px de target táctil).

| Componente | Uso | Superficie |
|---|---|---|
| `FloorPlan` | grid de mesas con color por estado, 1 toque para abrir/retomar | Mesero, Caja |
| `ModifierPicker` | grupos de modificadores como botones grandes; auto-confirma al completar los requeridos | Mesero |
| `NumPad` | teclado numérico táctil (cobro, arqueo, PIN) | Caja |
| `TipSelector` | propina sugerida 10/15/20%/otro, informativa (no gravada, ADR-3) | Caja |
| `CourseTimeline` | línea entrada→fuerte→postre, indica qué tiempo enviar | Mesero |
| `OrderTicket` | tarjeta de comanda del KDS, color por urgencia contra el reloj del hub | Cocina |
| `SplitBillSheet` | división de cuenta completa/partes iguales/por comensal | Caja |

## Prototipo y validación de la meta "comanda ≤ 3 toques"

`app/src/ui/screens/MeseroScreen.tsx` compone `FloorPlan` + categorías +
`ModifierPicker` sobre el menú semilla (`app/src/infra/memory/seedMenu.ts`)
implementando el Flujo 1 completo de `docs/ux/flujos-casos-uso.md`. Corre con
`cd app && npm run dev` (puerto 5190).

La meta de toques no se dejó como aspiración de diseño: `app/src/ui/flows/
comandaFlow.ts` modela el conteo de toques como función pura (misma que usa
la pantalla real) y `comandaFlow.test.ts` lo verifica automáticamente:

- Platillo sin modificadores requeridos → **2 toques**.
- Platillo con 1 grupo de modificadores requerido → **3 toques**.
- Se verifica que TODO el menú semilla tiene ≤ 1 grupo requerido por
  platillo — es una regla de diseño de menú, no solo una medición: un
  platillo con 2+ decisiones obligatorias no puede cumplir la meta y debe
  rediseñarse (mover una decisión a "extra opcional" con default razonable).

Verificado: `npm run typecheck` limpio, `npm test` (18/18 verdes, incluidos
los 4 nuevos de `comandaFlow.test.ts` y 5 de `domain/order.test.ts`),
`npm run build` sin errores, dev server responde 200 en `/`.

## Pendiente (no bloquea Fase 4)

- `MeseroScreen` usa datos semilla en memoria; se conecta a comandas reales
  en Fase 6 sobre las migraciones de Fase 4.
- Pantallas de Cocina (KDS) y Caja completas (que ya tienen sus primitivas
  `OrderTicket`/`NumPad`/`TipSelector`/`SplitBillSheet` listas) se ensamblan
  en Fase 6 junto con el resto de módulos del MVP.
- Validación de la meta de 3 toques con un mesero real (no solo el modelo) es
  parte del criterio de éxito del MVP (PLAN.md §9), no de este spike de
  diseño.
