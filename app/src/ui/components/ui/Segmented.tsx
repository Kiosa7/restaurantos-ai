import { cn } from "@ui/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ElementType;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Etiqueta accesible del grupo. */
  ariaLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Selector segmentado (toggle group) accesible por teclado. Reemplaza los
 * grupos de botones ad-hoc de método de pago / tipo de descuento / filtros.
 */
export function Segmented<T extends string>({
  value, onChange, options, ariaLabel, size = "md", className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex w-full gap-1 rounded-[var(--radius-field)] bg-slate-100 p-1", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-all",
              size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
              active ? "bg-white text-brand shadow-sm" : "text-slate-500 hover:text-slate-800",
              opt.disabled && "cursor-not-allowed opacity-40 hover:text-slate-500",
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
