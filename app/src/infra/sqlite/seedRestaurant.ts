import type { SqliteDatabase } from "./db";
import { normalize } from "@domain/catalog";
import { fromMajor } from "@domain/money";
import { uuidv7 } from "@domain/ids";

/** IDs fijos de la organización demo (mono-sucursal, igual criterio que pos-inteligente ORG). */
export const ORG = {
  tenant: "t1",
  location: "l1",
  register: "r1",
  roleMesero: "role-mesero",
  roleCocina: "role-cocina",
  roleCajero: "role-cajero",
  employeeMesero: "e-mesero",
  employeeCocina: "e-cocina",
  employeeCajero: "e-cajero",
  node: "t1:l1:hub",
  taxIVA: "tax-iva-16",
  profileIVA: "prof-iva",
  unitPieza: "unit-pieza",
  catFuertes: "cat-fuertes",
  catInsumos: "cat-insumos",
  productTacos: "prod-tacos-pastor",
  productCebolla: "insumo-cebolla",
  productTortilla: "insumo-tortilla",
  productCarnePastor: "insumo-carne-pastor",
  recipeTacos: "recipe-tacos-pastor",
  modGroupSalsa: "mg-salsa",
  modOptionVerde: "mo-salsa-verde",
  modOptionRoja: "mo-salsa-roja",
  table7: "table-7",
} as const;

/** Inserta organización, menú con receta y modificadores, y una mesa. Idempotente (INSERT OR IGNORE). */
export function seedRestaurant(db: SqliteDatabase, now: number = Date.now()): void {
  const n = ORG.node;
  const ins = (sql: string, params: unknown[]) => db.prepare(sql).run(...(params as never[]));

  ins(`INSERT OR IGNORE INTO tenants (id,name,currency,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?)`, [
    ORG.tenant, "Restaurante Demo", "MXN", now, now, n,
  ]);
  ins(
    `INSERT OR IGNORE INTO locations (id,tenant_id,name,code,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?)`,
    [ORG.location, ORG.tenant, "Sucursal Centro", "A", now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO registers (id,location_id,name,device_node,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?)`,
    [ORG.register, ORG.location, "Caja principal", n, now, now, n],
  );

  for (const [roleId, name] of [
    [ORG.roleMesero, "Mesero"],
    [ORG.roleCocina, "Cocina"],
    [ORG.roleCajero, "Cajero"],
  ]) {
    ins(
      `INSERT OR IGNORE INTO roles (id,tenant_id,name,permissions_json,is_system,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?,?)`,
      [roleId, ORG.tenant, name, "[]", 1, now, now, n],
    );
  }
  for (const [empId, roleId, name] of [
    [ORG.employeeMesero, ORG.roleMesero, "Ana (mesera)"],
    [ORG.employeeCocina, ORG.roleCocina, "Beto (cocina)"],
    [ORG.employeeCajero, ORG.roleCajero, "Carla (caja)"],
  ]) {
    ins(
      `INSERT OR IGNORE INTO employees (id,tenant_id,role_id,name,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?)`,
      [empId, ORG.tenant, roleId, name, now, now, n],
    );
  }

  ins(
    `INSERT OR IGNORE INTO taxes (id,tenant_id,name,rate,kind,included,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?,?,?)`,
    [ORG.taxIVA, ORG.tenant, "IVA 16%", 0.16, "percent", 1, now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO tax_profiles (id,tenant_id,name,tax_ids_json,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?)`,
    [ORG.profileIVA, ORG.tenant, "IVA general", JSON.stringify([ORG.taxIVA]), now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO units (id,tenant_id,name,factor,allow_fraction,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?,?)`,
    [ORG.unitPieza, ORG.tenant, "pieza", 1, 1, now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO categories (id,tenant_id,name,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?)`,
    [ORG.catFuertes, ORG.tenant, "Fuertes", now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO categories (id,tenant_id,name,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?)`,
    [ORG.catInsumos, ORG.tenant, "Insumos", now, now, n],
  );

  // Insumos (products con track_stock=1, no aparecen en el menú del mesero)
  for (const [id, name, cost] of [
    [ORG.productCebolla, "Cebolla (kg)", 12],
    [ORG.productTortilla, "Tortilla de maíz (pieza)", 1],
    [ORG.productCarnePastor, "Carne al pastor (kg)", 90],
  ] as const) {
    ins(
      `INSERT OR IGNORE INTO products
         (id,tenant_id,name,name_normalized,category_id,unit_id,cost,price,tax_profile_id,track_stock,source,created_at,updated_at,origin_node)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, ORG.tenant, name, normalize(name), ORG.catInsumos, ORG.unitPieza, fromMajor(cost), 0, ORG.profileIVA, 1, "manual", now, now, n],
    );
    ins(
      `INSERT INTO inventory_movements (id,tenant_id,location_id,product_id,type,qty_delta,unit_cost,created_at,origin_node)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv7(now), ORG.tenant, ORG.location, id, "initial", 1000, fromMajor(cost), now, n],
    );
  }

  // Platillo del menú: Tacos al pastor
  ins(
    `INSERT OR IGNORE INTO products
       (id,tenant_id,name,name_normalized,category_id,unit_id,cost,price,tax_profile_id,track_stock,source,created_at,updated_at,origin_node)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [ORG.productTacos, ORG.tenant, "Tacos al pastor", normalize("Tacos al pastor"), ORG.catFuertes, ORG.unitPieza, 0, fromMajor(90), ORG.profileIVA, 0, "manual", now, now, n],
  );

  // Receta: 3 tortillas + 0.15kg carne + 0.02kg cebolla por porción
  ins(
    `INSERT OR IGNORE INTO recipes (id,tenant_id,product_id,yield_qty,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?)`,
    [ORG.recipeTacos, ORG.tenant, ORG.productTacos, 1, now, now, n],
  );
  for (const [ingredientId, qty] of [
    [ORG.productTortilla, 3],
    [ORG.productCarnePastor, 0.15],
    [ORG.productCebolla, 0.02],
  ] as const) {
    ins(
      `INSERT INTO recipe_items (id,recipe_id,ingredient_id,qty,unit_id,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv7(now), ORG.recipeTacos, ingredientId, qty, ORG.unitPieza, now, now, n],
    );
  }

  // Modificador: Salsa (requerido, única selección)
  ins(
    `INSERT OR IGNORE INTO modifier_groups (id,tenant_id,product_id,name,single_choice,required,sort_order,created_at,updated_at,origin_node)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [ORG.modGroupSalsa, ORG.tenant, ORG.productTacos, "Salsa", 1, 1, 0, now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO modifier_options (id,group_id,name,price_delta,sort_order,created_at,updated_at,origin_node)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ORG.modOptionVerde, ORG.modGroupSalsa, "Verde", 0, 0, now, now, n],
  );
  ins(
    `INSERT OR IGNORE INTO modifier_options (id,group_id,name,price_delta,sort_order,created_at,updated_at,origin_node)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ORG.modOptionRoja, ORG.modGroupSalsa, "Roja", 0, 1, now, now, n],
  );

  ins(
    `INSERT OR IGNORE INTO tables (id,tenant_id,location_id,number,capacity,status,created_at,updated_at,origin_node)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ORG.table7, ORG.tenant, ORG.location, 7, 4, "libre", now, now, n],
  );
}
