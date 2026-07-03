import { readFileSync, writeFileSync } from "node:fs";

const OLLAMA = "http://127.0.0.1:11434";
const imgPath = process.argv[2];
if (!imgPath) {
  console.error("uso: node bench-vision.mjs <ruta-imagen>");
  process.exit(1);
}
const b64 = readFileSync(imgPath).toString("base64");

async function main() {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    body: JSON.stringify({
      model: "llava:7b",
      prompt: "Describe brevemente qué se ve en esta imagen, en español, en una línea.",
      images: [b64],
      stream: false,
    }),
  });
  const body = await res.json();
  const result = {
    model: "llava:7b",
    wallMs: Date.now() - t0,
    load_duration_ms: (body.load_duration ?? 0) / 1e6,
    eval_count: body.eval_count,
    eval_duration_ms: (body.eval_duration ?? 0) / 1e6,
    tokens_per_second: body.eval_count && body.eval_duration ? +(body.eval_count / (body.eval_duration / 1e9)).toFixed(2) : null,
    response: body.response,
  };
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(new URL("./results-vision.json", import.meta.url), JSON.stringify(result, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
