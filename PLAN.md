# PLAN MAESTRO — RestaurantOS AI

> **Documento de handoff autosuficiente.** Si eres una IA (o humano) tomando este
> proyecto, este archivo es tu única fuente de arranque: contiene la visión, las
> decisiones congeladas, qué reutilizar de dónde, los riesgos, el roadmap y el
> próximo paso concreto. Fue producido en la Fase 1 (Discovery) el 2026-07-03 y
> validado por el dueño del proyecto.
>
> **Regla de mantenimiento:** este PLAN.md es un documento VIVO. Actualízalo en
> cada avance (estado por componente + bitácora al final), igual que se hace en
> `~/pos-inteligente/PLAN.md`.

---

## 1. Visión en una línea

**RestaurantOS AI**: sistema operativo para restaurantes **Local-First / AI-First /
Touch-First** — opera 100% sin Internet sobre una PC modesta, con caja + tablets de
mesero + pantalla de cocina (KDS) en red local, IA 100% local vía Ollama, y nube
solo como asistencia (respaldo, sync, licencias, multi-sucursal, CFDI, reportes
remotos). Arquitectura pensada para mantenerse 10 años.

## 2. Punto de partida: NO es un proyecto desde cero

RestaurantOS AI es la **evolución vertical** de `~/pos-inteligente` (repo GitHub
privado `Kiosa7/pos-inteligente`), un POS de mostrador para PYMES **ya terminado en
alcance MVP**: 150/150 tests, Tauri + SQLite funcionando, sync con Supabase,
licencias, backup cifrado, IA local operativa. **Antes de diseñar nada, lee:**

| Leer | Qué contiene |
|---|---|
| `~/pos-inteligente/HANDOFF.md` | Entorno, trampas conocidas, cómo correr todo |
| `~/pos-inteligente/PLAN.md` | Estado real por componente y bitácora completa |
| `~/pos-inteligente/docs/arquitectura-tecnica.md` | Arquitectura completa (687 líneas): capas, sync, IA, plugins, seguridad, riesgos |
| `~/pos-inteligente/docs/db/` | 11 migraciones SQLite validadas + convenciones + ER |
| `~/pos-inteligente/docs/sync/protocolo.md` + `sync-sim.mjs` | Protocolo de sync **validado por simulación** (2 nodos, 2000 órdenes, convergencia probada) |
| `~/pos-inteligente/docs/ai/tools-conversacional.md` | Catálogo de tools de function-calling (el LLM nunca escribe SQL) |
| `~/pos-inteligente/app/src/ui/components/ui/` | Design System (primitivas accesibles, tokens OKLCH) |
| `~/pos-inteligente/docs/rediseno-ux-plan.md` | Metodología de migración UI que funcionó |

### 2.1 Qué se reutiliza (copiar/adaptar, no re-diseñar)

- **Arquitectura por capas** `src/{domain,app,infra,ui}` con puertos (interfaces) y
  repos intercambiables (in-memory para tests/browser, SQLite real en producción).
- **Convenciones de datos:** SQLite WAL + STRICT, dinero en `INTEGER` centavos,
  PK UUID v7, stock derivado de `inventory_movements` append-only, ventas
  inmutables con cadena de hash anti-fraude.
- **Protocolo de sync** (HLC + outbox transaccional + eventos inmutables + LWW por
  campo + CRDT por suma de deltas): se usa TAL CUAL para hub↔nube y multi-sucursal.
- **Infraestructura IA:** `OllamaAIClient` (chat + tools + visión), embeddings con
  cosine similarity, OCR de facturas con llava, búsqueda semántica con fallback.
- **Módulos completos:** licencias (trial/grace/planes), backup cifrado AES-256-GCM,
  RBAC + PIN (Web Crypto), onboarding wizard, settings por secciones.
- **Design System:** Button, IconButton, Input+Field, Card+StatCard, Badge, Modal
  (foco atrapado + Esc), ConfirmDialog, Segmented, EmptyState, Spinner, Toast.
- **Shell Tauri** (scaffold `src-tauri/`, `tauri-plugin-sql`, build probado).

### 2.2 Qué es genuinamente NUEVO (el corazón de este proyecto)

1. **Multi-terminal LAN** (ver §4 — la decisión arquitectónica central).
2. **Dominio restaurantero:** mesas, comandas con ciclo de vida largo, tiempos
   (entrada/fuerte/postre), modificadores, división de cuenta, propinas, turnos,
   recetas/escandallo (el inventario se descuenta por receta, no por unidad).
3. **CFDI 4.0** (México): timbrado vía PAC con cola offline, factura global,
   complemento de pago, cancelación.

## 3. Decisiones congeladas (ADR resumido)

Validadas explícitamente por el dueño el 2026-07-03. **No re-litigar sin su OK.**

- **ADR-1 Evolución, no greenfield:** repo nuevo `~/restaurantos-ai` que copia y
  adapta módulos de pos-inteligente. No monorepo, no fork: pos-inteligente sigue
  vivo como producto de mostrador independiente.
- **ADR-2 Hardware objetivo:** PC modesta **sin GPU**, 8–16 GB RAM. La IA se
  dimensiona por tiers (3B en 8 GB, 7B-q4 en 16 GB) y TODO funciona sin IA.
- **ADR-3 Mercado inicial México:** CFDI 4.0 desde el diseño del modelo de datos
  (Fase 4), timbrado implementado en Fase 7. IVA 16%, propina no gravada.
- **ADR-4 Multi-terminal LAN desde el MVP:** caja + tablets mesero + KDS.
- **ADR-5 Topología A — Hub + clientes web delgados:** el hub (la PC de caja
  principal, salvo que el cliente monte una mini-PC aparte) corre Tauri + SQLite
  (única fuente de verdad del local) + servidor HTTP/WebSocket en LAN + Ollama.
  Las terminales son **PWA en navegador** (tablets Android baratas con Chrome;
  KDS = cualquier pantalla con navegador). Se descartó "cada terminal con su
  SQLite + sync LAN" por complejidad de conflictos en tiempo real y Tauri móvil
  inmaduro. Consecuencia clave: **una sola DB por local elimina los conflictos
  intra-restaurante** (escritor único serializa las comandas); el protocolo de
  sync se reserva para hub↔nube↔sucursales, donde ya está validado.
