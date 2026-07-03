// Spike 1 — Hub multi-terminal LAN (prototipo de protocolo, no de runtime final).
// Objetivo: validar el PROTOCOLO (reconexión, dedup por UUID, reloj autoritativo
// del hub) independientemente de si la implementación final vive en Node o en
// Rust/axum embebido en Tauri. Ver docs/spikes/spike-1-multiterminal.md.

import http from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

export function createHub({ port = 0 } = {}) {
  // outbox in-memory: en producción esto es la tabla `events` + `outbox` de SQLite
  // (mismo patrón que pos-inteligente/docs/sync/protocolo.md).
  const seenCommandIds = new Set();
  const eventLog = []; // { id, cmd, payload, serverTime }
  const clients = new Map(); // ws -> { role, deviceId, lastSeenEventIndex }

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", serverTime: Date.now() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  function broadcast(event, predicate) {
    for (const [ws, meta] of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (predicate && !predicate(meta)) continue;
      ws.send(JSON.stringify({ type: "event", ...event }));
      meta.lastSeenEventIndex = eventLog.length - 1;
    }
  }

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, "http://hub");
    const role = url.searchParams.get("role") ?? "unknown";
    const deviceId = url.searchParams.get("device") ?? randomUUID();
    const meta = { role, deviceId, lastSeenEventIndex: -1 };
    clients.set(ws, meta);

    // Reloj autoritativo: el hub SIEMPRE manda su hora al conectar; el cliente
    // nunca debe confiar en su propio reloj para timers de cocina (ADR §4).
    ws.send(
      JSON.stringify({
        type: "hello",
        serverTime: Date.now(),
        minClientVersion: 1,
      }),
    );

    // Replay de eventos perdidos si el cliente indica desde dónde vio (reconexión).
    const since = Number(url.searchParams.get("since_index") ?? -1);
    if (since >= -1) {
      for (let i = since + 1; i < eventLog.length; i++) {
        const evt = eventLog[i];
        if (role === "kds" && evt.cmd !== "nueva_comanda" && evt.cmd !== "bump_platillo") continue;
        ws.send(JSON.stringify({ type: "event", ...evt, index: i }));
        meta.lastSeenEventIndex = i;
      }
    }

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== "cmd") return;

      const { id, cmd, payload } = msg;
      if (!id || !cmd) return;

      if (seenCommandIds.has(id)) {
        // Deduplicación por UUID: reintentos tras reconexión no duplican efecto.
        ws.send(JSON.stringify({ type: "ack", id, status: "duplicate" }));
        return;
      }
      seenCommandIds.add(id);

      const event = { id: randomUUID(), cmd, payload, serverTime: Date.now(), causedBy: id };
      eventLog.push(event);
      const index = eventLog.length - 1;

      ws.send(JSON.stringify({ type: "ack", id, status: "ok" }));

      // Enruta comandas nuevas y bumps a KDS; todo se difunde también a cajas.
      broadcast({ ...event, index }, (m) => m.role === "kds" || m.role === "caja");
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: address.port,
        server,
        wss,
        eventLog,
        clientCount: () => clients.size,
        close: () =>
          new Promise((r) => {
            wss.close(() => server.close(() => r()));
          }),
      });
    });
  });
}
