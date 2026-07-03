import { cn } from "@ui/lib/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  brand:   "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger:  "bg-danger-soft text-danger",
  info:    "bg-info-soft text-info",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Muestra un punto de estado a la izquierda. */
  dot?: boolean;
}

/** Etiqueta de estado. Nunca depende solo del color: acepta texto e icono. */
export function Badge({ tone = "neutral", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
