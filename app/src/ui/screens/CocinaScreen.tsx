import { useEffect, useRef, useState } from "react";
import { OrderTicket } from "@ui/components/restaurant";
import { HubClient, type HubEvent } from "@infra/hub/hubClient";
import { cents } from "@domain/money";

interface ComandaKds {
  mesa: number;
  folio: string;
  items: { id: string; cantidad: number; nombre: string; estado: "pendiente" | "listo"; modificadores: never[]; notas: string }[];
  sentAtMs: number;
}

/** KDS: se conecta al hub como rol "kds" y renderiza las comandas que le llegan en vivo. */
export function CocinaScreen({ hubUrl = "ws://localhost:5190/ws" }: { hubUrl?: string }) {
  const [comandas, setComandas] = useState<Record<string, ComandaKds>>({});
  const [conectado, setConectado] = useState(false);
  const clientRef = useRef<HubClient | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const client = new HubClient({
      url: `${hubUrl}?role=kds&device=kds-1`,
      onHello: () => setConectado(true),
      onEvent: (evt: HubEvent) => {
        if (evt.cmd !== "nueva_comanda") return;
        const payload = evt.payload as { mesa: number; items: { producto: string; cantidad: number }[] };
        setComandas((prev) => ({
          ...prev,
          [evt.id]: {
            mesa: payload.mesa,
            folio: evt.id.slice(0, 8),
            items: payload.items.map((it, i) => ({
              id: `${evt.id}_${i}`,
              cantidad: it.cantidad,
              nombre: it.producto,
              estado: "pendiente",
              modificadores: [],
              notas: "",
            })),
            sentAtMs: evt.serverTime,
          },
        }));
      },
    });
    clientRef.current = client;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000); // refresca segundos transcurridos
    return () => {
      client.close();
      clearInterval(timer);
    };
  }, [hubUrl]);

  function bump(comandaEventId: string, itemId: string) {
    setComandas((prev) => {
      const c = prev[comandaEventId];
      if (!c) return prev;
      return {
        ...prev,
        [comandaEventId]: {
          ...c,
          items: c.items.map((it) => (it.id === itemId ? { ...it, estado: it.estado === "pendiente" ? "listo" : "pendiente" } : it)),
        },
      };
    });
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4">
      <p className="mb-4 text-sm text-slate-400">{conectado ? "● Conectado al hub" : "○ Conectando…"}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(comandas).map(([eventId, c]) => (
          <OrderTicket
            key={eventId}
            mesa={c.mesa}
            folio={c.folio}
            items={c.items.map((it) => ({
              id: it.id,
              menuItemId: it.id,
              nombre: it.nombre,
              tiempo: "fuerte",
              cantidad: it.cantidad,
              modificadores: [],
              notas: it.notas,
              estado: it.estado,
              precioBaseCents: cents(0),
            }))}
            segundosTranscurridos={Math.max(0, Math.floor((Date.now() - c.sentAtMs) / 1000))}
            onBump={(itemId) => bump(eventId, itemId)}
          />
        ))}
        {Object.keys(comandas).length === 0 && <p className="text-slate-500">Sin comandas en cocina.</p>}
      </div>
    </div>
  );
}
