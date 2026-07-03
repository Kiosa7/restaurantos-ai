/**
 * Dinero SIEMPRE en enteros (centavos). Nunca punto flotante en cálculos de
 * dinero (ver docs/db/README.md §2.3). El tipo nominal evita mezclar pesos
 * y centavos por accidente.
 */
export type Cents = number & { readonly __brand: "Cents" };

export const cents = (n: number): Cents => Math.round(n) as Cents;

/** Convierte una cantidad en pesos (ej. 18.5) a centavos (1850). */
export const fromMajor = (major: number): Cents => Math.round(major * 100) as Cents;

export const add = (a: Cents, b: Cents): Cents => (a + b) as Cents;
export const sub = (a: Cents, b: Cents): Cents => (a - b) as Cents;

/** Multiplica un monto por una cantidad (qty puede ser fraccional: kg, litros). */
export const mul = (a: Cents, qty: number): Cents => Math.round(a * qty) as Cents;

/** Formatea centavos a string de moneda. */
export function formatMoney(value: Cents, currency = "MXN", locale = "es-MX"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value / 100);
}
