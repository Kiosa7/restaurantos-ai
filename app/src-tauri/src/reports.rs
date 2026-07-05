//! Reportes avanzados (Fase 7 §10.1 punto 9). Las 6 vistas de 0016
//! (`v_dish_sales_margin`, `v_table_turnover`, `v_tips_by_shift`, etc.) ya
//! las explota el asistente de IA (Fase 6 punto 8) para responder preguntas
//! sueltas; esto arma un solo payload agregado para una pantalla de
//! reportes dedicada (gráficas + exportar), sin inventar vistas nuevas.
use rusqlite::Connection;
use serde_json::{json, Value};

/// Ventas por día de los últimos N días — no hay vista para esto en 0016
/// porque las 6 vistas existentes son operativas (mesas, cocina, turnos),
/// no de series de tiempo; se agrega directo sobre `sales`.
fn ventas_por_dia(conn: &Connection, dias: i64) -> Vec<Value> {
    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m-%d', datetime / 1000, 'unixepoch') AS dia,
                    COUNT(*) AS num_ventas,
                    SUM(total) AS total_cents
             FROM sales
             WHERE datetime >= (unixepoch() - ?1 * 86400) * 1000
             GROUP BY dia
             ORDER BY dia ASC",
        )
        .unwrap();
    stmt.query_map([dias], |r| {
        Ok(json!({
            "dia": r.get::<_, String>(0)?,
            "numVentas": r.get::<_, i64>(1)?,
            "totalCents": r.get::<_, i64>(2)?,
        }))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn margen_por_platillo(conn: &Connection) -> Vec<Value> {
    let mut stmt = conn
        .prepare(
            "SELECT product_name, precio_venta_cents, costo_receta_cents, margen_cents
             FROM v_dish_sales_margin
             ORDER BY margen_cents DESC
             LIMIT 20",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok(json!({
            "producto": r.get::<_, String>(0)?,
            "precioVentaCents": r.get::<_, i64>(1)?,
            "costoRecetaCents": r.get::<_, f64>(2)?,
            "margenCents": r.get::<_, f64>(3)?,
        }))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn rotacion_mesas(conn: &Connection) -> Vec<Value> {
    let mut stmt = conn
        .prepare(
            "SELECT table_number, comandas_cerradas, minutos_promedio_ocupacion
             FROM v_table_turnover
             ORDER BY table_number ASC",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok(json!({
            "mesa": r.get::<_, i64>(0)?,
            "comandasCerradas": r.get::<_, i64>(1)?,
            "minutosPromedioOcupacion": r.get::<_, f64>(2)?,
        }))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn propinas_por_turno(conn: &Connection) -> Vec<Value> {
    let mut stmt = conn
        .prepare(
            "SELECT shift_id, employee_id, started_at, num_propinas, total_propinas_cents
             FROM v_tips_by_shift
             ORDER BY started_at DESC
             LIMIT 20",
        )
        .unwrap();
    stmt.query_map([], |r| {
        Ok(json!({
            "shiftId": r.get::<_, String>(0)?,
            "employeeId": r.get::<_, String>(1)?,
            "startedAt": r.get::<_, i64>(2)?,
            "numPropinas": r.get::<_, i64>(3)?,
            "totalPropinasCents": r.get::<_, i64>(4)?,
        }))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

pub fn dashboard(conn: &Connection) -> Value {
    json!({
        "ventasPorDia": ventas_por_dia(conn, 30),
        "margenPorPlatillo": margen_por_platillo(conn),
        "rotacionMesas": rotacion_mesas(conn),
        "propinasPorTurno": propinas_por_turno(conn),
    })
}
