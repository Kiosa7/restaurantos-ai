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
| **2 Arquitectura** ⬅️ SIGUIENTE | Docs formales (`docs/`) + **4 spikes de riesgo** (ver §10) | Spikes verdes, ADRs firmados |
| **3 UX/UI** | Flujos mesero/cocina/caja, wireframes, extensión Design System | Comanda ≤ 3 toques validada en prototipo |
| **4 Base de datos** | Migraciones nuevas sobre el patrón de las 11 existentes: menú/modificadores, mesas, comandas/tiempos, recetas/insumos, turnos/propinas, tablas CFDI | Esquema validado con datos (mismo método que pos-inteligente: node:sqlite + triggers probados) |
| **5 Infraestructura** | Hub server (HTTP+WS), pairing de dispositivos, servido de PWA, updater, empaquetado | Instalación limpia en PC virgen < 30 min |
| **6 MVP** | Módulos §7 | **Un restaurante piloto opera un servicio de viernes completo sin tocar papel** |
| **7 Comercial** | CFDI, delivery, reservas, promos, compras | Primer cliente de pago facturando |
| **8 Enterprise** | Multi-sucursal, plugins, API pública | Cadena 3+ sucursales sincronizando |

Entregables documentales de la Fase 2 (crear en `docs/`): visión de producto ·
arquitectura general/software/datos/sync/IA/seguridad · modelo de dominio · modelo
de permisos · modelo de plugins · flujos UX y casos de uso · historias de usuario ·
matriz de riesgos completa · backlog priorizado · estrategia de pruebas ·
estrategia de despliegue · estrategia de mantenimiento. Formato: el mismo que
`~/pos-inteligente/docs/` (documentos validables + este PLAN.md vivo).

## 10. PRÓXIMO PASO CONCRETO — Fase 2: 4 spikes + docs

Ejecutar en este orden (cada spike termina con un mini-informe en `docs/spikes/`):

1. **Spike multi-terminal:** prototipo hub (HTTP + WebSocket sirviendo una PWA
   mínima) con 2 clientes en LAN: un "mesero" manda un comando idempotente y un
   "KDS" lo ve en < 1 s. Validar: reconexión, deduplicación por UUID, reloj del hub.
   Decisión a tomar aquí: servidor en el proceso Rust de Tauri (axum) vs sidecar
   Node — elegir con el spike, criterio = simplicidad de despliegue en 1 solo exe.
2. **Spike impresión ESC/POS:** imprimir comanda y cuenta en térmica 80 mm real
   (USB y/o Ethernet) + drawer kick. ⚠️ Requiere hardware — si no hay impresora
   aún, PEDIRLA al dueño antes de empezar la fase.
3. **Spike CFDI sandbox:** timbrar una factura de prueba contra el sandbox de
   Facturama o SW Sapien desde Node. Documentar costos por timbre y flujo de
   cancelación.
4. **Benchmark Ollama CPU:** medir tokens/s de `qwen2.5:3b` y `qwen2.5:7b` y
   latencia de `llava:7b` en la PC objetivo; fijar los umbrales de los tiers.

En paralelo/después: redactar los documentos de `docs/` (§9).

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
- ⬜ Fase 2 Arquitectura — spikes 1–4 + docs/.
- ⬜ Fases 3–8 — ver §9.

## Bitácora

- 2026-07-03: Fase 1 Discovery completada y validada. Decisiones ADR-1..6
  congeladas. Repo creado con este plan maestro como handoff.
