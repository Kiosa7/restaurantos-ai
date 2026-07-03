/**
 * Cliente del protocolo LAN validado en spike 1 y portado a Rust en Fase 5
 * (docs/spikes/spike-1-multiterminal.md, docs/spikes/spike-5-hub-rust.md).
 * Cola local idempotente: cada comando se reintenta con el MISMO uuid hasta
 * recibir su ack (PLAN.md §4 "cola local idempotente en la PWA de mesero").
 */
import { uuidv7 } from "@domain/ids";

export type HubEvent = {
  id: string;
  cmd: string;
  payload: unknown;
  serverTime: number;
  causedBy: string;
  index: number;
};

export interface HubClientOptions {
  url: string; // ej. ws://localhost:5190/ws?role=mesero&device=tablet-1
  onEvent: (evt: HubEvent) => void;
  onHello?: (serverTime: number) => void;
  retryMs?: number;
}

export class HubClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { cmd: string; payload: unknown }>();
  private lastSeenIndex = -1;
  private closedByUser = false;

  constructor(private opts: HubClientOptions) {
    this.connect();
  }

  private connect() {
    const url = new URL(this.opts.url);
    url.searchParams.set("since_index", String(this.lastSeenIndex));
    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.onmessage = (raw) => {
      const msg = JSON.parse(raw.data as string);
      if (msg.type === "hello") {
        this.opts.onHello?.(msg.serverTime);
        this.flushPending();
      } else if (msg.type === "event") {
        if (typeof msg.index === "number") this.lastSeenIndex = Math.max(this.lastSeenIndex, msg.index);
        this.opts.onEvent(msg as HubEvent);
      } else if (msg.type === "ack" && msg.status === "ok") {
        this.pending.delete(msg.id);
      }
      // status "duplicate" también limpia el pendiente: el hub ya lo procesó antes.
      if (msg.type === "ack" && msg.status === "duplicate") this.pending.delete(msg.id);
    };

    ws.onclose = () => {
      if (this.closedByUser) return;
      setTimeout(() => this.connect(), this.opts.retryMs ?? 1000);
    };
  }

  private flushPending() {
    for (const [id, { cmd, payload }] of this.pending) {
      this.send(id, cmd, payload);
    }
  }

  private send(id: string, cmd: string, payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "cmd", id, cmd, payload }));
    }
  }

  /** Encola un comando con UUID propio; se reintenta solo hasta recibir ack. */
  sendCommand(cmd: string, payload: unknown): string {
    const id = uuidv7();
    this.pending.set(id, { cmd, payload });
    this.send(id, cmd, payload);
    return id;
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
