import { cn } from "@ui/lib/cn";

export type TableStatus = "libre" | "ocupada" | "por_limpiar" | "reservada";

export interface FloorTable {
  id: string;
  numero: number;
  estado: TableStatus;
  capacidad: number;
}

const ESTADO_STYLES: Record<TableStatus, string> = {
  libre: "bg-success-soft border-success text-success",
  ocupada: "bg-brand-soft border-brand text-brand",
  por_limpiar: "bg-warning-soft border-warning text-warning",
  reservada: "bg-info-soft border-info text-info",
};

const ESTADO_LABEL: Record<TableStatus, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  por_limpiar: "Por limpiar",
  reservada: "Reservada",
};

export interface FloorPlanProps {
  tables: FloorTable[];
  onSelect: (table: FloorTable) => void;
  selectedTableId?: string;
}

/** Plano de mesas: grid táctil, color por estado. Un toque abre/retoma la mesa. */
export function FloorPlan({ tables, onSelect, selectedTableId }: FloorPlanProps) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5" role="list" aria-label="Plano de mesas">
      {tables.map((t) => (
        <button
          key={t.id}
          type="button"
          role="listitem"
          onClick={() => onSelect(t)}
          aria-pressed={t.id === selectedTableId}
          className={cn(
            "flex aspect-square flex-col items-center justify-center rounded-[var(--radius-card)] border-2 font-semibold transition-all active:scale-95",
            ESTADO_STYLES[t.estado],
            t.id === selectedTableId && "ring-2 ring-brand ring-offset-2",
          )}
        >
          <span className="text-2xl">{t.numero}</span>
          <span className="text-xs font-normal opacity-80">{ESTADO_LABEL[t.estado]}</span>
          <span className="text-[0.65rem] opacity-60">{t.capacidad}p</span>
        </button>
      ))}
    </div>
  );
}
