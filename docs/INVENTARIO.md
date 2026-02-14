# Módulo de Inventario con Asientos Automáticos de CMV

## Descripción General

El módulo de inventario implementa un sistema completo de gestión de stock con integración automática al sistema contable. Cuando se crea una factura, el sistema:

1. ✅ Valida disponibilidad de stock
2. ✅ Calcula el CMV (Costo de Mercadería Vendida)
3. ✅ Descuenta stock automáticamente
4. ✅ Genera asientos contables de CMV
5. ✅ Registra auditoría completa

## Características Principales

### 1. Tipos de Movimientos de Stock

- **COMPRA**: Entrada de mercadería por compra a proveedor
- **VENTA**: Salida automática por venta a cliente (generada al crear factura)
- **AJUSTE_POSITIVO**: Incremento manual de stock
- **AJUSTE_NEGATIVO**: Decremento manual de stock
- **DEVOLUCION_CLIENTE**: Entrada por devolución de cliente
- **DEVOLUCION_PROVEEDOR**: Salida por devolución a proveedor

### 2. Método de Costeo

**Costo Promedio Ponderado**

El sistema usa el último costo de compra para calcular el CMV:

1. Busca el último movimiento de tipo COMPRA o AJUSTE_POSITIVO
2. Si no existe, busca en ProductPrice con priceType = COST
3. Si no encuentra costo, falla la operación

### 3. Asientos Contables Automáticos

Al crear una factura, se genera automáticamente:

```
Asiento CMV
-----------
DEBE:  5.1.01 (Costo de Mercaderías Vendidas) = CMV total
HABER: 1.1.05.001 (Mercaderías) = CMV total
Estado: POSTED (automático)
```

## Arquitectura

### Estructura de Archivos

```
src/lib/inventario/
├── types.ts                          # Interfaces TypeScript
├── validations.ts                    # Schemas Zod
├── stock.service.ts                  # Gestión de movimientos
├── cmv.service.ts                    # Cálculo de CMV
└── invoice-inventory.service.ts      # Integración factura-inventario

src/lib/contabilidad/
└── journal-entry.helper.ts           # Helper para asientos automáticos

src/app/api/inventario/
├── movimientos/
│   ├── route.ts                      # GET (listar), POST (crear manual)
│   └── [id]/route.ts                 # GET (detalle)
└── productos/[id]/
    ├── stock/route.ts                # GET (historial de stock)
    └── ajuste/route.ts               # POST (ajuste manual)

src/app/api/facturas/
├── route.ts                          # GET (listar), POST (crear con inventario)
├── preview/route.ts                  # POST (preview antes de crear)
└── [id]/route.ts                     # GET (detalle con inventario)
```

### Flujo de Creación de Factura

```
POST /api/facturas
       ↓
Validar datos (Zod)
       ↓
Validar stock disponible
       ↓
Calcular CMV
       ↓
TRANSACCIÓN ATÓMICA:
  1. Crear Invoice
  2. Crear InvoiceItems
  3. Crear StockMovements (tipo VENTA)
  4. Actualizar Product.stockQuantity
  5. Crear JournalEntry (CMV)
  6. Vincular asiento a movimientos
  7. Registrar Activity
       ↓
   SUCCESS
```

## API Endpoints

### Inventario

#### 1. Listar Movimientos de Stock

```http
GET /api/inventario/movimientos?productId={id}&type={type}&limit=100
```

**Query Parameters:**
- `productId` (opcional): Filtrar por producto
- `type` (opcional): Tipo de movimiento (COMPRA, VENTA, etc.)
- `startDate` (opcional): Fecha inicio
- `endDate` (opcional): Fecha fin
- `limit` (opcional): Límite de resultados (default: 100)
- `offset` (opcional): Offset para paginación (default: 0)

