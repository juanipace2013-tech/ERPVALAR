# ASIENTOS CONTABLES AUTOMÁTICOS - PAGOS Y COBROS

## ✅ IMPLEMENTACIÓN COMPLETADA

Se implementó la generación automática de asientos contables para:
- ✅ **Pagos a proveedores**
- ✅ **Cobros a clientes**

---

## 📋 ASIENTOS GENERADOS AUTOMÁTICAMENTE

### 1. COBRO A CLIENTE (Efectivo)
```
DEBE:  Caja Chica (1.1.01.002)          = Monto cobrado
HABER: Créditos por Ventas (1.1.03)     = Monto cobrado
```

### 2. COBRO A CLIENTE (Transferencia/Banco)
```
DEBE:  Banco Cuenta Corriente (1.1.01.003) = Monto cobrado
HABER: Créditos por Ventas (1.1.03)         = Monto cobrado
```

### 3. PAGO A PROVEEDOR (Efectivo)
```
DEBE:  Proveedores (2.1.01.001)        = Monto pagado
HABER: Caja Chica (1.1.01.002)         = Monto pagado
```

### 4. PAGO A PROVEEDOR (Transferencia/Banco)
```
DEBE:  Proveedores (2.1.01.001)           = Monto pagado
HABER: Banco Cuenta Corriente (1.1.01.003) = Monto pagado
```

---

## 🔧 ARCHIVOS CREADOS/MODIFICADOS

### 1. **Base de Datos** - `prisma/schema.prisma`

#### Nuevo Modelo: CustomerReceipt
```prisma
model CustomerReceipt {
  id            String        @id @default(cuid())
  customerId    String
  customer      Customer      @relation("CustomerReceipts", fields: [customerId], references: [id])

  invoiceId     String?       // Factura asociada (opcional)
  invoice       Invoice?      @relation(fields: [invoiceId], references: [id])

  amount        Decimal       @db.Decimal(15, 2)
  currency      String        @default("ARS")
  receiptDate   DateTime      @default(now())
  method        String        // CASH, TRANSFER, DEBIT, CREDIT, CHECK
  reference     String?       // Número de referencia
  notes         String?

  userId        String
  user          User          @relation(fields: [userId], references: [id])

  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@map("customer_receipts")
}
```

### 2. **Funciones Contables** - `src/lib/payment-accounting.ts`

#### Funciones Exportadas:

**`registerSupplierPayment()`**
- Registra pago a proveedor
- Genera asiento contable automático
- Actualiza saldo del proveedor
- Actualiza saldo de orden de compra (si aplica)
- Actualiza saldos de cuentas contables

**`registerCustomerReceipt()`**
- Registra cobro a cliente
- Genera asiento contable automático
- Actualiza saldo del cliente
- Actualiza saldo de factura (si aplica)
- Actualiza saldos de cuentas contables

**`registerPurchasePayment()`** *(ya existía)*
- Registra pago a factura de compra específica
- Similar a `registerSupplierPayment` pero vinculado a factura

#### Lógica de Cuentas por Método de Pago:

```typescript
CASH      → Caja Chica (1.1.01.002)
TRANSFER  → Banco Cuenta Corriente (1.1.01.003)
DEBIT     → Banco Cuenta Corriente (1.1.01.003)
CREDIT    → Banco Cuenta Corriente (1.1.01.003)
CHECK     → Valores a Depositar (1.1.01.005)
```

### 3. **API: Pagos a Proveedores** - `src/app/api/proveedores/[id]/pagos/route.ts`

#### Modificado:
- Ahora usa `registerSupplierPayment()` del módulo contable
- Genera asiento automáticamente al crear el pago
- Retorna tanto el pago como el asiento generado

**Endpoint:** `POST /api/proveedores/[id]/pagos`

**Request Body:**
```json
{
  "amount": 1500,
  "method": "CASH",           // CASH | TRANSFER | DEBIT | CREDIT | CHECK
  "paymentDate": "2026-02-16",
  "reference": "CHQ-001",     // Opcional
  "notes": "Pago a cuenta",   // Opcional
  "purchaseOrderId": "..."    // Opcional
}
```

**Response:**
```json
{
  "payment": {
    "id": "...",
    "amount": 1500,
    "method": "CASH",
    ...
  },
  "journalEntry": {
    "id": "...",
    "entryNumber": 5
  }
}
```

### 4. **API: Cobros a Clientes** - `src/app/api/clientes/[id]/cobros/route.ts`

#### Nuevo archivo creado:
- Implementa `GET` y `POST` para cobros a clientes
- Usa `registerCustomerReceipt()` del módulo contable
- Genera asiento automáticamente al crear el cobro

**Endpoint:** `POST /api/clientes/[id]/cobros`

**Request Body:**
```json
{
  "amount": 1000,
  "method": "TRANSFER",       // CASH | TRANSFER | DEBIT | CREDIT | CHECK
  "receiptDate": "2026-02-16",
  "reference": "TRANSF-123",  // Opcional
  "notes": "Cobro factura",   // Opcional
  "invoiceId": "..."          // Opcional
}
```

**Response:**
```json
{
  "receipt": {
    "id": "...",
    "amount": 1000,
    "method": "TRANSFER",
    ...
  },
  "journalEntry": {
    "id": "...",
    "entryNumber": 6
  }
}
```