- **ADR-6 (heredados de pos-inteligente, ya validados):** eventos inmutables con
  hash chain; dinero en centavos; UUID v7; LLM solo consulta vía tools sobre
  vistas SQL; núcleo + plugins por vertical; licencias que no rompen offline.

## 4. Arquitectura objetivo

```
┌──────────────────── RESTAURANTE (opera sin Internet) ───────────────────┐
│  HUB (PC modesta; normalmente la misma caja principal)                  │
│  ├─ Tauri shell (UI de caja en WebView) + core TS por capas             │
│  ├─ SQLite (WAL, STRICT) — ÚNICA fuente de verdad del local             │
│  ├─ Servidor LAN: HTTP API + WebSocket (eventos en tiempo real)         │
│  ├─ Ollama (qwen2.5 3B/7B + nomic-embed + llava) — SIEMPRE async/cola   │
│  ├─ Bus de eventos interno + outbox transaccional (para sync nube)      │
│  └─ Impresión ESC/POS: cuenta (caja) + comandas (impresora de cocina)   │
│                                                                          │
│  Terminales LAN (PWA servida por el hub):                                │
│    · cajas adicionales  · tablets de mesero  · KDS de cocina             │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ sync HLC/outbox (solo cuando hay Internet)
┌──────────────▼──────────────── NUBE (asistencia) ────────────────────────┐
│  Supabase/Postgres: respaldo · licencias · multi-sucursal · reportes    │
│  remotos del dueño · monitoreo · actualizaciones                         │
│  CFDI: el hub timbra DIRECTO contra el PAC cuando hay Internet           │
│  (cola de timbrado offline; la nube NO es intermediaria obligatoria)     │
└───────────────────────────────────────────────────────────────────────────┘
```

Detalles no negociables detectados en la revisión del plan (fáciles de omitir):

- **Contrato hub↔PWA versionado.** La PWA cachea assets; tras actualizar el hub
  puede haber clientes viejos. La API lleva versión y el WS anuncia
  `min_client_version` → la PWA se auto-recarga si quedó atrás.
- **Reloj autoritativo del hub.** Los timers del KDS ("este platillo lleva 14 min")
  se calculan contra la hora del hub, nunca contra la hora local de la tablet.
- **Cola local idempotente en la PWA de mesero.** Cada acción (agregar platillo,
  enviar comanda) es un comando con UUID que se encola localmente y se reintenta
  al reconectar el WS; el hub deduplica por UUID. Sin esto, LAN inestable = comandas
  duplicadas o perdidas.
- **Auth de dispositivos LAN:** pairing por token (código QR/PIN generado en el
  hub) + rol por dispositivo. TLS en LAN local no es práctico sin dominio; se
  documenta como requisito la red WiFi/LAN dedicada al restaurante.
- **Respaldo físico de cocina:** además del KDS, soporte de impresora de comandas
  en cocina desde el MVP (si una tablet muere en pleno servicio, el papel salva).
- **Modo degradado:** si el hub cae, la caja (mismo equipo) es lo primero que se
  restaura; UPS recomendado; restauración documentada < 15 min; backup continuo.
- **Datos semilla/demo:** menú de restaurante mexicano realista (con modificadores,
  recetas e insumos) como seed para desarrollo y demos, desde la Fase 4.

## 5. IA local (CPU-only, por tiers de RAM)

| Función | Modelo | Notas |
|---|---|---|
| Asistente + function-calling | `qwen2.5:3b` (tier 8 GB) / `qwen2.5:7b` q4 (tier 16 GB) | 7b YA instalado y validado en pos-inteligente |
| Embeddings / búsqueda semántica | `nomic-embed-text` | **Falta `ollama pull nomic-embed-text`** en esta máquina |
| Visión + OCR (facturas, foto de platillo) | `llava:7b` (instalado, pipeline probado); `moondream` como tier bajo | En CPU tarda 30–60 s/imagen → SOLO flujos asíncronos |
| Clasificación / recomendaciones | Embeddings + reglas + SQL nocturno narrado por el LLM | Sin modelo dedicado |

**Reglas de oro:** (1) la IA JAMÁS está en el camino crítico de una venta o
comanda; (2) cola con prioridad y `keep_alive` corto en 8 GB; (3) el sistema es
100% funcional sin Ollama; (4) el LLM nunca escribe SQL — solo invoca tools
tipadas sobre vistas, con tenant/permisos inyectados por el núcleo.

Casos de uso restauranteros priorizados: copiloto del dueño (ventas/márgenes por
platillo), pronóstico de demanda por platillo/hora, sugerencia de compras derivada
de recetas, "86 predictivo" (avisar qué se agotará durante el servicio), análisis
de merma, OCR de facturas de proveedor (pipeline ya construido).

## 6. UX/UI

Tres personas, tres superficies, un solo Design System (extensión del de
pos-inteligente: mismos tokens OKLCH, focus-visible, targets 44 px):

- **Mesero (tablet PWA):** comanda completa en ≤ 3 toques por platillo;
  modificadores como botones grandes (nunca dropdowns); UI optimista < 100 ms
  percibidos (el WS confirma después).
- **Cocina (KDS):** legible a 2 metros; tarjetas y tipografía enormes; color por
  urgencia/tiempo; bump por toque; modo oscuro por defecto.
- **Caja/gerente (hub Tauri):** densidad alta, numpad, arqueo, división de
  cuentas, propinas, cortes.

Primitivas nuevas a diseñar: `FloorPlan` (plano de mesas con estados),
`OrderTicket` (tarjeta KDS), `ModifierPicker`, `SplitBillSheet`, `CourseTimeline`,
`NumPad`, `TipSelector`.

## 7. Módulos por fase

