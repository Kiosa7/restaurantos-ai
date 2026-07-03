import { comandaTicket, cuentaTicket } from "./tickets.mjs";
import { simulate } from "./simulator.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FALLÓ: " + msg);
  console.log("  ✔ " + msg);
}

const comanda = comandaTicket({
  mesa: 7,
  folio: "C-0042",
  meseroNombre: "Ana",
  tiempo: "fuerte",
  hora: "20:14",
  items: [
    { cantidad: 2, nombre: "Tacos al pastor", modificadores: ["sin cebolla"], notas: "" },
    { cantidad: 1, nombre: "Quesadilla de flor", modificadores: [], notas: "extra queso" },
  ],
});
const simComanda = simulate(comanda);
console.log("--- Preview comanda ---\n" + simComanda.preview + "\n------------------------");
assert(simComanda.cmds[0].op === "init", "la comanda inicializa la impresora (ESC @)");
assert(simComanda.cmds.some((c) => c.op === "cutPartial"), "la comanda termina en corte parcial");
assert(!simComanda.cmds.some((c) => c.op === "openDrawer"), "la comanda NUNCA abre el cajón (no es un cobro)");
assert(simComanda.preview.includes("MESA 7"), "el número de mesa aparece en el ticket");
assert(simComanda.preview.includes("sin cebolla"), "los modificadores aparecen como línea propia");

const cuenta = cuentaTicket({
  folio: "F-1001",
  mesa: 7,
  items: [
    { cantidad: 2, nombre: "Tacos al pastor", totalCents: 9000 },
    { cantidad: 1, nombre: "Quesadilla de flor", totalCents: 6500 },
  ],
  subtotalCents: 13362,
  ivaCents: 2138,
  totalCents: 15500,
  propinaSugeridaPct: [10, 15, 20],
  metodoPago: "efectivo",
});
const simCuenta = simulate(cuenta);
console.log("--- Preview cuenta ---\n" + simCuenta.preview + "\n------------------------");
assert(simCuenta.cmds.some((c) => c.op === "cutPartial"), "la cuenta termina en corte parcial");
assert(simCuenta.cmds.some((c) => c.op === "openDrawer"), "cuenta pagada en EFECTIVO abre el cajón");
assert(simCuenta.preview.includes("$155.00"), "el total en pesos aparece formateado");

const cuentaTarjeta = cuentaTicket({
  folio: "F-1002",
  mesa: 3,
  items: [{ cantidad: 1, nombre: "Café", totalCents: 3000 }],
  subtotalCents: 2586,
  ivaCents: 414,
  totalCents: 3000,
  propinaSugeridaPct: [],
  metodoPago: "tarjeta",
});
const simTarjeta = simulate(cuentaTarjeta);
assert(!simTarjeta.cmds.some((c) => c.op === "openDrawer"), "cuenta pagada con TARJETA no abre el cajón");

console.log("\nTODAS LAS PROPIEDADES DE SOFTWARE VALIDADAS ✅ (hardware real sigue pendiente, ver informe)");
