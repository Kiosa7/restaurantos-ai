# Asistente conversacional — Catálogo de Tools (restaurante)

> Complementa `~/pos-inteligente/docs/ai/tools-conversacional.md` (mismo
> patrón, mismo principio: **el LLM nunca escribe SQL**, solo elige una tool
> tipada; el hub ejecuta una vista de reporte ya escrita —
> `docs/db/migrations/0016`— e inyecta el resultado de vuelta). Aquí solo se
> documentan las tools NUEVAS, sobre el dominio restaurantero.

## Contrato de ejecución (implementado en `app/src-tauri/src/ai.rs`)

```
Usuario → POST /ai/chat {question} → Ollama (qwen2.5:7b) decide tool_call(s)
        → hub ejecuta la vista SQL (lock de BD breve, SIN await de por medio)
        → resultado JSON se manda de vuelta a Ollama como mensaje role="tool"
        → Ollama redacta la respuesta final en español
        → { answer, toolsUsadas: [...] } al cliente
```

**Regla de oro que este diseño protege**: la IA nunca bloquea el camino
crítico de una venta/comanda. El lock de SQLite (`Mutex<Connection>`) se
toma y suelta SOLO alrededor de la ejecución de la tool — nunca mientras se
espera la respuesta de red de Ollama (que puede tardar 1-3s+). Si se hiciera
al revés, una pregunta al asistente podría congelar el WS de mesero/KDS
mientras Ollama piensa.

## Catálogo de tools v1 (sin parámetros — el hub es mono-local en esta fase)

| Tool | Vista (0016) | Pregunta de negocio |
|---|---|---|
| `get_dish_margins` | `v_dish_sales_margin` | "¿qué platillo deja más/menos margen?" |
| `get_kitchen_queue` | `v_kitchen_queue` | "¿qué hay pendiente en cocina ahora?" |
| `get_dish_prep_time` | `v_dish_prep_time` | "¿qué platillo se tarda más en prepararse?" |
| `get_tables_status` | `v_tables_status` | "¿qué mesas están libres?" |
| `get_tips_by_shift` | `v_tips_by_shift` | "¿cómo van las propinas de los turnos?" |

Ninguna toma parámetros del usuario todavía (v1: son consultas de solo
lectura sobre el local completo). El filtrado por tenant/location que
`~/pos-inteligente/docs/ai/tools-conversacional.md` pide inyectar server-side
no aplica aún porque el hub es mono-tenant/mono-local en Fase 6 — se vuelve
relevante en Fase 8 (multi-sucursal), momento en el que estas tools deben
empezar a recibir `location_id` inyectado por el núcleo, nunca elegido por
el modelo.

## Modelo usado

`qwen2.5:7b` (mismo modelo validado en el spike 4, 22 tok/s en la PC de
referencia — ver `docs/spikes/spike-4-ollama-bench.md`). Es el mismo que
`pos-inteligente/app/src/infra/ollamaClient.ts` usa por default; no se portó
ese cliente TS tal cual porque el bucle de tool-calling debe vivir en el hub
(Rust), no en el navegador — ver razón en `app/src-tauri/src/ai.rs`.

## Pendiente (no bloquea Fase 6)

- Tools con parámetros (rango de fechas, `limit`, etc.) — v1 solo trae "lo
  de ahora"/"todo lo reciente" sin acotar.
- Permisos por tool (`docs/permisos-plugins.md`): hoy `POST /ai/chat` no
  valida qué rol pregunta — cualquier terminal con acceso al hub puede
  preguntar cualquier cosa. Debería exigir un permiso tipo `report.view`
  (mismo patrón que pos-inteligente con `cost.view`).
- Registro de conversación (`ai_chat_log` en pos-inteligente) — no existe
  todavía una tabla equivalente aquí; se pierde el historial entre reinicios.
- Modelos de visión/OCR (llava) para foto de platillo/factura de proveedor —
  quedan fuera de v1, son casos de uso de Fase 7 (compras con OCR).
