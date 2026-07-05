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
  /** Fase 7: liga la venta a un cliente y/o redime sus puntos de fidelización. */
  customerId?: string;
  redeemPoints?: number;
}

export interface CheckoutResponse {
  saleIds: string[];
  totalCents: number;
  grossTotalCents: number;
  discountCents: number;
  partes: number;
  mesa: number;
  puntosGanados: number;
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

/** Snapshot JSON de respaldo (Fase 6 §10.7) — se cifra en el navegador con encryptedBackup.ts. */
export async function fetchBackupSnapshot(baseUrl = DEFAULT_BASE): Promise<unknown> {
  const res = await fetch(`${baseUrl}/backup/export`);
  return res.json();
}

export interface AiChatResponse {
  answer: string;
  toolsUsadas: string[];
}

/** Asistente conversacional v1 (Fase 6 §10.8) — el LLM nunca escribe SQL, solo elige tools. */
export function askAssistant(question: string, baseUrl = DEFAULT_BASE): Promise<AiChatResponse> {
  return postJson(baseUrl, "/ai/chat", { question });
}

export interface PairingCode {
  code: string;
  role: "mesero" | "kds" | "caja";
  expiresAt: number;
}

/** Genera un código de emparejamiento de un solo uso (Fase 6 §10.9). */
export function generatePairing(role: PairingCode["role"], baseUrl = DEFAULT_BASE): Promise<PairingCode> {
  return postJson(baseUrl, "/pair/generate", { role });
}

export interface PairedDevice {
  deviceId: string;
  role: string;
  label: string | null;
  pairedAt: number;
  lastSeenAt: number | null;
}

export async function fetchPairedDevices(baseUrl = DEFAULT_BASE): Promise<PairedDevice[]> {
  const res = await fetch(`${baseUrl}/pair/devices`);
  return res.json();
}

export interface CfdiDocument {
  documentId: string;
  folio: string;
  estado: string;
  rfcReceptor: string;
  nombreReceptor: string;
  subtotalCents?: number;
  ivaCents?: number;
  totalCents: number;
  conceptos?: unknown[];
  nota?: string;
}

/** Genera el documento CFDI 4.0 de una venta (Fase 7). Timbrado real sigue bloqueado (⛔ spike 3). */
export function generateCfdi(
  body: { saleId: string; rfcReceptor: string; nombreReceptor: string; usoCfdi?: string },
  baseUrl = DEFAULT_BASE,
): Promise<CfdiDocument> {
  return postJson(baseUrl, "/cfdi/generate", body);
}

// ---------------------------------------------------------------------------
// Fase 7: clientes, fidelización, promociones, compras y proveedores
// ---------------------------------------------------------------------------

export interface Customer {
  customerId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  puntos: number;
  ultimaCompra: number | null;
}

export async function fetchCustomers(baseUrl = DEFAULT_BASE): Promise<Customer[]> {
  const res = await fetch(`${baseUrl}/customers`);
  return res.json();
}

export function createCustomer(
  body: { name: string; phone?: string; email?: string; taxId?: string },
  baseUrl = DEFAULT_BASE,
): Promise<{ customerId: string }> {
  return postJson(baseUrl, "/customers", body);
}

export interface Promotion {
  promotionId: string;
  nombre: string;
  reglas: { type: string; value: number };
  activa: boolean;
}

export async function fetchPromotions(baseUrl = DEFAULT_BASE): Promise<Promotion[]> {
  const res = await fetch(`${baseUrl}/promotions`);
  return res.json();
}

export function createPromotion(
  body: { name: string; percentOff: number; priority?: number },
  baseUrl = DEFAULT_BASE,
): Promise<{ promotionId: string }> {
  return postJson(baseUrl, "/promotions", body);
}

export interface Supplier {
  supplierId: string;
  nombre: string;
  leadTimeDays: number;
}

export async function fetchSuppliers(baseUrl = DEFAULT_BASE): Promise<Supplier[]> {
  const res = await fetch(`${baseUrl}/suppliers`);
  return res.json();
}

export function createSupplier(
  body: { name: string; leadTimeDays?: number },
  baseUrl = DEFAULT_BASE,
): Promise<{ supplierId: string }> {
  return postJson(baseUrl, "/suppliers", body);
}

export function createPurchase(
  body: { supplierId: string; items: { productId: string; qty: number; unitCostCents: number }[] },
  baseUrl = DEFAULT_BASE,
): Promise<{ purchaseId: string; folio: string; totalCents: number }> {
  return postJson(baseUrl, "/purchases", body);
}

export interface OcrInvoiceLine {
  name: string;
  qty: number;
  unitCost: number;
}

/** OCR de factura de proveedor (Fase 7, ⚠️ 30-60s en CPU — llamar siempre desde un botón, no automático). */
export function ocrInvoice(imageBase64: string, baseUrl = DEFAULT_BASE): Promise<{ supplier: string | null; lines: OcrInvoiceLine[] }> {
  return postJson(baseUrl, "/purchases/ocr", { imageBase64 });
}

// ---------------------------------------------------------------------------
// Fase 7: reservaciones y delivery/para llevar
// ---------------------------------------------------------------------------

export interface Reservation {
  reservationId: string;
  cliente: string;
  telefono: string | null;
  personas: number;
  horaReservada: number;
  estado: "confirmada" | "sentada" | "cancelada" | "no_show";
  notas: string | null;
}

export async function fetchReservations(baseUrl = DEFAULT_BASE): Promise<Reservation[]> {
  const res = await fetch(`${baseUrl}/reservations`);
  return res.json();
}

export function createReservation(
  body: { customerName: string; customerPhone?: string; partySize?: number; reservedAt: number; notes?: string },
  baseUrl = DEFAULT_BASE,
): Promise<{ reservationId: string }> {
  return postJson(baseUrl, "/reservations", body);
}

export function updateReservationStatus(id: string, status: Reservation["estado"], baseUrl = DEFAULT_BASE): Promise<unknown> {
  return postJson(baseUrl, `/reservations/${id}/status`, { status });
}

export interface DeliveryOrder {
  deliveryOrderId: string;
  orderId: string;
  canal: "para_llevar" | "domicilio";
  cliente: string;
  telefono: string | null;
  direccion: string | null;
  estado: string;
}

export async function fetchDeliveryOrders(baseUrl = DEFAULT_BASE): Promise<DeliveryOrder[]> {
  const res = await fetch(`${baseUrl}/delivery-orders`);
  return res.json();
}

export function createDeliveryOrder(
  body: {
    channel: "para_llevar" | "domicilio";
    customerName: string;
    customerPhone?: string;
    address?: string;
    items: { productId: string; cantidad: number }[];
  },
  baseUrl = DEFAULT_BASE,
): Promise<{ deliveryOrderId: string; orderId: string; channel: string }> {
  return postJson(baseUrl, "/delivery-orders", body);
}

export function updateDeliveryStatus(id: string, status: DeliveryOrder["estado"], baseUrl = DEFAULT_BASE): Promise<unknown> {
  return postJson(baseUrl, `/delivery-orders/${id}/status`, { status });
}

// ---------------------------------------------------------------------------
// Fase 7: factura global (agrupa ventas sin CFDI individual)
// ---------------------------------------------------------------------------

export interface UninvoicedSale {
  saleId: string;
  folio: string;
  datetime: number;
  totalCents: number;
}

export async function fetchUninvoicedSales(baseUrl = DEFAULT_BASE): Promise<UninvoicedSale[]> {
  const res = await fetch(`${baseUrl}/cfdi/uninvoiced-sales`);
  return res.json();
}

export interface GlobalInvoiceResponse {
  documentId: string;
  folio: string;
  estado: string;
  totalCents: number;
  ventasIncluidas: number;
}

export function generateGlobalInvoice(
  body: { saleIds: string[]; rfcReceptor?: string; nombreReceptor?: string; usoCfdi?: string },
  baseUrl = DEFAULT_BASE,
): Promise<GlobalInvoiceResponse> {
  return postJson(baseUrl, "/cfdi/global", body);
}

// ---------------------------------------------------------------------------
// Fase 7: reportes avanzados
// ---------------------------------------------------------------------------

export interface VentaPorDia {
  dia: string;
  numVentas: number;
  totalCents: number;
}

export interface MargenPlatillo {
  producto: string;
  precioVentaCents: number;
  costoRecetaCents: number;
  margenCents: number;
}

export interface RotacionMesa {
  mesa: number;
  comandasCerradas: number;
  minutosPromedioOcupacion: number;
}

export interface PropinaPorTurno {
  shiftId: string;
  employeeId: string;
  startedAt: number;
  numPropinas: number;
  totalPropinasCents: number;
}

export interface ReportsDashboard {
  ventasPorDia: VentaPorDia[];
  margenPorPlatillo: MargenPlatillo[];
  rotacionMesas: RotacionMesa[];
  propinasPorTurno: PropinaPorTurno[];
}

export async function fetchReportsDashboard(baseUrl = DEFAULT_BASE): Promise<ReportsDashboard> {
  const res = await fetch(`${baseUrl}/reports/dashboard`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Fase 8: registro de plugins (docs/permisos-plugins.md)
// ---------------------------------------------------------------------------

export interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export async function fetchPlugins(baseUrl = DEFAULT_BASE): Promise<Plugin[]> {
  const res = await fetch(`${baseUrl}/plugins`);
  return res.json();
}

export function togglePlugin(id: string, enabled: boolean, baseUrl = DEFAULT_BASE): Promise<{ id: string; enabled: boolean }> {
  return postJson(baseUrl, `/plugins/${id}/toggle`, { enabled });
}

// ---------------------------------------------------------------------------
// Fase 8: auditoría avanzada
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  seq: number;
  actor: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  originNode: string;
  ts: number;
}

export async function fetchAuditLog(entity?: string, baseUrl = DEFAULT_BASE): Promise<AuditLogEntry[]> {
  const qs = entity ? `?entity=${encodeURIComponent(entity)}` : "";
  const res = await fetch(`${baseUrl}/audit-log${qs}`);
  return res.json();
}

export interface AuditChainVerification {
  valid: boolean;
  brokenAtSeq: number | null;
  totalRecords: number;
  reason?: string;
}

export async function verifyAuditChain(baseUrl = DEFAULT_BASE): Promise<AuditChainVerification> {
  const res = await fetch(`${baseUrl}/audit-log/verify`);
  return res.json();
}
