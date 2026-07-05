import { useEffect, useRef, useState } from "react";
import { OrderTicket } from "@ui/components/restaurant";
import { HubClient, type HubEvent } from "@infra/hub/hubClient";
import { cents } from "@domain/money";

interface ComandaItemKds {
  id: string;
  cantidad: number;
  nombre: string;
  estado: "pendiente" | "en_preparacion" | "listo" | "entregado";
  modificadores: { nombre: string }[];
  notas: string;
}

interface ComandaKds {
  orderId: string;
  mesa: number;
  items: ComandaItemKds[];
  sentAtMs: number;
}

/**
 * KDS: se conecta al hub como rol "kds" y renderiza las comandas reales
 * (persistidas en SQLite, Fase 6 §10.1) que le llegan en vivo. Un toque en un
 * platillo manda `bump_platillo` de verdad — dispara el descuento de
 * inventario por receta en el hub, no solo un cambio visual local.
 */
export function CocinaScreen({ hubUrl = "ws://localhost:5190/ws" }: { hubUrl?: string }) {
  const [comandas, setComandas] = useState<Record<string, ComandaKds>>({});
  const [conectado, setConectado] = useState(false);
  const clientRef = useRef<HubClient | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    function handleEvent(evt: HubEvent) {
      if (evt.cmd === "nueva_comanda") {
        const payload = evt.payload as {
          orderId: string;
          mesa: number;
          items: { orderItemId: string; nombre: string; cantidad: number; modificadores: { nombre: string }[]; notas: string | null; estado: string }[];
        };
        setComandas((prev) => {
          const existing = prev[payload.orderId];
          const nuevosItems: ComandaItemKds[] = payload.items.map((it) => ({
            id: it.orderItemId,
            cantidad: it.cantidad,
            nombre: it.nombre,
            estado: it.estado as ComandaItemKds["estado"],
            modificadores: it.modificadores,
            notas: it.notas ?? "",
          }));
          return {
            ...prev,
            [payload.orderId]: existing
              ? { ...existing, items: [...existing.items, ...nuevosItems] }
              : { orderId: payload.orderId, mesa: payload.mesa, items: nuevosItems, sentAtMs: evt.serverTime },
          };
        });
      } else if (evt.cmd === "bump_platillo") {
        const payload = evt.payload as { orderItemId: string; nextStatus: ComandaItemKds["estado"] };
        setComandas((prev) => {
          const next = { ...prev };
          for (const orderId of Object.keys(next)) {
            const c = next[orderId];
            if (c.items.some((it) => it.id === payload.orderItemId)) {
              next[orderId] = { ...c, items: c.items.map((it) => (it.id === payload.orderItemId ? { ...it, estado: payload.nextStatus } : it)) };
            }
          }
          return next;
        });
      }
    }

    const client = new HubClient({
      url: `${hubUrl}?role=kds&device=kds-1`,
      onHello: () => setConectado(true),
      onEvent: handleEvent,
    });
    clientRef.current = client;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000); // refresca segundos transcurridos
    return () => {
      client.close();
      clearInterval(timer);
    };
  }, [hubUrl]);

  function bump(itemId: string, estadoActual: ComandaItemKds["estado"]) {
    const nextStatus = estadoActual === "pendiente" ? "en_preparacion" : estadoActual === "en_preparacion" ? "listo" : "entregado";
    clientRef.current?.sendCommand("bump_platillo", { orderItemId: itemId, nextStatus });
  }

  const comandasActivas = Object.values(comandas).filter((c) => c.items.some((it) => it.estado !== "entregado"));

  return (
    <div className="min-h-screen bg-slate-950 p-4">
      <p className="mb-4 text-sm text-slate-400">{conectado ? "● Conectado al hub" : "○ Conectando…"}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {comandasActivas.map((c) => (
          <OrderTicket
            key={c.orderId}
            mesa={c.mesa}
            folio={c.orderId.slice(0, 8)}
            items={c.items.map((it) => ({
              id: it.id,
              menuItemId: it.id,
              nombre: it.nombre,
              tiempo: "fuerte",
              cantidad: it.cantidad,
              modificadores: it.modificadores.map((m, i) => ({ groupId: "", optionId: String(i), nombre: m.nombre, ajusteCents: cents(0) })),
              notas: it.notas,
              estado: it.estado,
              precioBaseCents: cents(0),
            }))}
            segundosTranscurridos={Math.max(0, Math.floor((Date.now() - c.sentAtMs) / 1000))}
            onBump={(itemId) => {
              const item = c.items.find((it) => it.id === itemId);
              if (item) bump(itemId, item.estado);
            }}
          />
        ))}
        {comandasActivas.length === 0 && <p className="text-slate-500">Sin comandas en cocina.</p>}
      </div>
    </div>
  );
}
