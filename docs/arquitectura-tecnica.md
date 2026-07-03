# Arquitectura técnica — RestaurantOS AI

> Documento formal de Fase 2. Complementa a `PLAN.md` (que es el handoff vivo
> con decisiones y bitácora) — aquí se detalla el CÓMO. Reutiliza sin
> re-litigar la arquitectura de `~/pos-inteligente/docs/arquitectura-tecnica.md`
> donde aplica; este documento se enfoca en lo que cambia por ser
> multi-terminal y restaurantero.

## 1. Arquitectura general

Ver diagrama completo en PLAN.md §4. Resumen de capas por proceso:

```
HUB (Tauri, proceso único)
├─ core/         TS por capas: domain (puro) ← app (casos de uso) ← infra
├─ src-tauri/    Rust: SQLite (SQLCipher), servidor axum (HTTP+WS), Ollama IPC,
│                impresión ESC/POS (USB/Serial/TCP), comandos Tauri para la UI local
└─ pwa/          build estático servido por axum: mesero, KDS, caja-secundaria

TERMINALES (navegador, sin instalación)
└─ misma pwa/, distinta ruta de entrada según rol (?role=mesero|kds|caja)
```

**Un solo escritor de estado (el hub)**: toda mutación de negocio (nueva
comanda, bump de platillo, cobro) es un comando que el hub procesa en orden
de llegada y persiste en TX atómica antes de confirmar. Las terminales nunca
escriben directo a SQLite — siempre vía el protocolo de comandos del hub
(spike 1). Esto es lo que hace innecesario un CRDT intra-restaurante: no hay
dos escritores que puedan divergir.

## 2. Arquitectura de software (capas TS reutilizadas de pos-inteligente)

Mismo patrón `domain ← app ← infra`, `ui → app`:

- **`domain/`** (puro, sin I/O): además de lo heredado (`money`, `ids`,
  `catalog`), nuevo dominio restaurantero — ver `docs/modelo-dominio.md`.
- **`app/ports.ts`**: nuevos puertos — `TableRepository`, `OrderRepository`,
  `RecipeRepository`, `ShiftRepository`, `HubEventBus` (publica/suscribe a
  los eventos del protocolo del spike 1).
- **`infra/`**: implementación SQLite real (patrón de
  `pos-inteligente/app/src/infra/sqlite/`) + el servidor del hub (Fase 5) +
  clientes PAC (`spikes/cfdi/client.mjs`, promovido a `infra/cfdi/` en Fase 7).
- **`ui/`**: tres superficies (mesero/cocina/caja) sobre el mismo Design
  System — ver `docs/ux/flujos-casos-uso.md`.

## 3. Arquitectura de datos

Ver `docs/db/` (Fase 4) para las migraciones concretas. Principios heredados
y no negociables (PLAN.md §12): SQLite WAL+STRICT, dinero en centavos, UUID
v7, stock por movimientos append-only, ventas inmutables con hash chain.

Nuevo en este dominio: **comandas con ciclo de vida largo** (una comanda
puede vivir minutos u horas, con ítems que se agregan por tiempos — entrada,
fuerte, postre), a diferencia de una venta de mostrador que es atómica. Esto
implica que "comanda" y "venta/cobro" son conceptos separados: la comanda
maneja el servicio, la venta (heredada de pos-inteligente) se genera al
cerrar/cobrar la cuenta, referenciando las comandas del turno de mesa.

## 4. Arquitectura de sync (multi-terminal LAN + hub↔nube)

Dos protocolos distintos, cada uno resuelve un problema distinto — no
confundirlos:

1. **LAN (hub↔terminales), NUEVO, validado en spike 1**: comando idempotente
   por UUID → ack → evento con `serverTime` autoritativo → broadcast filtrado
   por rol. Sin conflictos porque hay un solo escritor. Ver
   `docs/spikes/spike-1-multiterminal.md` para el protocolo completo.
2. **Hub↔nube (multi-sucursal, respaldo), HEREDADO de pos-inteligente, se usa
   TAL CUAL**: HLC + outbox transaccional + eventos inmutables + LWW por
   campo + CRDT por suma de deltas (`~/pos-inteligente/docs/sync/protocolo.md`,
   validado por simulación de 2000 órdenes). Se activa en Fase 8
   (multi-sucursal) y opcionalmente antes para respaldo simple (push-only,
   sin necesidad de resolver conflictos porque un solo hub es dueño de su
   local).

**Contrato hub↔PWA versionado** (detalle no negociable de PLAN.md §4): el
mensaje `hello` del protocolo LAN (spike 1) ya lleva `minClientVersion`; la
PWA debe comparar contra su propia versión de build y forzar recarga
(`location.reload(true)`) si quedó atrás. Implementar en Fase 5 junto al
servido de la PWA.

## 5. Arquitectura de IA

Ver `docs/spikes/spike-4-ollama-bench.md` para números reales en hardware de
referencia. Reutiliza `OllamaAIClient` de pos-inteligente (chat + tools +
visión) sin cambios de contrato. Nuevo: tools de function-calling específicas
del dominio restaurantero (ventas por platillo/hora, sugerencia de compra por
receta, "86 predictivo") — mismo patrón que
`~/pos-inteligente/docs/ai/tools-conversacional.md`: el LLM invoca tools
tipadas sobre VISTAS SQL, nunca escribe SQL, el núcleo inyecta
tenant/local/permisos.

**Cola de IA con prioridad** (nuevo, no existía en pos-inteligente porque ahí
no hay multi-terminal): las peticiones al asistente conversacional entran en
una cola de baja prioridad respecto a los comandos operativos (nueva comanda,
bump, cobro) — el hub nunca deja que una consulta de IA bloquee el hilo que
procesa comandas. `keep_alive` corto para `llava`/`nomic-embed-text` (se
cargan bajo demanda), `keep_alive` largo/persistente para `qwen2.5` (siempre
listo para el chat) — confirmado necesario por los tiempos de carga en frío
medidos en el spike 4 (18 s vs 200 ms).

## 6. Arquitectura de seguridad

Heredado de pos-inteligente sin cambios de fondo: RBAC + PIN (Web Crypto),
backup cifrado AES-256-GCM, licencias que no rompen offline. Nuevo por ser
LAN multi-dispositivo:

- **Pairing por token/QR**: el hub genera un código (QR o PIN corto) que una
  tablet nueva escanea/teclea para autenticarse contra el hub; el token se
  asocia a un rol (mesero, KDS, caja) y un `deviceId` persistente.
- **Red dedicada**: TLS en LAN local sin dominio no es práctico — se
  documenta como REQUISITO DE INSTALACIÓN una red WiFi/LAN dedicada al
  restaurante (no la red de clientes), no como control técnico del software.
- **Reloj autoritativo del hub** (spike 1): además de ser correcto para UX
  (timers de cocina), es un control de integridad — un dispositivo
  comprometido no puede falsificar cuánto tiempo lleva un platillo.

## 7. Decisiones que este documento fija (no re-litigar sin ADR)

Ver PLAN.md §3 (ADR-1..6). Este documento no agrega ADRs nuevos; los spikes
de Fase 2 confirmaron los existentes (ver mini-informes en `docs/spikes/`) y
tomaron una decisión operativa nueva registrada como DECISIÓN AUTÓNOMA en
`docs/spikes/spike-1-multiterminal.md` (runtime del hub = Rust/axum embebido
en Tauri, no sidecar Node).
