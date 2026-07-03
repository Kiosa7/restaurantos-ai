import { useState } from "react";
import { cn } from "@ui/lib/cn";
import { formatMoney } from "@domain/money";
import type { ModifierGroup } from "@domain/menu";

export interface ModifierPickerProps {
  menuItemNombre: string;
  groups: ModifierGroup[];
  /** Se dispara automáticamente al completar el último grupo REQUERIDO (sin botón de "confirmar" aparte). */
  onComplete: (chosenOptionIdByGroup: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Botones grandes, nunca dropdowns (PLAN.md §6). Al elegir la opción del
 * último grupo requerido pendiente, confirma solo — esto es lo que mantiene
 * el flujo en ≤ 3 toques (ver app/src/ui/flows/comandaFlow.ts).
 */
export function ModifierPicker({ menuItemNombre, groups, onComplete, onCancel }: ModifierPickerProps) {
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const requeridos = groups.filter((g) => g.requerido);
  const faltantes = requeridos.filter((g) => !chosen[g.id]);

  function choose(group: ModifierGroup, optionId: string) {
    const next = { ...chosen, [group.id]: optionId };
    setChosen(next);
    const aunFaltan = requeridos.filter((g) => !next[g.id]);
    if (aunFaltan.length === 0) onComplete(next);
  }

  return (
    <div className="flex flex-col gap-5" role="group" aria-label={`Modificadores de ${menuItemNombre}`}>
      <h3 className="text-lg font-semibold text-slate-800">{menuItemNombre}</h3>
      {groups.map((group) => (
        <div key={group.id}>
          <p className="mb-2 text-sm font-medium text-slate-600">
            {group.nombre}
            {group.requerido && <span className="text-danger"> *</span>}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.opciones.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => choose(group, opt.id)}
                className={cn(
                  "min-h-[var(--spacing-touch)] rounded-[var(--radius-field)] border-2 px-3 text-sm font-semibold transition-all active:scale-95",
                  chosen[group.id] === opt.id
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {opt.nombre}
                {opt.ajusteCents !== 0 && (
                  <span className="ml-1 text-xs opacity-70">
                    {opt.ajusteCents > 0 ? "+" : ""}
                    {formatMoney(opt.ajusteCents)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
      {faltantes.length === 0 && groups.length > 0 && (
        <p className="text-xs text-success">Todo listo, agregando…</p>
      )}
      <button type="button" onClick={onCancel} className="self-start text-sm text-slate-500 underline">
        Cancelar
      </button>
    </div>
  );
}
