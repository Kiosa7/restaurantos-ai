import { cn } from "@ui/lib/cn";

export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] border border-slate-200 bg-white",
        className,
      )}
      {...rest}
    />
  );
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  /** Texto secundario (ej. variación, contexto). */
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  className?: string;
}

const TONES = {
  default: "text-slate-900",
  success: "text-success",
  warning: "text-warning",
  danger:  "text-danger",
} as const;

/** Tarjeta de KPI reutilizable para Dashboard/Reportes/Inventario. */
export function StatCard({ label, value, icon: Icon, hint, tone = "default", className }: StatCardProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
      </div>
      <p className={cn("mt-2 text-2xl font-bold tabular-nums", TONES[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}
