import { cn } from "@ui/lib/cn";
import { formatMoney, mul, type Cents } from "@domain/money";

export interface TipSelectorProps {
  totalCents: Cents;
  options?: number[];
  value: number | "otro" | null;
  onChange: (pct: number | "otro") => void;
}

/** Propina sugerida sobre el total; NO se suma automáticamente (no gravada, ADR-3). */
export function TipSelector({ totalCents, options = [10, 15, 20], value, onChange }: TipSelectorProps) {
  return (
    <div className="flex gap-2" role="group" aria-label="Selector de propina">
      {options.map((pct) => (
        <button
          key={pct}
          type="button"
          onClick={() => onChange(pct)}
          className={cn(
            "flex min-h-[var(--spacing-touch)] flex-1 flex-col items-center justify-center rounded-[var(--radius-field)] border-2 font-semibold transition-all active:scale-95",
            value === pct ? "border-brand bg-brand-soft text-brand" : "border-slate-200 bg-white text-slate-700",
          )}
        >
          <span>{pct}%</span>
          <span className="text-xs opacity-70">{formatMoney(mul(totalCents, pct / 100))}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange("otro")}
        className={cn(
          "min-h-[var(--spacing-touch)] flex-1 rounded-[var(--radius-field)] border-2 font-semibold transition-all active:scale-95",
          value === "otro" ? "border-brand bg-brand-soft text-brand" : "border-slate-200 bg-white text-slate-700",
        )}
      >
        Otro
      </button>
    </div>
  );
}