**Response:**
```json
{
  "movements": [
    {
      "id": "clx...",
      "productId": "clx...",
      "type": "VENTA",
      "quantity": -10,
      "unitCost": 50.00,
      "totalCost": 500.00,
      "stockBefore": 100,
      "stockAfter": 90,
      "date": "2024-01-15T10:00:00Z",
      "product": { "name": "Producto A" },
      "user": { "name": "Juan Pérez" },
      "invoice": { "invoiceNumber": "0001-00000123" }
    }
  ],
  "count": 1
}
```

#### 2. Crear Movimiento Manual

```http
POST /api/inventario/movimientos
Content-Type: application/json

{
  "productId": "clx...",
  "type": "COMPRA",
  "quantity": 100,
  "unitCost": 45.50,
  "currency": "ARS",
  "reference": "OC-2024-001",
  "notes": "Compra a Proveedor XYZ",
  "date": "2024-01-15T00:00:00Z"
}
```

**Tipos permitidos para creación manual:**
- COMPRA
- AJUSTE_POSITIVO
- AJUSTE_NEGATIVO
- DEVOLUCION_CLIENTE
- DEVOLUCION_PROVEEDOR

**Response:**
```json
{
  "id": "clx...",
  "productId": "clx...",
  "type": "COMPRA",
  "quantity": 100,
  "unitCost": 45.50,
  "totalCost": 4550.00,
  "stockBefore": 0,
  "stockAfter": 100,
  "date": "2024-01-15T00:00:00Z"
}
```

#### 3. Historial de Stock por Producto

```http
GET /api/inventario/productos/{id}/stock?limit=100
```

**Response:**
```json
{
  "productId": "clx...",
  "productName": "Producto A",
  "currentStock": 90,
  "movements": [
    {
      "id": "clx...",
      "date": "2024-01-15T10:00:00Z",
      "type": "VENTA",
      "quantity": -10,
      "unitCost": 50.00,
      "totalCost": 500.00,
      "stockBefore": 100,
      "stockAfter": 90,
      "invoiceNumber": "0001-00000123",
      "userName": "Juan Pérez"
    }
  ]
}
```

#### 4. Ajustar Stock Manualmente

```http
POST /api/inventario/productos/{id}/ajuste
Content-Type: application/json

{
  "newQuantity": 95,
  "reason": "Ajuste por inventario físico realizado el 15/01/2024",
  "unitCost": 50.00
}
```

**Nota**: El sistema calculará automáticamente si es AJUSTE_POSITIVO o AJUSTE_NEGATIVO.

**Response:**
```json
{
  "success": true,
  "message": "Ajuste de stock realizado correctamente",
  "movement": {
    "id": "clx...",
    "type": "AJUSTE_POSITIVO",
    "quantity": 5,
    "stockBefore": 90,
    "stockAfter": 95
  }
}
```

### Facturas

#### 5. Preview de Factura

```http
POST /api/facturas/preview
Content-Type: application/json

{
  "items": [
    {
      "productId": "clx...",
      "quantity": 10,
      "unitPrice": 100.00,
      "taxRate": 21,
      "subtotal": 1000.00
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "preview": {
    "valid": true,
    "stockErrors": [],
    "totalCMV": 500.00,
    "currency": "ARS",
    "products": [
      {
        "productId": "clx...",
        "productName": "Producto A",
        "currentStock": 90,
        "requestedQuantity": 10,
        "remainingStock": 80,
        "unitCost": 50.00,
        "totalCost": 500.00
      }
    ]
  }
}
```

#### 6. Crear Factura con Inventario

