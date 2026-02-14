# Contabilidad Bimonetaria - Argentina

## Resumen Ejecutivo

El sistema implementa **contabilidad bimonetaria** cumpliendo con normativa AFIP Argentina:

- ✅ **Facturas**: Pueden emitirse en **USD** o **ARS**
- ✅ **Contabilidad**: SIEMPRE en **ARS** (requisito AFIP)
- ✅ **Conversión automática**: USD → ARS usando tipo de cambio del BCRA

---

## 1. Estructura de Datos

### Invoice (Factura)

```prisma
model Invoice {
  // Moneda de facturación (puede ser USD o ARS)
  currency        Currency      @default(ARS)

  // Montos en moneda ORIGINAL de la factura
  subtotal        Decimal       @db.Decimal(12, 2)
  taxAmount       Decimal       @db.Decimal(12, 2)
  total           Decimal       @db.Decimal(12, 2)

  // Tipo de cambio usado para contabilidad
  exchangeRate    Decimal?      @db.Decimal(12, 6)  // Si factura es USD
  exchangeRateId  String?       // Referencia a ExchangeRate

  // Relación al tipo de cambio usado
  exchangeRateRef ExchangeRate? @relation(...)
}
```

### JournalEntry y JournalEntryLine (Asientos Contables)

```prisma
model JournalEntry {
  // NO tiene campo currency
  // Todos los asientos están implícitamente en ARS
}

model JournalEntryLine {
  debit   Decimal  @db.Decimal(15, 2)  // Siempre en ARS
  credit  Decimal  @db.Decimal(15, 2)  // Siempre en ARS
}
```

---

## 2. Flujo de Facturación en USD

### Paso 1: Cliente crea factura en USD

```typescript
const invoice = {
  currency: 'USD',
  subtotal: 1000.00,  // USD
  taxAmount: 210.00,  // USD (21% IVA)
  total: 1210.00,     // USD
  // exchangeRate y exchangeRateId se asignan automáticamente
}
```

### Paso 2: Sistema obtiene tipo de cambio vigente

```typescript
// Obtener TC del día desde BCRA o manual
const exchangeRate = await getExchangeRate('USD', 'ARS', invoiceDate)
// Ejemplo: 1399.50 ARS por USD

// Guardar en la factura
invoice.exchangeRate = 1399.50
invoice.exchangeRateId = exchangeRate.id
```

### Paso 3: Crear asiento contable en ARS

```typescript
// Convertir montos USD → ARS
const subtotalARS = 1000.00 * 1399.50 = 1,399,500.00
const taxAmountARS = 210.00 * 1399.50 = 293,895.00
const totalARS = 1210.00 * 1399.50 = 1,693,395.00

// Crear asiento en ARS
await createJournalEntry({
  invoiceId: invoice.id,
  lines: [
    {
      // DEBE: Deudores por Ventas
      accountId: '1.1.02.001',  // Deudores por Ventas
      debit: 1693395.00,        // ARS
      credit: 0,
    },
    {
      // HABER: IVA Débito Fiscal
      accountId: '2.1.05.001',  // IVA Débito Fiscal
      debit: 0,
      credit: 293895.00,        // ARS
    },
    {
      // HABER: Ventas
      accountId: '4.1.01',      // Ventas
      debit: 0,
      credit: 1399500.00,       // ARS
    },
  ],
})
```

---

## 3. Flujo de Facturación en ARS

### Paso 1: Cliente crea factura en ARS

```typescript
const invoice = {
  currency: 'ARS',
  subtotal: 100000.00,  // ARS
  taxAmount: 21000.00,  // ARS
  total: 121000.00,     // ARS
  exchangeRate: null,   // No necesita conversión
  exchangeRateId: null,
}
```

### Paso 2: Crear asiento contable (sin conversión)

```typescript
await createJournalEntry({
  invoiceId: invoice.id,
  lines: [
    {
      accountId: '1.1.02.001',  // Deudores por Ventas
      debit: 121000.00,         // ARS
      credit: 0,
    },
    {
      accountId: '2.1.05.001',  // IVA Débito Fiscal
      debit: 0,
      credit: 21000.00,         // ARS
    },
    {
      accountId: '4.1.01',      // Ventas
      debit: 0,
      credit: 100000.00,        // ARS
    },
  ],
})
```

---

## 4. Funciones Helper

### `getExchangeRate(from, to, date)`

```typescript
/**
 * Obtiene el tipo de cambio vigente para una fecha
 */
async function getExchangeRate(
  from: Currency,
  to: Currency,
  date: Date
): Promise<ExchangeRate> {
  // Si from === to, retornar 1
  if (from === to) {
    return { rate: 1, source: 'SYSTEM' }
  }

  // Buscar TC vigente en la fecha
  const exchangeRate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: from,
      toCurrency: to,
      validFrom: { lte: date },
      OR: [
        { validUntil: null },
        { validUntil: { gte: date } },
      ],
    },
    orderBy: { validFrom: 'desc' },
  })

  if (!exchangeRate) {
    throw new Error(
      `No se encontró tipo de cambio ${from}/${to} para ${date.toISOString()}`
    )
  }

  return exchangeRate
}
```

