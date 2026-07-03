-- =============================================================================
-- 0009_ai_vector_fts.sql
-- Capa de IA local: base vectorial (sqlite-vec), feedback de reconocimiento,
-- bitácora del asistente conversacional, y búsqueda full-text (FTS5).
-- Requiere cargar las extensiones: sqlite-vec y FTS5 (FTS5 viene compilado en
-- la mayoría de distribuciones de SQLite).
-- =============================================================================

-- Metadatos de embeddings (apunta a vectores en la tabla vec0) ----------------
-- owner_type: 'product_text','product_image','category'...
CREATE TABLE IF NOT EXISTS embeddings (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    owner_type  TEXT NOT NULL,
    owner_id    TEXT NOT NULL,               -- product_id / variant_id
    model       TEXT NOT NULL,               -- 'nomic-embed-text','siglip-base'...
    dim         INTEGER NOT NULL,
    source_ref  TEXT,                        -- texto o image_ref que originó el vector
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    origin_node TEXT NOT NULL,
    dirty       INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX IF NOT EXISTS idx_embeddings_owner ON embeddings (owner_type, owner_id);

-- Vectores de TEXTO de producto (búsqueda semántica del asistente) -----------
-- Ajusta la dimensión al modelo elegido (nomic-embed-text = 768).
CREATE VIRTUAL TABLE IF NOT EXISTS vec_products_text USING vec0(
    embedding_id TEXT PRIMARY KEY,
    tenant_id    TEXT,
    embedding    FLOAT[768]
);

-- Vectores VISUALES de producto (reconocimiento "ya lo vi antes") ------------
-- SigLIP/CLIP base = 768; ajusta si usas otra variante.
CREATE VIRTUAL TABLE IF NOT EXISTS vec_products_image USING vec0(
    embedding_id TEXT PRIMARY KEY,
    tenant_id    TEXT,
    embedding    FLOAT[768]
);

-- Feedback de reconocimiento (loop de aprendizaje local) ---------------------
-- Cada corrección humana mejora futuros reconocimientos vía re-embedding.
CREATE TABLE IF NOT EXISTS ai_recognitions (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    image_ref           TEXT,
    method              TEXT,                -- 'barcode','image_vec','ocr','vlm'
    predicted_json      TEXT CHECK (predicted_json IS NULL OR json_valid(predicted_json)),
    predicted_product_id TEXT,
    confidence          REAL,
    confirmed_product_id TEXT,               -- lo que el humano confirmó
    user_corrections_json TEXT CHECK (user_corrections_json IS NULL OR json_valid(user_corrections_json)),
    accepted            INTEGER,             -- 1 si la predicción fue correcta
    created_at          INTEGER NOT NULL,
    origin_node         TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ai_recognitions_product
    ON ai_recognitions (confirmed_product_id);

-- Bitácora del asistente conversacional (auditoría + evaluación de calidad) ---
CREATE TABLE IF NOT EXISTS ai_chat_log (
    id            TEXT PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    employee_id   TEXT,
    question      TEXT NOT NULL,
    tool_calls_json TEXT CHECK (tool_calls_json IS NULL OR json_valid(tool_calls_json)),
    answer        TEXT,
    model         TEXT,
    latency_ms    INTEGER,
    rating        INTEGER,                   -- feedback 👍/👎 del usuario (-1,0,1)
    created_at    INTEGER NOT NULL,
    origin_node   TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_ai_chat_created ON ai_chat_log (created_at);

-- Búsqueda full-text de productos (FTS5, content-linked a products) ----------
-- 'content=products' evita duplicar datos; los triggers (0010) la mantienen.
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    name,
    name_normalized,
    description,
    sku,
    barcode,
    content='products',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

INSERT INTO schema_migrations (version, name, applied_at, checksum)
VALUES (9, 'ai_vector_fts', unixepoch() * 1000, 'PENDING');
