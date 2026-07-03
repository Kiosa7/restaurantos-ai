import { cn } from "@ui/lib/cn";
import type { OrderItem } from "@domain/order";

export interface OrderTicketProps {
  mesa: number;
  folio: string;
  items: OrderItem[];
  /** Segundos transcurridos desde que se envió — SIEMPRE calculado contra el reloj del hub. */
  segundosTranscurridos: number;
  onBump: (itemId: string) => void;
}

function urgencia(segundos: number): "ok" | "atencion" | "urgente" {
  if (segundos < 5 * 60) return "ok";
  if (segundos < 12 * 60) return "atencion";
  return "urgente";
}

const BORDE: Record<ReturnType<typeof urgencia>, string> = {
  ok: "border-success",
  atencion: "border-warning",
  urgente: "border-danger",
};

/** Tarjeta del KDS: legible a 2 metros, un toque para pasar el ítem de estado. */
export function OrderTicket({ mesa, folio, items, segundosTranscurridos, onBump }: OrderTicketProps) {
  const nivel = urgencia(segundosTranscurridos);
  const minutos = Math.floor(segundosTranscurridos / 60);

  return (
    <article className={cn("rounded-[var(--radius-card)] border-4 bg-slate-900 p-4 text-white shadow-lg", BORDE[nivel])}>
      <header className="mb-3 flex items-baseline justify-between">
        <h3 className="text-3xl font-bold">Mesa {mesa}</h3>
        <span className="text-lg font-semibold">{minutos} min</span>
      </header>
      <p className="mb-2 text-sm text-slate-400">Comanda {folio}</p>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onBump(item.id)}
              className={cn(
                "w-full rounded-lg p-3 text-left transition-all active:scale-[0.98]",
                item.estado === "listo" ? "bg-success/20 line-through opacity-60" : "bg-white/10 hover:bg-white/20",
              )}
            >
              <span className="text-xl font-bold">{item.cantidad}× {item.nombre}</span>
              {item.modificadores.map((m) => (
                <div key={m.optionId} className="pl-6 text-base text-slate-300">+ {m.nombre}</div>
              ))}
              {item.notas && <div className="pl-6 text-base font-semibold text-warning">NOTA: {item.notas}</div>}
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}
