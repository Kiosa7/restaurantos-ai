/**
 * Cliente HTTP del hub (complementa hubClient.ts, que es el WS). Caja usa
 * request/response clásico porque necesita confirmaciones y totales, no el
 * fire-and-forget del protocolo LAN de mesero/KDS (docs/arquitectura-tecnica.md §5).
 */
import type { Categoria, MenuItem } from "@domain/menu";
import type { FloorTable } from "@ui/components/restaurant";

const DEFAULT_BASE = "http://localhost:5190";

export interface MenuResponse {
  categorias: Categoria[];
  items: MenuItem[];
}

export async function fetchMenu(baseUrl = DEFAULT_BASE): Promise<MenuResponse> {
  const res = await fetch(`${baseUrl}/menu`);
  return res.json();
}

export async function fetchTables(baseUrl = DEFAULT_BASE): Promise<FloorTable[]> {
  const res = await fetch(`${baseUrl}/tables`);
  return res.json();
}

export interface OpenOrderItem {
  orderItemId: string;
  productId: string;
  nombre: string;
  cantidad: number;
  unitPriceCents: number;
  lineTotalCents: number;
  estado: string;
  notas: string | null;
}

export interface OpenOrder {
  orderId: string;
  mesa: number;
  openedAt: number;
  items: OpenOrderItem[];
  totalCents: number;
}

export async function fetchOpenOrders(baseUrl = DEFAULT_BASE): Promise<OpenOrder[]> {
  const res = await fetch(`${baseUrl}/orders/open`);
  return res.json();
}

export interface CheckoutRequest {
  orderId: string;
  splitMode?: "completo" | "partes_iguales" | "por_comensal";
  partes?: number;
  paymentMethod: "efectivo" | "tarjeta";
  tipCents?: number;
  shiftId?: string;
}

export interface CheckoutResponse {
  saleIds: string[];
  totalCents: number;
  partes: number;
  mesa: number;
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `error en ${path}`);
  return json;
}

export function checkout(body: CheckoutRequest, baseUrl = DEFAULT_BASE): Promise<CheckoutResponse> {
  return postJson(baseUrl, "/checkout", body);
}

export function openShift(employeeId: string, baseUrl = DEFAULT_BASE): Promise<{ shiftId: string; reused: boolean }> {
  return postJson(baseUrl, "/shifts/open", { employeeId });
}

export function closeShift(shiftId: string, baseUrl = DEFAULT_BASE): Promise<{ shiftId: string; employeeId: string; totalTipsCents: number }> {
  return postJson(baseUrl, "/shifts/close", { shiftId });
}

export interface TipDistribution {
  shiftId: string;
  employeeId: string;
  amountCents: number;
}

export async function fetchTipsSummary(baseUrl = DEFAULT_BASE): Promise<TipDistribution[]> {
  const res = await fetch(`${baseUrl}/tips/summary`);
  return res.json();
}
