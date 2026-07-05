/**
 * Plantillas de ticket (puerto TS de spikes/escpos/tickets.mjs, Fase 6 §10.4)
 * sobre datos reales del hub (OpenOrder/CheckoutResponse), no el prototipo.
 */
import { TicketBuilder } from "./escposEncoder";

const ANCHO = 42; // columnas típicas de una térmica 80mm en fuente normal

function money(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

export interface ComandaTicketItem {
  cantidad: number;
  nombre: string;
  modificadores?: { nombre: string }[];
  notas?: string | null;
}

/** Comanda de cocina: SIN precios, tiempos y modificadores grandes (legible a 2m). NUNCA abre el cajón. */
export function comandaTicket(opts: { mesa: number; folio: string; horaTexto: string; items: ComandaTicketItem[] }): Uint8Array {
  const b = new TicketBuilder().init().align("center").bold(true).size(2, 2);
  b.line(`MESA ${opts.mesa}`);
  b.size(1, 1).bold(false);
  b.line(`Comanda #${opts.folio} · ${opts.horaTexto}`);
  b.align("left").hr(ANCHO);
  for (const it of opts.items) {
    b.bold(true).size(1, 2).line(`${it.cantidad}x ${it.nombre}`);
    b.bold(false).size(1, 1);
    for (const mod of it.modificadores ?? []) b.line(`   + ${mod.nombre}`);
    if (it.notas) b.line(`   NOTA: ${it.notas}`);
    b.feed(1);
  }
  b.hr(ANCHO).align("center").feed(2).cutPartial();
  return b.build();
}

export interface CuentaTicketItem {
  cantidad: number;
  nombre: string;
  lineTotalCents: number;
}

/** Cuenta de caja: totales, IVA incluido, propina sugerida, corte + cajón SOLO si efectivo. */
export function cuentaTicket(opts: {
  folio: string;
  mesa: number;
  items: CuentaTicketItem[];
  totalCents: number;
  propinaSugeridaPct?: number[];
  metodoPago: "efectivo" | "tarjeta";
}): Uint8Array {
  const subtotalCents = Math.round(opts.totalCents / 1.16);
  const ivaCents = opts.totalCents - subtotalCents;

  const b = new TicketBuilder().init().align("center").bold(true).size(1, 2);
  b.line("RESTAURANTE DEMO");
  b.bold(false).size(1, 1);
  b.line("Av. Siempre Viva 123, CDMX");
  b.line("RFC: XAXX010101000");
  b.hr(ANCHO).align("left");
  b.line(`Folio: ${opts.folio}    Mesa: ${opts.mesa}`);
  b.hr(ANCHO);
  for (const it of opts.items) {
    const izq = `${it.cantidad}x ${it.nombre}`.padEnd(ANCHO - 10);
    b.line(izq + money(it.lineTotalCents).padStart(10));
  }
  b.hr(ANCHO);
  b.line(`Subtotal:`.padEnd(ANCHO - 10) + money(subtotalCents).padStart(10));
  b.line(`IVA (16%):`.padEnd(ANCHO - 10) + money(ivaCents).padStart(10));
  b.bold(true);
  b.line(`TOTAL:`.padEnd(ANCHO - 10) + money(opts.totalCents).padStart(10));
  b.bold(false);
  if (opts.propinaSugeridaPct?.length) {
    b.feed(1).line("Propina sugerida (no incluida):");
    for (const pct of opts.propinaSugeridaPct) {
      b.line(`  ${pct}%: ${money(Math.round((opts.totalCents * pct) / 100))}`);
    }
  }
  b.align("center").feed(2).line("¡Gracias por su visita!").feed(2);
  b.cutPartial();
  if (opts.metodoPago === "efectivo") b.openDrawer();
  return b.build();
}
