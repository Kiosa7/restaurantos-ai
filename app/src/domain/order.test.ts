import { describe, expect, it } from "vitest";
import { fromMajor } from "./money";
import type { MenuItem } from "./menu";
import { addItemToOrder, createDraftOrder, itemTotalCents, orderTotalCents, selectModifier } from "./order";

const tacos: MenuItem = {
  id: "mi_tacos",
  nombre: "Tacos al pastor",
  categoria: "cat_fuertes",
  tiempo: "fuerte",
  precioCents: fromMajor(90),
  modifierGroups: [
    {
      id: "mg_salsa",
      nombre: "Salsa",
      seleccionUnica: true,
      requerido: true,
      opciones: [
        { id: "op_verde", nombre: "Verde", ajusteCents: fromMajor(0) },
        { id: "op_roja", nombre: "Roja", ajusteCents: fromMajor(0) },
      ],
    },
    {
      id: "mg_extra",
      nombre: "Extras",
      seleccionUnica: false,
      requerido: false,
      opciones: [{ id: "op_queso", nombre: "Queso extra", ajusteCents: fromMajor(10) }],
    },
  ],
};

describe("domain/order", () => {
  it("agrega un platillo respetando cantidad y modificadores", () => {
    const salsa = tacos.modifierGroups[0];
    const order = addItemToOrder(createDraftOrder(5), tacos, {
      cantidad: 2,
      modificadores: [selectModifier(salsa, salsa.opciones[1])],
    });
    expect(order.items).toHaveLength(1);
    expect(order.items[0].cantidad).toBe(2);
    expect(itemTotalCents(order.items[0])).toBe(fromMajor(180));
  });

  it("lanza si falta un grupo de modificadores requerido", () => {
    expect(() => addItemToOrder(createDraftOrder(5), tacos)).toThrow(/Salsa/);
  });

  it("suma correctamente el ajuste de precio de un modificador opcional", () => {
    const salsa = tacos.modifierGroups[0];
    const extra = tacos.modifierGroups[1];
    const order = addItemToOrder(createDraftOrder(5), tacos, {
      modificadores: [selectModifier(salsa, salsa.opciones[0]), selectModifier(extra, extra.opciones[0])],
    });
    expect(itemTotalCents(order.items[0])).toBe(fromMajor(100));
  });

  it("orderTotalCents suma todos los items de la comanda", () => {
    const salsa = tacos.modifierGroups[0];
    let order = createDraftOrder(5);
    order = addItemToOrder(order, tacos, { modificadores: [selectModifier(salsa, salsa.opciones[0])] });
    order = addItemToOrder(order, tacos, { cantidad: 3, modificadores: [selectModifier(salsa, salsa.opciones[1])] });
    expect(orderTotalCents(order)).toBe(fromMajor(90 + 90 * 3));
  });

  it("no muta la comanda original (inmutable)", () => {
    const salsa = tacos.modifierGroups[0];
    const original = createDraftOrder(5);
    addItemToOrder(original, tacos, { modificadores: [selectModifier(salsa, salsa.opciones[0])] });
    expect(original.items).toHaveLength(0);
  });
});
