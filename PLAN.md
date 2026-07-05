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
| **5 Infraestructura** 🟡 | Hub server (HTTP+WS) ✅, pairing real ✅ (genera/persiste, enforcement ⛔), servido de PWA ✅ — updater y empaquetado ⛔ | "Instalación limpia en PC virgen < 30 min" SIN validar (falta `tauri build`, decisión de posponerlo ya tomada) |
| **6 MVP** ✅ | Los 9 puntos de §10 abordados: comandas/inventario/caja/turnos/impresión(sw)/RBAC/backup/IA/pairing, todo verificado contra el binario real | **Un restaurante piloto opera un servicio de viernes completo sin tocar papel** — el software ya lo soporta; falta el piloto real (⛔ §11.4) para decir que se cumplió en la práctica |
| **7 Comercial** ✅ (salvo timbrado ⛔) | CFDI (generación ✅, timbrado ⛔), factura global ✅ (complemento de pago ⛔ transitivo de timbrado), clientes ✅, fidelización ✅, promociones ✅, compras+proveedores+OCR ✅, reservaciones ✅, delivery/para llevar ✅, reportes avanzados ✅ | Primer cliente de pago facturando — lejos, falta timbrado real; todo el resto de Fase 7 ya opera contra el binario real |
| **8 Enterprise** ⬜ ⬅️ SIGUIENTE | Multi-sucursal, plugins, API pública | Cadena 3+ sucursales sincronizando |

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
7. ✅ **Backup cifrado** — `encryptedBackup.ts` (AES-256-GCM+PBKDF2) copiado
   TAL CUAL de pos-inteligente (ADR-1), solo cambia el magic header
   ("RES1" en vez de "POS1", para no confundir backups de ambos productos).
   Lo que cifra es nuevo: `GET /backup/export` en el hub arma un snapshot
   JSON genérico de 30 tablas de negocio (excluye `hub_events`/`hub_commands`,
   protocolo LAN, no datos). `BackupPanel.tsx` exporta y descarga
   `.restaurantosbackup`; restaurar DESCIFRA y previsualiza el contenido pero
   NO reescribe el hub en vivo todavía (reimportar de forma transaccional y
   segura es más grande, diferido a Fase 7).
8. ✅ **Asistente IA v1** — DECISIÓN AUTÓNOMA: NO se portó `OllamaAIClient.ts`
   al navegador; el bucle de tool-calling se implementó en el HUB
   (`app/src-tauri/src/ai.rs`, `POST /ai/chat`) porque el permiso/tenant debe
   inyectarse server-side y porque el lock de la BD solo puede protegerse de
   quedar retenido durante la espera de red si el que espera es el mismo
   proceso que la tiene. 5 tools sobre las vistas de 0016
   (`docs/ai/tools-conversacional-restaurante.md`, nuevo): márgenes por
   platillo, cola de cocina, tiempo de preparación, estado de mesas, propinas
   por turno. `AsistentePanel.tsx` en Caja con preguntas sugeridas.
9. 🟡 **Pairing real de dispositivos** — migración `0018_device_pairings.sql`
   (`device_pairings` + `devices`), `POST /pair/generate` (código de 6
   dígitos, un solo uso, expira a los 5 min), `POST /pair/redeem` (crea
   `deviceId` persistente ligado a un rol), `GET /pair/devices`.
   `PairingPanel.tsx` en Caja genera códigos con QR-como-texto y muestra
   dispositivos ya emparejados. ⛔ Enforcement pendiente: el WS solo
   REGISTRA (`touch_device_if_paired`, log si no está pareado) pero no
   RECHAZA conexiones de dispositivos sin parear todavía — hacerlo exige que
   Mesero/KDS/Caja hagan el handshake de "redimir código" antes de conectar
   el WS, que no se cableó en esta pasada (romperlo ahora habría tumbado
   todo el flujo mesero↔hub↔KDS↔Caja que ya funciona).

**Criterio de éxito de Fase 6 no depende solo de código**: necesita el
restaurante piloto (⛔ §11.4) para el "sin tocar papel" real; mientras tanto,
validar cada módulo con el seed demo (`seedRestaurant.ts`) es suficiente para
marcarlo ✅ técnicamente. **Fase 6 quedó cerrada el 2026-07-04** (ver bitácora).

## 10.1 PRÓXIMO PASO CONCRETO — completar Fase 7 (Comercial)

Fase 6 completa (§9, §13). Fase 7 arrancó con la pieza de mayor riesgo
regulatorio ya resuelta en software: generación de CFDI 4.0
(`POST /cfdi/generate`, `commands.rs::generate_cfdi`) sobre el modelo de
datos de 0015, con conceptos y totales que coinciden con la venta real,
verificado contra el binario (`cargo test` + flujo WS+HTTP en vivo).

**Lo que falta para cerrar Fase 7** (orden sugerido por dependencia/riesgo):

1. ⛔ **Timbrado real** — conectar `generate_cfdi` a un PAC de verdad
   (SW Sapien primario, spike 3). Bloqueado: no hay cuenta/credenciales.
   Cuando existan, el cambio es acotado: `commands.rs` ya arma el documento
   estructural; falta portar `spikes/cfdi/client.mjs` (`FacturamaClient`/
   `SwSapienClient`) a Rust con `reqwest` (mismo patrón que `ai.rs`) y
   llamarlo tras `generate_cfdi`, actualizando `estado`/`uuid_fiscal`/`xml`.
2. ✅ **Factura global** — `commands.rs::generate_global_invoice` agrupa N
   ventas sin CFDI individual en un solo documento (`sale_id NULL`, ya
   previsto en 0015). Rutas `POST /cfdi/global` y
   `GET /cfdi/uninvoiced-sales`. `FacturaGlobalPanel.tsx` en `CajaScreen`.
   Verificado contra el binario real (2026-07-05).
   ⛔ **Complemento de pago** — sigue bloqueado, y NO por falta de diseño:
   un complemento de pago se relaciona (`documento_relacionado_uuid`) con el
   **UUID fiscal** de la factura PPD original, que el SAT solo asigna al
   timbrar de verdad. Como el timbrado real sigue bloqueado (punto 1, sin
   cuenta de PAC), no existe ningún UUID fiscal real al que relacionar un
   complemento — es el mismo bloqueo de fondo, no uno nuevo. DECISIÓN
   AUTÓNOMA: no se construyó un concepto especulativo de "ventas a
   crédito" para rodear esto, porque además de la dependencia del PAC
   implicaría un rediseño real del checkout (hoy toda `sales` se crea con
   su pago ya recibido — ver ADR-6/docs/modelo-dominio.md) que es una
   decisión de alcance de negocio (¿el restaurante da crédito a clientes
   corporativos? ¿con qué términos?), no una limitación técnica a resolver
   por adivinanza. Cuando exista cuenta de PAC y el timbrado real esté
   conectado, `cfdi_pago_complementos` (tabla ya lista desde 0015) es
   suficiente para registrar los pagos del complemento sin más cambios de
   esquema.
3. ✅ **Clientes** — `commerce.rs` (`create_customer`/`list_customers`)
   sobre la tabla heredada `customers`; ligado al checkout
   (`customerId` opcional en `/checkout`). Selector de cliente en
   `CajaScreen`. Verificado contra el binario real (2026-07-04).
