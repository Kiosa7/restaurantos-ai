import { add, cents, mul, type Cents } from "./money";
import type { MenuItem, ModifierOption, Tiempo } from "./menu";

export type OrderItemStatus = "pendiente" | "en_preparacion" | "listo" | "entregado";

export interface SelectedModifier {
  groupId: string;
  optionId: string;
  nombre: string;
  ajusteCents: Cents;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  nombre: string;
  tiempo: Tiempo;
  cantidad: number;
  modificadores: SelectedModifier[];
  notas: string;
  estado: OrderItemStatus;
  precioBaseCents: Cents;
}

export interface DraftOrder {
  mesa: number;
  items: OrderItem[];
}

export function createDraftOrder(mesa: number): DraftOrder {
  return { mesa, items: [] };
}

/** Precio unitario de un OrderItem: base + suma de ajustes de modificadores. */
export function itemUnitPriceCents(item: OrderItem): Cents {
  return item.modificadores.reduce((acc, m) => add(acc, m.ajusteCents), item.precioBaseCents);
}

export function itemTotalCents(item: OrderItem): Cents {
  return mul(itemUnitPriceCents(item), item.cantidad);
}

export function orderTotalCents(order: DraftOrder): Cents {
  return order.items.reduce((acc, it) => add(acc, itemTotalCents(it)), cents(0));
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `oi_${Date.now()}_${seq}`;
}

/**
 * Agrega un platillo a la comanda en construcción. Pura: no muta `order`.
 * Valida que todo grupo `requerido` tenga al menos una opción elegida.
 */
export function addItemToOrder(
  order: DraftOrder,
  menuItem: MenuItem,
  opts: { cantidad?: number; modificadores?: SelectedModifier[]; notas?: string } = {},
): DraftOrder {
  const cantidad = opts.cantidad ?? 1;
  const modificadores = opts.modificadores ?? [];

  for (const group of menuItem.modifierGroups) {
    if (!group.requerido) continue;
    const elegido = modificadores.some((m) => m.groupId === group.id);
    if (!elegido) throw new Error(`Falta elegir "${group.nombre}" para ${menuItem.nombre}`);
  }

  const item: OrderItem = {
    id: nextId(),
    menuItemId: menuItem.id,
    nombre: menuItem.nombre,
    tiempo: menuItem.tiempo,
    cantidad,
    modificadores,
    notas: opts.notas ?? "",
    estado: "pendiente",
    precioBaseCents: menuItem.precioCents,
  };

  return { ...order, items: [...order.items, item] };
}

export function selectModifier(group: { id: string }, option: ModifierOption): SelectedModifier {
  return { groupId: group.id, optionId: option.id, nombre: option.nombre, ajusteCents: option.ajusteCents };
}
