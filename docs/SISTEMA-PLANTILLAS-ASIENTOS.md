# 🎯 SISTEMA DE PLANTILLAS DE ASIENTOS CONTABLES

Sistema flexible para generar asientos contables automáticamente basado en plantillas configurables.

## 📊 CONCEPTOS CLAVE

### ¿Qué es una Plantilla?

Una **plantilla de asiento contable** define:
- **Disparo**: Qué tipo de operación la activa (factura, cobro, pago, etc.)
- **Líneas**: Qué cuentas se afectan (DEBE/HABER)
- **Montos**: De dónde sale cada importe (total, subtotal, IVA, etc.)

### Ventajas del Sistema

✅ **Sin código**: Configurás una vez, se aplica automáticamente
✅ **Flexible**: El usuario puede crear nuevas plantillas sin programar
✅ **Auditable**: Todas las plantillas están documentadas y versionadas
✅ **Reutilizable**: Una plantilla se usa para miles de operaciones
✅ **Mantenible**: Cambiar la contabilización es actualizar una plantilla

---

## 🗄️ ESTRUCTURA DE BASE DE DATOS

### Tabla: `journal_entry_templates`

Plantillas de asientos contables.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | String | ID único |
| `name` | String | Nombre descriptivo |
| `code` | String | Código único (ej: "SALE_INVOICE_A") |
| `triggerType` | TriggerType | Tipo de operación que dispara |
| `description` | String | Descripción de la plantilla |
| `isActive` | Boolean | Si está activa |

### Tabla: `journal_entry_template_lines`

Líneas de cada plantilla (cuentas a afectar).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `templateId` | String | ID de la plantilla |
| `lineNumber` | Int | Orden de la línea |
| `accountId` | String | Cuenta contable |
| `side` | EntryLineSide | DEBIT (debe) o CREDIT (haber) |
| `amountType` | AmountType | Tipo de monto (TOTAL, SUBTOTAL, TAX, etc.) |
| `fixedAmount` | Decimal | Monto fijo (opcional) |
| `percentage` | Decimal | Porcentaje del total (opcional) |
| `description` | String | Descripción de la línea |

### Enums

**TriggerType**: Tipos de operaciones
- `SALE_INVOICE` - Factura de venta
- `PURCHASE_INVOICE` - Factura de compra
- `CUSTOMER_PAYMENT` - Cobro a cliente
- `SUPPLIER_PAYMENT` - Pago a proveedor
- `BANK_TRANSFER` - Transferencia bancaria
- `LOAN_DISBURSEMENT` - Desembolso de préstamo
- `LOAN_PAYMENT` - Pago de cuota de préstamo
- `EXPENSE` - Gasto
- `SALARY_PAYMENT` - Pago de sueldo
- `DEPRECIATION` - Depreciación
- `INVENTORY_ADJUSTMENT` - Ajuste de inventario
- `MANUAL` - Asiento manual

**AmountType**: Origen del monto
- `TOTAL` - Total del documento
- `SUBTOTAL` - Subtotal sin impuestos
- `TAX` - Impuestos totales
- `TAX_21` - IVA 21%
- `TAX_10_5` - IVA 10.5%
- `PERCEPTION` - Percepciones
- `RETENTION` - Retenciones
- `NET_PAYMENT` - Pago neto
- `PRINCIPAL` - Capital de préstamo
- `INTEREST` - Intereses
- `FIXED` - Monto fijo
- `PERCENTAGE` - Porcentaje del total

---

## 📋 PLANTILLAS PREDEFINIDAS

Se crearon 12 plantillas básicas:

### 1. SALE_INVOICE_A - Factura Venta Tipo A
```
DEBE:  1.1.03 (Deudores por Ventas) = TOTAL
HABER: 4.1.01 (Ventas) = SUBTOTAL
HABER: 2.1.04.001 (IVA Débito Fiscal) = TAX
```

### 2. SALE_INVOICE_B - Factura Venta Tipo B
```
DEBE:  1.1.03 (Deudores por Ventas) = TOTAL
HABER: 4.1.01 (Ventas) = TOTAL
```

### 3. PURCHASE_INVOICE_A - Factura Compra Tipo A
```
DEBE:  1.1.05.001 (Mercaderías) = SUBTOTAL
DEBE:  1.1.04.002 (IVA Crédito Fiscal) = TAX
HABER: 2.1.01 (Proveedores) = TOTAL
```