**MVP (Fase 6):** POS restaurantero · Mesas/plano · Comandas (modificadores +
tiempos) · KDS · Menú/recetas con descuento de inventario por escandallo · Caja y
cortes · Turnos de mesero y propinas (reparto CONFIGURABLE, no política fija) ·
Impresión ESC/POS (cuenta + comanda + apertura de cajón) · Usuarios/RBAC/PIN ·
Backup cifrado · Asistente IA v1 · Multi-terminal LAN.

**Comercial (Fase 7):** CFDI 4.0 (timbrado + factura global + complemento de
pago) · Inventario completo + compras/proveedores con OCR · Reservaciones ·
Delivery/para llevar · Promociones · Fidelización · Clientes · Reportes avanzados.

**Enterprise (Fase 8):** Multi-sucursal (protocolo ya validado) · Plugins/
marketplace · Auditoría avanzada · Franquicias · API pública · Visión avanzada.

## 8. Riesgos principales y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Hub cae en pleno servicio | Crítico | UPS + backup continuo + restore < 15 min documentado + impresora de cocina como respaldo del KDS |
| Inferencia CPU lenta | Medio | IA solo async; tiers 3B/7B; sistema completo sin IA |
| Dos meseros, misma mesa | Alto | Escritor único en hub + locking optimista por comanda + eventos WS (la topología A lo vuelve trivial) |
| CFDI complejidad regulatoria | Alto | Spike sandbox PAC temprano (evaluar Facturama y SW Sapien); modelo de datos listo desde Fase 4; timbrado diferido en cola |
| Impresoras térmicas (hardware #1 del rubro) | Alto | Spike ESC/POS con impresora real 80 mm ANTES de congelar el diseño de impresión |
| LAN inestable / tablets baratas | Medio | Cola local idempotente + reconexión WS + guía de instalación con router dedicado |
| Update skew hub↔PWA | Medio | Versionado de contrato + auto-recarga de clientes viejos |
| Scope creep | Alto | Disciplina de fases; MVP = un restaurante real opera un servicio completo |

## 9. Roadmap

| Fase | Alcance | Criterio de éxito |
|---|---|---|
| **1 Discovery** ✅ | Este documento | Dirección validada (2026-07-03) |
| **2 Arquitectura** ✅ | Docs formales (`docs/`) + **4 spikes de riesgo** | Spikes verdes (2/4 con hardware/cuenta ⛔ pendiente, ver bitácora) |
| **3 UX/UI** ✅ | Flujos mesero/cocina/caja, wireframes, extensión Design System | Comanda ≤ 3 toques validada por test automatizado |
| **4 Base de datos** ✅ | Migraciones nuevas: menú/modificadores, mesas, comandas/tiempos, recetas/insumos, turnos/propinas, tablas CFDI | Esquema validado con datos reales (node:sqlite, servicio completo simulado) |
| **5 Infraestructura** 🟡 | Hub server (HTTP+WS) ✅, pairing MVP ✅, servido de PWA ✅ — updater y empaquetado ⛔ | "Instalación limpia en PC virgen < 30 min" SIN validar (falta `tauri build`) |
| **6 MVP** 🟡 ⬅️ SIGUIENTE | Módulos §7 — arrancado: mesero↔hub↔KDS end-to-end real. Falta: caja/cortes, menú-recetas en pantalla, turnos/propinas en UI, impresión real, RBAC/PIN, backup, asistente IA v1 conectado | **Un restaurante piloto opera un servicio de viernes completo sin tocar papel** — lejos aún |
| **7 Comercial** ⬜ | CFDI, delivery, reservas, promos, compras | Primer cliente de pago facturando |
| **8 Enterprise** ⬜ | Multi-sucursal, plugins, API pública | Cadena 3+ sucursales sincronizando |

Entregables documentales de la Fase 2 (crear en `docs/`): visión de producto ·
arquitectura general/software/datos/sync/IA/seguridad · modelo de dominio · modelo
de permisos · modelo de plugins · flujos UX y casos de uso · historias de usuario ·
matriz de riesgos completa · backlog priorizado · estrategia de pruebas ·
estrategia de despliegue · estrategia de mantenimiento. Formato: el mismo que
`~/pos-inteligente/docs/` (documentos validables + este PLAN.md vivo).

## 10. PRÓXIMO PASO CONCRETO — completar Fase 6 (MVP)

Fases 1–5 completas (5 con 2 pendientes ⛔ no bloqueantes, ver bitácora
2026-07-03). Fase 6 arrancó con la porción más riesgosa ya resuelta: mesero
→ hub (Rust real) → KDS funcionando en vivo (`app/src/ui/screens/
MeseroScreen.tsx` + `CocinaScreen.tsx` + `app/src/infra/hub/hubClient.ts`),
verificado contra el binario compilado (`cargo run`), no solo contra tests.

**Lo que falta para cerrar Fase 6** (orden sugerido, cada uno independiente
salvo donde se anota dependencia):

1. ✅ **Persistir el hub en SQLite** — `app/src-tauri/src/{db,seed,commands}.rs`
   + migración `0017_hub_lan_log.sql`. `hub_events`/`hub_commands` sobreviven
   reinicios (verificado abriendo el mismo archivo dos veces en
   `persistencia_y_descuento_de_inventario_por_receta`). `nueva_comanda` y
   `bump_platillo` escriben de verdad sobre `orders`/`order_items`.
2. ✅ **Pantalla de Caja** — `app/src/ui/screens/CajaScreen.tsx`
   (`?role=caja`): lista de comandas abiertas (vía `GET /orders/open`,
   refrescada por WS rol `caja`), `SplitBillSheet`/`TipSelector`/`Segmented`
   integrados, cobra vía `POST /checkout` (genera venta con hash chain real
   + cierra la comanda, dispara el trigger de mesa→`por_limpiar`).
3. ✅ **Descuento de inventario por receta real** — `handle_bump_platillo`
   en `commands.rs`: al pasar a `en_preparacion` lee la receta y escribe
   `inventory_movements` de verdad (no un test manual).
4. 🟡 **Impresión real** — `app/src/infra/print/{escposEncoder,tickets,
   printSimulator,printClient}.ts` (puerto TS de `spikes/escpos/`) +
   `thermalPrinter.ts` copiado tal cual de pos-inteligente. Botón "Imprimir
   comanda" en `CocinaScreen` y "Imprimir cuenta" en `CajaScreen`, con
   `printClient.ts` intentando reconectar/pedir la impresora vía WebUSB.
   ⛔ Sigue sin validar con impresora física 80mm real (spike 2) — el botón
   fallará con mensaje legible ("Impresora no conectada...") hasta que exista
   el hardware.
5. ✅ **Turnos y propinas en UI** — botones abrir/cerrar turno en
   `CajaScreen.tsx` vía `POST /shifts/open|close`; propina capturada en el
   cobro se reparte al cerrar turno (modo `individual`, `close_shift` en
   `commands.rs`).
6. ✅ **RBAC/PIN** — adaptado (no copiado literal) de pos-inteligente: el hash
   SHA-256 del PIN se reutiliza (`hash_pin` en `seed.rs`, mismo esquema que
   `app/src/app/usecases/pin.ts`), pero la VERIFICACIÓN se movió al hub
   (`POST /auth/pin` en `commands.rs`/`hub.rs`) en vez del cliente — decisión
   correcta para multi-terminal: cualquier tablet debe poder identificar a
   cualquier empleado, no solo "el dispositivo del dueño" (patrón de
   pos-inteligente, un solo dispositivo). `PinGate.tsx` (nuevo, reutiliza
   `NumPad`) bloquea cada ruta hasta un PIN con el permiso requerido
   (`docs/permisos-plugins.md`): `order.create` en mesero, `kitchen.bump` en
   KDS, `cash.checkout` en Caja. PINs demo: 1111/2222/3333 (mesero/cocina/
   cajero) — NO son un mecanismo de seguridad real para producción.
   Pendiente: `CajaScreen` sigue hardcodeando `EMPLOYEE_MESERO` para el turno
   (usar el empleado autenticado real es un refinamiento de Fase 7).
7. **Backup cifrado**: copiar el módulo de pos-inteligente tal cual (ADR-1).
8. **Asistente IA v1**: conectar `OllamaAIClient` de pos-inteligente contra
   las vistas nuevas de 0016 (`v_dish_sales_margin`, `v_tips_by_shift`, etc.)
   con las tools que faltan por catalogar en un
   `docs/ai/tools-conversacional-restaurante.md` (no existe aún).
9. **Pairing real de dispositivos** (hoy `/pair` es un placeholder, ver
   spike-5): QR/PIN generado en el hub, `deviceId` persistente, rol
   asociado.

**Criterio de éxito de Fase 6 no depende solo de código**: necesita el
restaurante piloto (⛔ §11.4) para el "sin tocar papel" real; mientras tanto,
validar cada módulo con el seed demo (`seedRestaurant.ts`) es suficiente para
marcarlo ✅ técnicamente.

## 11. Supuestos pendientes de confirmar con el dueño

Defaults razonables ya asumidos; confirmar en cuanto haya oportunidad:

1. Hub = la misma PC de caja principal (default). ¿O mini-PC separada?
2. PAC: sin relación previa conocida → evaluar Facturama y SW Sapien en el spike.
3. Impresora térmica 80 mm para el spike 2: **pendiente conseguir**.
4. Restaurante piloto para el criterio de éxito del MVP: **pendiente identificar**.

## 12. Entorno y convenciones de trabajo

- **Máquina:** Windows 11, PowerShell/Git Bash. Node v24 (`node:sqlite` disponible),
  npm 11, pnpm 10, Rust 1.96 + VS2022 + Win10 SDK (Tauri compila, ~4 min).
- **Ollama instalado** con `qwen2.5:7b` y `llava:7b`; hacer `ollama pull
  nomic-embed-text` para embeddings. `gpt-oss:20b` NO sirve (falla por MXFP4).
- **Puertos ocupados en esta máquina:** 3000 (otra app) y 5180 (pos-inteligente).
  Usar **5190** para el dev server de RestaurantOS.
- **Git:** config NO global; commitear con
  `git -c user.name=Kiosa7 -c user.email=isc.christiandavid@gmail.com commit ...`.
- **Calidad (heredada de pos-inteligente, obligatoria):** dominio puro con tests
  Vitest; typecheck limpio y build OK antes de marcar algo ✅; TDD donde aplique;
  toda venta/comanda persiste en TX atómica con outbox + hash chain.
- **Idioma:** código y docs en español donde ya es convención (UI 100% español).
- **Bitácora:** registrar cada avance al final de este archivo con fecha.

## 13. Estado por componente

- ✅ Fase 1 Discovery — este documento (2026-07-03).
- ✅ Fase 2 Arquitectura — spikes 1–4 + docs/ formales completos (2026-07-03).
  Spike 1 (multi-terminal) y 4 (benchmark Ollama) 100% verdes. Spikes 2
  (ESC/POS) y 3 (CFDI) verdes en software/contrato, ⛔ bloqueados en hardware
  real / cuenta sandbox (ver docs/spikes/).
- ✅ Fase 3 UX/UI — `app/` scaffolded, Design System extendido con 7
  primitivas restauranteras, prototipo MeseroScreen funcional, meta "≤3
  toques" validada por test automatizado (2026-07-03).
- ✅ Fase 4 Base de datos — 11 migraciones base copiadas de pos-inteligente +
  5 nuevas (mesas/comandas, recetas, turnos/propinas, CFDI, triggers/vistas),
  validadas con `node:sqlite` real simulando un servicio completo (2026-07-03).
- 🟡 Fase 5 Infraestructura — hub Rust/axum embebido en Tauri COMPLETO y
  validado (protocolo + PWA estática, 2/2 tests). Pairing MVP. ⛔ empaquetado
  real (MSI/NSIS), updater y resource bundling de la PWA en producción
  pendientes (2026-07-03) — ver docs/spikes/spike-5-hub-rust.md.
- 🟡 Fase 6 MVP — 6/9 puntos de §10 completos: (1) hub persistido en SQLite,
  (2) Caja funcional (ver/dividir/cobrar), (3) descuento de inventario por
  receta como caso de uso real, (4) impresión ESC/POS en software (⛔ falta
  hardware), (5) turnos/propinas en UI, (6) RBAC/PIN (verificado en el hub,
  no en el cliente). Mesero↔hub↔KDS↔Caja funcionando de punta a punta contra
  el binario real (comanda→bump→cobro→turno cerrado con propina repartida,
  verificado con scripts WS+HTTP en vivo, no solo tests).
  Falta: (7) backup cifrado, (8) asistente IA v1, (9) pairing
  real (2026-07-04).
- ⬜ Fases 7–8 — sin empezar, ver §9.

## Bitácora

- 2026-07-03: Fase 1 Discovery completada y validada. Decisiones ADR-1..6
  congeladas. Repo creado con este plan maestro como handoff.
- 2026-07-03: Fase 2 completada en modo autónomo total.
  - **Spike 1 (multi-terminal)** ✅: hub HTTP+WS prototipo en Node
    (`spikes/multiterminal/`), protocolo comando→ack→evento con dedup por
    UUID, replay tras reconexión y reloj autoritativo del hub — las 4
    propiedades de riesgo validadas con test automatizado.
    DECISIÓN AUTÓNOMA: el runtime de producción del hub será Rust/axum
    embebido en el proceso Tauri (no un sidecar Node), por simplicidad de
    empaquetado en 1 solo exe; el prototipo Node queda como referencia
    ejecutable del protocolo, portable a la implementación Rust de Fase 5.
  - **Spike 2 (ESC/POS)** 🟡: encoder ESC/POS + plantillas de comanda/cuenta +
    simulador de impresora (`spikes/escpos/`), todas las propiedades de
    software validadas por test (corte, apertura de cajón solo en efectivo,
    formato). ⛔ BLOQUEADO: no hay impresora térmica 80mm física en esta
    máquina para validar compatibilidad de firmware real (ancho de columna,
    soporte de corte parcial, tabla de caracteres) — sigue pendiente
    conseguirla (PLAN.md §11.3).
  - **Spike 3 (CFDI)** 🟡: investigación de Facturama vs SW Sapien (auth,
    endpoints, precios) + clientes `PacClient` con contrato validado por
    mocks (`spikes/cfdi/`). DECISIÓN AUTÓNOMA: SW Sapien como PAC primario
    (sandbox "igual a producción", payload más apegado al CFDI oficial),
    Facturama como fallback documentado — la interfaz `PacClient` hace este
    cambio barato si hiciera falta. ⛔ BLOQUEADO: no hay cuenta/credenciales
    sandbox reales de ningún PAC (crear cuenta es gratuito pero requiere
    acción del dueño); no se pudo timbrar un CFDI de prueba real.
  - **Spike 4 (benchmark Ollama)** ✅: medido en esta PC (Ryzen 5 8645HS,
    24GB RAM, CPU-only) — `qwen2.5:3b` 50.4 tok/s, `qwen2.5:7b` 22.1 tok/s,
    `llava:7b` ~51s pared a pared por imagen (18s carga fría + inferencia).
    Se pulieron `qwen2.5:3b` y `nomic-embed-text` (faltaban, PLAN.md §12 lo
    marcaba pendiente). Tiers del ADR-2 confirmados sin cambios; nota: esta
    PC es más potente que el piso del ADR-2, falta medir en hardware de 8GB
    real (⛔ no disponible).
  - **Docs formales** ✅: `docs/vision-producto.md`,
    `docs/arquitectura-tecnica.md` (general/software/datos/sync/IA/
    seguridad), `docs/modelo-dominio.md`, `docs/permisos-plugins.md`,
    `docs/ux/flujos-casos-uso.md`, `docs/riesgos-backlog.md`,
    `docs/estrategia-pruebas-despliegue-mantenimiento.md`.
  - ⛔ Pendientes que solo el dueño puede resolver (no bloquean el avance a
    Fase 3): impresora térmica 80mm real, cuenta sandbox de un PAC (SW Sapien
    recomendado), restaurante piloto, confirmar hub = PC de caja vs mini-PC.
- 2026-07-03: Fase 3 completada en modo autónomo total.
  - **Scaffold de `app/`**: copiado y adaptado de `pos-inteligente/app`
    (vite+react+ts+tailwind v4, puerto 5190, alias `@domain/@app/@infra/@ui`,
    Design System `ui/components/ui/` heredado tal cual, dominio puro
    `money.ts`/`ids.ts` heredado). `package.json` deliberadamente SIN
    `@testing-library`/`jsdom` — se siguió el patrón real de pos-inteligente
    de probar componentes con `renderToString` (SSR), no el que la memoria
    vieja de la sesión anterior sugería.
  - **Dominio nuevo**: `domain/menu.ts` (MenuItem/ModifierGroup/Categoria) y
    `domain/order.ts` (DraftOrder/OrderItem, `addItemToOrder` puro e
    inmutable, cálculo de totales) — base conceptual que Fase 4 traduce a
    migraciones SQLite reales.
  - **7 primitivas nuevas** en `ui/components/restaurant/`: `FloorPlan`,
    `ModifierPicker`, `NumPad`, `TipSelector`, `CourseTimeline`,
    `OrderTicket`, `SplitBillSheet` — ver `docs/ux/design-system-extension.md`.
  - **Prototipo `MeseroScreen`** implementando el Flujo 1 completo (mesa →
    categoría → platillo → modificadores → comanda). Meta "comanda ≤ 3
    toques" validada por `ui/flows/comandaFlow.ts` + test automatizado (no
    solo medida a ojo): 2 toques sin modificadores requeridos, 3 con uno;
    regla de diseño registrada de que un platillo con 2+ grupos requeridos no
    puede cumplir la meta.
  - **Verificado**: `npm run typecheck` limpio, `npm test` 18/18 verdes,
    `npm run build` sin errores, dev server (puerto 5190) responde 200.
    Verificación visual en navegador real NO se hizo en esta sesión (sin
    herramienta de captura de pantalla disponible) — recomendado que el
    dueño abra `http://localhost:5190` tras `npm run dev` para confirmar
    visualmente antes de considerar el prototipo cerrado del todo.
  - Docs nuevos: `docs/ux/design-system-extension.md`.
