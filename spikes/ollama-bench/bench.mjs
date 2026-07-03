// Benchmark limpio contra la API HTTP de Ollama (evita el ruido ANSI de `ollama run`).
// Mide lo que importa para el diseño de tiers (PLAN.md §5): tokens/s en generación
// (eval rate) y tiempo hasta el primer token útil, en esta PC concreta.
import { writeFileSync } from "node:fs";

const OLLAMA = "http://127.0.0.1:11434";
const PROMPT_TEXTO =
  "Eres el copiloto de un dueño de restaurante. Con estos datos: " +
  "Tacos al pastor vendió 250 unidades con margen 62%, Quesadillas 180 con margen 55%, " +
  "Café 400 con margen 78%. Responde en máximo 3 líneas cuál platillo conviene promocionar y por qué.";

async function generate(model, prompt, extra = {}) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model, prompt, stream: false, ...extra }),
  });
  const body = await res.json();
  const wallMs = Date.now() - t0;
  return {
    model,
    wallMs,
    load_duration_ms: (body.load_duration ?? 0) / 1e6,
    prompt_eval_count: body.prompt_eval_count,
    prompt_eval_duration_ms: (body.prompt_eval_duration ?? 0) / 1e6,
    eval_count: body.eval_count,
    eval_duration_ms: (body.eval_duration ?? 0) / 1e6,
    tokens_per_second: body.eval_count && body.eval_duration ? +(body.eval_count / (body.eval_duration / 1e9)).toFixed(2) : null,
    response_preview: (body.response ?? "").slice(0, 120),
  };
}

async function main() {
  const results = [];

  console.log("Calentando qwen2.5:3b (carga en RAM, no se mide)...");
  await generate("qwen2.5:3b", "hola");

  console.log("Benchmark qwen2.5:3b (tier 8GB)...");
  results.push(await generate("qwen2.5:3b", PROMPT_TEXTO));

  console.log("Calentando qwen2.5:7b...");
  await generate("qwen2.5:7b", "hola");

  console.log("Benchmark qwen2.5:7b (tier 16GB)...");
  results.push(await generate("qwen2.5:7b", PROMPT_TEXTO));

  console.log("Benchmark nomic-embed-text (embeddings)...");
  const t0 = Date.now();
  const embRes = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    body: JSON.stringify({ model: "nomic-embed-text", prompt: "Tacos al pastor con cebolla y cilantro" }),
  });
  const embBody = await embRes.json();
  results.push({ model: "nomic-embed-text", wallMs: Date.now() - t0, dims: embBody.embedding?.length });

  console.log(JSON.stringify(results, null, 2));
  writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
