import { cn } from "@ui/lib/cn";
import type { Tiempo } from "@domain/menu";

const ORDEN: Tiempo[] = ["entrada", "fuerte", "postre"];
const LABEL: Record<Tiempo, string> = { entrada: "Entrada", fuerte: "Fuerte", postre: "Postre", bebida: "Bebida" };

export interface CourseTimelineProps {
  /** Tiempo actualmente en servicio (el próximo a enviar/servir). */
  tiempoActual: Tiempo;
  /** Tiempos que ya se enviaron a cocina. */
  enviados: Tiempo[];
}

/** Línea de tiempo entrada→fuerte→postre; guía al mesero sobre cuándo enviar el siguiente tiempo. */
export function CourseTimeline({ tiempoActual, enviados }: CourseTimelineProps) {
  return (
    <ol className="flex items-center gap-2" aria-label="Tiempos del servicio">
      {ORDEN.map((tiempo, i) => {
        const enviado = enviados.includes(tiempo);
        const actual = tiempo === tiempoActual;
        return (
          <li key={tiempo} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 items-center rounded-full px-3 text-xs font-semibold",
                enviado && "bg-success-soft text-success",
                actual && !enviado && "bg-brand-soft text-brand ring-2 ring-brand",
                !enviado && !actual && "bg-slate-100 text-slate-400",
              )}
              aria-current={actual ? "step" : undefined}
            >
              {LABEL[tiempo]}
            </div>
            {i < ORDEN.length - 1 && <div className="h-px w-4 bg-slate-200" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