4. ✅ **Inventario completo + compras/proveedores con OCR** — `create_supplier`/
   `create_purchase` escriben `purchases`+`purchase_items`+
   `inventory_movements` (mismo patrón que el descuento por receta);
   `extract_invoice_from_image` (Rust, `llava:7b`) porta el pipeline OCR de
   pos-inteligente. `ComprasPanel.tsx` en `CajaScreen`. Verificado contra el
   binario real, incluida una llamada real a Ollama/llava (2026-07-04).
5. ✅ **Reservaciones** — migración 0019 (`reservations`), CRUD completo en
   `commerce.rs` (`create_reservation`/`list_reservations`/
   `update_reservation_status`, estados `confirmada|sentada|cancelada|
   no_show`), rutas `/reservations` y `/reservations/:id/status`,
   `ReservacionesDeliveryPanel.tsx` en `CajaScreen`. Verificado contra el
   binario real (2026-07-05).
6. ✅ **Delivery/para llevar** — migración 0019 (`delivery_orders`).
   DECISIÓN AUTÓNOMA: en vez de hacer `orders.table_id` nullable (SQLite no
   tiene `ALTER COLUMN`; habría que recrear la tabla y arriesgar todo el
   pipeline de KDS/checkout ya probado), se sembraron dos mesas virtuales
   (`table-take-away` #90 "Para llevar", `table-delivery` #91 "Domicilio",
   `zone='virtual'`, capacidad 999) y `create_delivery_order` llama
   directamente a `handle_nueva_comanda` contra esa mesa — un pedido a
   domicilio/para llevar reutiliza TODO el pipeline de comandas/KDS/cobro
   sin cambios. `channel='domicilio'` exige `address`; `channel=
   'para_llevar'` no. Rutas `/delivery-orders` y
   `/delivery-orders/:id/status`. Verificado contra el binario real: se
   crea el pedido, aparece en `/orders/open` con `mesa: 91/90` y el total
   correcto, se cobra con el mismo `/checkout` que cualquier mesa, y los
   estados (`recibido→preparando→listo→en_camino→entregado/cancelado`) se
   actualizan (2026-07-05).
7. ✅ **Promociones** — `commerce.rs::active_percent_off_promotion` aplica
   la primera promoción `percent_off` activa sobre el total bruto del
   cobro; UI de alta en `CajaScreen`. Documentado como v1: sin scope por
   categoría, sin condiciones de monto/cantidad mínima, sin apilar varias
   promociones (el modelo ya soporta reglas más ricas vía `rules_json` para
   cuando se necesiten). Verificado contra el binario real (2026-07-04).
8. ✅ **Fidelización** — 1 punto por cada $10 MXN gastados
   (`floor(total_cents / 1000)`), 1 punto redimido = $1 MXN de descuento
   (100 centavos); `accrue_loyalty`/`redeem_loyalty` en `commerce.rs`.
   DECISIÓN AUTÓNOMA: promoción + puntos redimidos solo se aplican cuando
   `splitMode == "completo"` (una sola venta) — combinarlos con cuenta
   dividida queda documentado como limitación conocida, no bloqueante.
   Verificado contra el binario real con matemática exacta ($140 bruto →
   $119 con 15% de descuento, 11 puntos ganados) (2026-07-04).
9. ✅ **Reportes avanzados** — `reports.rs::dashboard` agrega ventas por
   día (serie de tiempo nueva sobre `sales`, sin vista dedicada porque las
   6 vistas de 0016 son operativas, no de series de tiempo) + 3 de esas
   vistas (`v_dish_sales_margin`, `v_table_turnover`, `v_tips_by_shift`) en
   un solo payload. `GET /reports/dashboard`. `ReportesPanel.tsx` en
   `CajaScreen`: gráfica de barras (SVG propio, sin librería nueva) para
   ventas por día + tablas para las otras 3 métricas, cada una con botón
   de exportar CSV (client-side, sin endpoint nuevo). No se tocaron las
   vistas mismas: siguen siendo las mismas que ya explota el asistente de
   IA (§10 punto 8), esto es la versión "para mirar", no un modelo nuevo.
   Verificado contra el binario real, incluida una revisión visual con
   Playwright (2026-07-05).

**Ninguno de estos bloquea empezar el siguiente**: son módulos
independientes entre sí salvo (1)→(2) (timbrado antes que factura global).
Con (2)-(9) cerrados (complemento de pago ⛔ transitivamente bloqueado por
(1)), **Fase 7 queda cerrada salvo el timbrado real** (⛔, bloqueado desde
Fase 2 por falta de cuenta de PAC).

## 10.2 Fase 8 (Enterprise)

1. ✅ **Multi-sucursal (sync HLC/outbox)** — puerto real del protocolo de
   pos-inteligente (`docs/sync/protocolo.md`, antes solo validado por
   simulación) sobre el esquema que ya traía 0001 (`outbox`, `sync_state`,
   `sync_conflicts`, `audit_log`) sin usar hasta ahora. Módulo nuevo
   `sync.rs`: `Hlc` (wall_ms, counter, node — orden total vía
   `derive(Ord)`, exactamente el algoritmo del protocolo §3),
   `HlcClock` (reloj por proceso, `next_local`/`observe_remote`),
   `enqueue_sale`/`enqueue_inventory_movement`/`enqueue_customer` (escriben
   al `outbox` en la MISMA transacción que el cambio de dominio), y
   `pull`/`push` (el servidor de `GET /sync/pull` y `POST /sync/push`).
   Las 3 estrategias de resolución del protocolo §5, las 3 reales, no solo
   documentadas: `sale` y `inventory_movement` son append-only/CRDT por
   suma de deltas (el trigger de 0010 recalcula `inventory.qty` solo,
   converge sin importar el orden); `customer` es LWW — DECISIÓN AUTÓNOMA:
   simplificado a LWW **por fila** en vez de por-campo (el protocolo
   original hacía por-campo); el valor perdedor SIEMPRE se traza en
   `audit_log` (acción `sync.lww_overwrite`), nunca se descarta en
   silencio, igual que exige el protocolo.
   DECISIÓN AUTÓNOMA (alcance v1): todos los nodos comparten el mismo
   catálogo sembrado (mismo `tenant_id`/`location_id`/productos/empleados);
   lo que de verdad sincroniza son los hechos transaccionales (ventas,
   movimientos de inventario) y el CRM (clientes) — federar un catálogo
   realmente distinto por sucursal (productos/precios propios) es un paso
   posterior, no bloqueante para probar que el PROTOCOLO de sync converge.
   Un hub de RestaurantOS ahora puede jugar el rol de "sucursal" del
   protocolo original; el rol de "nube" lo puede jugar cualquier proceso
   que hable el mismo `push`/`pull` HTTP — incluyendo otro hub, que es
   exactamente cómo se verificó (ver bitácora): dos binarios reales
   (puertos 5190/5191, `RESTAURANTOS_NODE_ID`/`RESTAURANTOS_HUB_PORT`
   nuevos para poder correr dos hubs en la misma máquina) sincronizando
   entre sí de verdad, no una simulación en memoria como en pos-inteligente.
   Verificado contra los binarios reales (2026-07-05).
