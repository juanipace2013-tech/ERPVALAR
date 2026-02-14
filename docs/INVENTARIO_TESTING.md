# Guía de Testing - Módulo de Inventario

## Preparación del Entorno de Testing

### 1. Verificar Base de Datos

```bash
# Verificar que el schema está actualizado
npx prisma db push

# Verificar cuentas contables necesarias
# Debe existir:
# - 5.1.01 (Costo de Mercaderías Vendidas)
# - 1.1.05.001 (Mercaderías)
```

### 2. Crear Datos de Prueba

Necesitarás:
- Un usuario autenticado (para session)
- Un cliente
- Un producto

## Escenario de Prueba Completo

### Paso 1: Crear Producto de Prueba

```bash
POST http://localhost:3000/api/productos
Content-Type: application/json
Cookie: next-auth.session-token=...

{
  "sku": "TEST-001",
  "name": "Producto de Prueba Inventario",
  "description": "Producto para testing del módulo de inventario",
  "categoryId": null,
  "stockQuantity": 0,
  "minStock": 10,
  "unit": "UN",
  "status": "ACTIVE",
  "isTaxable": true,
  "taxRate": 21
}
```

**Guardar el `productId` de la respuesta.**

### Paso 2: Definir Precio de Costo

```bash
POST http://localhost:3000/api/productos/{productId}/precios
Content-Type: application/json

{
  "currency": "ARS",
  "priceType": "COST",
  "amount": 50.00,
  "validFrom": "2024-01-01T00:00:00Z"
}
```

### Paso 3: Registrar Compra Inicial

```bash
POST http://localhost:3000/api/inventario/movimientos
Content-Type: application/json

{
  "productId": "{productId}",
  "type": "COMPRA",
  "quantity": 100,
  "unitCost": 50.00,
  "currency": "ARS",
  "reference": "OC-TEST-001",
  "notes": "Compra inicial para testing",
  "date": "2024-01-15T00:00:00Z"
}
```

**Verificaciones:**
- ✅ Status 201
- ✅ `stockBefore` = 0
- ✅ `stockAfter` = 100
- ✅ `totalCost` = 5000.00

### Paso 4: Verificar Stock Actualizado

```bash
GET http://localhost:3000/api/productos/{productId}
```

**Verificaciones:**
- ✅ `stockQuantity` = 100

### Paso 5: Ver Historial de Stock

```bash
GET http://localhost:3000/api/inventario/productos/{productId}/stock
```

**Verificaciones:**
- ✅ Debe mostrar 1 movimiento de tipo COMPRA
- ✅ quantity = 100
- ✅ currentStock = 100

### Paso 6: Preview de Factura

```bash
POST http://localhost:3000/api/facturas/preview
Content-Type: application/json

{
  "items": [
    {
      "productId": "{productId}",
      "quantity": 10,
      "unitPrice": 100.00,
      "discount": 0,
      "taxRate": 21,
      "subtotal": 1000.00
    }
  ]
}
```

**Verificaciones:**
- ✅ `valid` = true
- ✅ `totalCMV` = 500.00 (10 × 50)
- ✅ `remainingStock` = 90
- ✅ Sin errores de stock

### Paso 7: Crear Cliente (si no existe)

```bash
POST http://localhost:3000/api/clientes
Content-Type: application/json

{
  "name": "Cliente Test Inventario",
  "cuit": "20-12345678-9",
  "type": "COMPANY",
  "taxCondition": "RESPONSABLE_INSCRIPTO",
  "status": "ACTIVE"
}
```

**Guardar el `customerId`.**

### Paso 8: Crear Factura con Integración de Inventario

```bash
POST http://localhost:3000/api/facturas
Content-Type: application/json

{
  "invoiceNumber": "0001-00000999",
  "invoiceType": "B",
  "customerId": "{customerId}",
  "currency": "ARS",
  "subtotal": 1000.00,
  "taxAmount": 210.00,
  "discount": 0,
  "total": 1210.00,
  "issueDate": "2024-01-16T00:00:00Z",
  "dueDate": "2024-02-15T00:00:00Z",
  "notes": "Factura de prueba - Módulo Inventario",
  "items": [
    {
      "productId": "{productId}",
      "quantity": 10,
      "unitPrice": 100.00,
      "discount": 0,
      "taxRate": 21,
      "subtotal": 1000.00,
      "description": "Producto de Prueba"
    }
  ]
}
```

**Verificaciones:**
- ✅ Status 201
- ✅ `success` = true
- ✅ `stockMovements` = 1
- ✅ `journalEntry.entryNumber` existe

**Guardar el `invoiceId` y `journalEntry.id`.**

### Paso 9: Verificar Stock Descontado

```bash
GET http://localhost:3000/api/productos/{productId}
```

**Verificaciones:**
- ✅ `stockQuantity` = 90 (100 - 10)

### Paso 10: Verificar Movimiento de Venta

```bash
GET http://localhost:3000/api/inventario/productos/{productId}/stock
```