- 2026-07-03: Fase 4 completada en modo autónomo total.
  - **11 migraciones base copiadas TAL CUAL** de
    `~/pos-inteligente/docs/db/migrations/` (0001–0011: tenants/locations,
    catálogo/impuestos, inventario, ventas, caja, promociones, vectores/FTS,
    triggers, vistas) — sin re-litigar, per ADR-1. `migrate.ts`/`db.ts`
    copiados sin cambios (ya eran genéricos, sin nada específico de POS).
  - **5 migraciones nuevas**: `0012_mesas_comandas` (tables, orders,
    order_items append-only event log, modificadores), `0013_recetas`
    (recipes/recipe_items/modifier_recipe_deltas — el inventario se descuenta
    por receta, no por unidad vendida), `0014_turnos_propinas` (shifts, tips,
    reparto CONFIGURABLE vía `tip_pool_configs`), `0015_cfdi` (modelo CFDI 4.0
    completo: issuers/documents/conceptos/complemento de pago, independiente
    del PAC), `0016_triggers_vistas_restaurante` (2 triggers mecánicos
    mesa↔comanda + 6 vistas: `v_tables_status`, `v_kitchen_queue`,
    `v_dish_prep_time`, `v_dish_sales_margin`, `v_tips_by_shift`,
    `v_table_turnover`).
  - DECISIÓN AUTÓNOMA: un platillo del menú y un insumo son AMBOS filas de
    `products` (0003) — no se creó un catálogo paralelo. Solo se agregó lo
    genuinamente nuevo (mesas/comandas/recetas/turnos/CFDI), reutilizando
    FTS5/inventario/ventas sin tocarlos.
  - DECISIÓN AUTÓNOMA: el descuento de inventario por receta NO es un
    trigger SQL — es lógica de dominio (TX explícita), mismo criterio de
    diseño que 0010 ya documentaba para pos-inteligente (triggers solo para
    transformaciones puramente mecánicas).
  - **Validado con datos reales** (`node:sqlite`, no mockeado):
    `seedRestaurant.ts` siembra un menú con receta (tacos al pastor: 3
    tortillas + 0.15kg carne + 0.02kg cebolla) y modificador requerido
    (salsa). `restaurantSchema.test.ts` simula un servicio completo: abrir
    mesa (trigger→ocupada) → comanda → bump a en_preparacion (inventario
    descontado, verificado) → bump a listo 4 min después (verificado en
    `v_dish_prep_time`) → cerrar comanda (trigger→por_limpiar) → venta+pago →
    turno+propina (`v_tips_by_shift`) → margen del platillo
    (`v_dish_sales_margin`, verificado: precio $90 − costo receta $16.74 =
    margen $73.26). **20/20 tests verdes**, typecheck y build limpios.
  - Docs nuevos: `docs/db/schema-overview-restaurante.md`.
  - Pendiente para Fase 6 (no bloquea Fase 5): envolver el descuento de
    inventario por receta en un caso de uso real con outbox
    (`sendItemToKitchen`, mismo patrón que `checkoutSale`); ejercitar
    `modifier_recipe_deltas` con un caso real ("sin cebolla").
