-- AlterTable: RouteStop.packages from Int to String (text libre para bultos)
-- Convierte valores existentes de integer a texto

ALTER TABLE "RouteStop" ALTER COLUMN "packages" SET DATA TYPE TEXT USING "packages"::TEXT;
ALTER TABLE "RouteStop" ALTER COLUMN "packages" SET DEFAULT '';
