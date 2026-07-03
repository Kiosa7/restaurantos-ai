import { addItemToOrder, selectModifier, type DraftOrder } from "@domain/order";
import type { MenuItem } from "@domain/menu";

/**
 * Modelo puro de la secuencia de toques del mesero al agregar UN platillo,
 * usado tanto por MeseroScreen (UI real) como por el test que valida la meta
 * de "comanda ≤ 3 toques por platillo" (PLAN.md §6, docs/ux §Flujo 1).
 *
 * Reglas del conteo (por diseño, no por medición de UI real):
 *  - toque 1: elegir categoría
 *  - toque 2: elegir platillo → si NO tiene grupos de modificadores
 *    requeridos, se agrega solo (2 toques totales).
 *  - toque 3+: por cada grupo de modificadores REQUERIDO, un toque para
 *    elegir la opción; el último toque requerido agrega el platillo sin
 *    botón de "confirmar" aparte. Los grupos OPCIONALES (extras) no cuentan
 *    toque si el mesero no los usa — van con default "sin adición".
 *
 * Consecuencia de diseño (documentada, no solo medida): un MenuItem con más
 * de 1 grupo REQUERIDO no puede cumplir la meta de 3 toques. El menú debe
 * diseñarse con a lo más 1 decisión obligatoria por platillo.
 */
export interface TapResult {
  order: DraftOrder;
  taps: number;
}

export function addItemByTapping(
  order: DraftOrder,
  menuItem: MenuItem,
  chosenOptionIdByGroup: Record<string, string>,
): TapResult {
  let taps = 2; // categoría + platillo
  const modificadores = [];
  for (const group of menuItem.modifierGroups) {
    if (!group.requerido) continue;
    const optionId = chosenOptionIdByGroup[group.id];
    const option = group.opciones.find((o) => o.id === optionId);
    if (!option) throw new Error(`Falta la opción elegida para "${group.nombre}"`);
    modificadores.push(selectModifier(group, option));
    taps += 1;
  }
  const next = addItemToOrder(order, menuItem, { modificadores });
  return { order: next, taps };
}