```http
POST /api/facturas
Content-Type: application/json

{
  "invoiceNumber": "0001-00000124",
  "invoiceType": "B",
  "customerId": "clx...",
  "currency": "ARS",
  "subtotal": 1000.00,
  "taxAmount": 210.00,
  "discount": 0,
  "total": 1210.00,
  "issueDate": "2024-01-16T00:00:00Z",
  "dueDate": "2024-02-15T00:00:00Z",
  "items": [
    {
      "productId": "clx...",
      "quantity": 10,
      "unitPrice": 100.00,
      "discount": 0,
      "taxRate": 21,
      "subtotal": 1000.00,
      "description": "Producto A"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Factura creada correctamente",
  "invoice": {
    "id": "clx...",
    "invoiceNumber": "0001-00000124",
    "status": "AUTHORIZED",
    "total": 1210.00,
    "items": [...]
  },
  "stockMovements": 1,
  "journalEntry": {
    "id": "clx...",
    "entryNumber": 45
  }
}
```

#### 7. Detalle de Factura

```http
GET /api/facturas/{id}
```

**Response:** Incluye factura completa + movimientos de stock + asientos contables

## Validaciones Implementadas

### Al Crear Factura

1. ✅ Número de factura único
2. ✅ Cliente existe
3. ✅ Productos existen
4. ✅ Stock suficiente para todos los ítems
5. ✅ Todos los productos tienen costo definido
6. ✅ Validación de datos con Zod

### Al Crear Movimiento Manual

1. ✅ Producto existe
2. ✅ Cantidad no es cero
3. ✅ Costo unitario positivo
4. ✅ Stock no queda negativo (después del movimiento)
5. ✅ Tipo de movimiento permitido para creación manual

## Transaccionalidad

**CRÍTICO**: Todas las operaciones de facturación se ejecutan en una transacción atómica de Prisma:

```typescript
await prisma.$transaction(async (tx) => {
  // Todas las operaciones aquí
}, {
  maxWait: 10000,  // 10 segundos
  timeout: 30000,  // 30 segundos
});
```

Si cualquier paso falla, se hace **rollback automático** de todo.

## Manejo de Concurrencia

Para evitar race conditions, se usa actualización atómica:

```typescript
const updated = await tx.product.updateMany({
  where: {
    id: productId,
    stockQuantity: { gte: quantityRequired }, // Verificar en WHERE
  },
  data: {
    stockQuantity: { decrement: quantityRequired },
  },
});

if (updated.count === 0) {
  throw new Error('Stock insuficiente o concurrencia detectada');
}
```

## Casos de Uso

### Caso 1: Compra de Inventario

```bash
# 1. Crear movimiento de compra
POST /api/inventario/movimientos
{
  "productId": "prod-123",
  "type": "COMPRA",
  "quantity": 100,
  "unitCost": 45.50,
  "reference": "OC-2024-001"
}

# Resultado:
# - Stock: 0 → 100
# - Costo guardado: 45.50
```

### Caso 2: Venta con Factura

```bash
# 1. Preview (opcional)
POST /api/facturas/preview
{
  "items": [
    { "productId": "prod-123", "quantity": 10, ... }
  ]
}

# 2. Crear factura
POST /api/facturas
{
  "invoiceNumber": "0001-00000001",
  "customerId": "customer-123",
  "items": [
    { "productId": "prod-123", "quantity": 10, "unitPrice": 100 }
  ],
  ...
}

# Resultado automático:
# - Stock: 100 → 90
# - Movimiento VENTA creado: quantity = -10
# - CMV calculado: 10 × 45.50 = 455.00
# - Asiento contable:
#   DEBE:  5.1.01 (CMV) = 455.00
#   HABER: 1.1.05.001 (Mercaderías) = 455.00
# - Factura status: AUTHORIZED
```

### Caso 3: Ajuste de Inventario

```bash
# Ajustar stock después de conteo físico
POST /api/inventario/productos/prod-123/ajuste
{
  "newQuantity": 85,
  "reason": "Conteo físico - diferencia por merma"
}

# Resultado:
# - Stock: 90 → 85
# - Movimiento AJUSTE_NEGATIVO: quantity = -5
```

### Caso 4: Devolución de Cliente