**Verificaciones:**
- ✅ Debe mostrar 2 movimientos:
  1. COMPRA: quantity = 100
  2. VENTA: quantity = -10
- ✅ El movimiento VENTA debe tener:
  - `invoiceNumber` = "0001-00000999"
  - `stockBefore` = 100
  - `stockAfter` = 90
  - `unitCost` = 50.00
  - `totalCost` = 500.00

### Paso 11: Verificar Asiento Contable de CMV

```bash
GET http://localhost:3000/api/contabilidad/asientos/{journalEntryId}
```

**Verificaciones:**
- ✅ `status` = "POSTED"
- ✅ `description` contiene "CMV - Factura 0001-00000999"
- ✅ Tiene 2 líneas:
  1. DEBE: Cuenta 5.1.01 (CMV) = 500.00
  2. HABER: Cuenta 1.1.05.001 (Mercaderías) = 500.00
- ✅ Debe está balanceado: DEBE = HABER = 500.00

### Paso 12: Verificar Detalle Completo de Factura

```bash
GET http://localhost:3000/api/facturas/{invoiceId}
```

**Verificaciones:**
- ✅ Incluye `stockMovements` con 1 movimiento
- ✅ Incluye `journalEntries` con 1 asiento
- ✅ `totalCMV` = 500.00

### Paso 13: Intentar Vender Más Stock del Disponible (Debe Fallar)

```bash
POST http://localhost:3000/api/facturas
Content-Type: application/json

{
  "invoiceNumber": "0001-00001000",
  "invoiceType": "B",
  "customerId": "{customerId}",
  "currency": "ARS",
  "subtotal": 10000.00,
  "taxAmount": 2100.00,
  "discount": 0,
  "total": 12100.00,
  "issueDate": "2024-01-17T00:00:00Z",
  "dueDate": "2024-02-16T00:00:00Z",
  "items": [
    {
      "productId": "{productId}",
      "quantity": 100,
      "unitPrice": 100.00,
      "discount": 0,
      "taxRate": 21,
      "subtotal": 10000.00
    }
  ]
}
```

**Verificaciones:**
- ✅ Status 400
- ✅ Error contiene "Stock insuficiente"
- ✅ Mensaje indica: Disponible: 90, Requerido: 100

### Paso 14: Verificar que Nada Cambió (Rollback)

```bash
GET http://localhost:3000/api/productos/{productId}
```

**Verificaciones:**
- ✅ `stockQuantity` sigue siendo 90 (no cambió)
- ✅ No se creó factura 0001-00001000
- ✅ No se creó movimiento de stock
- ✅ No se creó asiento contable

### Paso 15: Ajuste Manual de Stock

```bash
POST http://localhost:3000/api/inventario/productos/{productId}/ajuste
Content-Type: application/json

{
  "newQuantity": 95,
  "reason": "Ajuste de prueba: se encontraron 5 unidades adicionales en inventario físico",
  "unitCost": 50.00
}
```

**Verificaciones:**
- ✅ Status 200
- ✅ `movement.type` = "AJUSTE_POSITIVO"
- ✅ `movement.quantity` = 5
- ✅ `movement.stockBefore` = 90
- ✅ `movement.stockAfter` = 95

### Paso 16: Verificar Stock Ajustado

```bash
GET http://localhost:3000/api/productos/{productId}
```

**Verificaciones:**
- ✅ `stockQuantity` = 95

### Paso 17: Crear Devolución de Cliente

```bash
POST http://localhost:3000/api/inventario/movimientos
Content-Type: application/json

{
  "productId": "{productId}",
  "type": "DEVOLUCION_CLIENTE",
  "quantity": 2,
  "unitCost": 50.00,
  "currency": "ARS",
  "reference": "Factura 0001-00000999",
  "notes": "Devolución por defecto de fabricación"
}
```

**Verificaciones:**
- ✅ Status 201
- ✅ `stockBefore` = 95
- ✅ `stockAfter` = 97
- ✅ `quantity` = 2

### Paso 18: Historial Completo

```bash
GET http://localhost:3000/api/inventario/productos/{productId}/stock?limit=100
```

**Verificaciones:**
- ✅ Debe mostrar 4 movimientos:
  1. DEVOLUCION_CLIENTE: +2 (stock: 95 → 97)
  2. AJUSTE_POSITIVO: +5 (stock: 90 → 95)
  3. VENTA: -10 (stock: 100 → 90)
  4. COMPRA: +100 (stock: 0 → 100)

### Paso 19: Listar Todos los Movimientos

```bash
GET http://localhost:3000/api/inventario/movimientos?limit=100
```

**Verificaciones:**
- ✅ Debe mostrar todos los movimientos del sistema
- ✅ Incluye información de producto, usuario, factura (si aplica)

### Paso 20: Filtrar Movimientos por Tipo

```bash
GET http://localhost:3000/api/inventario/movimientos?type=VENTA
```

