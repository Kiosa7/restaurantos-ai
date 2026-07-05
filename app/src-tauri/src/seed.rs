//! Semilla demo del hub — MISMOS ids que usaba `app/src/infra/memory/seedMenu.ts`
//! (Fase 3) para que el frontend, al pasar de datos locales a `GET /menu` y
//! `GET /tables` reales (Fase 6 §10.1), no tenga que cambiar ni un id. Es el
//! mismo menú/mesas que ya se veía en el prototipo, ahora respaldado por SQLite.
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

/// Mismo esquema de hash que pos-inteligente (`app/src/app/usecases/pin.ts`:
/// `sha256("pos:pin:" + pin)`), namespaced para este sistema. Verificado del
/// lado del hub (`POST /auth/pin`), no en el cliente — a diferencia de
/// pos-inteligente (un solo dispositivo), aquí cualquier terminal debe poder
/// autenticar a cualquier empleado contra el hub.
pub fn hash_pin(pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("restaurantos:pin:{pin}").as_bytes());
    format!("{:x}", hasher.finalize())
}

pub const TENANT: &str = "t1";
pub const LOCATION: &str = "l1";
pub const REGISTER: &str = "r1";
pub const NODE: &str = "t1:l1:hub";
pub const ROLE_MESERO: &str = "role-mesero";
pub const ROLE_COCINA: &str = "role-cocina";
pub const ROLE_CAJERO: &str = "role-cajero";
pub const EMPLOYEE_MESERO: &str = "e-mesero";
pub const EMPLOYEE_COCINA: &str = "e-cocina";
pub const EMPLOYEE_CAJERO: &str = "e-cajero";
pub const TAX_IVA: &str = "tax-iva-16";
pub const PROFILE_IVA: &str = "prof-iva";
pub const UNIT_PIEZA: &str = "unit-pieza";
pub const CFDI_ISSUER: &str = "cfdi-issuer-demo";
pub const VIRTUAL_TABLE_TAKEAWAY: &str = "table-take-away";
pub const VIRTUAL_TABLE_DELIVERY: &str = "table-delivery";

/// course inferido por categoría (MVP: no hay columna `course` en `products`,
/// ver docs/db/schema-overview-restaurante.md — limitación conocida).
pub fn course_for_category(category_id: &str) -> &'static str {
    match category_id {
        "cat_entradas" => "entrada",
        "cat_fuertes" => "fuerte",
        "cat_bebidas" => "bebida",
        "cat_postres" => "postre",
        _ => "fuerte",
    }
}

