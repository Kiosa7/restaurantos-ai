import { cn } from "@ui/lib/cn";

export interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: string;
  /** Acción principal opcional (ej. un <Button/>). */
  action?: React.ReactNode;
  className?: string;
}

/** Estado vacío unificado: mismo lenguaje para "sin resultados / sin datos". */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100">
          <Icon className="h-6 w-6 text-slate-400" aria-hidden />
        </div>
      )}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-xs text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
