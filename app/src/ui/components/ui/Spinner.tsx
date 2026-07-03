import { Loader2 } from "lucide-react";
import { cn } from "@ui/lib/cn";

export interface SpinnerProps {
  className?: string;
  /** Texto para lectores de pantalla (por defecto "Cargando"). */
  label?: string;
}

export function Spinner({ className, label = "Cargando" }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <Loader2 className={cn("h-5 w-5 animate-spin text-brand", className)} aria-hidden />
    </span>
  );
}