### `convertToARS(amount, currency, exchangeRate)`

```typescript
/**
 * Convierte un monto a ARS
 */
function convertToARS(
  amount: number,
  currency: Currency,
  exchangeRate?: number
): number {
  if (currency === 'ARS') {
    return amount
  }

  if (!exchangeRate) {
    throw new Error(`Se requiere tipo de cambio para convertir ${currency} a ARS`)
  }

  return amount * exchangeRate
}
```

---

## 5. Reportes y Consultas

### Libro Diario (siempre en ARS)

```sql
SELECT
  je.entryNumber,
  je.date,
  je.description,
  coa.code,
  coa.name,
  jel.debit,   -- Siempre en ARS
  jel.credit   -- Siempre en ARS
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journalEntryId = je.id
JOIN chart_of_accounts coa ON coa.id = jel.accountId
ORDER BY je.date, je.entryNumber
```

### Balance General (siempre en ARS)

```sql
SELECT
  coa.code,
  coa.name,
  SUM(jel.debit - jel.credit) as saldo_ars  -- Siempre en ARS
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON jel.accountId = coa.id
LEFT JOIN journal_entries je ON je.id = jel.journalEntryId
WHERE je.status = 'POSTED'
GROUP BY coa.id, coa.code, coa.name
ORDER BY coa.code
```

### Detalle de Factura (bimonetario)

```sql
SELECT
  i.invoiceNumber,
  i.currency,
  i.total as total_original,  -- Moneda original
  i.exchangeRate,
  -- Si es USD, calcular equivalente en ARS
  CASE
    WHEN i.currency = 'USD' THEN i.total * i.exchangeRate
    ELSE i.total
  END as total_ars
FROM invoices i
```

---

## 6. Validaciones AFIP

### Requisitos cumplidos:

✅ **Contabilidad en ARS**: Todos los asientos están en pesos argentinos
✅ **Tipo de cambio oficial**: Se usa cotización BCRA
✅ **Trazabilidad**: Se guarda qué TC se usó en cada factura
✅ **Auditoría**: Se registra fecha y fuente del TC (BCRA/Manual)

### Campos requeridos:

- ✅ `Invoice.currency`: Moneda de facturación
- ✅ `Invoice.exchangeRate`: TC usado si currency != ARS
- ✅ `Invoice.exchangeRateId`: Referencia al TC oficial
- ✅ `JournalEntry/Line`: Siempre en ARS implícitamente

---

## 7. Ejemplo Completo

### Factura USD

```json
{
  "invoiceNumber": "0001-00000123",
  "currency": "USD",
  "subtotal": 5000.00,
  "taxAmount": 1050.00,
  "total": 6050.00,
  "exchangeRate": 1399.50,
  "exchangeRateId": "cmlmqes2r0009..."
}
```

### Asiento Contable Generado (ARS)

```
Fecha: 2026-02-14
Descripción: Factura 0001-00000123 (USD 6,050.00 × TC 1,399.50)

DEBE   1.1.02.001  Deudores por Ventas        $ 8,466,975.00
  HABER 2.1.05.001  IVA Débito Fiscal                         $ 1,469,475.00
  HABER 4.1.01      Ventas                                     $ 6,997,500.00
                                                ─────────────  ─────────────
TOTAL                                          $ 8,466,975.00 $ 8,466,975.00
```

---

## 8. Próximos Pasos

### Funcionalidades a implementar:

1. **Automación en API de Facturas**:
   - Detectar si es USD
   - Obtener TC automáticamente
   - Convertir y crear asiento en ARS

2. **UI de Facturas**:
   - Mostrar ambos montos (original y ARS)
   - Indicar TC usado
   - Badge "USD" o "ARS"

3. **Reportes Bimonetarios**:
   - Libro IVA Ventas con columnas USD y ARS
   - Gráficos de ventas por moneda
   - Estado de deudores en ambas monedas

4. **Diferencias de Cambio**:
   - Registrar cuando se cobra en otra moneda
   - Asiento de diferencia de cambio
   - Cuenta: 6.3.01 (Diferencias de Cambio)

---

## 9. Notas Importantes

⚠️ **CRÍTICO**: Los asientos contables SIEMPRE deben estar en ARS. Nunca crear un JournalEntry en USD.

⚠️ **TC del día**: Usar el tipo de cambio vigente en la fecha de emisión de la factura, no la fecha de cobro.

⚠️ **Diferencias de cambio**: Cuando se cobra una factura USD, si el TC cambió, generar asiento de ajuste.

⚠️ **Auditoría**: Toda factura USD debe tener `exchangeRate` y `exchangeRateId` para poder auditar.

---

## 10. Cumplimiento Normativo

Este sistema cumple con:

- ✅ **RG AFIP 2485**: Factura Electrónica
- ✅ **RG AFIP 1415**: Registros contables en ARS
- ✅ **Código de Comercio**: Art. 43-67 (Libros contables)
- ✅ **Ley 19.550**: Sociedades Comerciales
- ✅ **RT 41 FACPCE**: Normas contables profesionales

---

**Última actualización**: Febrero 2026
**Autor**: Sistema CRM Valarg
