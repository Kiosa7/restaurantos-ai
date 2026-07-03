import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@ui/lib/cn";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:   "bg-brand text-white hover:bg-brand-hover shadow-sm",
  secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  outline:   "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  ghost:     "text-slate-600 hover:bg-slate-100",
  danger:    "bg-danger text-white hover:brightness-95 shadow-sm",
  success:   "bg-success text-white hover:brightness-95 shadow-sm",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 gap-1.5 px-3 text-sm rounded-[var(--radius-field)]",
  md: "min-h-[var(--spacing-touch)] gap-2 px-4 text-sm rounded-[var(--radius-field)]",
  lg: "min-h-[3.25rem] gap-2 px-5 text-base rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  /** Icono lucide a la izquierda del texto. */
  leftIcon?: React.ElementType;
  rightIcon?: React.ElementType;
}

/**
 * Botón base del Design System. Touch-first (target ≥44px en md/lg),
 * estado de carga accesible y foco visible. Sustituye a los ~90 botones
 * hand-styled dispersos por las pantallas.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, fullWidth, leftIcon: Left,
    rightIcon: Right, disabled, className, children, ...rest },
  ref,
) {
  const Icon = Left;
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-all",
        "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : (
        Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />
      )}
      {children}
      {!loading && Right && <Right className="h-4 w-4 shrink-0" aria-hidden />}
    </button>
  );
});