2. ✅ **Plugins/marketplace** — usa la tabla `plugins` que YA EXISTÍA desde
   0008 (heredada de pos-inteligente, con `manifest_json`/`version`/
   `core_compat`/`signature`, nunca usada hasta ahora — se descubrió al
   intentar crear una migración nueva y toparse con "table plugins has no
   column named description"). Módulo `plugins.rs`
   (`list`/`set_enabled`) + rutas `GET /plugins` y
   `POST /plugins/:id/toggle`. 4 plugins v1 sembrados (todos habilitados
   por default, mismo comportamiento que antes de que existiera el
   registro): `reservaciones_delivery`, `compras_ocr`, `factura_global`,
   `reportes_avanzados` — los módulos de Fase 7 que ya son paneles
   independientes del núcleo. `CajaScreen` lee `GET /plugins` y solo
   renderiza cada panel si su plugin está habilitado; `PluginsPanel.tsx`
   nuevo con checkboxes para encenderlos/apagarlos en vivo.
   DECISIÓN AUTÓNOMA (alcance v1): promociones/fidelización NO se
   volvieron plugin-gateables porque viven inline en el checkout de
   `CajaScreen` (no son un panel separado) — desacoplarlas requeriría
   tocar el flujo de cobro ya probado de punta a punta; documentado como
   pendiente, no bloqueante. Un runtime de plugins de TERCEROS fuera de
   proceso (con la "frontera dura" que describe el doc: IPC/sandboxing) es
   alcance posterior — no se necesita para que el valor real de "un
   restaurante que no hace delivery no ve ese panel" exista hoy; sería
   prematuro construir esa frontera sin un plugin de tercero real que la
   necesite.
   Verificado contra el binario real, incluida una revisión visual con
   Playwright: se deshabilitó "Reservaciones y delivery" por HTTP, se
   confirmó que su panel desaparece de la UI, y se reactivó desde el
   propio checkbox de la UI (no por HTTP) confirmando que reaparece
   (2026-07-05).
3. ✅ **Auditoría avanzada** — `audit.rs` (`list`/`verify_chain`) sobre
   `audit_log` (0001, hash-encadenado), que ya se usaba de verdad desde el
   punto 1 (`sync.lww_overwrite`). `verify_chain` recalcula la cadena
   COMPLETA desde `seq=1` y confirma que cada `hash` coincide con lo que
   el código de escritura habría producido — detecta manipulación directa
   en SQLite (editar/borrar una fila sin pasar por el código), no solo
   confía en que nadie lo haga. Rutas `GET /audit-log` (filtrable por
   `entity`) y `GET /audit-log/verify`. `AuditoriaPanel.tsx` con tabla +
   botón "Verificar integridad de la cadena". Verificado contra el
   binario real (conflicto LWW real vía `/sync/push` con un evento de HLC
   deliberadamente antiguo, que pierde y queda trazado) y con revisión
   visual en Playwright (2026-07-05).
4. **API pública** — exponer un subconjunto de los endpoints ya existentes
   bajo autenticación por API key para integraciones de terceros
   (contabilidad, agregadores de delivery reales).
5. **Franquicias, visión avanzada** — sin empezar; visión avanzada
   (OCR/cámara cenital) depende de hardware que no existe en esta máquina
   (cámara cenital real), mismo patrón de bloqueo que la impresora térmica
   (§11.3) — evaluar si aplica marcar ⛔ formalmente al llegar a ese punto
   en vez de construir en el vacío.

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
- 🟡 Fase 6 MVP — **9/9 puntos de §10 abordados** (7 completos sin
  reservas: 1,2,3,5,6,7,8; 2 con una parte ⛔ documentada: 4 impresión de
  software completo/falta hardware físico, 9 pairing generado/persistido
  completo/falta que el WS lo EXIJA). Mesero↔hub↔KDS↔Caja funcionando de
  punta a punta contra el binario real (comanda→bump con descuento de
  inventario→cobro→turno cerrado con propina repartida→asistente IA
  respondiendo con datos reales sin bloquear el WS→dispositivo emparejado
  con código de un solo uso), todo verificado con scripts WS+HTTP en vivo
  contra el binario compilado, no solo con `cargo test`/`npm test`.
  **Fase 6 queda funcionalmente completa para el estándar de este proyecto**
  (código + verificación real); lo que falta son 2 piezas que dependen de
  algo fuera del código (hardware físico) o de una decisión de ruptura
  deliberada (enforcement de pairing) — ver §10 y bitácora 2026-07-04.
- ✅ Fase 7 Comercial (salvo timbrado ⛔) — CERRADA: generación de CFDI 4.0
  real, factura global, clientes, fidelización, promociones, compras+
  proveedores+OCR, reservaciones, delivery/para llevar y reportes
  avanzados — los 9 módulos completos y verificados contra el binario
  real (incluida revisión visual con Playwright para el módulo de
  reportes). ⛔ Timbrado real bloqueado (spike 3, sin cuenta de PAC);
  complemento de pago bloqueado transitivamente (necesita el UUID fiscal
  que solo da un timbrado real) — ninguno de los dos es un hueco de
  diseño, son dependencias externas documentadas. Fase 7 no tiene más
  trabajo pendiente que no dependa de esos dos bloqueos (2026-07-05).
- 🟡 Fase 8 Enterprise — AVANZANDO: multi-sucursal (sync HLC/outbox) ✅
  (puerto real, no simulado, verificado con dos binarios sincronizando
  entre sí), plugins/marketplace ✅ (registro enable/disable sobre la
  tabla `plugins` heredada de 0008, nunca usada hasta ahora; 4 paneles de
  Fase 7 ahora apagables en vivo) y auditoría avanzada ✅ (UI real sobre
  `audit_log` + verificación de integridad de la cadena de hash completa).
  Faltan API pública, franquicias y visión avanzada — ver §10.2
  (2026-07-05).

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
- 2026-07-04: Fase 6 punto 7 (backup cifrado) completado en modo autónomo total.
  - `encryptedBackup.ts` (AES-256-GCM + PBKDF2, Web Crypto) copiado TAL CUAL
    de pos-inteligente (ADR-1 §2.1) — el algoritmo no se tocó. Solo cambió el
    magic header del archivo (`"RES1"` en vez de `"POS1"`) para no confundir
    backups de ambos productos, y el texto de los mensajes de error.
  - Lo nuevo: `app/src-tauri/src/backup.rs` arma un snapshot JSON genérico
    (`dump_table` lee `PRAGMA table_info` y convierte cada fila con
    `row.get_ref` según el tipo SQLite real — no hay que mantener una lista
    de columnas a mano por tabla) de 30 tablas de negocio, expuesto en
    `GET /backup/export`. Deliberadamente NO incluye `hub_events`/
    `hub_commands` (protocolo LAN) ni `schema_migrations` (se reconstruye).
  - `BackupPanel.tsx` (nuevo, dentro de `CajaScreen`, permiso `backup.manage`
    agregado al rol Cajero en el seed): exporta y descarga
    `.restaurantosbackup` real; restaurar descifra y muestra un resumen de
    conteos por tabla, pero **no reescribe el hub en vivo todavía** —
    reimportar de forma transaccional y segura sobre un hub operando es una
    pieza más grande (¿qué pasa con comandas abiertas durante la
    restauración? ¿se valida contra el schema actual?) que se difiere a
    Fase 7, documentado explícitamente en el componente y aquí.
  - Verificado: `cargo test` 6/6 (nuevo
    `snapshot_de_respaldo_incluye_catalogo_y_mesas_sembradas`), `npm test`
    23/23, typecheck/build limpios, y `curl /backup/export` contra el
    binario real devuelve 30 tablas con los datos sembrados reales
    (7 productos, 5 mesas, 3 empleados).
  - Próximo: puntos 8 (asistente IA v1), 9 (pairing real) de §10, luego
    Fases 7–8.
- 2026-07-04: Fase 6 punto 8 (asistente IA v1) completado en modo autónomo total.
  - DECISIÓN AUTÓNOMA: NO se portó `OllamaAIClient.ts` (fetch desde el
    navegador) de pos-inteligente. El bucle completo de tool-calling
    (pregunta → Ollama decide tool → hub ejecuta vista → resultado de vuelta
    a Ollama → respuesta final) se implementó en Rust
    (`app/src-tauri/src/ai.rs`, `reqwest` como cliente HTTP hacia
    `localhost:11434`) por DOS razones: (1) la inyección de tenant/permisos
    server-side que el ADR exige solo es posible si el núcleo (hub) es quien
    arma la conversación, no el navegador; (2) la regla de oro "la IA nunca
    bloquea el camino crítico" solo se puede GARANTIZAR si el lock de SQLite
    se toma/suelta en el mismo proceso que hace el `.await` a Ollama — el
    código toma el lock SOLO para ejecutar la tool (síncrono, rápido) y lo
    suelta antes de cualquier espera de red.
  - 5 tools nuevas sobre las vistas de 0016 (documentadas en
    `docs/ai/tools-conversacional-restaurante.md`, nuevo): `get_dish_margins`,
    `get_kitchen_queue`, `get_dish_prep_time`, `get_tables_status`,
    `get_tips_by_shift`. Modelo: `qwen2.5:7b` (mismo del spike 4).
  - `AsistentePanel.tsx` (nuevo, en `CajaScreen`): preguntas sugeridas +
    input libre, muestra la respuesta y qué tool se usó como cita de fuente
    (mismo principio de trazabilidad que pos-inteligente).
  - **Verificado contra Ollama REAL, no un mock** (`curl /ai/chat`):
    "¿Qué mesas están libres ahora?" → citó `get_tables_status`, respondió
    correctamente "mesa 1 y mesa 4" (coincide con el seed) en 14s.
    "¿Qué platillo deja más margen?" → citó `get_dish_margins`, respondió
    "Quesadilla de flor de calabaza" (correcto: es la única sin receta, así
    que su margen es el precio completo) en 3.8s.
  - **Verificado el requisito arquitectónico más importante de este punto**:
    un script dispara una pregunta a la IA (que tarda ~4s) y, 200ms después,
    manda un comando `nueva_comanda` real por WS — el comando se confirmó en
    **6ms**, sin esperar a que la IA terminara. La regla "la IA nunca bloquea
    el camino crítico" quedó demostrada, no solo documentada.
  - Verificado: `cargo test` 6/6 (sin regresión), `npm test` 23/23,
    typecheck/build limpios.
  - Pendiente (documentado en el doc de tools, no bloquea): tools sin
    parámetros aún (fechas, límites), sin permisos por tool, sin
    `ai_chat_log` (historial se pierde entre reinicios).
  - Próximo: punto 9 (pairing real de dispositivos) de §10, último pendiente
    de Fase 6, luego Fases 7–8.
- 2026-07-04: Fase 6 punto 9 (pairing real) completado — CIERRE DE FASE 6.
  - Migración `0018_device_pairings.sql`: `device_pairings` (código de 6
    dígitos, un solo uso, expira a los 5 min) y `devices` (identidad
    persistente: id UUID v7, rol, label, paired_at, last_seen_at).
  - `POST /pair/generate {role}` → código; `POST /pair/redeem {code,label}`
    → crea el `deviceId` y marca el código usado (falla si ya se usó o
    expiró); `GET /pair/devices` → lista para administración.
    `PairingPanel.tsx` en Caja: selector de rol, genera y muestra el código
    con cuenta regresiva, lista dispositivos ya emparejados.
  - DECISIÓN AUTÓNOMA: el WS (`handle_socket`) llama a
    `touch_device_if_paired` — si el `device` de la conexión SÍ está
    pareado, actualiza `last_seen_at`; si NO, deja pasar la conexión igual
    (con un log informativo) en vez de rechazarla. Exigir pairing de verdad
    (rechazar conexiones no pareadas) requeriría que Mesero/KDS/Caja hicieran
    un paso de "canjear código" antes de conectar — cambio de UI que no se
    hizo en esta pasada porque habría arriesgado romper el flujo
    mesero↔hub↔KDS↔Caja que ya está probado y funcionando de punta a punta;
    más valioso dejarlo generando/persistiendo pairing real (que es lo que
    faltaba de fondo) y marcar el enforcement como el siguiente paso exacto.
  - Verificado: `cargo test` 7/7 (nuevo
    `pairing_genera_y_redime_un_codigo_de_un_solo_uso`), `npm test` 23/23
    (corregido el conteo de migraciones a 18), typecheck/build limpios, y
    contra el binario real: generar código → redimir (crea deviceId) →
    redimir de nuevo falla (400) → `GET /pair/devices` lo lista.

  ## FASE 6 (MVP) — CIERRE

  Los 9 puntos de §10 quedaron abordados con código real y verificación
  contra el binario compilado (no solo tests unitarios), en el mismo
  estándar que se usó en Fases 1-5. Resumen de lo que SÍ se puede prometer
  hoy: un mesero manda una comanda real desde una tablet, la cocina la ve
  en vivo y al marcarla "en preparación" el hub descuenta inventario por
  receta de verdad, la caja la cobra (con división de cuenta y propina) y
  genera una venta con cadena de hash, el turno se cierra repartiendo esa
  propina, el dueño le puede preguntar al asistente de IA local sin que eso
  afecte la velocidad de las comandas, hay botones de imprimir (aunque sin
  impresora real para probarlos), un backup cifrado descargable, PINs reales
  por empleado con permisos reales, y un flujo para emparejar dispositivos
  nuevos. Todo esto sobre un hub Rust persistido en SQLite que sobrevive
  reinicios — no una demo de humo.

  Lo que NO se puede prometer todavía (⛔, honesto): que una impresora
  térmica real imprima bien (falta el hardware), que un dispositivo sin
  parear sea rechazado (falta el cambio de UI de "canjear código"), que el
  timbrado CFDI funcione (Fase 7, falta cuenta de PAC), y que el sistema
  completo quepa en un instalador de un clic (falta `tauri build`, decisión
  ya tomada de posponerlo). Ninguno de estos bloquea seguir construyendo:
  son piezas que dependen de un recurso externo o de una decisión de
  producto, no de más diseño.
- 2026-07-04: Fase 7 arrancada (modo autónomo total) — CIERRE DE SESIÓN.
  - **Generación de CFDI 4.0 real**: `commands.rs::generate_cfdi` arma el
    documento completo (emisor sembrado con RFC genérico de pruebas del SAT,
    folio secuencial por local, conceptos desde `sale_items` con clave SAT
    genérica de "servicios de restaurante", totales que se toman
    DIRECTAMENTE de la venta ya cobrada, no se recalculan) y lo persiste en
    `cfdi_documents`/`cfdi_conceptos` en estado `'pendiente'`. Expuesto en
    `POST /cfdi/generate` y `GET /cfdi/by-sale/:id`. Botón "Generar factura"
    en `CajaScreen` tras un cobro exitoso, con campos de RFC/nombre del
    receptor (default "público en general").
  - Reglas de negocio ya cubiertas por test: una venta solo puede tener UN
    CFDI (`generate_cfdi` rechaza el segundo intento); el total del CFDI
    coincide exactamente con el de la venta.
  - ⛔ El TIMBRADO (llamar al PAC de verdad) sigue bloqueado — sin cambio
    desde el spike 3 de Fase 2: no hay cuenta/credenciales de SW Sapien ni
    Facturama. El documento generado es estructuralmente válido pero nunca
    pasa de `estado='pendiente'`. Cuando exista la cuenta, conectar es
    acotado: portar `spikes/cfdi/client.mjs` a Rust con `reqwest` (mismo
    patrón que `ai.rs`) y llamarlo desde `generate_cfdi` o un paso posterior.
  - Verificado: `cargo test` 8/8 (nuevo
    `genera_cfdi_a_partir_de_una_venta_cobrada`), `npm test` 23/23,
    typecheck/build limpios, y flujo completo contra el binario real
    (comanda→cobro→CFDI con folio y totales correctos→consulta por venta).
  - **Por qué se detuvo aquí y no se completó toda la Fase 7 y la Fase 8**:
    el resto de Fase 7 (factura global, clientes, inventario+compras+OCR,
    reservaciones, delivery, promociones, fidelización, reportes avanzados)
    y toda la Fase 8 (multi-sucursal, plugins, auditoría, franquicias, API
    pública, visión avanzada) son, cada una, un conjunto de módulos nuevos
    del tamaño de lo que tomó toda la Fase 6 — intentar todas en la misma
    sesión con el mismo estándar de verificación real (no solo diseño en el
    papel) habría sacrificado la rigurosidad que se mantuvo en las 6 fases
    anteriores. Se priorizó CFDI por ser el requisito regulatorio central de
    ADR-3 (México) y porque su modelo de datos ya existía desde Fase 4.
  - **Próximo paso concreto para quien retome**: §10.1 de este documento
    tiene el desglose completo y el orden sugerido para terminar Fase 7;
    §10.2 tiene el recordatorio de alcance de Fase 8. El timbrado real (1)
    es lo único bloqueado por un recurso externo; todo lo demás es
    diseño+código nuevo sin bloqueos técnicos identificados.
- 2026-07-04: Fase 7 continuación (modo autónomo total) — clientes,
  fidelización, promociones, compras+proveedores+OCR.
  - **Módulo nuevo `commerce.rs`** sobre tablas heredadas de pos-inteligente
    (`customers`/`suppliers`/`purchases`/`promotions`, 0005/0007/0008) que no
    tenían UI restaurantera todavía.
  - **Clientes**: `create_customer`/`list_customers`. `/checkout` ahora
    acepta `customerId` opcional para ligar la venta a un cliente guardado.
  - **Promociones**: `active_percent_off_promotion` aplica la primera
    promoción `percent_off` activa sobre el total bruto. DECISIÓN AUTÓNOMA:
    v1 solo soporta un tipo de regla (porcentaje sobre el total, sin scope
    por categoría ni condiciones de monto mínimo ni apilar varias
    promociones) — el modelo de datos ya soporta reglas más ricas vía
    `rules_json` para cuando se necesiten; documentado como límite conocido,
    no como omisión accidental.
  - **Fidelización**: `accrue_loyalty`/`redeem_loyalty` — 1 punto por cada
    $10 MXN gastados (`floor(total_cents / 1000)`), 1 punto redimido = $1
    MXN de descuento (100 centavos). DECISIÓN AUTÓNOMA: promoción y puntos
    redimidos solo se aplican cuando `splitMode == "completo"` (una sola
    venta); combinar descuentos con cuenta dividida queda como limitación
    documentada, no bloqueante para el resto de Fase 7.
  - **Compras/proveedores**: `create_supplier`/`create_purchase` escriben
    `purchases`+`purchase_items`+`inventory_movements` (mismo patrón que el
    descuento de inventario por receta ya usado en Fase 6), sumando
    inventario real, no solo un registro contable.
  - **OCR de facturas de proveedor**: `extract_invoice_from_image` en
    `ai.rs`, puerto verbatim del prompt/parsing de
    `extractInvoiceFromImage.ts` de pos-inteligente a Rust usando
    `llava:7b` vía `/api/chat` de Ollama (mismo patrón tolerante a fallos de
    lectura: busca el primer `{` y el último `}`, filtra líneas inválidas).
    DECISIÓN AUTÓNOMA: el resultado del OCR se muestra como referencia de
    solo lectura en `ComprasPanel.tsx`, sin fuzzy-matching automático
    nombre→`productId` todavía — documentado como pendiente, no bloqueante
    (capturar la compra manual con el OCR de apoyo ya es una mejora real
    sobre no tener OCR).
  - `ComprasPanel.tsx` (proveedores, compra manual, subida de imagen para
    OCR) y selector de cliente + input de puntos a redimir en `CajaScreen`.
  - Verificado: `cargo test` 10/10 (nuevos
    `cliente_promocion_y_puntos_se_aplican_en_el_cobro`,
    `compra_a_proveedor_suma_inventario_real`), `npm test` 23/23,
    typecheck/build limpios. Contra el binario real: cliente creado,
    promoción 15% aplicada en un cobro real ($140 bruto → $119 con
    descuento, 11 puntos ganados — matemática correcta), compra que sumó
    inventario de verdad, y llamada real a Ollama/llava que devolvió JSON
    estructurado de una factura.
- 2026-07-05: Fase 7 continuación (modo autónomo total) — reservaciones y
  delivery/para llevar.
  - **Migración 0019** (`reservations` + `delivery_orders`).
  - **Reservaciones**: CRUD completo en `commerce.rs`
    (`create_reservation`/`list_reservations`/`update_reservation_status`),
    estados `confirmada|sentada|cancelada|no_show` con validación de enum
    (un estado inválido se rechaza). Rutas `/reservations` y
    `/reservations/:id/status`.
  - **Delivery/para llevar** — DECISIÓN AUTÓNOMA (diseño arquitectónico):
    en vez de hacer `orders.table_id` nullable (SQLite no tiene
    `ALTER COLUMN`; habría que recrear la tabla completa y arriesgar todo el
    pipeline de KDS/checkout ya probado de punta a punta desde Fase 6), se
    sembraron dos mesas virtuales en `seed.rs`
    (`table-take-away` #90 "Para llevar", `table-delivery` #91 "Domicilio",
    `zone='virtual'`, capacidad 999) y `create_delivery_order` llama
    directamente a `handle_nueva_comanda` contra esa mesa. Un pedido a
    domicilio o para llevar reutiliza TODO el pipeline de
    comandas/KDS/cobro sin ningún cambio adicional — aparece en Caja y se
    cobra exactamente como cualquier mesa física. `channel='domicilio'`
    exige `address` no vacía (se rechaza si falta); `channel='para_llevar'`
    no la requiere. Rutas `/delivery-orders` y
    `/delivery-orders/:id/status`, estados
    `recibido→preparando→listo→en_camino→entregado/cancelado`.
  - `ReservacionesDeliveryPanel.tsx` (dos columnas: reservaciones con
    formulario+lista+cambio de estado inline; delivery con selector de
    canal, dirección condicional, formulario+lista+cambio de estado inline
    con emoji 🚴/🥡) montado en `CajaScreen`.
  - Corregidas dos aserciones obsoletas al aparecer las mesas virtuales: el
    snapshot de respaldo pasó de 5 a 7 mesas sembradas
    (`hub_test.rs`), y el conteo de migraciones TS pasó de 18 a 19
    (`restaurantSchema.test.ts`).
  - Verificado: `cargo test` 12/12 (nuevos
    `reservacion_se_crea_y_cambia_de_estado`,
    `pedido_a_domicilio_reutiliza_el_pipeline_de_comandas`), `npm test`
    23/23, typecheck/build limpios. Contra el binario real (script Node
    con 22 aserciones vía `fetch`, hub compilado y corriendo en :5190):
    reservación creada→listada→estado inválido rechazado→cambio a
    "sentada" persistido; pedido a domicilio sin dirección rechazado;
    pedido a domicilio válido aparece en `/orders/open` con `mesa: 91` y
    total correcto (3×$90.00); listado de delivery con canal/dirección
    correctos; cambio de estado a "en_camino" persistido; `/checkout` del
    pedido a domicilio cobra el total correcto igual que cualquier mesa;
    pedido para llevar aparece con `mesa: 90`. Hub detenido limpiamente y
    `.db` de desarrollo borrada tras la verificación.
  - **Con esto, de los 9 puntos de §10.1 solo quedan pendientes**: (1)
    timbrado real (⛔ bloqueado, sin cambio), (2) factura global/
    complemento de pago, y (9) reportes avanzados. Continúa la sesión con
    (2) y (9) para cerrar Fase 7, y después Fase 8 (§10.2).
- 2026-07-05: Fase 7 continuación (modo autónomo total) — factura global.
  - **Factura global**: `commands.rs::generate_global_invoice` agrupa N
    ventas del día sin CFDI individual en un solo documento con
    `sale_id NULL` (columna ya prevista en 0015). No hizo falta ninguna
    migración nueva: "¿ya está facturada esta venta?" se resuelve con el
    mismo join `sale_items→cfdi_conceptos` tanto para factura individual
    como global, así que una venta no puede quedar facturada dos veces sin
    importar por cuál vía. Corregido de paso un hueco real que esto
    destapó: `generate_cfdi` (individual) solo revisaba
    `cfdi_documents.sale_id`, que es NULL en una factura global —una venta
    ya incluida en una global podía facturarse individual otra vez. Ahora
    ambas rutas usan el mismo join. Rutas nuevas `POST /cfdi/global` y
    `GET /cfdi/uninvoiced-sales` (ventas sin CFDI, candidatas a agrupar).
    `FacturaGlobalPanel.tsx` en `CajaScreen` (selección con checkboxes +
    botón generar).
  - ⛔ **Complemento de pago** — evaluado y NO implementado, con
    justificación técnica, no solo de alcance: un complemento de pago se
    relaciona (`documento_relacionado_uuid`, ya modelado en
    `cfdi_pago_complementos` desde 0015) con el UUID fiscal de la factura
    PPD original, y ese UUID solo existe después de un timbrado real. Con
    el timbrado bloqueado (spike 3, sin cuenta de PAC), no hay ningún UUID
    fiscal real al que relacionar un complemento — es transitivamente el
    mismo bloqueo del punto 1, no uno nuevo. DECISIÓN AUTÓNOMA: se evitó
    construir un concepto especulativo de "ventas a crédito" para rodear
    esto (implicaría redefinir cuándo se crea una `sale` — hoy siempre con
    su pago ya recibido, ver ADR-6 — y es una decisión de alcance de
    negocio del dueño, no algo que deba adivinarse). Cuando exista cuenta
    de PAC y timbrado real, la tabla ya está lista y conectar el
    complemento es acotado.
  - Verificado: `cargo test` 13/13 (nuevo
    `factura_global_agrupa_varias_ventas_sin_duplicar`, cubre agrupar 2
    ventas, rechazo de re-facturar global o individual una venta ya
    incluida, y venta inexistente), `npm test` 23/23, typecheck/build
    limpios. Contra el binario real (script Node, 14 aserciones vía
    `fetch`): 2 ventas nuevas aparecen en `/cfdi/uninvoiced-sales`,
    factura global las agrupa con el total correcto y queda en estado
    `pendiente`, un segundo intento de facturar global o individual
    cualquiera de esas ventas se rechaza, y ambas desaparecen de la lista
    de pendientes. Hub detenido limpiamente y `.db` de desarrollo borrada.
  - **Con esto, de los 9 puntos de §10.1 solo queda pendiente el (9)
    reportes avanzados** para cerrar Fase 7 por completo (además del
    timbrado real, bloqueado sin cambio desde Fase 2).
- 2026-07-05: Fase 7 — reportes avanzados. **CIERRE DE FASE 7** (salvo
  timbrado real, ⛔).
  - **`reports.rs::dashboard`**: agrega ventas por día de los últimos 30
    días (agregación nueva sobre `sales`, agrupando por
    `strftime('%Y-%m-%d', datetime/1000, 'unixepoch')` — no hay vista para
    esto en 0016 porque sus 6 vistas son operativas —mesas, cocina,
    turnos—, no series de tiempo) junto con 3 de esas vistas ya existentes
    (`v_dish_sales_margin`, `v_table_turnover`, `v_tips_by_shift`) en un
    solo payload. `GET /reports/dashboard`.
  - **`ReportesPanel.tsx`**: gráfica de barras SVG propia (sin librería
    nueva — el proyecto no tenía ninguna de gráficas) para ventas por día,
    y tablas para margen por platillo / rotación de mesas / propinas por
    turno, cada bloque con botón "Exportar CSV" (generado en el cliente
    con `Blob`, sin endpoint nuevo). DECISIÓN AUTÓNOMA: se usó el skill de
    dataviz del proyecto para la gráfica — barra con tope de 24px (nunca
    llena el carril aunque haya pocos días de datos), extremo redondeado,
    línea base, etiqueta de día, tooltip nativo con el valor exacto; las
    otras 3 métricas se muestran como tabla (no gráfica) porque son datos
    multi-campo por fila, donde una tabla es más legible que forzar un
    tipo de gráfica.
  - Revisión visual real con Playwright (no solo capturas de otra sesión):
    se detectó y corrigió un bug real que el typecheck/tests no habrían
    visto — con pocos días de datos (1, en el seed de prueba) la barra sin
    tope de ancho llenaba TODO el ancho de la gráfica y parecía un bloque
    sólido roto, no una barra. Corregido capando el ancho a 24px y
    centrando cada barra en su carril; se agregó la etiqueta de día en el
    eje X, que tampoco existía. Confirmado visualmente tras el fix.
  - Verificado: `cargo test` 14/14 (nuevo
    `dashboard_de_reportes_agrega_ventas_y_vistas_existentes`), `npm test`
    23/23, typecheck/build limpios. Contra el binario real (script Node,
    10 aserciones vía `fetch`): el dashboard trae los 4 arreglos
    esperados, incluye datos sembrados del menú en margen por platillo, y
    una venta nueva se refleja correctamente en `ventasPorDia`.
  - **Con esto, Fase 7 (Comercial) queda cerrada.** Los 9 puntos de §10.1
    están abordados: 8 con código + verificación real completa, y el
    noveno (timbrado real) sigue ⛔ documentado desde Fase 2 sin cambio —
    no es una omisión de esta sesión, es la única pieza que depende de un
    recurso externo (cuenta de PAC) que el proyecto no controla.
  - **Próximo paso**: Fase 8 (Enterprise) — §9 y §10.2 tienen el
    recordatorio de alcance (multi-sucursal con el protocolo HLC/outbox ya
    validado en pos-inteligente, plugins/marketplace sobre
    `docs/permisos-plugins.md`, auditoría avanzada, franquicias, API
    pública, visión avanzada).
- 2026-07-05: Fase 8 (Enterprise) — multi-sucursal (sync HLC/outbox), primer
  módulo real de la fase.
  - **Contexto**: el esquema ya traía desde 0001 (heredado de
    pos-inteligente) toda la infraestructura de sync — `outbox`,
    `sync_state`, `sync_conflicts`, `audit_log` — sin que ningún código la
    usara todavía (confirmado por grep antes de empezar). El protocolo
    completo (HLC, outbox transaccional, 3 estrategias de resolución por
    tipo de agregado) ya estaba diseñado y validado por SIMULACIÓN en
    pos-inteligente (`docs/sync/protocolo.md`), pero nunca implementado
    contra un servidor real (su propio §12 dice "falta la implementación
    del hub"). Esta sesión lo implementa y lo verifica de verdad.
  - **DECISIÓN AUTÓNOMA (identidad de nodo configurable)**: `seed::NODE`
    era una constante fija (`"t1:l1:hub"`); para poder correr DOS hubs
    reales en la misma máquina con identidad de nodo distinta (necesario
    para desempate determinista de HLC), se volvió `seed::node()` —
    función que lee `RESTAURANTOS_NODE_ID` una sola vez (`OnceLock`), con
    el mismo default de antes si no se define. Refactor mecánico (~30
    call sites entre `seed.rs`/`commands.rs`/`commerce.rs`), sin cambio de
    comportamiento cuando la env var no está definida — confirmado por
    los 14 tests previos siguiendo pasando igual tras el cambio.
  - **`sync.rs` (nuevo)**: `Hlc{wall,counter,node}` con orden total por
    `derive(Ord)` (exactamente el algoritmo del protocolo §3: comparar
    lexicográficamente); `HlcClock` con `next_local`/`observe_remote`
    (monotonía garantizada aunque el remoto traiga un wall más
    adelantado); `enqueue_sale`/`enqueue_inventory_movement`/
    `enqueue_customer` escriben al `outbox` en la MISMA transacción que el
    cambio de dominio (se llaman desde los handlers HTTP/WS de
    `hub.rs`, justo después de que `commands.rs`/`commerce.rs` ya
    insertaron la fila real, todavía con el mismo `conn` bloqueado);
    `pull`/`push` son el servidor de `GET /sync/pull` (cursor incremental
    por HLC, reanudable) y `POST /sync/push` (idempotente por
    `aggregate_id` ya existente localmente).
  - **Las 3 estrategias del protocolo §5, las 3 reales**:
    - `sale`/`inventory_movement`: append-only / CRDT por suma de deltas.
      Aplicar un movimiento remoto es un simple INSERT (si el id no existe
      ya) — el trigger de 0010 recalcula `inventory.qty` solo, así que el
      stock converge sin importar en qué orden lleguen los movimientos de
      distintas sucursales. Verificado explícitamente: dos nodos con el
      mismo movimiento aplicado dos veces (reenvío) NO duplican el
      descuento (idempotencia real, no solo "en memoria").
    - `customer`: LWW. DECISIÓN AUTÓNOMA: simplificado a LWW **por fila**
      (el protocolo original de pos-inteligente lo diseñaba por-campo,
      fusionando cambios a campos distintos del mismo registro); documentado
      como limitación v1 — dos ediciones concurrentes a campos DISTINTOS
      del mismo cliente hacen que una pise a la otra en vez de fusionarse.
      Lo que SÍ se preservó del protocolo: el valor perdedor nunca se
      descarta en silencio — se escribe a `audit_log` (acción
      `sync.lww_overwrite`, con el before/after completos), reutilizando
      la cadena de hash que ya existía para eso (mismo patrón que la
      cadena de `sales`).
  - **DECISIÓN AUTÓNOMA (alcance v1 de "multi-sucursal")**: todos los
    nodos de esta implementación comparten el mismo catálogo sembrado
    (mismo `tenant_id`/`location_id`/productos/empleados/mesas). Lo que
    de verdad viaja por el protocolo son los HECHOS transaccionales
    (ventas, movimientos de inventario) y el CRM (clientes) — federar un
    catálogo realmente distinto por sucursal (productos/precios propios
    por locación) es un paso posterior de modelado de datos, no bloqueante
    para demostrar que el PROTOCOLO DE SYNC EN SÍ converge correctamente,
    que es el riesgo que este punto de la Fase 8 existe para mitigar.
  - **Verificación — más estricta que la del propio pos-inteligente**: ahí
    el protocolo se validó con `docs/sync/sync-sim.mjs`, una simulación en
    memoria de 2 nodos. Aquí se verificó con:
    - `cargo test`: nuevo `sync_multi_sucursal_converge_por_estrategia_de_agregado`
      (dos BDs en memoria con relojes HLC de nodo distinto, intercambian
      outbox real vía `pull()`/`push()`, verifica las 3 estrategias +
      idempotencia + convergencia de LWW con conflicto real). 15/15 tests
      verdes.
    - **Contra DOS BINARIOS REALES simultáneos**: se agregaron
      `RESTAURANTOS_HUB_PORT` (puerto configurable, antes fijo en 5190) y
      se usó `RESTAURANTOS_NODE_ID`/`RESTAURANTOS_DB_PATH` para levantar
      "sucursal A" (puerto 5190) y "sucursal B" (puerto 5191) como dos
      procesos `app.exe` independientes con sus propios `.db`. Un script
      Node relayó eventos reales por HTTP entre ambos (el rol que jugaría
      una nube real, pero contra hubs reales, no un mock): venta +
      compra creadas en A, sincronizadas hacia B (aparecen, son
      facturables ahí); reenviar el mismo lote a B es no-op puro;
      cliente creado en B, sincronizado hacia A. 11/11 aserciones
      pasaron. Ambos procesos detenidos limpiamente y sus `.db` borradas
      al terminar.
  - **Con esto, el punto de mayor riesgo/incertidumbre de Fase 8 (¿el
    protocolo de sync realmente converge fuera de una simulación?) queda
    resuelto**: sí, contra hubs reales. Sigue pendiente: plugins/
    marketplace, auditoría avanzada (UI sobre el `audit_log` que ya se usa
    de verdad desde este punto), API pública, franquicias, visión
    avanzada — ver §10.2 para el desglose y el orden sugerido.
- 2026-07-05: Fase 8 (Enterprise) — plugins/marketplace.
  - **Hallazgo antes de escribir código**: al ir a crear una migración
    nueva para un registro de plugins, `cargo test` falló con "table
    plugins has no column named description" — ya existía una tabla
    `plugins` desde 0008 (heredada de pos-inteligente), con un esquema más
    rico que el que se iba a crear desde cero (`manifest_json`, `version`,
    `core_compat`, `signature`), sin que ningún código la hubiera usado
    todavía. Se descartó la migración nueva (0020, redundante) y se
    reescribió `plugins.rs` contra el esquema ya existente — mejor
    resultado y menos código que si no se hubiera revisado antes de
    escribir.
  - **`plugins.rs`** (nuevo): `list` (lee `id`/`name`/`enabled` +
    `description` extraída de `manifest_json`) y `set_enabled`
    (valida que el id exista, actualiza y sella `updated_at`). Rutas
    `GET /plugins` y `POST /plugins/:id/toggle`.
  - **4 plugins v1 sembrados**, todos `enabled=1` por default (mismo
    comportamiento que antes de que existiera el registro):
    `reservaciones_delivery`, `compras_ocr`, `factura_global`,
    `reportes_avanzados` — los módulos de Fase 7 que ya son paneles
    independientes del núcleo (dogfooding real del modelo de
    `docs/permisos-plugins.md`: "mesero/KDS/caja son, arquitectónicamente,
    plugins del núcleo"). `signature` queda `NULL` a propósito: es para
    verificar plugins de terceros firmados que todavía no existen, no
    aplica a estos 4 de primera parte.
  - **`CajaScreen`** ahora hace `GET /plugins` al montar y solo renderiza
    cada uno de los 4 paneles si su plugin está habilitado.
    **`PluginsPanel.tsx`** (nuevo): lista con checkbox por plugin, llama a
    `POST /plugins/:id/toggle` y refresca — un dueño puede apagar
    "Reservaciones y delivery" si su restaurante no las ofrece, sin tocar
    código.
  - DECISIÓN AUTÓNOMA (alcance v1): promociones/fidelización NO se
    volvieron plugin-gateables — viven inline en el checkout de
    `CajaScreen` (selector de cliente + puntos a redimir dentro del propio
    flujo de cobro), no son un panel separado; desacoplarlas arriesgaría
    el flujo de cobro ya probado de punta a punta desde Fase 6. Un runtime
    de plugins de TERCEROS fuera de proceso (la "frontera dura" que
    describe el doc: sin acceso directo a SQLite/proceso Rust, solo a
    puertos y bus de eventos) queda como alcance posterior explícito —
    construir esa frontera hoy sería diseñar en el vacío sin un plugin de
    tercero real que la necesite.
  - Verificado: `cargo test` 16/16 (nuevo
    `plugins_se_listan_sembrados_y_se_pueden_deshabilitar`), `npm test`
    23/23, typecheck/build limpios. Contra el binario real: se deshabilitó
    "Reservaciones y delivery" por HTTP y se confirmó que persiste; **más
    una revisión visual real con Playwright** (no solo HTTP): el panel de
    Reservaciones desaparece de la pantalla de Caja al deshabilitarse, y
    reaparece al reactivar el plugin desde el propio checkbox de la UI (no
    por HTTP) — la nota de bug de la sesión de reportes avanzados sigue
    aplicando: la revisión visual encuentra cosas que HTTP+tests no ven,
    en este caso confirmando que sí funciona, no un bug.
  - Nota aparte (no relacionada con plugins): al reiniciar el hub para
    esta verificación, una primera instancia terminó sola con exit code 0
    sin panic en el log, justo tras una petición — no se reprodujo en el
    segundo intento (mismo comando) y la funcionalidad se verificó
    exitosamente ahí. Posible fluke del entorno de desarrollo (Windows/
    Git Bash) más que un bug del código; queda anotado por transparencia,
    no se investigó a fondo porque no volvió a ocurrir y no bloqueó la
    verificación.
  - Sigue pendiente de Fase 8: auditoría avanzada (UI), API pública,
    franquicias, visión avanzada — ver §10.2.
- 2026-07-05: Fase 8 (Enterprise) — auditoría avanzada.
  - **`audit.rs`** (nuevo): `list(conn, entity, limit)` (filtra por
    entidad, ej. `customer`) y `verify_chain(conn)` — recorre TODA la
    cadena desde `seq=1`, recomputando cada `hash` con el mismo algoritmo
    exacto que `sync::audit_log_write` (`sha256(prev_hash + action +
    entity_id + before_json + after_json)`) y comparando contra lo
    guardado; si algo no cuadra (alguien editó/borró una fila de
    `audit_log` directamente en SQLite, sin pasar por el código), lo
    detecta y devuelve en qué `seq` se rompió y por qué. No es solo "la
    tabla existe" — es la misma garantía que ya tenía la cadena de
    `sales`, aplicada a la bitácora general.
  - Rutas `GET /audit-log` (con `?entity=`) y `GET /audit-log/verify`.
    `AuditoriaPanel.tsx`: tabla de eventos (fecha/acción/entidad/origen) +
    botón "Verificar integridad de la cadena" que llama al endpoint y
    muestra "Cadena íntegra (N registros)" o el punto exacto de ruptura.
  - Verificado: `cargo test` 17/17 (nuevo
    `auditoria_lista_y_detecta_manipulacion_de_la_cadena`: genera un
    conflicto LWW real, confirma que `verify_chain` da `valid=true`,
    manipula una fila directamente con SQL crudo — bypaseando todo el
    código — y confirma que `verify_chain` ahora da `valid=false` con el
    `seq` exacto), `npm test` 23/23, typecheck/build limpios. Contra el
    binario real: cliente creado, se le empujó un evento de sync
    deliberadamente viejo (HLC mínimo) vía `POST /sync/push` — perdió el
    LWW como se esperaba (el nombre real no se sobreescribió), y el
    intento perdedor quedó trazado en `audit_log`; `verify_chain` reportó
    la cadena íntegra antes y después (un conflicto real trazado no es lo
    mismo que una manipulación — la cadena sigue siendo válida). Revisión
    visual con Playwright: la fila `sync.lww_overwrite` aparece en la
    tabla y el botón de integridad muestra "Cadena íntegra" contra datos
    reales del hub corriendo.
  - Sigue pendiente de Fase 8: API pública, franquicias, visión avanzada
    — ver §10.2.
