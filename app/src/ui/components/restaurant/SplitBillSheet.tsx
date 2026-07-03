import { useState } from "react";
import { cn } from "@ui/lib/cn";
import { formatMoney, mul, type Cents } from "@domain/money";

export type SplitMode = "completo" | "partes_iguales" | "por_comensal";

export interface SplitBillSheetProps {
  totalCents: Cents;
  onConfirm: (mode: SplitMode, partes: number) => void;
}

const MODOS: { id: SplitMode; label: string }[] = [
  { id: "completo", label: "Cuenta completa" },
  { id: "partes_iguales", label: "Partes iguales" },
  { id: "por_comensal", label: "Por comensal" },
];

/** División de cuenta: completo, partes iguales, o por comensal (PLAN.md §6). */
export function SplitBillSheet({ totalCents, onConfirm }: SplitBillSheetProps) {
  const [mode, setMode] = useState<SplitMode>("completo");
  const [partes, setPartes] = useState(2);

  const montoPorParte = mode === "completo" ? totalCents : mul(totalCents, 1 / partes);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Modo de división">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              "min-h-[var(--spacing-touch)] rounded-[var(--radius-field)] border-2 px-2 text-sm font-semibold transition-all active:scale-95",
              mode === m.id ? "border-brand bg-brand-soft text-brand" : "border-slate-200 bg-white text-slate-700",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode !== "completo" && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">Entre</span>
          <button
            type="button"
            onClick={() => setPartes((p) => Math.max(2, p - 1))}
            className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold"
            aria-label="Menos partes"
          >
            −
          </button>
          <span className="w-8 text-center text-lg font-bold">{partes}</span>
          <button
            type="button"
            onClick={() => setPartes((p) => p + 1)}
            className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold"
            aria-label="Más partes"
          >
            +
          </button>
        </div>
      )}

      <p className="text-lg font-semibold text-slate-800">
        {mode === "completo" ? "Total: " : `Cada parte: `}
        {formatMoney(montoPorParte)}
      </p>

      <button
        type="button"
        onClick={() => onConfirm(mode, mode === "completo" ? 1 : partes)}
        className="min-h-[var(--spacing-touch)] rounded-[var(--radius-field)] bg-brand font-semibold text-white active:scale-95"
      >
        Cobrar
      </button>
    </div>
  );
}
