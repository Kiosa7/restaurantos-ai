import { Delete } from "lucide-react";
import { cn } from "@ui/lib/cn";

export interface NumPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Máximo de dígitos tras el punto decimal (2 para dinero). */
  decimals?: number;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/** Numpad táctil para cobro/arqueo/PIN. Sin dropdowns, targets ≥44px. */
export function NumPad({ value, onChange, decimals = 2 }: NumPadProps) {
  function press(key: (typeof KEYS)[number]) {
    if (key === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === "." && (value.includes(".") || decimals === 0)) return;
    const [, frac] = value.split(".");
    if (frac && frac.length >= decimals) return;
    onChange(value + key);
  }

  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Teclado numérico">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          aria-label={k === "back" ? "Borrar" : k}
          className={cn(
            "min-h-[var(--spacing-touch)] rounded-[var(--radius-field)] border border-slate-200 bg-white text-xl font-semibold text-slate-700",
            "transition-all active:scale-95 hover:bg-slate-50",
          )}
        >
          {k === "back" ? <Delete className="mx-auto h-5 w-5" aria-hidden /> : k}
        </button>
      ))}
    </div>
  );
}
