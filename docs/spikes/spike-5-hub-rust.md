# Fase 5, nota técnica — Puerto del hub a Rust/axum (cumple lo prometido por el spike 1)

**Estado: ✅ protocolo verde en Rust real. 🟡 pairing es MVP. ⛔ empaquetado/updater sin ejercitar.**

El mini-informe del spike 1 (`docs/spikes/spike-1-multiterminal.md`) decía:
"la implementación Rust de la Fase 5 debe pasar el mismo `test.mjs` [...] así
el protocolo queda probado antes y después del port". Esto es exactamente lo
que se hizo.

## Qué se construyó

- `app/src-tauri/src/hub.rs`: mismo protocolo JSON por WebSocket que el
  prototipo Node (`hello`/`cmd`/`ack`/`event`, dedup por UUID, replay por
  `since_index`, `serverTime` autoritativo del hub), reimplementado en
  axum 0.7 + tokio, embebido en el proceso Tauri (decisión del spike 1: un
  solo exe, no sidecar).
- `app/src-tauri/tests/hub_test.rs`: puerto del `test.mjs` del spike 1 a
  `#[tokio::test]` con `tokio-tungstenite` como cliente — verifica las mismas
  4 propiedades (comando visible en <2s, dedup, replay tras reconexión,
  reloj del hub) contra el hub REAL, no un mock. **2/2 tests verdes.**
- Endpoint `POST /pair`: entrega un token de sesión de dispositivo (UUID).
  Es un placeholder de transporte — la política real (qué token es válido,
  contra qué rol/empleado, expiración) es Fase 6 cuando exista la pantalla de
  gestión de dispositivos.
- Servido de PWA estática: `router(state, pwa_dir)` monta `tower_http::ServeDir`
  como fallback — probado contra el build real de `app/dist`
  (`sirve_la_pwa_estatica_cuando_se_configura_el_directorio`, GET `/` devuelve
  el `index.html` real de RestaurantOS AI).

## Bug encontrado y corregido durante el port (documentado porque no era obvio)

El primer intento del port fallaba con timeout en el test — la causa real
tomó dos iteraciones encontrar:

1. `HubEvent` serializaba a `snake_case` (`server_time`, `caused_by`) por
   default de `serde`; el protocolo (y los clientes TS futuros) esperan
   `camelCase` (`serverTime`, `causedBy`) igual que el prototipo Node.
   Fix: `#[serde(rename_all = "camelCase")]`.
2. La difusión en vivo estaba usando el MISMO filtro que el replay
   (`kds` filtrado por comando, todo lo demás pasa). El spike 1 original usa
   dos reglas DISTINTAS: el **broadcast en vivo** solo llega a `kds`/`caja`
   (el mesero que originó el comando no se autoescucha), mientras el
   **replay** al reconectar es más permisivo (cualquier rol ve su historial,
   salvo que `kds` sigue filtrado por tipo de comando). Se separó en
   `live_routes_to_role` vs `replay_routes_to_role` para que el Rust
   reproduzca EXACTAMENTE la asimetría ya validada en Node, no una
   aproximación.

## Verificado

```
cd app/src-tauri
cargo build   # ~20s incremental, ~2min limpio (compila axum/tokio/tower-http nuevos)
cargo test    # 2/2 tests verdes: protocolo + PWA estática
```

## ⛔ Pendiente (no bloquea Fase 6, pero debe resolverse antes de un release real)

1. **Empaquetado real** (`npm run tauri build` → MSI/NSIS en Windows): NO se
   ejecutó en esta sesión. Requiere confirmar que WiX/NSIS estén disponibles
   en la máquina de build (más allá de lo que HANDOFF.md de pos-inteligente
   confirmó, que fue solo `cargo build`, no el bundler completo) y puede
   tomar varios minutos + espacio en disco adicional. Criterio de éxito de
   Fase 5 ("instalación limpia en PC virgen < 30 min") sigue sin validar.
2. **Auto-updater**: Tauri lo soporta pero necesita llaves de firma de
   actualización y un feed de releases — ninguno de los dos existe todavía;
   es una decisión de infraestructura del dueño (dónde se hostean los
   releases), no solo código.
3. **PWA en producción empaquetada**: hoy `RESTAURANTOS_PWA_DIR` se lee de
   una variable de entorno apuntando a una ruta de desarrollo (`../dist`).
   En producción, `dist/` debe registrarse como *resource* de Tauri y
   resolverse con `app.path().resource_dir()` — no una env var. Cambio
   pequeño pero no trivial de probar sin un build empaquetado real.
4. **Pairing real** (QR/PIN, expiración, ligar token→`employees`/rol): el
   endpoint `/pair` de hoy es un placeholder de transporte, ver arriba.
5. **Persistencia del hub**: `event_log`/`seen_command_ids` siguen en
   memoria (igual que el prototipo Node) — pasar a SQLite (tabla `events` +
   índice único en `id` de comando, mismo patrón que el outbox de
   pos-inteligente) es trabajo de Fase 6, no de este port.
