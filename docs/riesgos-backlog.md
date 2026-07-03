# Matriz de riesgos completa y backlog priorizado — RestaurantOS AI

## Matriz de riesgos

Extiende PLAN.md §8 con probabilidad/impacto/estado tras los spikes de Fase 2.

| Riesgo | Prob. | Impacto | Estado tras Fase 2 | Mitigación |
|---|---|---|---|---|
| Hub cae en pleno servicio | Media | Crítico | Sin validar (requiere Fase 5+piloto real) | UPS + backup continuo + restore < 15 min + impresora de cocina como respaldo del KDS |
| Dos meseros, misma mesa | Baja (mitigado por diseño) | Alto | **Resuelto por diseño**, spike 1 valida el protocolo base | Escritor único en hub + eventos WS + locking implícito por comanda |
| Inferencia CPU lenta | Baja | Medio | **Medido**, dentro de lo esperado (spike 4) | IA solo async; tiers 3B/7B confirmados; sistema completo sin IA |
| Impresoras térmicas (compatibilidad de firmware) | Media | Alto | Software validado, ⛔ hardware real pendiente (spike 2) | Diseño de ticket desacoplado del encoder; ajuste de compatibilidad es barato una vez haya impresora |
| CFDI complejidad regulatoria | Media | Alto | Contrato de cliente listo, ⛔ cuenta sandbox pendiente (spike 3) | Interfaz `PacClient` abstrae proveedor; modelo de datos listo desde Fase 4 |
| LAN inestable / tablets baratas | Media | Medio | Protocolo de reconexión+replay validado (spike 1) | Cola local idempotente + reconexión WS + guía de router dedicado |
| Update skew hub↔PWA | Baja | Medio | Diseñado (spike 1: `minClientVersion` en `hello`) | Versionado de contrato + auto-recarga |
| Scope creep | Alta (es el riesgo más probable de todos) | Alto | Activo — mitigar en cada fase | Disciplina de fases; no empezar Fase N+1 sin cerrar criterio de éxito de Fase N |
| No hay restaurante piloto identificado | Alta | Alto (bloquea el criterio de éxito del MVP) | ⛔ Sin resolver | Es decisión del dueño, no técnica — el desarrollo puede avanzar con seed demo mientras tanto |
| No hay hub físico dedicado decidido (PC de caja vs mini-PC) | Media | Bajo (no bloquea desarrollo) | ⛔ Supuesto default: misma PC de caja | Confirmar con el dueño antes de Fase 5 (empaquetado/instalador) |

## Backlog priorizado (trabajo técnico, de arriba hacia abajo)

> Formato heredado de `~/pos-inteligente/HANDOFF.md` §6: cada ítem = tarea +
> criterio de aceptación. Se ejecuta en el roadmap de PLAN.md §9; este backlog
> es la vista "lista de tareas" de esas mismas fases.

### Fase 4 (base de datos)
1. Migraciones de menú/modificadores/recetas sobre el patrón de las 11
   existentes de pos-inteligente. Aceptación: seed de un menú mexicano
   completo con modificadores y recetas, validado con `node:sqlite`.
2. Migraciones de mesas/comandas/tiempos. Aceptación: simular un servicio
   completo (abrir mesa→comanda→bump→cobro) por script, sin UI.
3. Migraciones de turnos/propinas. Aceptación: cerrar un turno con reparto
   configurable y verificar que el total repartido = propinas capturadas.
4. Migraciones CFDI (modelo de datos, sin PAC real). Aceptación: generar el
   JSON/XML de un CFDI de prueba localmente, estructuralmente válido.

### Fase 5 (infraestructura)
1. Puerto del hub de Node→Rust/axum (spike 1 ya validó el protocolo).
   Aceptación: `test.mjs` del spike 1 pasa contra el hub Rust real.
2. Persistencia del protocolo LAN en SQLite (outbox real, no in-memory).
3. Pairing por QR/PIN + servido de PWA versionada.
4. Empaquetado Tauri + instalador. Aceptación: instalación limpia en PC
   virgen < 30 min (criterio de PLAN.md §9).

### Fase 6 (MVP) — ver PLAN.md §7 para el alcance completo de módulos

## Nota sobre priorización

El orden de este backlog asume que Fase 4 (datos) es prerequisito duro de
Fase 5 (infra) y Fase 6 (MVP) — no se puede construir un hub server que
persiste comandas sin las tablas de comandas. Este documento no repite el
roadmap completo de PLAN.md §9; lo referencia.
