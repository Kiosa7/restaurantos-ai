# Spike 4 — Benchmark Ollama CPU

**Estado: ✅ VERDE.** Medido en la PC de desarrollo (no es la PC objetivo del
restaurante piloto — ese sigue ⛔ pendiente de identificar). Scripts en
`spikes/ollama-bench/` (`node bench.mjs`, `node bench-vision.mjs <img>`).

## Hardware de referencia (esta máquina)

AMD Ryzen 5 8645HS (6 núcleos / 12 hilos), 24 GB RAM, iGPU Radeon 760M (Ollama
corrió en modo CPU — no se configuró backend Vulkan/ROCm). Es un proxy
razonable del "tier 16 GB" del ADR-2; falta medir en una máquina de 8 GB real
antes de fijar el umbral bajo con datos duros (⛔ no hay esa PC disponible).

## Resultados (prompt de negocio real: "qué platillo promocionar dado
ventas+margen", ~114 tokens de entrada)

| Modelo | Carga (frío) | Prompt eval | Generación | **Tokens/s** |
|---|---|---|---|---|
| `qwen2.5:3b` (tier 8 GB) | 204 ms (ya cacheado en RAM) | 60 ms / 114 tok | 1.2 s / 61 tok | **50.4 tok/s** |
| `qwen2.5:7b` (tier 16 GB) | 239 ms (ya cacheado) | 149 ms / 114 tok | 2.4 s / 53 tok | **22.1 tok/s** |
| `nomic-embed-text` | — | — | 22.7 s primera llamada (carga de modelo) | 768 dims |
| `llava:7b` (visión, 1 imagen) | 18.0 s | — | 4.9 s / 111 tok | 22.6 tok/s, **51.2 s pared a pared** |

## Lectura para los umbrales de tier (PLAN.md §5)

- **Ambos modelos de texto son perfectamente usables para el asistente
  conversacional** en esta clase de hardware: una respuesta de ~60 tokens
  tarda 1.2–2.4 s una vez el modelo está caliente en RAM. Confirma la regla
  de oro "la IA nunca en el camino crítico de venta/comanda" es suficiente
  cautela — no hace falta más, el chat se siente instantáneo.
- **`llava:7b` confirma la advertencia del PLAN**: ~30–60 s por imagen
  (aquí 51 s, dominado por 18 s de carga en frío + tiempo de visión). Esto
  **valida la decisión de diseño** "OCR de facturas y visión SOLO en flujos
  asíncronos" — no debe haber ningún botón que bloquee la UI esperando a
  `llava`.
- **`keep_alive` importa mucho**: la carga en frío de `llava:7b` (18 s) es
  ~40× más lenta que la de los modelos de texto ya cacheados (200 ms). Fase 5
  debe mantener `qwen2.5` residente (`keep_alive: -1` o similar) y cargar
  `llava`/`nomic-embed-text` solo bajo demanda con `keep_alive` corto, tal
  como ya anticipaba el PLAN §5.
- **Embeddings**: 22.7 s en la primera llamada es carga de modelo, no
  throughput real — para búsqueda semántica en producción hay que
  pre-calentar `nomic-embed-text` al iniciar el hub, no calcularlo on-demand
  la primera vez que un mesero pregunta algo.

## DECISIÓN AUTÓNOMA: umbrales de tier confirmados, con una advertencia

Se mantienen los tiers del PLAN (`qwen2.5:3b` en 8 GB, `qwen2.5:7b` en 16 GB)
sin cambios — el spike no encontró motivo para revisarlos. La advertencia:
esta PC (24 GB, 12 hilos) es más potente que el piso del ADR-2 ("PC modesta
sin GPU, 8–16 GB"); estos números son un **techo optimista**, no el peor caso.
Antes de prometerle al restaurante piloto tiempos de respuesta, repetir este
mismo `bench.mjs` en hardware de 8 GB / 4 núcleos real (⛔ no disponible aún).

## Pendiente

- Repetir en una PC de 8 GB reales (el "peor caso" del ADR-2) — ⛔ no hay una
  disponible en este momento.
- Medir con la cola de prioridad real de Fase 5 bajo carga concurrente
  (varias tablets pidiendo al asistente a la vez mientras entran comandas) —
  este spike solo midió una petición aislada.
