import { forwardRef } from "react";
import { cn } from "@ui/lib/cn";

type Variant = "ghost" | "outline" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  ghost:   "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
  outline: "border border-slate-200 text-slate-600 hover:bg-slate-100",
  danger:  "text-slate-300 hover:bg-danger-soft hover:text-danger",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-11 w-11", // 44px touch target
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Etiqueta accesible obligatoria: el botón no tiene texto visible. */
  label: string;
  icon: React.ElementType;
  variant?: Variant;
  size?: Size;
}

/** Botón de solo icono con `aria-label` obligatorio y target táctil. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, variant = "ghost", size = "md", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-field)]",
        "transition-colors active:scale-90 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      <Icon className={cn(size === "sm" ? "h-4 w-4" : "h-5 w-5")} aria-hidden />
    </button>
  );
});
