-- =============================================================================
-- 0015_cfdi.sql
-- Modelo de datos CFDI 4.0 (México), diseñado en Fase 4 sobre la estructura
-- oficial del SAT — independiente del PAC elegido (spike 3: SW Sapien
-- primario, Facturama fallback). El TIMBRADO real (llamar al PAC) se
-- implementa en Fase 7; este esquema solo modela el documento fiscal.
-- Una `sales` (0006) cobrada es la fuente de los conceptos; el CFDI es un
-- documento DERIVADO, nunca al revés (docs/modelo-dominio.md).
-- =============================================================================

-- Datos del emisor (el negocio). Un tenant normalmente tiene 1, pero se
-- modela 1-a-N por si el dueño factura bajo distintas razones sociales.
CREATE TABLE IF NOT EXISTS cfdi_issuers (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    rfc             TEXT NOT NULL,
    razon_social    TEXT NOT NULL,
    regimen_fiscal  TEXT NOT NULL,             -- clave SAT c_RegimenFiscal
    lugar_expedicion TEXT NOT NULL,            -- código postal
    pac_provider    TEXT NOT NULL DEFAULT 'sw_sapien' CHECK (pac_provider IN ('sw_sapien','facturama')),
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER,
    version         INTEGER NOT NULL DEFAULT 1,
    origin_node     TEXT NOT NULL,
    hlc             TEXT,
    dirty           INTEGER NOT NULL DEFAULT 1
) STRICT;

-- Documento CFDI (factura, nota de crédito, o complemento de pago) -----------
CREATE TABLE IF NOT EXISTS cfdi_documents (
    id                  TEXT PRIMARY KEY,          -- UUID v7 interno (no confundir con folio fiscal del SAT)
    tenant_id           TEXT NOT NULL REFERENCES tenants(id),
    location_id         TEXT NOT NULL REFERENCES locations(id),
    issuer_id           TEXT NOT NULL REFERENCES cfdi_issuers(id),
    sale_id             TEXT REFERENCES sales(id), -- NULL si es factura global (varias ventas del día)
    tipo_comprobante    TEXT NOT NULL DEFAULT 'I'
                        CHECK (tipo_comprobante IN ('I','E','P')), -- Ingreso/Egreso(NC)/Pago
    serie               TEXT,
    folio               TEXT NOT NULL,
    rfc_receptor        TEXT NOT NULL,
    nombre_receptor     TEXT NOT NULL,
    uso_cfdi            TEXT NOT NULL DEFAULT 'G03',   -- clave SAT c_UsoCFDI (G03 = Gastos en general)
    forma_pago          TEXT NOT NULL DEFAULT '01',    -- 01=efectivo, 04=tarjeta crédito, etc.
    metodo_pago         TEXT NOT NULL DEFAULT 'PUE' CHECK (metodo_pago IN ('PUE','PPD')),
    moneda              TEXT NOT NULL DEFAULT 'MXN',
    subtotal            INTEGER NOT NULL,             -- centavos
    iva                 INTEGER NOT NULL,
    total               INTEGER NOT NULL,
    relaciona_uuid      TEXT,                         -- CFDI relacionado (p.ej. NC relaciona a la factura original)
    tipo_relacion       TEXT,                          -- clave SAT c_TipoRelacion
    estado              TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','timbrado','error','cancelado')),
    uuid_fiscal         TEXT,                          -- folio fiscal (UUID) que regresa el PAC al timbrar
    xml                 TEXT,                          -- XML timbrado completo
    sat_seal            TEXT,                          -- sello/QR del PAC
    pac_error_json      TEXT CHECK (pac_error_json IS NULL OR json_valid(pac_error_json)),
    motivo_cancelacion  TEXT,                          -- clave SAT 01-04
    timbrado_at         INTEGER,
    cancelado_at        INTEGER,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    origin_node         TEXT NOT NULL,
    hlc                 TEXT,
    dirty               INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cfdi_documents_folio
    ON cfdi_documents (location_id, serie, folio);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_sale ON cfdi_documents (sale_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_estado ON cfdi_documents (estado);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_pending
    ON cfdi_documents (tenant_id) WHERE estado = 'pendiente'; -- cola de timbrado offline

-- Conceptos (líneas) del CFDI, snapshot de sale_items -------------------------
CREATE TABLE IF NOT EXISTS cfdi_conceptos (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES cfdi_documents(id),
    sale_item_id         TEXT REFERENCES sale_items(id),
    clave_prod_serv     TEXT NOT NULL,           -- clave SAT c_ClaveProdServ
    clave_unidad        TEXT NOT NULL,           -- clave SAT c_ClaveUnidad
    descripcion         TEXT NOT NULL,
    cantidad             REAL NOT NULL,
    valor_unitario       INTEGER NOT NULL,       -- centavos
    importe              INTEGER NOT NULL,
    objeto_impuesto      TEXT NOT NULL DEFAULT '02', -- clave SAT c_ObjetoImp (02 = sí objeto de impuesto)
    created_at            INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cfdi_conceptos_document ON cfdi_conceptos (document_id);

-- Complemento de pago (para ventas PPD, o pagos diferidos de banquetes/eventos)
CREATE TABLE IF NOT EXISTS cfdi_pago_complementos (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES cfdi_documents(id),   -- el CFDI tipo P
    documento_relacionado_uuid TEXT NOT NULL,     -- UUID de la factura PPD que se está pagando
    monto                INTEGER NOT NULL,        -- centavos
    forma_pago           TEXT NOT NULL,
    fecha_pago           INTEGER NOT NULL,
    created_at            INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_cfdi_pago_complementos_document ON cfdi_pago_complementos (document_id);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (15, 'cfdi', unixepoch() * 1000, 'PENDING');
