import { describe, expect, it } from "vitest";
import { comandaTicket, cuentaTicket } from "./tickets";
import { simulate } from "./printSimulator";

describe("Impresión ESC/POS — puerto TS del spike 2 sobre datos reales de la app", () => {
  it("la comanda inicializa, corta, NUNCA abre cajón, y muestra modificadores/notas", () => {
    const bytes = comandaTicket({
      mesa: 7,
      folio: "abc12345",
      horaTexto: "20:14",
      items: [
        { cantidad: 2, nombre: "Tacos al pastor", modificadores: [{ nombre: "Roja" }] },
        { cantidad: 1, nombre: "Quesadilla de flor", notas: "extra queso" },
      ],
    });
    const sim = simulate(bytes);
    expect(sim.cmds[0]).toEqual({ op: "init" });
    expect(sim.cmds.some((c) => c.op === "cutPartial")).toBe(true);
    expect(sim.cmds.some((c) => c.op === "openDrawer")).toBe(false);
    expect(sim.preview).toContain("MESA 7");
    expect(sim.preview).toContain("Roja");
    expect(sim.preview).toContain("extra queso");
  });

  it("la cuenta pagada en efectivo corta Y abre el cajón", () => {
    const bytes = cuentaTicket({
      folio: "F-000123",
      mesa: 7,
      items: [{ cantidad: 2, nombre: "Tacos al pastor", lineTotalCents: 18000 }],
      totalCents: 18000,
      propinaSugeridaPct: [10, 15, 20],
      metodoPago: "efectivo",
    });
    const sim = simulate(bytes);
    expect(sim.cmds.some((c) => c.op === "cutPartial")).toBe(true);
    expect(sim.cmds.some((c) => c.op === "openDrawer")).toBe(true);
    expect(sim.preview).toContain("$180.00");
  });

  it("la cuenta pagada con tarjeta corta pero NO abre el cajón", () => {
    const bytes = cuentaTicket({
      folio: "F-000124",
      mesa: 3,
      items: [{ cantidad: 1, nombre: "Café", lineTotalCents: 3000 }],
      totalCents: 3000,
      metodoPago: "tarjeta",
    });
    const sim = simulate(bytes);
    expect(sim.cmds.some((c) => c.op === "cutPartial")).toBe(true);
    expect(sim.cmds.some((c) => c.op === "openDrawer")).toBe(false);
  });
});
