import { forwardRef, useId } from "react";
import { cn } from "@ui/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

/** Input base con foco de marca y estado de error. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full rounded-[var(--radius-field)] border bg-white px-3 py-2.5 text-sm text-slate-900",
        "outline-none transition-colors placeholder:text-slate-400",
        "focus:border-brand focus:ring-2 focus:ring-brand/20",
        invalid ? "border-danger focus:border-danger focus:ring-danger/20" : "border-slate-300",
        className,
      )}
      {...rest}
    />
  );
});

export interface FieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Recibe el id generado para enlazar label ↔ control. */
  children: (props: { id: string; invalid: boolean }) => React.ReactNode;
}

/**
 * Contenedor de formulario: etiqueta + control + ayuda/error, todo enlazado
 * por id/aria para accesibilidad. Unifica los formularios de las pantallas.
 */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const invalid = Boolean(error);
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {children({ id, invalid })}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
