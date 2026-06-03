-- Permite items manuales (sin producto del catalogo) en ordenes de compra.
-- DropNotNull
ALTER TABLE "purchase_order_items" ALTER COLUMN "productId" DROP NOT NULL;