pub fn seed(conn: &Connection, now: i64) {
    conn.execute(
        "INSERT OR IGNORE INTO tenants (id,name,currency,created_at,updated_at,origin_node) VALUES (?1,?2,'MXN',?3,?3,?4)",
        params![TENANT, "Restaurante Demo", now, NODE],
    ).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO locations (id,tenant_id,name,code,created_at,updated_at,origin_node) VALUES (?1,?2,'Sucursal Centro','A',?3,?3,?4)",
        params![LOCATION, TENANT, now, NODE],
    ).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO registers (id,location_id,name,device_node,created_at,updated_at,origin_node) VALUES (?1,?2,'Caja principal',?4,?3,?3,?4)",
        params![REGISTER, LOCATION, now, NODE],
    ).unwrap();

    // Capacidades por rol (docs/permisos-plugins.md) — el LLM y las pantallas
    // consultan esto, no hardcodean el nombre del rol.
    for (role_id, name, permissions) in [
        (ROLE_MESERO, "Mesero", r#"["order.create","order.view_own"]"#),
        (ROLE_COCINA, "Cocina", r#"["kitchen.bump","kitchen.view"]"#),
        (ROLE_CAJERO, "Cajero", r#"["cash.checkout","cash.open_shift","cash.close_shift","order.view_all","backup.manage"]"#),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO roles (id,tenant_id,name,permissions_json,is_system,created_at,updated_at,origin_node) VALUES (?1,?2,?3,?4,1,?5,?5,?6)",
            params![role_id, TENANT, name, permissions, now, NODE],
        ).unwrap();
    }
    // PINs demo (documentados aquí, NO son un mecanismo de seguridad real
    // para producción — ver docs/spikes/spike-6-rbac-pin.md).
    for (emp_id, role_id, name, pin) in [
        (EMPLOYEE_MESERO, ROLE_MESERO, "Ana (mesera)", "1111"),
        (EMPLOYEE_COCINA, ROLE_COCINA, "Beto (cocina)", "2222"),
        (EMPLOYEE_CAJERO, ROLE_CAJERO, "Carla (caja)", "3333"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO employees (id,tenant_id,role_id,name,pin_hash,created_at,updated_at,origin_node) VALUES (?1,?2,?3,?4,?5,?6,?6,?7)",
            params![emp_id, TENANT, role_id, name, hash_pin(pin), now, NODE],
        ).unwrap();
    }

    conn.execute(
        "INSERT OR IGNORE INTO taxes (id,tenant_id,name,rate,kind,included,created_at,updated_at,origin_node) VALUES (?1,?2,'IVA 16%',0.16,'percent',1,?3,?3,?4)",
        params![TAX_IVA, TENANT, now, NODE],
    ).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO tax_profiles (id,tenant_id,name,tax_ids_json,created_at,updated_at,origin_node) VALUES (?1,?2,'IVA general',?3,?4,?4,?5)",
        params![PROFILE_IVA, TENANT, format!("[\"{TAX_IVA}\"]"), now, NODE],
    ).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO units (id,tenant_id,name,factor,allow_fraction,created_at,updated_at,origin_node) VALUES (?1,?2,'pieza',1,1,?3,?3,?4)",
        params![UNIT_PIEZA, TENANT, now, NODE],
    ).unwrap();

    for (id, name) in [
        ("cat_entradas", "Entradas"),
        ("cat_fuertes", "Fuertes"),
        ("cat_bebidas", "Bebidas"),
        ("cat_postres", "Postres"),
        ("cat_insumos", "Insumos"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO categories (id,tenant_id,name,created_at,updated_at,origin_node) VALUES (?1,?2,?3,?4,?4,?5)",
            params![id, TENANT, name, now, NODE],
        ).unwrap();
    }

    // Insumos (para la receta de tacos al pastor) ---------------------------
    for (id, name, cost_cents) in [
        ("insumo-cebolla", "Cebolla (kg)", 1200_i64),
        ("insumo-tortilla", "Tortilla de maíz (pieza)", 100),
        ("insumo-carne-pastor", "Carne al pastor (kg)", 9000),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO products (id,tenant_id,name,name_normalized,category_id,unit_id,cost,price,tax_profile_id,track_stock,source,created_at,updated_at,origin_node)
             VALUES (?1,?2,?3,?3,'cat_insumos',?4,?5,0,?6,1,'manual',?7,?7,?8)",
            params![id, TENANT, name, UNIT_PIEZA, cost_cents, PROFILE_IVA, now, NODE],
        ).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO inventory_movements (id,tenant_id,location_id,product_id,type,qty_delta,unit_cost,created_at,origin_node)
             VALUES (?1,?2,?3,?4,'initial',1000,?5,?6,?7)",
            params![format!("mov-init-{id}"), TENANT, LOCATION, id, cost_cents, now, NODE],
        ).unwrap();
    }

    // Menú (mismos ids que el prototipo de Fase 3: seedMenu.ts) -------------
    let menu = [
        ("mi_tacos_pastor", "Tacos al pastor", "cat_fuertes", 9000_i64),
        ("mi_quesadilla_flor", "Quesadilla de flor de calabaza", "cat_entradas", 6500),
        ("mi_agua_horchata", "Agua de horchata", "cat_bebidas", 3500),
        ("mi_flan", "Flan napolitano", "cat_postres", 4500),
    ];
    for (id, name, category, price_cents) in menu {
        conn.execute(
            "INSERT OR IGNORE INTO products (id,tenant_id,name,name_normalized,category_id,unit_id,cost,price,tax_profile_id,track_stock,source,created_at,updated_at,origin_node)
             VALUES (?1,?2,?3,?3,?4,?5,0,?6,?7,0,'manual',?8,?8,?9)",
            params![id, TENANT, name, category, UNIT_PIEZA, price_cents, PROFILE_IVA, now, NODE],
        ).unwrap();
    }

    // Receta de los tacos: 3 tortillas + 0.15kg carne + 0.02kg cebolla -------
    conn.execute(
        "INSERT OR IGNORE INTO recipes (id,tenant_id,product_id,yield_qty,created_at,updated_at,origin_node) VALUES ('recipe-tacos-pastor',?1,'mi_tacos_pastor',1,?2,?2,?3)",
        params![TENANT, now, NODE],
    ).unwrap();
    for (ingredient, qty) in [("insumo-tortilla", 3.0_f64), ("insumo-carne-pastor", 0.15), ("insumo-cebolla", 0.02)] {
        conn.execute(
            "INSERT OR IGNORE INTO recipe_items (id,recipe_id,ingredient_id,qty,unit_id,created_at,updated_at,origin_node)
             VALUES (?1,'recipe-tacos-pastor',?2,?3,?4,?5,?5,?6)",
            params![format!("ri-{ingredient}"), ingredient, qty, UNIT_PIEZA, now, NODE],
        ).unwrap();
    }

    // Modificadores -----------------------------------------------------------
    conn.execute(
        "INSERT OR IGNORE INTO modifier_groups (id,tenant_id,product_id,name,single_choice,required,sort_order,created_at,updated_at,origin_node)
         VALUES ('mg_salsa',?1,'mi_tacos_pastor','Salsa',1,1,0,?2,?2,?3)",
        params![TENANT, now, NODE],
    ).unwrap();
    for (id, name, delta) in [("op_salsa_verde", "Verde", 0_i64), ("op_salsa_roja", "Roja", 0), ("op_salsa_ambas", "Ambas", 0)] {
        conn.execute(
            "INSERT OR IGNORE INTO modifier_options (id,group_id,name,price_delta,sort_order,created_at,updated_at,origin_node) VALUES (?1,'mg_salsa',?2,?3,0,?4,?4,?5)",
            params![id, name, delta, now, NODE],
        ).unwrap();
    }
    conn.execute(
        "INSERT OR IGNORE INTO modifier_groups (id,tenant_id,product_id,name,single_choice,required,sort_order,created_at,updated_at,origin_node)
         VALUES ('mg_tamano',?1,'mi_agua_horchata','Tamaño',1,1,0,?2,?2,?3)",
        params![TENANT, now, NODE],
    ).unwrap();
    for (id, name, delta) in [("op_chica", "Chica", 0_i64), ("op_grande", "Grande", 1500)] {
        conn.execute(
            "INSERT OR IGNORE INTO modifier_options (id,group_id,name,price_delta,sort_order,created_at,updated_at,origin_node) VALUES (?1,'mg_tamano',?2,?3,0,?4,?4,?5)",
            params![id, name, delta, now, NODE],
        ).unwrap();
    }

    // Mesas (mismos ids/números/estados que el FloorPlan de Fase 3) ---------
    let tables = [
        ("table-1", 1_i64, "libre", 4_i64, None::<&str>),
        ("table-2", 2, "ocupada", 2, None),
        ("table-3", 3, "por_limpiar", 6, None),
        ("table-4", 4, "libre", 4, None),
        ("table-5", 5, "reservada", 8, None),
        // Mesas virtuales (Fase 7 §10.1 punto 6): delivery/para llevar
        // reutilizan TODO el pipeline de comandas sin tocarlo — ver
        // docs/db/migrations/0019_reservaciones_delivery.sql.
        (VIRTUAL_TABLE_TAKEAWAY, 90, "libre", 999, Some("virtual")),
        (VIRTUAL_TABLE_DELIVERY, 91, "libre", 999, Some("virtual")),
    ];
    for (id, number, status, capacity, zone) in tables {
        conn.execute(
            "INSERT OR IGNORE INTO tables (id,tenant_id,location_id,number,capacity,status,zone,created_at,updated_at,origin_node)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?9)",
            params![id, TENANT, LOCATION, number, capacity, status, zone, now, NODE],
        ).unwrap();
    }

    // Config de reparto de propinas (individual por default, PLAN.md §7) ----
    conn.execute(
        "INSERT OR IGNORE INTO tip_pool_configs (id,tenant_id,location_id,mode,kitchen_share,active_from,created_at,updated_at,origin_node)
         VALUES ('tip-config-default',?1,?2,'individual',0,?3,?3,?3,?4)",
        params![TENANT, LOCATION, now, NODE],
    ).unwrap();

    // Emisor CFDI demo (Fase 7): RFC genérico de pruebas del SAT, NO uno
    // real — sustituir antes de timbrar de verdad (⛔ spike 3, sin cuenta de
    // PAC todavía).
    conn.execute(
        "INSERT OR IGNORE INTO cfdi_issuers (id,tenant_id,rfc,razon_social,regimen_fiscal,lugar_expedicion,pac_provider,created_at,updated_at,origin_node)
         VALUES (?1,?2,'XAXX010101000','Restaurante Demo SA de CV','601','06000','sw_sapien',?3,?3,?4)",
        params![CFDI_ISSUER, TENANT, now, NODE],
    ).unwrap();

    log::info!("hub: seed demo aplicado (idempotente)");
}
