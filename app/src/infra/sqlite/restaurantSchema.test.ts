import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDatabase } from "./db";
import { seedRestaurant, ORG } from "./seedRestaurant";
import { uuidv7 } from "@domain/ids";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/db/migrations");

function freshDb() {
  const db = openDatabase({ migrationsDir, skipVecTables: true });
  seedRestaurant(db);
  return db;
}

describe("Esquema restaurantero (0012-0018) contra node:sqlite real", () => {
  it("aplica las 18 migraciones sin error y siembra el demo", () => {
    const db = freshDb();
    const row = db.prepare(`SELECT COUNT(*) AS n FROM schema_migrations`).get() as { n: number };
    expect(row.n).toBe(18);
    const table = db.prepare(`SELECT status FROM tables WHERE id = ?`).get(ORG.table7) as { status: string };
    expect(table.status).toBe("libre");
  });

  it("simula un servicio completo: abrir mesa → comanda → bump con descuento de receta → cobro → propina", () => {
    const db = freshDb();
    const n = ORG.node;
    let now = Date.now();
    const ins = (sql: string, params: unknown[]) => db.prepare(sql).run(...(params as never[]));
    const get = <T>(sql: string, params: unknown[] = []): T => db.prepare(sql).get(...(params as never[])) as T;

    // 1. Abrir mesa → comanda (el trigger debe pasar la mesa a 'ocupada')
    const orderId = uuidv7(now);
    ins(
      `INSERT INTO orders (id,tenant_id,location_id,table_id,employee_id,guests,status,opened_at,created_at,updated_at,origin_node)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId, ORG.tenant, ORG.location, ORG.table7, ORG.employeeMesero, 2, "abierta", now, now, now, n],
    );
    expect(get<{ status: string }>(`SELECT status FROM tables WHERE id=?`, [ORG.table7]).status).toBe("ocupada");

    // 2. Agregar tacos al pastor x2 con salsa roja, enviar a cocina
    const itemId = uuidv7(now);
    ins(
      `INSERT INTO order_items (id,order_id,product_id,name_snapshot,course,qty,unit_price,status,sent_at,created_at,updated_at,origin_node)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [itemId, orderId, ORG.productTacos, "Tacos al pastor", "fuerte", 2, 9000, "pendiente", now, now, now, n],
    );
    ins(
      `INSERT INTO order_item_modifiers (id,order_item_id,group_id,option_id,name_snapshot,price_delta_snapshot,created_at)
       VALUES (?,?,?,?,?,?,?)`,
      [uuidv7(now), itemId, ORG.modGroupSalsa, ORG.modOptionRoja, "Roja", 0, now],
    );

    // 3. Bump a 'en_preparacion': descuento de inventario por receta (lógica de dominio, no trigger)
    const recipeItems = db
      .prepare(`SELECT ingredient_id, qty FROM recipe_items WHERE recipe_id = ?`)
      .all(ORG.recipeTacos) as { ingredient_id: string; qty: number }[];
    const itemQty = 2;
    for (const ri of recipeItems) {
      ins(
        `INSERT INTO inventory_movements (id,tenant_id,location_id,product_id,type,qty_delta,created_at,origin_node)
         VALUES (?,?,?,?,?,?,?,?)`,
        [uuidv7(now), ORG.tenant, ORG.location, ri.ingredient_id, "sale", -(ri.qty * itemQty), now, n],
      );
    }
    ins(`UPDATE order_items SET status='en_preparacion', updated_at=? WHERE id=?`, [now, itemId]);
    ins(`INSERT INTO order_item_events (id,order_item_id,status,at,employee_id,created_at,origin_node) VALUES (?,?,?,?,?,?,?)`, [
      uuidv7(now), itemId, "en_preparacion", now, ORG.employeeCocina, now, n,
    ]);

    const tortillaStock = get<{ qty: number }>(`SELECT qty FROM inventory WHERE product_id=?`, [ORG.productTortilla]);
    expect(tortillaStock.qty).toBeCloseTo(1000 - 3 * 2, 5); // 994

    // 4. Cocina termina (bump a 'listo') 4 minutos después
    now += 4 * 60_000;
    ins(`UPDATE order_items SET status='listo', updated_at=? WHERE id=?`, [now, itemId]);
    ins(`INSERT INTO order_item_events (id,order_item_id,status,at,employee_id,created_at,origin_node) VALUES (?,?,?,?,?,?,?)`, [
      uuidv7(now), itemId, "listo", now, ORG.employeeCocina, now, n,
    ]);

    const prep = get<{ segundos_promedio_preparacion: number }>(
      `SELECT segundos_promedio_preparacion FROM v_dish_prep_time WHERE product_id=?`,
      [ORG.productTacos],
    );
    expect(prep.segundos_promedio_preparacion).toBeCloseTo(240, 0);

    // 5. Cerrar comanda y cobrar (venta inmutable, igual patrón que pos-inteligente)
    now += 60_000;
    ins(`UPDATE orders SET status='cerrada', closed_at=?, updated_at=? WHERE id=?`, [now, now, orderId]);
    expect(get<{ status: string }>(`SELECT status FROM tables WHERE id=?`, [ORG.table7]).status).toBe("por_limpiar");

    const saleId = uuidv7(now);
    const total = 9000 * 2; // 2 tacos, sin ajuste de modificador
    ins(
      `INSERT INTO sales (id,tenant_id,location_id,register_id,employee_id,folio,datetime,subtotal,tax_total,total,seq,hash,created_at,origin_node)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [saleId, ORG.tenant, ORG.location, ORG.register, ORG.employeeCajero, "F-0001", now, total, 0, total, 1, "hash1", now, n],
    );
    ins(
      `INSERT INTO sale_items (id,sale_id,product_id,name_snapshot,unit_price,qty,line_total,created_at,origin_node)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuidv7(now), saleId, ORG.productTacos, "Tacos al pastor", 9000, 2, total, now, n],
    );
    ins(`INSERT INTO payments (id,sale_id,method,amount,created_at,origin_node) VALUES (?,?,?,?,?,?)`, [
      uuidv7(now), saleId, "cash", total, now, n,
    ]);
    ins(`INSERT INTO order_sales (id,order_id,sale_id,created_at) VALUES (?,?,?,?)`, [uuidv7(now), orderId, saleId, now]);

    // 6. Turno y propina
    const shiftId = uuidv7(now);
    ins(`INSERT INTO shifts (id,tenant_id,location_id,employee_id,started_at,created_at,updated_at,origin_node) VALUES (?,?,?,?,?,?,?,?)`, [
      shiftId, ORG.tenant, ORG.location, ORG.employeeMesero, now - 3 * 3600_000, now, now, n,
    ]);
    ins(`INSERT INTO tips (id,tenant_id,sale_id,shift_id,amount,method,created_at,origin_node) VALUES (?,?,?,?,?,?,?,?)`, [
      uuidv7(now), ORG.tenant, saleId, shiftId, 1800, "cash", now, n,
    ]);

    const tipsSummary = get<{ total_propinas_cents: number; num_propinas: number }>(
      `SELECT total_propinas_cents, num_propinas FROM v_tips_by_shift WHERE shift_id=?`,
      [shiftId],
    );
    expect(tipsSummary.total_propinas_cents).toBe(1800);
    expect(tipsSummary.num_propinas).toBe(1);

    // 7. El kitchen queue ya no debe mostrar el ítem (está 'listo', no 'pendiente'/'en_preparacion')
    const queue = db.prepare(`SELECT * FROM v_kitchen_queue WHERE order_item_id=?`).all(itemId);
    expect(queue).toHaveLength(0);

    // 8. Margen del platillo: precio venta - costo de receta (tortillas+carne+cebolla)
    const margin = get<{ costo_receta_cents: number; margen_cents: number }>(
      `SELECT costo_receta_cents, margen_cents FROM v_dish_sales_margin WHERE product_id=?`,
      [ORG.productTacos],
    );
    expect(Math.round(margin.costo_receta_cents)).toBe(1674); // 3*100 + 0.15*9000 + 0.02*1200
    expect(Math.round(margin.margen_cents)).toBe(9000 - 1674);
  });
});