- 2026-07-03: Fase 5 (parcial) completada en modo autónomo total.
  - **`app/src-tauri/` scaffolded** copiando el shell Tauri de pos-inteligente
    (ya compilaba ahí, Rust 1.96 confirmado instalado) y adaptando
    identifier/productName/puerto a RestaurantOS AI (5190).
  - **Hub portado a Rust/axum** (`src/hub.rs`), cumpliendo lo que el spike 1
    prometía: el mismo protocolo (hello/cmd/ack/event, dedup UUID, replay,
    reloj autoritativo) reimplementado y RE-VALIDADO en Rust con un test que
    replica exactamente `spikes/multiterminal/test.mjs`
    (`src-tauri/tests/hub_test.rs`, `cargo test`, 2/2 verdes).
  - **2 bugs reales encontrados y corregidos durante el port** (documentados
    en `docs/spikes/spike-5-hub-rust.md`): (1) serde serializaba a
    snake_case en vez de camelCase — rompía el contrato con clientes TS;
    (2) el filtro de difusión en vivo y el de replay se habían colapsado en
    una sola función cuando el protocolo original (spike 1) usa dos reglas
    distintas (`live_routes_to_role` solo kds/caja, `replay_routes_to_role`
    más permisivo). Se separaron para reproducir la asimetría exacta ya
    validada, no una aproximación.
  - **PWA estática servida por el hub**: probado contra el build real de
    `app/dist` (GET `/` devuelve el index.html real).
  - **`/pair` MVP**: entrega un token de dispositivo; política real de
    autenticación queda para Fase 6 (ver spike-5).
  - DECISIÓN AUTÓNOMA: no se intentó `npm run tauri build` (empaquetado
    MSI/NSIS) ni configuración de auto-updater en esta sesión — son pasos de
    alto riesgo/tiempo (toolchain de bundling no confirmado, llaves de firma
    inexistentes) que no bloquean seguir construyendo el MVP de Fase 6 sobre
    `cargo build`/`npm run dev`. Quedan ⛔ documentados en spike-5 como
    criterio de éxito de Fase 5 aún sin cerrar ("instalación limpia en PC
    virgen < 30 min").
  - Docs nuevos: `docs/spikes/spike-5-hub-rust.md`.
- 2026-07-03: Fase 6 arrancada (modo autónomo total) y CIERRE DE SESIÓN.
  - **`app/src/infra/hub/hubClient.ts`**: cliente TS del protocolo del hub
    para el navegador — cola idempotente por UUID, reconexión con backoff
    fijo (1s) y replay automático vía `since_index`.
  - **`MeseroScreen`** ahora manda un comando `nueva_comanda` real al hub al
    tocar "Enviar a cocina" (antes solo mutaba estado local). **`CocinaScreen`**
    (KDS) es nueva: se conecta como rol `kds`, renderiza con `OrderTicket` lo
    que llega en vivo. `App.tsx` rutea por `?role=kds|mesero`.
  - **Verificado de punta a punta contra el binario REAL, no solo tests**:
    `cargo run` levantó el hub en el puerto 5190 (tras liberar un proceso
    `vite` zombie que quedó de una sesión anterior de este mismo trabajo —
    ver nota abajo), `curl /health` respondió, `curl /` sirvió la PWA real,
    y un cliente `ws` de Node conectado como mesero+kds contra ESE proceso
    (no un test aislado) confirmó hello→cmd→ack→evento tal cual el diseño.
    Proceso detenido limpiamente al terminar.
  - **Nota operativa para la siguiente sesión**: si `curl localhost:5190`
    responde con la PWA de Vite en vez del hub Rust (o viceversa), revisar
    `netstat -ano | grep 5190` — pueden quedar procesos `node`/`app.exe`
    huérfanos de sesiones de desarrollo anteriores ocupando el puerto en
    IPv4 vs IPv6 por separado; no asumir que "responde" = "es el proceso que
    yo arranqué".
  - typecheck limpio, **20/20 tests** (sin cambios de conteo: la integración
    con hubClient no se cubrió con test unitario propio porque requiere
    `WebSocket` de navegador — la corrección del protocolo ya está probada
    por partida doble en `spikes/multiterminal/test.mjs` y
    `src-tauri/tests/hub_test.rs`; lo nuevo aquí es el cableado, verificado
    manualmente end-to-end como se describe arriba), build limpio.
  - **Todo lo que falta de Fase 6 en adelante queda desglosado en §10** —
    persistencia del hub en SQLite es el siguiente paso de mayor apalancamiento
    (desbloquea Caja). Fases 7 y 8 no se empezaron: son build-out de módulos
    de negocio (CFDI real, delivery, reservas, multi-sucursal, plugins) sobre
    una base arquitectónica ya validada en Fases 2–5, no decisiones de diseño
    pendientes.
  - ⛔ Bloqueos que solo el dueño puede resolver, sin cambio desde Fase 2:
    impresora térmica 80mm física, cuenta sandbox de un PAC (SW Sapien
    recomendado), restaurante piloto, confirmar hub = PC de caja vs mini-PC,
    y ahora también: confirmar si vale la pena invertir tiempo en
    `tauri build` (WiX/NSIS) antes de tener más módulos de negocio listos,
    o si conviene seguir iterando en `cargo build`/`npm run dev` un poco más.
- 2026-07-04: Fase 6, puntos 1/2/3/5 de §10 completados (modo autónomo total).
  - **Punto 1 — Hub persistido en SQLite**: `app/src-tauri/src/db.rs`
    (migration runner IDEMPOTENTE — ver bug encontrado abajo),
    `app/src-tauri/src/seed.rs` (mismos ids que el prototipo de Fase 3:
    `mi_tacos_pastor`, `table-1`..`table-5`, etc. — el frontend YA NO tiene
    un seed local propio, ahora consume `GET /menu`/`GET /tables` del hub) y
    `app/src-tauri/src/commands.rs` (lógica de dominio). Nueva migración
    `0017_hub_lan_log.sql` (`hub_events`/`hub_commands`) reemplaza el
    `Vec`/`HashSet` en memoria del prototipo de Fase 5 — sobrevive reinicios,
    verificado abriendo el MISMO archivo `.db` dos veces en el test
    `persistencia_y_descuento_de_inventario_por_receta`.
  - **Punto 3 — Descuento de inventario por receta real**: `handle_bump_platillo`
    en `commands.rs` lee la receta del producto y escribe
    `inventory_movements` de verdad al pasar a `en_preparacion` (el trigger
    0010 ya existente materializa `inventory.qty`) — ya no es un test manual,
    es el flujo real que dispara el hub.
  - **Punto 2 — Pantalla de Caja**: `app/src/ui/screens/CajaScreen.tsx`
    (ruta `?role=caja`). Lista de comandas abiertas vía `GET /orders/open`
    (refrescada al vuelo por eventos WS rol `caja`), selecciona una,
    `Segmented` para método de pago, `TipSelector`, `SplitBillSheet` →
    `POST /checkout` genera venta(s) con secuencia + cadena de hash real
    (`sha2`) y cierra la comanda (dispara el trigger mesa→`por_limpiar`).
    División de cuenta por partes genera ventas sintéticas "N de M" sin
    desglose por ítem — simplificación de MVP documentada en `commands.rs`.
  - **Punto 5 — Turnos y propinas en UI**: botones abrir/cerrar turno en
    `CajaScreen`, `POST /shifts/open|close`; la propina capturada en el cobro
    se liga al turno y se reparte al cerrarlo (`tip_pool_configs` modo
    `individual`, ya seedeado). Modos `pool_turno`/`pool_ventas` caen a
    individual con log de advertencia — DECISIÓN AUTÓNOMA (no hay más de un
    turno simultáneo en el seed demo para probar reparto grupal real).
  - **2 bugs reales encontrados y corregidos** (no cosméticos, rompían el
    flujo):
    1. Columna `notas` vs `notes`: el SQL de `commands.rs` usaba `notas`
       (español) pero la migración 0012 define la columna como `notes`
       (inglés, convención del esquema heredado) — todo INSERT/SELECT sobre
       `order_items` fallaba. Corregido a `notes` en el SQL (los nombres
       Rust/JSON siguen en español, solo las columnas SQL en inglés).
    2. **Migraciones NO eran idempotentes entre reinicios**: `migrate.ts`
       (Node) siempre corre contra una BD nueva y nunca necesitó chequear
       `schema_migrations`; el hub Rust SÍ reabre el mismo archivo entre
       arranques, y re-ejecutar `INSERT INTO schema_migrations` sin
       protección rompía con `UNIQUE constraint failed`. `db.rs` ahora lee
       las versiones ya aplicadas y salta esos archivos — este bug solo
       podía aparecer aquí porque Fase 6 es la primera vez que algo en el
       proyecto reabre un `.db` persistido entre "reinicios" reales.
    3. (menor) `tips.method`/`payments.method` usan claves en inglés
       (`cash`/`card`, CHECK constraint en 0014) pero la API habla español
       (`efectivo`/`tarjeta`, igual que el ticket ESC/POS del spike 2) —
       se agregó `normalize_payment_method` en la frontera.
  - **Verificado de punta a punta contra el binario REAL** (no solo
    `cargo test`): `cargo run` con `RESTAURANTOS_PWA_DIR=../dist`, scripts
    Node con `ws`+`fetch` reales simulando mesero/KDS/Caja: comanda creada →
    KDS la recibe → bump a `en_preparacion` (inventario descontado,
    confirmado por `cargo test`) → `GET /orders/open` la muestra → `POST
    /checkout` genera venta y cierra la mesa (`por_limpiar` confirmado en
    `GET /tables`) → turno abierto/cerrado con propina de $30 repartida
    (`GET /tips/summary` lo confirma). Hub detenido limpiamente al terminar.
  - **Verificado con tests**: `cargo test` 4/4 (protocolo, PWA estática,
    persistencia+receta, turno+propina), `npm test` 20/20 (se corrigió una
    aserción vieja que esperaba 16 migraciones, ahora 17), typecheck y
    build limpios en ambos lenguajes.
  - Docs actualizados: `docs/db/schema-overview-restaurante.md` (0017 +
    sección "Actualización Fase 6").
  - Próximo: puntos 4 (impresión), 6 (RBAC/PIN), 7 (backup), 8 (IA), 9
    (pairing real) de §10, en ese orden, luego Fases 7–8.
- 2026-07-04: Fase 6 punto 4 (impresión ESC/POS) completado en software.
  - Puerto TS 1:1 de `spikes/escpos/{encoder,tickets,simulator}.mjs` a
    `app/src/infra/print/{escposEncoder,tickets,printSimulator}.ts`, ahora
    sobre tipos/datos reales (`OpenOrder`, `CheckoutResponse`) en vez del
    prototipo. `thermalPrinter.ts` (transporte WebUSB/Serial) copiado tal
    cual de pos-inteligente, ADR-1. `printClient.ts` nuevo: intenta
    reconectar a una impresora ya autorizada, si no pide una nueva — SIEMPRE
    disparado desde un click (WebUSB exige gesto del usuario).
  - Botones reales: "Imprimir comanda" en `CocinaScreen` (respaldo físico de
    cocina, PLAN.md §4), "Imprimir cuenta" en `CajaScreen` tras un cobro
    exitoso. Ambos con manejo de error legible vía `useToast` — sin
    impresora conectada, el sistema sigue funcionando (falla ese botón, no
    la pantalla).
  - 3 tests nuevos (`tickets.test.ts`) replican las mismas propiedades del
    spike 2: comanda nunca abre cajón, cuenta en efectivo sí lo abre, cuenta
    con tarjeta no. 23/23 tests totales, typecheck y build limpios.
  - ⛔ Sigue sin validar con impresora térmica 80mm real — sin cambio desde
    Fase 2 (spike 2), sigue pendiente que el dueño consiga el hardware.
- 2026-07-04: Fase 6 punto 6 (RBAC/PIN) completado en modo autónomo total.
  - DECISIÓN AUTÓNOMA: NO se copió `AuthContext.tsx`/`PinModal.tsx` de
    pos-inteligente literal — ese patrón asume UN dispositivo con UN PIN de
    dueño (verificado en el cliente contra `localStorage`). En un sistema
    multi-terminal cualquier tablet debe poder identificar a CUALQUIER
    empleado, así que la verificación se movió al hub: `POST /auth/pin`
    (`commands.rs::pin_login`) busca entre todos los `employees` el que
    coincide con el hash. Lo que SÍ se reutilizó tal cual: el esquema de hash
    SHA-256 (`sha256("...:pin:" + pin)`, mismo principio que
    `app/src/app/usecases/pin.ts`).
  - `PinGate.tsx` (nuevo componente, reutiliza `NumPad` del Design System):
    bloquea una pantalla completa hasta un PIN válido CON el permiso
    requerido; expone el empleado autenticado a sus hijos. Permisos reales
    por rol sembrados en `roles.permissions_json` (antes vacíos):
    `order.create`/`order.view_own` (mesero), `kitchen.bump`/`kitchen.view`
    (cocina), `cash.checkout`/`cash.open_shift`/`cash.close_shift`/
    `order.view_all` (cajero) — docs/permisos-plugins.md.
  - `App.tsx` ahora exige PIN por ruta: mesero→`order.create`,
    KDS→`kitchen.bump`, Caja→`cash.checkout`. PINs demo sembrados:
    1111/2222/3333 — documentados como NO aptos para producción.
  - Verificado: `cargo test` 5/5 (nuevo `login_por_pin_identifica_al_
    empleado_y_sus_permisos`), `npm test` 23/23, typecheck/build limpios en
    ambos, y `curl /auth/pin` contra el binario real confirma PIN correcto
    (devuelve empleado+permisos) y PIN incorrecto (401).
  - Pendiente (no bloquea): `CajaScreen` sigue usando el `EMPLOYEE_MESERO`
    hardcodeado para abrir turno en vez del empleado autenticado — requiere
    una segunda pantalla de PIN específica para "quién es el mesero de este
    turno" (distinta del PIN de quien opera la caja), diferido a Fase 7.
  - Próximo: puntos 7 (backup cifrado), 8 (asistente IA v1), 9 (pairing
    real) de §10, luego Fases 7–8.