**Verificaciones:**
- ✅ Solo muestra movimientos de tipo VENTA
- ✅ Cada uno tiene `invoiceId` y `invoiceNumber`

## Casos Edge a Probar

### 1. Producto sin Costo Definido

```bash
# Crear producto sin costo
POST /api/productos
{ "sku": "NO-COST", ... }

# Intentar vender (debe fallar)
POST /api/facturas
{ "items": [{ "productId": "{noCostProductId}", ... }] }

# Verificar error:
# ✅ Status 400
# ✅ "Producto sin costo definido"
```

### 2. Factura con Número Duplicado

```bash
# Intentar crear factura con número existente
POST /api/facturas
{ "invoiceNumber": "0001-00000999", ... }

# Verificar error:
# ✅ Status 400
# ✅ "Ya existe una factura con este número"
```

### 3. Ajuste a Cantidad Negativa (Debe Fallar)

```bash
POST /api/inventario/productos/{productId}/ajuste
{
  "newQuantity": -10,
  "reason": "Intento de cantidad negativa"
}

# Verificar error:
# ✅ Status 400
# ✅ Validación Zod falla
```

### 4. Movimiento Manual de Tipo VENTA (Debe Fallar)

```bash
POST /api/inventario/movimientos
{
  "productId": "{productId}",
  "type": "VENTA",
  "quantity": -5,
  "unitCost": 50.00
}

# Verificar error:
# ✅ Status 400
# ✅ "Tipo de movimiento no permitido para creación manual"
```

### 5. Ajuste con Mismo Stock (Debe Fallar)

```bash
# Si stock actual es 97
POST /api/inventario/productos/{productId}/ajuste
{
  "newQuantity": 97,
  "reason": "Mismo stock"
}

# Verificar error:
# ✅ Status 400
# ✅ "El nuevo stock es igual al stock actual"
```

## Verificación de Integridad

### Balance Contable

```bash
GET /api/contabilidad/balance-sumas-saldos
```

**Verificar:**
- ✅ Cuenta 5.1.01 (CMV) tiene DEBE = 500.00
- ✅ Cuenta 1.1.05.001 (Mercaderías) tiene HABER = 500.00
- ✅ Balance total está cuadrado

### Consistencia de Stock

```bash
GET /api/inventario/productos/{productId}/stock
```

**Calcular manualmente:**
```
Stock inicial: 0
+ COMPRA: 100
- VENTA: -10
+ AJUSTE_POSITIVO: 5
+ DEVOLUCION_CLIENTE: 2
= Stock final esperado: 97
```

**Verificar:**
- ✅ `currentStock` = 97
- ✅ Coincide con `Product.stockQuantity`
- ✅ Suma de `quantity` de todos los movimientos = 97

## Cleanup (Opcional)

Para limpiar datos de prueba:

```bash
# Eliminar factura (si se implementa DELETE)
DELETE /api/facturas/{invoiceId}

# Eliminar cliente
DELETE /api/clientes/{customerId}

# Eliminar producto
DELETE /api/productos/{productId}

# Nota: Los movimientos y asientos asociados deben eliminarse en cascada
```

## Resultados Esperados

Al completar todas las pruebas:

| Test | Resultado Esperado |
|------|-------------------|
| Crear producto | ✅ Stock inicial = 0 |
| Registrar compra | ✅ Stock = 100, costo guardado |
| Preview factura | ✅ Válido, CMV calculado |
| Crear factura | ✅ Stock descontado, asiento creado |
| Stock insuficiente | ✅ Error, rollback completo |
| Ajuste manual | ✅ Stock actualizado |
| Devolución | ✅ Stock incrementado |
| Historial | ✅ Todos los movimientos visibles |
| Balance contable | ✅ DEBE = HABER |
| Consistencia | ✅ Stock calculado = Stock real |

## Troubleshooting

### Error: "No autenticado"
**Solución**: Asegurarse de incluir el cookie de sesión en todas las requests.

### Error: "Cuenta contable no encontrada"
**Solución**: Ejecutar `POST /api/contabilidad/plan-cuentas/initialize`

### Error: "EPERM: operation not permitted"
**Solución**: Reiniciar el servidor de desarrollo para regenerar Prisma Client.

### Stock descuadrado
**Solución**: Verificar que no hubo errores en transacciones. Revisar logs de errores.

## Automatización (Próximamente)

Se pueden crear tests automatizados con:
- Jest + Supertest para API testing
- Prisma test helpers
- Fixtures de datos

```typescript
// Ejemplo de test automatizado
describe('Invoice with Inventory', () => {
  it('should create invoice and update stock', async () => {
    const response = await request(app)
      .post('/api/facturas')
      .send(invoiceData);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    // Verificar stock actualizado
    const product = await prisma.product.findUnique({
      where: { id: productId }
    });
    expect(product.stockQuantity).toBe(90);
  });
});
```

---

**Última actualización**: 2024-01-15
**Versión del módulo**: 1.0.0
