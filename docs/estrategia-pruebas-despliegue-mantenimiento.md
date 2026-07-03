# Estrategia de pruebas, despliegue y mantenimiento — RestaurantOS AI

## Pruebas

Heredado sin cambios de fondo de pos-inteligente (PLAN.md §12): dominio puro
con Vitest, typecheck limpio y build OK antes de marcar algo ✅, TDD donde
aplique. Extensión para lo multi-terminal:

- **Dominio y casos de uso**: Vitest, igual que siempre — sin I/O, rápidos.
- **Protocolo LAN**: pruebas de propiedades sobre el protocolo (spike 1 ya es
  el primer ejemplo — dedup, replay, reloj autoritativo), no solo pruebas de
  "camino feliz". Cuando el hub se porte a Rust, el mismo conjunto de
  propiedades se re-verifica ahí (no se reinventa el criterio de éxito).
- **Infra SQLite**: e2e contra migraciones reales con `node:sqlite`, mismo
  patrón que pos-inteligente (14/14 tests ahí).
- **Simuladores de hardware**: para impresión (spike 2) y, si aplica, para
  lectura de báscula/otros periféricos futuros — permiten CI sin hardware
  físico; el hardware real se valida aparte, manualmente, antes de cada
  release que toque esa capa.
- **Sync hub↔nube**: reutiliza `sync-sim.mjs` de pos-inteligente (simulación
  multi-nodo) sin reescribirlo.

## Despliegue

- **Hub**: instalador Tauri (MSI/NSIS en Windows, que es la plataforma
  objetivo del hardware de restaurante típico en México). Empaquetado single-
  exe (razón de la decisión de runtime del spike 1: Rust/axum embebido, no un
  segundo proceso Node que instalar/actualizar por separado).
  Criterio de éxito de Fase 5: instalación limpia en PC virgen < 30 min.
- **Terminales**: no se instalan — abren un navegador a la IP del hub en la
  red local. El "despliegue" de una tablet nueva es el flujo de pairing
  (QR/PIN), no un instalador.
- **Actualizaciones**: el hub se actualiza como cualquier app de escritorio
  (Tauri updater). Las terminales se actualizan solas al recargar (contrato
  versionado del spike 1 — `minClientVersion`).
- **Modo degradado / recuperación**: documentar (antes de Fase 6) un runbook
  corto de "el hub no prende" con pasos concretos y tiempo objetivo < 15 min,
  apoyado en backup continuo + UPS recomendado (riesgo #1 de la matriz).

## Mantenimiento

- **PLAN.md vivo**: se actualiza en cada avance (estado por componente +
  bitácora), igual que en pos-inteligente. Es el punto de retoma para
  cualquier sesión futura, humana o de IA.
- **Backward-compat del protocolo LAN**: cualquier cambio al formato de
  comando/evento del spike 1 debe subir `minClientVersion` — no se asume que
  todas las tablets se actualizan al mismo tiempo que el hub.
- **Vida útil objetivo del sistema: ~10 años** (PLAN.md §1) — implica evitar
  dependencias de servicios cloud de terceros que puedan desaparecer para
  cualquier función CORE (venta, comanda, cocina); las dependencias externas
  (PAC, Ollama registry) deben poder cambiarse sin rediseño gracias a las
  interfaces (`PacClient`, `OllamaAIClient`).
- **Observabilidad mínima del hub**: log local de eventos (ya existe como
  `eventLog`/outbox por diseño del protocolo) sirve doble propósito: replay
  para clientes reconectados Y bitácora para diagnosticar un problema post-
  mortem sin depender de servicios externos de logging.
