import type { Cents } from "./money";

export type Tiempo = "entrada" | "fuerte" | "postre" | "bebida";

export interface ModifierOption {
  id: string;
  nombre: string;
  /** Ajuste de precio: positivo, negativo o cero. */
  ajusteCents: Cents;
}

export interface ModifierGroup {
  id: string;
  nombre: string;
  seleccionUnica: boolean;
  requerido: boolean;
  opciones: ModifierOption[];
}

export interface MenuItem {
  id: string;
  nombre: string;
  categoria: string;
  tiempo: Tiempo;
  precioCents: Cents;
  modifierGroups: ModifierGroup[];
}

export interface Categoria {
  id: string;
  nombre: string;
}
