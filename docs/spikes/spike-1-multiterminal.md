# Spike 1 — Multi-terminal LAN (hub + WebSocket)

**Estado: ✅ VERDE.** Prototipo y test automatizado en `spikes/multiterminal/`
(`node test.mjs`, sin dependencias más allá de `ws`).

## Objetivo

Validar el riesgo "dos meseros, misma mesa" y la viabilidad de ADR-5 (hub +
PWA delgadas) antes de comprometer el diseño de infraestructura de la Fase 5.

## Qué se probó

Un hub HTTP+WS mínimo, un cliente "mesero" y un cliente "KDS" simulados con
`ws` en Node. Cuatro propiedades, las cuatro en verde:

| Propiedad | Resultado |
|---|---|
| Comando idempotente visible en KDS | **0 ms** en loopback (umbral pedido: < 1000 ms) |
| Deduplicación por UUID | reenviar el mismo `id` de comando NO genera un segundo evento; el hub responde `duplicate` |
| Replay tras reconexión | un KDS que estaba desconectado cuando se creó una comanda la recibe completa al reconectar, pasando `since_index` |
| Reloj autoritativo del hub | cada evento lleva `serverTime` puesto por el hub; el cliente no puede inyectar su propia hora |

## Diseño del protocolo (el artefacto real de este spike)

- **Comando** (cliente→hub): `{ type:"cmd", id:<uuid>, cmd, payload }`. El `id`
  lo genera el cliente al crear la acción (no al enviarla) y se reintenta con
  el MISMO id hasta recibir `ack`. Esto es lo que vuelve segura la cola local
  idempotente de la PWA de mesero mencionada en PLAN.md §4.
- **Ack** (hub→emisor): `{ type:"ack", id, status: "ok"|"duplicate" }`.
- **Evento** (hub→suscriptores): `{ type:"event", id, cmd, payload, serverTime, causedBy, index }`.
  `index` es la posición en el log del hub — permite a un cliente reconectado
  decir "vi hasta index N" (`?since_index=N`) y recibir solo lo que le falta.
- **Hello** (hub→cliente al conectar): `{ type:"hello", serverTime, minClientVersion }`.
  Aquí es donde se resuelve el "contrato hub↔PWA versionado" del PLAN: si el
  cliente detecta `minClientVersion` mayor al suyo, se auto-recarga.
- **Enrutamiento por rol**: el hub filtra qué eventos difunde a cada rol
  (`kds` solo ve `nueva_comanda`/`bump_platillo`; `caja` lo ve todo). Esto es
  lo que en producción evita que el KDS reciba tráfico irrelevante (cortes de
  caja, ediciones de menú, etc.).

## Decisión que este spike debía resolver: ¿runtime del hub?

**Rust/axum embebido en el proceso Tauri**, no un sidecar Node.

Razones (criterio pedido: simplicidad de despliegue en 1 solo exe):
- El shell Tauri de `pos-inteligente` ya compila con Rust 1.96 + VS2022 en esta
  máquina (`~/pos-inteligente/app/src-tauri`, `cargo build` ~4 min) — no hay
  que instalar un segundo runtime.
- Un sidecar Node duplica el proceso, complica el instalador (dos binarios que
  versionar juntos) y complica el "restore < 15 min" del riesgo de Fase 8 del
  PLAN (§8: "Hub cae en pleno servicio").
- axum + `tokio-tungstenite` implementan el mismo protocolo verbatim (JSON por
  WS, sin RPC binario) — nada de lo validado aquí es Node-específico.

**Lo que este prototipo Node SÍ es:** la referencia ejecutable del protocolo.
La implementación Rust de la Fase 5 debe pasar el mismo `test.mjs` apuntando
a `ws://127.0.0.1:<puerto-rust>/ws` (basta con no importar `createHub` y usar
el hub real) — así el protocolo queda probado antes y después del port.

## Pendiente para la Fase 5 (no bloquea Fase 2)

- Persistir `eventLog` y `seenCommandIds` en SQLite (tabla `events` + índice
  único en `id` de comando) en vez de memoria — mismo patrón que el outbox de
  `pos-inteligente/docs/sync/protocolo.md`.
- Pairing por token/QR (mencionado en PLAN §4) — no se prototipó aquí, es
  ortogonal al protocolo de eventos.
- Reconexión real con backoff exponencial en el cliente (aquí se simuló con
  una reconexión inmediata manual).

## Cómo reproducir

```bash
cd spikes/multiterminal
npm install   # ya vendorizado en package-lock.json
node test.mjs
```
