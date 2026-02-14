-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TaxCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_RESPONSABLE', 'RESPONSABLE_NO_INSCRIPTO');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('ARS', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('COST', 'SALE', 'LIST', 'WHOLESALE');

-- CreateEnum
CREATE TYPE "ExchangeRateSource" AS ENUM ('MANUAL', 'BANCO_CENTRAL', 'API');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "OpportunityPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('A', 'B', 'C', 'E');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'PENDING', 'AUTHORIZED', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_DELETED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED', 'OPPORTUNITY_CREATED', 'OPPORTUNITY_UPDATED', 'OPPORTUNITY_STAGE_CHANGED', 'QUOTE_CREATED', 'QUOTE_SENT', 'QUOTE_ACCEPTED', 'QUOTE_REJECTED', 'INVOICE_CREATED', 'INVOICE_SENT', 'INVOICE_PAID', 'NOTE_ADDED', 'EMAIL_SENT', 'CALL_LOGGED', 'MEETING_SCHEDULED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VENDEDOR',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "avatar" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "type" "CustomerType" NOT NULL DEFAULT 'COMPANY',
    "cuit" TEXT NOT NULL,
    "taxCondition" "TaxCondition" NOT NULL DEFAULT 'RESPONSABLE_INSCRIPTO',
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Argentina',
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditLimit" DECIMAL(12,2),
    "creditCurrency" "Currency" DEFAULT 'ARS',
    "paymentTerms" INTEGER,
    "discount" DECIMAL(5,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "brand" TEXT,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 0,
    "maxStock" INTEGER,
    "unit" TEXT NOT NULL DEFAULT 'UN',
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "isTaxable" BOOLEAN NOT NULL DEFAULT true,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 21,
    "images" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "priceType" "PriceType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "fromCurrency" "Currency" NOT NULL,
    "toCurrency" "Currency" NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "source" "ExchangeRateSource" NOT NULL DEFAULT 'MANUAL',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'LEAD',
    "priority" "OpportunityPriority" NOT NULL DEFAULT 'MEDIUM',
    "estimatedValue" DECIMAL(12,2),
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "probability" INTEGER,
    "expectedCloseDate" TIMESTAMP(3),
    "closedDate" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "customerId" TEXT NOT NULL,
    "quoteId" TEXT,
    "userId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "cae" TEXT,
    "caeExpiration" TIMESTAMP(3),
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "customers_cuit_key" ON "customers"("cuit");

-- CreateIndex
CREATE INDEX "customers_cuit_idx" ON "customers"("cuit");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_province_idx" ON "customers"("province");

-- CreateIndex
CREATE INDEX "contacts_customerId_idx" ON "contacts"("customerId");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE INDEX "categories_name_idx" ON "categories"("name");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "product_prices_productId_idx" ON "product_prices"("productId");

-- CreateIndex
CREATE INDEX "product_prices_currency_idx" ON "product_prices"("currency");

-- CreateIndex
CREATE INDEX "product_prices_priceType_idx" ON "product_prices"("priceType");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_productId_currency_priceType_validFrom_key" ON "product_prices"("productId", "currency", "priceType", "validFrom");

-- CreateIndex
CREATE INDEX "exchange_rates_fromCurrency_toCurrency_idx" ON "exchange_rates"("fromCurrency", "toCurrency");

-- CreateIndex
CREATE INDEX "exchange_rates_validFrom_idx" ON "exchange_rates"("validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_fromCurrency_toCurrency_validFrom_key" ON "exchange_rates"("fromCurrency", "toCurrency", "validFrom");

-- CreateIndex
CREATE INDEX "opportunities_customerId_idx" ON "opportunities"("customerId");

-- CreateIndex
CREATE INDEX "opportunities_userId_idx" ON "opportunities"("userId");

-- CreateIndex
CREATE INDEX "opportunities_stage_idx" ON "opportunities"("stage");

-- CreateIndex
CREATE INDEX "opportunities_expectedCloseDate_idx" ON "opportunities"("expectedCloseDate");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_quoteNumber_key" ON "quotes"("quoteNumber");

-- CreateIndex
CREATE INDEX "quotes_customerId_idx" ON "quotes"("customerId");

-- CreateIndex
CREATE INDEX "quotes_opportunityId_idx" ON "quotes"("opportunityId");

-- CreateIndex
CREATE INDEX "quotes_userId_idx" ON "quotes"("userId");

-- CreateIndex
CREATE INDEX "quotes_status_idx" ON "quotes"("status");

-- CreateIndex
CREATE INDEX "quotes_quoteNumber_idx" ON "quotes"("quoteNumber");

-- CreateIndex
CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");

-- CreateIndex
CREATE INDEX "quote_items_productId_idx" ON "quote_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_quoteId_key" ON "invoices"("quoteId");

-- CreateIndex
CREATE INDEX "invoices_customerId_idx" ON "invoices"("customerId");

-- CreateIndex
CREATE INDEX "invoices_userId_idx" ON "invoices"("userId");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_invoiceNumber_idx" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_issueDate_idx" ON "invoices"("issueDate");

-- CreateIndex
CREATE INDEX "invoices_dueDate_idx" ON "invoices"("dueDate");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_items_productId_idx" ON "invoice_items"("productId");

-- CreateIndex
CREATE INDEX "activities_userId_idx" ON "activities"("userId");

-- CreateIndex
CREATE INDEX "activities_entityType_entityId_idx" ON "activities"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activities_customerId_idx" ON "activities"("customerId");

-- CreateIndex
CREATE INDEX "activities_opportunityId_idx" ON "activities"("opportunityId");

-- CreateIndex
CREATE INDEX "activities_createdAt_idx" ON "activities"("createdAt");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

