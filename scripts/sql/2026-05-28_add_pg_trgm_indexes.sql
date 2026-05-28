-- =============================================================================
-- Migración manual: índices GIN trigram para búsqueda de productos por texto.
-- =============================================================================
--
-- Motivación: la query top de Supabase Query Performance (29% + 20.8% del
-- consumo total de la base, 11.4k + 9.2k llamadas) era una búsqueda ILIKE
-- combinada sobre sku/name/brand de products. La tabla tiene 12.738 filas y
-- el plan reportaba "No indexes involved" → full sequential scan en cada hit.
--
-- Endpoints que se benefician (todos hacen ILIKE sobre sku/name[/brand]):
--   - GET /api/productos                       (sku, name, brand) ← causa raíz del 49% del consumo
--   - GET /api/inventory/search-products       (sku, name)
--   - GET /api/inventory/export-items          (sku, name, brand)
--
-- Estos índices habilitan que el ILIKE '%...%' use Bitmap Index Scan en vez
-- de Seq Scan, llevando los tiempos típicos de 2.4ms (con tabla en cache) a
-- sub-milisegundo y, más importante, dejando libre la CPU del proceso de
-- Postgres bajo carga.
--
-- =============================================================================
-- INSTRUCCIONES DE EJECUCIÓN
-- =============================================================================
--
-- ⚠️ NO ejecutar todo el archivo de una. Pegar y ejecutar UN STATEMENT POR VEZ
-- en el SQL Editor de Supabase. Razones:
--
-- 1) CREATE INDEX CONCURRENTLY no puede correr dentro de una transacción. El
--    SQL Editor de Supabase, según el modo de ejecución, puede envolver
--    múltiples statements en una transacción implícita. Ejecutar uno por uno
--    evita ese problema.
-- 2) Cada CREATE INDEX CONCURRENTLY puede tardar varios segundos (no bloquea
--    la tabla, pero requiere dos escaneos completos internos). Mejor ver el
--    progreso individual.
-- 3) Si una creación falla a la mitad (corte de red, cancelación, etc.),
--    Postgres deja un índice "INVALID". El "IF NOT EXISTS" no detecta esos.
--    Ver query de limpieza al final.
--
-- Orden recomendado:
--   Statement 1: CREATE EXTENSION pg_trgm   (rápido, idempotente)
--   Statement 2: idx_products_sku_trgm
--   Statement 3: idx_products_name_trgm
--   Statement 4: idx_products_brand_trgm
--
-- Después de los 4: correr la query de verificación de
-- 2026-05-28_verify_pg_trgm_indexes.sql para confirmar uso de índice.
--
-- =============================================================================
-- STATEMENT 1 — Extensión pg_trgm
-- =============================================================================
-- Habilita gin_trgm_ops (operador class de GIN para búsquedas por trigrama).
-- Idempotente. Ejecutar primero.

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- =============================================================================
-- STATEMENT 2 — Índice GIN trigram sobre products.sku
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_sku_trgm
  ON products USING gin (sku gin_trgm_ops);


-- =============================================================================
-- STATEMENT 3 — Índice GIN trigram sobre products.name
-- =============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);


-- =============================================================================
-- STATEMENT 4 — Índice GIN trigram sobre products.brand
-- =============================================================================
-- brand es nullable; GIN admite filas con NULL sin problema (las excluye del
-- índice). Las consultas ILIKE de Prisma comparan con un valor concreto, así
-- que los productos sin brand siguen funcionando vía los otros dos índices.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_brand_trgm
  ON products USING gin (brand gin_trgm_ops);


-- =============================================================================
-- LIMPIEZA EN CASO DE ÍNDICE INVÁLIDO
-- =============================================================================
-- Si una creación CONCURRENTLY se interrumpió, queda un índice marcado como
-- INVALID que ocupa espacio pero no se usa. Detectarlo y eliminarlo:
--
--   SELECT relname FROM pg_class c JOIN pg_index i ON c.oid = i.indexrelid
--   WHERE i.indisvalid = false AND c.relname LIKE 'idx_products_%';
--
--   -- Por cada nombre devuelto:
--   DROP INDEX CONCURRENTLY <nombre>;
--
-- Y volver a correr el CREATE correspondiente.


-- =============================================================================
-- NOTAS SOBRE EL ÍNDICE de products.status (NO se toca acá)
-- =============================================================================
-- La query problemática también filtra por `status = 'ACTIVE'`. Ya existe
-- @@index([status]) (Prisma schema.prisma:807) → idx_products_status B-tree.
-- NO conviene crear otro índice de status:
--   - El enum tiene 3 valores (ACTIVE/INACTIVE/DISCONTINUED) y se espera que
--     >90% de los productos sean ACTIVE → baja selectividad → el optimizer
--     prefiere seq scan al status solo.
--   - Una vez agregados los GIN trigram, el plan típico será BitmapOr de los
--     3 GIN seguido de un Heap Scan que aplica el filter status. El índice de
--     status existente queda como respaldo pero no se usa para esta query.
--   - Crear otro índice solo agrega costo de escritura sin mejorar nada.

-- FIN DEL SCRIPT