### 4-5. CUSTOMER_PAYMENT_* - Cobros a Cliente
```
DEBE:  1.1.01.001/002 (Caja/Banco) = TOTAL
HABER: 1.1.03 (Deudores por Ventas) = TOTAL
```

### 6-7. SUPPLIER_PAYMENT_* - Pagos a Proveedor
```
DEBE:  2.1.01 (Proveedores) = TOTAL
HABER: 1.1.01.001/002 (Caja/Banco) = TOTAL
```

### 8. SALARY_PAYMENT - Pago de Sueldo
```
DEBE:  5.2.01.001 (Sueldos y Jornales) = TOTAL
HABER: 2.1.03.001 (Retenciones a Depositar) = RETENTION
HABER: 1.1.01.002 (Banco) = NET_PAYMENT
```

### 9-10. LOAN_* - Préstamos
```
Desembolso:
DEBE:  1.1.01.002 (Banco) = TOTAL
HABER: 2.2.01.001 (Préstamos) = TOTAL

Pago cuota:
DEBE:  2.2.01.001 (Préstamos) = PRINCIPAL
DEBE:  5.4.01.001 (Intereses) = INTEREST
HABER: 1.1.01.002 (Banco) = TOTAL
```

### 11-12. EXPENSE_* - Gastos
```
DEBE:  5.2.02.005/5.2.03.002 (Gastos) = TOTAL
HABER: 1.1.01.001/022 (Caja/Mercado Pago) = TOTAL
```

---

## 🔧 USO DEL SISTEMA

### Aplicar Plantilla Automáticamente

```typescript
import { applyJournalTemplate } from '@/lib/contabilidad/apply-template';
import { TriggerType } from '@prisma/client';

// Al crear una factura de venta
const result = await applyJournalTemplate(
  'SALE_INVOICE_A',  // Código de plantilla
  {
    id: invoice.id,
    type: TriggerType.SALE_INVOICE,
    date: invoice.issueDate,
    description: `Factura ${invoice.invoiceNumber} - ${customer.name}`,
    total: 12100,
    subtotal: 10000,
    taxAmount: 2100,  // IVA 21%
  },
  session.user.id
);

console.log('Asiento creado:', result.journalEntry.entryNumber);
```

### Opciones Avanzadas

```typescript
await applyJournalTemplate(
  'SALE_INVOICE_A',
  sourceDocument,
  userId,
  {
    autoPost: true,        // Auto-confirmar asiento (default: true)
    validateBalance: true, // Validar Debe=Haber (default: true)
    tx: prismaTransaction, // Usar transacción existente
  }
);
```

### Validar Plantilla

```typescript
import { validateTemplate } from '@/lib/contabilidad/apply-template';

const validation = await validateTemplate('SALE_INVOICE_A');

if (!validation.valid) {
  console.error('Errores:', validation.errors);
  console.warn('Advertencias:', validation.warnings);
}
```

---

## 🔌 INTEGRACIÓN CON FACTURAS

El sistema se integra automáticamente al crear facturas:

```typescript
// src/lib/inventario/invoice-inventory.service.ts

// PASO 6A: Asiento de Venta (usando plantilla)
const saleEntry = await createSaleJournalEntry({
  id: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  invoiceType: 'A',
  customerId: invoice.customerId,
  customerName: customer.name,
  issueDate: invoice.issueDate,
  subtotal: 10000,
  taxAmount: 2100,
  total: 12100,
  currency: 'ARS',
}, userId, tx);

// PASO 6B: Asiento de CMV (costo de ventas)
const cmvEntry = await createCMVJournalEntry(tx, {
  invoiceId: invoice.id,
  invoiceNumber: invoice.invoiceNumber,
  issueDate: invoice.issueDate,
  cmvAmount: 6500,
  currency: 'ARS',
  userId,
});
```

**Resultado**: Se crean 2 asientos automáticamente:
1. **Asiento de Venta** (usando plantilla)
2. **Asiento de CMV** (costo de mercaderías vendidas)

---

## 🎨 API REST

### GET /api/contabilidad/plantillas
Listar todas las plantillas.

**Query params:**
- `isActive` - Filtrar por activas/inactivas
- `triggerType` - Filtrar por tipo de disparo

