# Esquema de base de datos local (SQLite) — Convenciones

> Fuente de verdad del esquema = **suma ordenada de las migraciones** en `migrations/`.
> No hay un `schema.sql` monolítico que mantener en paralelo (evita divergencia).
> El estado actual de una BD se reconstruye aplicando `0001 → 000N` en orden.

## 1. Motor y modo

- **SQLite 3.37+** con tablas **`STRICT`** (tipado real: rechaza valores de tipo incorrecto).
- **WAL** activo para lecturas concurrentes con escritura (UI fluida durante una venta).
- Cifrado en reposo con **SQLCipher** (la app abre con la llave; el DDL es idéntico).
- Ruta de evolución a **libSQL** sin cambios de dialecto.

### PRAGMAs de arranque (se aplican en CADA apertura de conexión, no son migración)

```sql
PRAGMA journal_mode = WAL;          -- lecturas concurrentes
PRAGMA synchronous  = NORMAL;       -- balance seguridad/velocidad (FULL en TX de dinero)
PRAGMA foreign_keys = ON;           -- integridad referencial
PRAGMA busy_timeout = 5000;         -- espera en vez de fallar por lock
PRAGMA temp_store   = MEMORY;
PRAGMA mmap_size    = 268435456;    -- 256MB mmap si el SO lo permite
PRAGMA cache_size   = -65536;       -- ~64MB de cache de página
PRAGMA wal_autocheckpoint = 1000;
PRAGMA optimize;                    -- al cerrar/periódicamente
```

## 2. Convenciones transversales

### 2.1 Claves primarias
- **`id TEXT PRIMARY KEY`** = **UUID v7** generado por la app (string de 36 chars).
  - Globalmente único → multi-sucursal sin colisiones.
  - Ordenable por tiempo → buena localidad de índice (mejor que UUID v4).
  - SQLite no genera UUID; lo produce la capa de aplicación.

### 2.2 Tiempo
- Todos los timestamps son **`INTEGER` = epoch en milisegundos, UTC**.
- Nunca texto de fecha local; el formateo es responsabilidad de la UI.

### 2.3 Dinero
- Montos en **`INTEGER` = unidades menores** (centavos). Nunca `REAL` para dinero.
- `currency TEXT` (ISO 4217) acompaña montos multi-moneda.

### 2.4 Cantidades
- `qty REAL` (admite fraccional: kg, litros, metros). La unidad la define `unit_id`.

### 2.5 Columnas de sincronización/auditoría (en TODA tabla operativa)
```
created_at   INTEGER NOT NULL          -- epoch ms
updated_at   INTEGER NOT NULL          -- epoch ms (trigger lo mantiene)
deleted_at   INTEGER                   -- soft delete (NULL = vivo); habilita sync de borrados
version      INTEGER NOT NULL DEFAULT 1-- concurrencia optimista / orden de cambios
origin_node  TEXT    NOT NULL          -- dispositivo/sucursal que escribió (tie-break de conflictos)
hlc          TEXT                      -- Hybrid Logical Clock del último cambio (orden entre nodos)
dirty        INTEGER NOT NULL DEFAULT 1-- 1 = pendiente de sync; el sync worker lo pone en 0
```

### 2.6 Datos flexibles por vertical
- `attributes_json TEXT` (validado como JSON) para atributos específicos de plugin
  (farmacia: lote/caducidad; ropa: talla/color) sin alterar el esquema núcleo.
- Usar `json_valid()` en CHECK para garantizar JSON bien formado.

### 2.7 Borrado
- **Soft delete** vía `deleted_at`. El borrado físico solo lo hace el archivado/mantenimiento.
- Tablas append-only (movimientos, ventas, auditoría, outbox) **nunca** se editan ni borran.

### 2.8 Inmutabilidad e integridad
- `inventory_movements`, `sales`, `payments`, `audit_log`, `outbox` son **append-only**.
- `sales`/`audit_log` usan **encadenamiento por hash** (`prev_hash`, `hash`) → manipulación evidente.
- El stock (`inventory.qty`) es una **materialización** recalculable desde `inventory_movements`.

## 3. Orden de migraciones

| # | Archivo | Contenido |
|---|---|---|
| 0001 | meta_sync_audit | `schema_migrations`, `outbox`, `sync_state`, `audit_log` |
| 0002 | org_auth | `tenants`, `locations`, `registers`, `roles`, `employees` |
| 0003 | tax_catalog | `taxes`, `tax_profiles`, `brands`, `categories`, `units`, `products`, `product_variants`, `product_barcodes` |
| 0004 | inventory | `inventory`, `inventory_movements` |
| 0005 | parties | `customers`, `suppliers`, `supplier_prices` |
| 0006 | sales | `sales`, `sale_items`, `payments` |
| 0007 | purchases_cash | `purchases`, `purchase_items`, `cash_sessions`, `cash_movements` |
| 0008 | promotions_settings | `promotions`, `settings` |
| 0009 | ai_vector_fts | `embeddings` (vec0), `ai_recognitions`, `ai_chat_log`, FTS5 de productos |
| 0010 | triggers | `updated_at`, outbox, materialización de stock, FTS sync, hash de auditoría |

## 4. Estrategia de índices (resumen)

- Búsqueda de venta: `products(barcode)`, `product_barcodes(barcode)`, `products(sku)`, FTS5 sobre `name/description`.
- Reportes: `sales(location_id, datetime)`, `sale_items(product_id)`, `inventory_movements(product_id, created_at)`.
- Sync: índice parcial `WHERE dirty = 1` en cada tabla operativa.
- Multi-tenant/sucursal: prefijo `tenant_id`/`location_id` en índices compuestos.

## 5. Mantenimiento programado

- `PRAGMA wal_checkpoint(TRUNCATE)` y `PRAGMA optimize` periódicos.
- `ANALYZE` tras cargas grandes.
- `VACUUM` nocturno ocasional (cuidado: reescribe el archivo).
- `PRAGMA integrity_check` semanal + verificación de la cadena de hash de ventas.
- Archivado de `sales`/`*_movements`/`audit_log` antiguos a tablas/archivo histórico.
