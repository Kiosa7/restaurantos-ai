import type { Cents } from "./money";

/**
 * Producto del catálogo (subconjunto MVP del esquema `products`,
 * ver docs/db/migrations/0003_tax_catalog.sql).
 */
export interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  nameNormalized: string;
  price: Cents; // precio de venta (incluye impuesto en este MVP)
  cost: Cents;
  taxRate: number; // 0.16 = 16% (impuesto incluido en price)
  trackStock: boolean;
}

/** Normaliza texto para búsqueda: minúsculas y sin acentos (igual que FTS5). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // elimina diacríticos combinados
    .trim();
}
