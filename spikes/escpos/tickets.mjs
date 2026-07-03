import { TicketBuilder } from "./encoder.mjs";

const ANCHO = 42; // columnas típicas de una térmica 80mm en fuente normal

function money(cents) {
  return "$" + (cents / 100).toFixed(2);
}

/** Comanda de cocina: SIN precios, tiempos y modificadores grandes (legible a 2m). */
export function comandaTicket({ mesa, folio, meseroNombre, items, tiempo, hora }) {
  const b = new TicketBuilder().init().align("center").bold(true).size(2, 2);
  b.line(`MESA ${mesa}`);
  b.size(1, 1).bold(false);
  b.line(`Comanda #${folio} · ${tiempo.toUpperCase()}`);
  b.line(`${meseroNombre} · ${hora}`);
  b.align("left").hr(ANCHO);
  for (const it of items) {
    b.bold(true).size(1, 2).line(`${it.cantidad}x ${it.nombre}`);
    b.bold(false).size(1, 1);
    for (const mod of it.modificadores ?? []) b.line(`   + ${mod}`);
    if (it.notas) b.line(`   NOTA: ${it.notas}`);
    b.feed(1);
  }
  b.hr(ANCHO).align("center").feed(2).cutPartial();
  return b.build();
}

/** Cuenta de caja: totales, IVA incluido, propina sugerida, corte + apertura de cajón si es efectivo. */
export function cuentaTicket({ folio, mesa, items, subtotalCents, ivaCents, totalCents, propinaSugeridaPct, metodoPago }) {
  const b = new TicketBuilder().init().align("center").bold(true).size(1, 2);
  b.line("RESTAURANTE DEMO");
  b.bold(false).size(1, 1);
  b.line("Av. Siempre Viva 123, CDMX");
  b.line("RFC: XAXX010101000");
  b.hr(ANCHO).align("left");
  b.line(`Folio: ${folio}    Mesa: ${mesa}`);
  b.hr(ANCHO);
  for (const it of items) {
    const izq = `${it.cantidad}x ${it.nombre}`.padEnd(ANCHO - 10);
    b.line(izq + money(it.totalCents).padStart(10));
  }
  b.hr(ANCHO);
  b.line(`Subtotal:`.padEnd(ANCHO - 10) + money(subtotalCents).padStart(10));
  b.line(`IVA (16%):`.padEnd(ANCHO - 10) + money(ivaCents).padStart(10));
  b.bold(true);
  b.line(`TOTAL:`.padEnd(ANCHO - 10) + money(totalCents).padStart(10));
  b.bold(false);
  if (propinaSugeridaPct?.length) {
    b.feed(1).line("Propina sugerida (no incluida):");
    for (const pct of propinaSugeridaPct) {
      b.line(`  ${pct}%: ${money(Math.round((totalCents * pct) / 100))}`);
    }
  }
  b.align("center").feed(2).line("¡Gracias por su visita!").feed(2);
  b.cutPartial();
  if (metodoPago === "efectivo") b.openDrawer();
  return b.build();
}