---

## 🧪 TESTING

### Script de Prueba: `scripts/test-payment-accounting.ts`

El script de prueba verifica:

1. ✅ Creación de proveedor y cliente de prueba
2. ✅ Pago a proveedor en efectivo ($1,500)
   - Genera asiento DEBE Proveedores / HABER Caja
   - Actualiza saldo del proveedor
3. ✅ Pago a proveedor por transferencia ($2,000)
   - Genera asiento DEBE Proveedores / HABER Banco
   - Actualiza saldo del proveedor
4. ✅ Cobro a cliente en efectivo ($1,000)
   - Genera asiento DEBE Caja / HABER Créditos por Ventas
   - Actualiza saldo del cliente
5. ✅ Cobro a cliente por transferencia ($1,500)
   - Genera asiento DEBE Banco / HABER Créditos por Ventas
   - Actualiza saldo del cliente

**Para ejecutar:**
```bash
npx tsx scripts/test-payment-accounting.ts
```

---

## 🔄 FLUJO DE TRABAJO

### Registrar Pago a Proveedor:
```
1. Usuario crea pago vía API → POST /api/proveedores/{id}/pagos
2. Sistema valida datos
3. Sistema inicia transacción
4. Crea registro de pago
5. Actualiza saldo del proveedor (decrementa)
6. Genera asiento contable:
   - DEBE: Proveedores
   - HABER: Caja/Banco (según método)
7. Actualiza saldos de cuentas contables
8. Confirma transacción
9. Retorna pago + asiento generado
```

### Registrar Cobro a Cliente:
```
1. Usuario crea cobro vía API → POST /api/clientes/{id}/cobros
2. Sistema valida datos
3. Sistema inicia transacción
4. Crea registro de cobro
5. Actualiza saldo del cliente (decrementa)
6. Si hay factura asociada, actualiza su balance
7. Genera asiento contable:
   - DEBE: Caja/Banco (según método)
   - HABER: Créditos por Ventas
8. Actualiza saldos de cuentas contables
9. Confirma transacción
10. Retorna cobro + asiento generado
```

---

## ✅ VALIDACIONES IMPLEMENTADAS

### En Pagos:
- ✅ Proveedor debe existir
- ✅ Monto debe ser mayor a cero
- ✅ Cuenta contable de Proveedores debe existir
- ✅ Cuenta contable de pago (Caja/Banco) debe existir
- ✅ Usuario debe estar autenticado

### En Cobros:
- ✅ Cliente debe existir
- ✅ Monto debe ser mayor a cero
- ✅ Si hay factura asociada, debe existir
- ✅ Cuenta contable de Créditos por Ventas debe existir
- ✅ Cuenta contable de cobro (Caja/Banco) debe existir
- ✅ Usuario debe estar autenticado

---

## 📊 ACTUALIZACIÓN DE SALDOS

### Automáticamente se actualizan:

1. **Saldo del Proveedor/Cliente** (tabla suppliers/customers)
   - Campo `balance` se decrementa con el pago/cobro

2. **Saldo de la Factura** (si aplica)
   - Campo `balance` se decrementa
   - Campo `paymentStatus` se actualiza a PAID si saldo = 0

3. **Saldos de Cuentas Contables** (tabla chart_of_accounts)
   - `debitBalance` incrementa en cuentas al DEBE
   - `creditBalance` incrementa en cuentas al HABER

4. **Asiento Contable** (tabla journal_entries)
   - Estado: `POSTED` (confirmado automáticamente)
   - Incluye referencia al pago/cobro

---

## 🎯 PRÓXIMOS PASOS

### Opcional - Mejoras Futuras:

1. **UI para Pagos/Cobros**
   - Interfaz en el detalle del proveedor/cliente
   - Formulario para registrar pagos/cobros
   - Lista de pagos/cobros históricos

2. **Anulación de Pagos/Cobros**
   - Función para anular un pago/cobro
   - Generar asiento contable de reversa
   - Restaurar saldos

3. **Conciliación Bancaria**
   - Match de pagos/cobros con extractos bancarios
   - Detección de diferencias
   - Ajustes automáticos

4. **Reportes**
   - Estado de cuenta por proveedor
   - Estado de cuenta por cliente
   - Flujo de caja por método de pago
   - Antigüedad de saldos

---

## 📝 NOTAS IMPORTANTES

1. **Transacciones Atómicas**: Todo se ejecuta en transacción, si falla algo, nada se guarda

2. **Asientos Automáticos**: Los asientos se marcan como `POSTED` automáticamente

3. **Numeración**: Los asientos obtienen número secuencial automático

4. **Auditoría**: Cada pago/cobro guarda el `userId` de quien lo registró

5. **Métodos de Pago**: Se mapean automáticamente a cuentas contables

6. **Integración**: Compatible con el sistema de plantillas existente

---

## 🎉 RESULTADO FINAL

El sistema ahora genera **automáticamente** asientos contables dobles para:
- ✅ Todos los pagos a proveedores
- ✅ Todos los cobros a clientes
- ✅ Con actualización de saldos
- ✅ Con validaciones completas
- ✅ Con transacciones atómicas
- ✅ Con auditoría completa

**No se requiere intervención manual** para la contabilización de pagos y cobros.
