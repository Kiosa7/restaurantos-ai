import { clsx, type ClassValue } from "clsx";

/** Combina clases condicionales. Usa clsx; compatible con Tailwind v4. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