```bash
POST /api/inventario/movimientos
{
  "productId": "prod-123",
  "type": "DEVOLUCION_CLIENTE",
  "quantity": 2,
  "unitCost": 45.50,
  "reference": "Factura 0001-00000001",
  "notes": "Devolución por defecto"
}

# Resultado:
# - Stock: 85 → 87
```

## Testing

### Escenario de Prueba Completo

```bash
# 1. Verificar producto inicial
GET /api/productos/prod-123
# stock: 0

# 2. Comprar inventario
POST /api/inventario/movimientos
{
  "productId": "prod-123",
  "type": "COMPRA",
  "quantity": 100,
  "unitCost": 50.00
}

# 3. Verificar stock actualizado
GET /api/productos/prod-123
# stock: 100

# 4. Crear factura (venta)
POST /api/facturas
{
  "items": [{ "productId": "prod-123", "quantity": 10, ... }],
  ...
}

# 5. Verificar resultados
GET /api/productos/prod-123
# stock: 90

GET /api/inventario/productos/prod-123/stock
# Debe mostrar:
# - COMPRA: +100
# - VENTA: -10

GET /api/contabilidad/asientos
# Debe existir asiento CMV:
# - DEBE 5.1.01: 500.00
# - HABER 1.1.05.001: 500.00

# 6. Intentar vender más de lo disponible (debe fallar)
POST /api/facturas
{
  "items": [{ "productId": "prod-123", "quantity": 100, ... }],
  ...
}
# Error 400: Stock insuficiente
```

## Consideraciones Importantes

### ⚠️ Antes de Usar en Producción

1. **Verificar cuentas contables**: Asegurarse que existen:
   - 5.1.01 (Costo de Mercaderías Vendidas)
   - 1.1.05.001 (Mercaderías)

2. **Definir costos iniciales**: Todos los productos deben tener:
   - Un registro en ProductPrice con priceType = COST, O
   - Al menos un movimiento de COMPRA

3. **Configurar permisos**: Definir qué roles pueden:
   - Crear movimientos manuales
   - Ajustar stock
   - Crear facturas

### ⚠️ Limitaciones Actuales

1. **Solo asientos de CMV**: No genera asientos de venta (ingresos/IVA)
2. **Un solo almacén**: No soporta múltiples depósitos
3. **Solo costo promedio**: No implementa FIFO/LIFO
4. **Sin anulación**: Los movimientos no se pueden eliminar (solo crear compensatorios)

### 🚀 Funcionalidades Futuras

- Múltiples almacenes/depósitos
- Métodos de costeo alternativos (FIFO, LIFO)
- Generación completa de asientos de venta
- Reportes de rotación de inventario
- Alertas de stock bajo/alto
- Kardex detallado por producto
- Valoración de inventario
- Integración con compras a proveedores

## Troubleshooting

### Error: "Producto sin costo definido"

**Solución**: Crear un movimiento de COMPRA o definir ProductPrice:

```bash
POST /api/inventario/movimientos
{
  "productId": "prod-123",
  "type": "COMPRA",
  "quantity": 1,
  "unitCost": 50.00
}
```

### Error: "Stock insuficiente"

**Solución**: Verificar stock actual y ajustar si es necesario:

```bash
GET /api/inventario/productos/prod-123/stock
POST /api/inventario/productos/prod-123/ajuste
{
  "newQuantity": 100,
  "reason": "Ajuste inicial de inventario"
}
```

### Error: "Cuenta contable no encontrada"

**Solución**: Inicializar plan de cuentas:

```bash
POST /api/contabilidad/plan-cuentas/initialize
```

## Soporte

Para reportar bugs o solicitar features:
- GitHub Issues: [URL del repositorio]
- Email: soporte@empresa.com

## Changelog

### v1.0.0 (2024-01-15)
- ✅ Implementación inicial del módulo de inventario
- ✅ Integración con facturación
- ✅ Asientos automáticos de CMV
- ✅ API REST completa
- ✅ Validaciones y transaccionalidad
- ✅ Método de costeo promedio ponderado
