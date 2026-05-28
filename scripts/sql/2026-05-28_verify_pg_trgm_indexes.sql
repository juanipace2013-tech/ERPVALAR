-- =============================================================================
-- Verificación post-creación de los índices GIN trigram en products.
-- =============================================================================
--
-- Correr DESPUÉS de aplicar 2026-05-28_add_pg_trgm_indexes.sql.
-- Solo SELECT/EXPLAIN, no modifica nada. Seguro de re-ejecutar.
--
-- =============================================================================
-- CHECK 1 — Listar índices presentes en products
-- =============================================================================
-- Esperado: ver idx_products_sku_trgm, idx_products_name_trgm,
-- idx_products_brand_trgm con method=gin, indisvalid=true.

SELECT
  i.relname AS index_name,
  am.amname AS method,
  ix.indisunique AS is_unique,
  ix.indisvalid AS is_valid,
  pg_size_pretty(pg_relation_size(i.oid)) AS size
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_am am ON am.oid = i.relam
WHERE t.relname = 'products'
ORDER BY i.relname;


-- =============================================================================
-- CHECK 2 — Confirmar que pg_trgm está instalado
-- =============================================================================
-- Esperado: una fila con extname='pg_trgm'.

SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_trgm';


-- =============================================================================
-- CHECK 3 — EXPLAIN ANALYZE de la query problemática original
-- =============================================================================
-- Simula la query que genera Prisma para el endpoint /api/productos con
-- search='2094' y status='ACTIVE'. Reemplazá '2094' por un término real para
-- testear con tu data.
--
-- Esperado en el plan DESPUÉS de los índices:
--   - "Bitmap Heap Scan on products"
--   - debajo: "BitmapOr" combinando:
--       - "Bitmap Index Scan on idx_products_sku_trgm"
--       - "Bitmap Index Scan on idx_products_name_trgm"
--       - "Bitmap Index Scan on idx_products_brand_trgm"
--   - "Filter: (status = 'ACTIVE'::"ProductStatus")"
--   - Execution Time bajo (<1ms para términos selectivos en cache).
--
-- Si en el plan ves "Seq Scan on products" en vez del BitmapOr, los índices
-- existen pero el optimizer no los usó (selectividad insuficiente o ANALYZE
-- desactualizado). Probar con `ANALYZE products;` y reintentar.

EXPLAIN ANALYZE
SELECT COUNT(*) FROM (
  SELECT products.id
  FROM products
  WHERE (
    products.sku ILIKE '%2094%'
    OR products.name ILIKE '%2094%'
    OR products.brand ILIKE '%2094%'
  )
  AND products.status = 'ACTIVE'
) sub;


-- =============================================================================
-- CHECK 4 — EXPLAIN ANALYZE de la variante que trae los datos
-- =============================================================================
-- Esta es la otra query del top consumo (20.8% del total) — el SELECT real
-- que carga los campos. Mismo plan esperado.

EXPLAIN ANALYZE
SELECT id, sku, name, brand, "stockQuantity", "listPriceUSD", status
FROM products
WHERE (
  sku ILIKE '%2094%'
  OR name ILIKE '%2094%'
  OR brand ILIKE '%2094%'
)
AND status = 'ACTIVE'
ORDER BY name ASC
LIMIT 20;


-- =============================================================================
-- CHECK 5 — Smoke test contra el endpoint /api/inventory/search-products
-- =============================================================================
-- Este endpoint solo filtra sku/name (no brand). Confirma que dos GIN cubren
-- el caso.

EXPLAIN ANALYZE
SELECT id, sku, name, brand
FROM products
WHERE (sku ILIKE '%2094%' OR name ILIKE '%2094%')
AND status = 'ACTIVE'
ORDER BY name ASC
LIMIT 10;


-- =============================================================================
-- CHECK 6 — Costo de escritura: tamaño total de los GIN
-- =============================================================================
-- Útil para monitorear el overhead. Esperado: cada GIN entre 1-5 MB para
-- 12.7k filas. Aceptable.

SELECT
  relname AS index_name,
  pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class
WHERE relname IN (
  'idx_products_sku_trgm',
  'idx_products_name_trgm',
  'idx_products_brand_trgm'
);

-- FIN DE VERIFICACIÓN