**Response:**
```json
{
  "templates": [
    {
      "id": "...",
      "code": "SALE_INVOICE_A",
      "name": "Factura de Venta Tipo A",
      "triggerType": "SALE_INVOICE",
      "isActive": true,
      "lines": [
        {
          "lineNumber": 1,
          "account": {
            "code": "1.1.03",
            "name": "Deudores por Ventas"
          },
          "side": "DEBIT",
          "amountType": "TOTAL"
        },
        ...
      ]
    }
  ]
}
```

### GET /api/contabilidad/plantillas/[code]
Obtener detalle de una plantilla.

**Response:**
```json
{
  "template": { ... },
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": []
  }
}
```

### PATCH /api/contabilidad/plantillas/[code]
Activar/desactivar plantilla.

**Body:**
```json
{
  "isActive": false
}
```

---

## 🚀 PRÓXIMOS PASOS

### FASE 2: Integración Completa
- [ ] Integrar en cobros y pagos
- [ ] Integrar en préstamos
- [ ] Integrar en gastos
- [ ] Página de gestión de plantillas

### FASE 3: Funcionalidades Avanzadas
- [ ] Crear plantillas desde UI
- [ ] Editar plantillas existentes
- [ ] Probar plantillas con datos de ejemplo
- [ ] Plantillas para operaciones complejas
- [ ] Validaciones y reglas avanzadas
- [ ] Reportes de uso de plantillas
- [ ] Versionado de plantillas
- [ ] Plantillas condicionales (if/else)

---

## 📝 NOTAS TÉCNICAS

### ¿Por qué 2 asientos en facturas?

Las facturas de venta generan **2 asientos contables**:

1. **Asiento de Venta** (usando plantilla):
   ```
   DEBE:  Deudores por Ventas    12,100
   HABER: Ventas                  10,000
   HABER: IVA Débito Fiscal        2,100
   ```

2. **Asiento de CMV** (costo):
   ```
   DEBE:  Costo de Mercaderías     6,500
   HABER: Mercaderías               6,500
   ```

Esto es correcto porque:
- El **primer asiento** registra la venta al cliente
- El **segundo asiento** registra el costo de lo vendido

### Balance del Asiento

El sistema valida automáticamente que:
```
Suma(DEBE) = Suma(HABER)
```

Si no balancea, lanza error y no crea el asiento.

### Transacciones

Todo se ejecuta dentro de una transacción de Prisma:
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Crear factura
  // 2. Actualizar stock
  // 3. Crear asiento de venta (plantilla)
  // 4. Crear asiento CMV
  // 5. Registrar actividad
});
```

Si algo falla, **todo se revierte** (rollback).

---

## 🎓 EJEMPLO COMPLETO

```typescript
// 1. Cliente compra productos por $12,100 (IVA incluido)
const invoice = {
  invoiceNumber: '0001-00000123',
  invoiceType: 'A',
  customerId: 'cust_123',
  subtotal: 10000,
  taxAmount: 2100,
  total: 12100,
  items: [
    { productId: 'prod_1', quantity: 10, unitPrice: 1000 }
  ]
};

// 2. Al procesar la factura, se generan automáticamente:

// Asiento 1 (Plantilla SALE_INVOICE_A):
// DEBE:  1.1.03 Deudores      12,100
// HABER: 4.1.01 Ventas        10,000
// HABER: 2.1.04 IVA Débito     2,100

// Asiento 2 (CMV):
// DEBE:  5.1.01 CMV            6,500
// HABER: 1.1.05 Mercaderías    6,500

// 3. También se actualiza el stock
// 4. Y se registra la actividad
```

**Resultado**: Todo automático, sin código, usando plantillas. 🎉

---

## 🔧 SEEDS

Para regenerar las plantillas:

```bash
npx tsx prisma/seed-journal-templates.ts
```

Para ver plantillas en la base de datos:

```sql
SELECT * FROM journal_entry_templates;
SELECT * FROM journal_entry_template_lines;
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

- [x] Modelos de base de datos
- [x] Sistema de aplicación de plantillas
- [x] 12 plantillas básicas seeded
- [x] Integración con facturas de venta
- [x] API REST para gestión
- [x] Documentación completa
- [ ] Interfaz de gestión de plantillas
- [ ] Tests unitarios
- [ ] Tests de integración

---

**Creado**: 2026-02-16
**Autor**: Sistema CRM Val Arg
**Versión**: 1.0.0
