import { describe, expect, it } from "vitest";
import { createDraftOrder } from "@domain/order";
import { menuSeed } from "@infra/memory/seedMenu";
import { addItemByTapping } from "./comandaFlow";

describe("Flujo de toques del mesero (meta: ≤ 3 toques por platillo)", () => {
  it("un platillo SIN modificadores requeridos se agrega en 2 toques", () => {
    const quesadilla = menuSeed.find((m) => m.id === "mi_quesadilla_flor")!;
    const { order, taps } = addItemByTapping(createDraftOrder(7), quesadilla, {});
    expect(taps).toBe(2);
    expect(taps).toBeLessThanOrEqual(3);
    expect(order.items).toHaveLength(1);
  });

  it("un platillo con 1 grupo de modificadores requerido se agrega en 3 toques", () => {
    const tacos = menuSeed.find((m) => m.id === "mi_tacos_pastor")!;
    const { order, taps } = addItemByTapping(createDraftOrder(7), tacos, { mg_salsa: "op_salsa_roja" });
    expect(taps).toBe(3);
    expect(taps).toBeLessThanOrEqual(3);
    expect(order.items[0].modificadores[0].nombre).toBe("Roja");
  });

  it("TODO el menú semilla cumple la meta de ≤ 3 toques (ningún platillo tiene 2+ grupos requeridos)", () => {
    for (const item of menuSeed) {
      const gruposRequeridos = item.modifierGroups.filter((g) => g.requerido).length;
      expect(gruposRequeridos, `${item.nombre} tiene ${gruposRequeridos} grupos requeridos`).toBeLessThanOrEqual(1);
    }
  });

  it("agregar 2 platillos distintos a la misma comanda acumula ambos", () => {
    const flan = menuSeed.find((m) => m.id === "mi_flan")!;
    const agua = menuSeed.find((m) => m.id === "mi_agua_horchata")!;
    let order = createDraftOrder(3);
    ({ order } = addItemByTapping(order, flan, {}));
    ({ order } = addItemByTapping(order, agua, { mg_tamano: "op_grande" }));
    expect(order.items).toHaveLength(2);
    expect(order.items[1].modificadores[0].ajusteCents).toBeGreaterThan(0);
  });
});
