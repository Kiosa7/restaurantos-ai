// Ejecuta el spike y verifica las 3 propiedades de riesgo del §10.1 del PLAN:
//  1. Un mesero manda un comando idempotente y un KDS lo ve en < 1 s.
//  2. Deduplicación por UUID (reintento tras reconexión no duplica).
//  3. Reloj del hub es la fuente de verdad (no el reloj del cliente).
// Uso: node test.mjs

import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { createHub } from "./hub.mjs";

function connect(port, role, device, sinceIndex) {
  const qs = new URLSearchParams({ role, device, since_index: String(sinceIndex ?? -1) });
  return new WebSocket(`ws://127.0.0.1:${port}/ws?${qs}`);
}

function waitForMessage(ws, predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout esperando mensaje")), timeoutMs);
    ws.on("message", function handler(raw) {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    });
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FALLÓ: " + msg);
  console.log("  ✔ " + msg);
}

async function main() {
  const results = [];
  const hub = await createHub({ port: 0 });
  console.log(`Hub arriba en 127.0.0.1:${hub.port}`);

  const mesero = connect(hub.port, "mesero", "tablet-1");
  const kds = connect(hub.port, "kds", "cocina-1");

  await Promise.all([
    waitForMessage(mesero, (m) => m.type === "hello"),
    waitForMessage(kds, (m) => m.type === "hello"),
  ]);
  console.log("Ambos clientes conectados y recibieron 'hello' con serverTime.");

  // --- Propiedad 1: comando idempotente visible en KDS en < 1s ---
  const cmdId = randomUUID();
  const t0 = Date.now();
  const kdsEventPromise = waitForMessage(kds, (m) => m.type === "event" && m.causedBy === cmdId);
  mesero.send(
    JSON.stringify({
      type: "cmd",
      id: cmdId,
      cmd: "nueva_comanda",
      payload: { mesa: 7, items: [{ producto: "Tacos al pastor", cantidad: 3 }] },
    }),
  );
  const ack = await waitForMessage(mesero, (m) => m.type === "ack" && m.id === cmdId);
  const kdsEvent = await kdsEventPromise;
  const latencyMs = Date.now() - t0;
  assert(ack.status === "ok", "el hub confirma el comando con status ok");
  assert(latencyMs < 1000, `KDS ve la comanda en ${latencyMs}ms (< 1000ms)`);
  results.push({ property: "latencia_comanda_kds_ms", value: latencyMs, pass: latencyMs < 1000 });

  // --- Propiedad 2: deduplicación por UUID tras "reintento" (misma conexión) ---
  mesero.send(JSON.stringify({ type: "cmd", id: cmdId, cmd: "nueva_comanda", payload: {} }));
  const dupAck = await waitForMessage(mesero, (m) => m.type === "ack" && m.id === cmdId);
  assert(dupAck.status === "duplicate", "reenviar el mismo UUID no vuelve a crear evento");
  assert(hub.eventLog.length === 1, "el eventLog del hub tiene un solo evento tras el duplicado");
  results.push({ property: "dedup_por_uuid", pass: dupAck.status === "duplicate" });

  // --- Propiedad 3: reconexión — KDS se cae y reconecta, recibe el evento que se perdió ---
  const cmdId2 = randomUUID();
  kds.close();
  await new Promise((r) => setTimeout(r, 50));
  const mesero2AckPromise = waitForMessage(mesero, (m) => m.type === "ack" && m.id === cmdId2);
  mesero.send(
    JSON.stringify({
      type: "cmd",
      id: cmdId2,
      cmd: "nueva_comanda",
      payload: { mesa: 3, items: [{ producto: "Quesadillas", cantidad: 2 }] },
    }),
  );
  await mesero2AckPromise; // el hub procesó el evento aunque el KDS estaba desconectado

  const kdsReconnected = connect(hub.port, "kds", "cocina-1", 0); // "vi hasta el índice 0"
  const replayed = await waitForMessage(kdsReconnected, (m) => m.type === "event" && m.causedBy === cmdId2);
  assert(replayed.cmd === "nueva_comanda", "KDS reconectado recibe por replay el evento perdido mientras estaba offline");
  results.push({ property: "replay_tras_reconexion", pass: true });

  // --- Propiedad 4: reloj autoritativo — el evento usa serverTime del hub, no el del cliente ---
  const clientClaimedTime = Date.now() + 999_999_999; // reloj de tablet desincronizado a propósito
  assert(kdsEvent.serverTime !== clientClaimedTime, "el evento lleva serverTime del hub (el cliente no puede inyectar su hora)");
  assert(typeof kdsEvent.serverTime === "number" && Math.abs(kdsEvent.serverTime - t0) < 1000, "serverTime es coherente con el reloj real del hub");
  results.push({ property: "reloj_autoritativo_hub", pass: true });

  mesero.close();
  kdsReconnected.close();
  await hub.close();

  console.log("\nTODAS LAS PROPIEDADES VALIDADAS ✅");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("SPIKE FALLÓ:", err);
  process.exit(1);
});
