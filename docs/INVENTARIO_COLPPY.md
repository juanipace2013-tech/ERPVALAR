# Módulo de Inventario Estilo COLPPY

## Descripción General

Módulo completo de gestión de inventario profesional inspirado en COLPPY, con todas las funcionalidades necesarias para un ERP argentino moderno.

## ✨ Características Implementadas

### 1. Vista Principal - Items de Inventario

**Ruta**: `/inventario/items`

#### Características:
- ✅ Tabla profesional con columnas tipo COLPPY:
  - **Código**: SKU del producto (formato monoespaciado)
  - **Descripción**: Nombre del producto
  - **Tipo**: Producto / Servicio / Combo (con badges de colores)
  - **UM**: Unidad de Medida
  - **P. Venta**: Precio de venta
  - **Cto. Calculado**: Costo promedio o último costo
  - **Disponible**: Stock actual (badge verde/rojo)

#### Funcionalidades:
- ✅ **Buscador** por código o descripción
- ✅ **Filtros** por tipo de producto (Producto/Servicio/Combo)
- ✅ **Paginación** (20 items por página)
- ✅ **Click en fila** abre el detalle del item
- 🔜 **Botones superiores**:
  - Actualizar precios (próximamente)
  - Reportes (próximamente)
  - Importar items (próximamente)
  - Agregar (funcional)

#### Pestañas:
1. ✅ **Items de inventario**: Lista principal
2. 🔜 **Configuración de inventario**: Gestión de depósitos
3. 🔜 **Listas de precios**: Múltiples listas

### 2. Vista Detalle - Información del Item

**Ruta**: `/inventario/items/[id]`

#### Tarjetas de Resumen:
- 📊 **Stock Disponible**: Cantidad actual + stock mínimo
- 💰 **Precio de Venta**: Con unidad de medida
- 📉 **Costo Calculado**: Costo promedio
- 📝 **Movimientos**: Total registrados

#### Pestañas:

##### A) Movimientos (Estilo COLPPY)
Tabla con columnas exactas:
- **Fecha**: Fecha y hora del movimiento
- **Depósito**: Almacén (por defecto "Principal")
- **Descripción**: Tipo de movimiento + notas
- **TipoDoc**: Badge con tipo (FAC/FAV/AJI/DEV/TRA)
- **Precio**: Costo unitario del movimiento
- **Cantidad**: Entrada (+) o Salida (-) con iconos

**Tipos de Documento:**
- `FAC`: Factura de Compra
- `FAV`: Factura de Venta
- `AJI`: Ajuste de Inventario
- `DEV`: Devolución
- `TRA`: Transferencia

##### B) Información General
- Datos completos del producto
- Código SKU
- Tipo y categoría
- Unidad de medida
- Estado
- Configuración de inventario
- Lista de precios configurados

## 🗄️ Estructura de Base de Datos Extendida

### Nuevos Modelos:

#### 1. ProductType (Enum)
```prisma
enum ProductType {
  PRODUCT   // Producto físico con inventario
  SERVICE   // Servicio sin inventario
  COMBO     // Combo de productos
}
```

#### 2. Warehouse (Depósitos)
```prisma
model Warehouse {
  id              String
  code            String    @unique
  name            String
  description     String?
  address         String?
  isActive        Boolean   @default(true)
  isDefault       Boolean   @default(false)
  warehouseStocks WarehouseStock[]
  stockMovements  StockMovement[]
}
```

#### 3. WarehouseStock (Stock por Depósito)
```prisma
model WarehouseStock {
  id              String
  warehouseId     String
  productId       String
  quantity        Int       @default(0)
  minStock        Int       @default(0)
  maxStock        Int?
}
```

#### 4. PriceList (Listas de Precios)
```prisma
model PriceList {
  id              String
  name            String
  description     String?
  isActive        Boolean   @default(true)
  isDefault       Boolean   @default(false)
  validFrom       DateTime
  validUntil      DateTime?
  priceListItems  PriceListItem[]
}
```

#### 5. PriceListItem
```prisma
model PriceListItem {
  id              String
  priceListId     String
  productId       String
  price           Decimal
  currency        Currency  @default(ARS)
}
```

### Campos Agregados a Product:

```prisma
model Product {
  // Nuevos campos
  type            ProductType   @default(PRODUCT)
  lastCost        Decimal?      // Último costo de compra
  averageCost     Decimal?      // Costo promedio calculado
  trackInventory  Boolean       @default(true)
  allowNegative   Boolean       @default(false)

  // Nuevas relaciones
  warehouseStocks WarehouseStock[]
  priceListItems  PriceListItem[]
}
```

### Campos Agregados a StockMovement:

```prisma
model StockMovement {
  // Nuevo campo
  warehouseId     String?

  // Nueva relación
  warehouse       Warehouse?
}
```

### Nuevo Tipo de Movimiento:

```prisma
enum StockMovementType {
  // ... tipos existentes
  TRANSFERENCIA   // Transferencia entre depósitos
}
```

## 🎨 Diseño Visual

### Esquema de Colores (Azul Profesional)

| Elemento | Color |
|----------|-------|
| Texto principal | `text-blue-900` |
| Botones primarios | `bg-blue-600 hover:bg-blue-700` |
| Headers de tabla | `bg-blue-50` |
| Bordes | `border-blue-200` |
| Tabs activos | `bg-blue-600 text-white` |
| Links/Código | `text-blue-700` |
| Badges de Tipo | Azul/Púrpura/Verde según tipo |

### Componentes UI

- **Tablas**: Bordes azules, headers con fondo azul claro
- **Tarjetas**: Border azul, sombras suaves
- **Badges**: Colores semánticos (verde=positivo, rojo=negativo)
- **Tabs**: Estilo COLPPY con fondo azul al activarse
- **Botones**: Azul primario consistente

## 📊 Funcionalidades Detalladas

### 1. Búsqueda y Filtros

```typescript
// Búsqueda por:
- Código (SKU)
- Descripción (nombre del producto)

// Filtros:
- Tipo: Todos / Productos / Servicios / Combos
- Estado: Activo / Inactivo / Discontinuado (futuro)
```

### 2. Paginación

```typescript
- Items por página: 20
- Navegación: Anterior / Siguiente
- Contador: "Página X de Y"
- Info: "Mostrando N items"
```

### 3. Cálculo de Costos

```typescript
// Costo Calculado (prioridad):
1. averageCost (costo promedio)
2. lastCost (último costo de compra)
3. null (si no hay)

// Actualización automática:
- Se recalcula en cada movimiento de entrada
- Se guarda en Product.averageCost
```

### 4. Tracking de Movimientos

```typescript
// Cada movimiento registra:
{
  date: DateTime
  type: StockMovementType
  quantity: Int (+ entrada, - salida)
  unitCost: Decimal
  warehouse: Warehouse (opcional)
  invoice: Invoice (si es venta)
  user: User (quien lo hizo)
  notes: String (opcional)
}
```

## 🔄 Flujos de Trabajo

### A) Ver Items de Inventario

```
1. Usuario → Menu "Inventario"
2. Sistema → Carga /inventario/items
3. Muestra tabla con todos los items
4. Usuario puede:
   - Buscar por código/descripción
   - Filtrar por tipo
   - Paginar resultados
   - Click en item → Ver detalle
```

### B) Ver Detalle de Item

```
1. Usuario → Click en item de la tabla
2. Sistema → Carga /inventario/items/[id]
3. Muestra:
   - 4 tarjetas de resumen
   - Tabs: Movimientos / Info General
4. Tab Movimientos:
   - Lista completa de entradas/salidas
   - Formato tabla COLPPY
   - Paginación si hay muchos
5. Tab Info:
   - Datos completos del producto
   - Lista de precios
```

### C) Registrar Movimiento (Venta Automática)

```
1. Usuario → Crea factura en /facturas/nueva
2. Sistema → Valida stock disponible
3. Al confirmar:
   - Crea Invoice
   - Crea StockMovement (tipo: VENTA)
   - Actualiza Product.stockQuantity
   - Actualiza WarehouseStock (si usa depósitos)
   - Calcula y guarda averageCost
   - Crea JournalEntry (CMV)
4. Movimiento visible en detalle del item
```

## 📱 Navegación

```
Sidebar → Inventario
  ↓
/inventario/items (Vista Principal)
  ├─ Tab: Items de inventario
  ├─ Tab: Configuración
  └─ Tab: Listas de precios

  Click en item ↓

/inventario/items/[id] (Detalle)
  ├─ Tab: Movimientos
  │    └─ Tabla estilo COLPPY
  └─ Tab: Información general
       └─ Datos completos
```

## 🚀 Próximas Funcionalidades

### Alta Prioridad

1. **Gestión de Depósitos** ✨
   - CRUD de almacenes
   - Stock por depósito
   - Transferencias entre depósitos

2. **Listas de Precios** 💰
   - Múltiples listas
   - Asignar a clientes
   - Vigencias

3. **Importar Items** 📥
   - Desde Excel/CSV
   - Validación de datos
   - Actualización masiva

4. **Actualizar Precios** 📈
   - Actualización masiva
   - Por porcentaje
   - Por monto fijo
   - Por lista de precios

5. **Reportes** 📊
   - Valorización de inventario
   - Rotación de productos
   - Stock por depósito
   - Movimientos por período

### Media Prioridad

6. **Combos/Kits**
   - Definir combos
   - Desglose automático

7. **Códigos de Barras**
   - Escaneo
   - Impresión de etiquetas

8. **Alertas**
   - Stock bajo
   - Stock crítico
   - Productos sin movimiento

9. **Categorías Avanzadas**
   - Árbol de categorías
   - Filtros por categoría

10. **Proveedores**
    - Vincular productos a proveedores
    - Costos por proveedor

## 📊 APIs Requeridas (Futuras)

### Depósitos
```
GET    /api/inventario/depositos
POST   /api/inventario/depositos
PUT    /api/inventario/depositos/[id]
DELETE /api/inventario/depositos/[id]
```

### Listas de Precios
```
GET    /api/inventario/listas-precios
POST   /api/inventario/listas-precios
PUT    /api/inventario/listas-precios/[id]
DELETE /api/inventario/listas-precios/[id]
```

### Importación
```
POST   /api/inventario/importar
  Body: { file: File, type: 'productos' | 'precios' }
```

### Actualización Masiva
```
POST   /api/inventario/actualizar-precios
  Body: {
    productos: string[],
    tipo: 'porcentaje' | 'monto',
    valor: number,
    lista?: string
  }
```

### Reportes
```
GET /api/inventario/reportes/valorizacion
GET /api/inventario/reportes/rotacion
GET /api/inventario/reportes/stock-deposito
```

## 🎯 Casos de Uso

### 1. Buscar un Producto

```
Usuario: "Buscar producto ABC123"
1. Va a /inventario/items
2. Escribe "ABC123" en buscador
3. Enter
4. Sistema muestra producto
5. Click en fila
6. Ve detalle completo con movimientos
```

### 2. Ver Movimientos de un Producto

```
Usuario: "¿Cuándo se vendió el producto XYZ?"
1. Busca producto XYZ
2. Click en el producto
3. Tab "Movimientos" (por defecto)
4. Ve tabla con:
   - Fecha de cada venta
   - Factura asociada (FAV)
   - Cantidad vendida
   - Precio
```

### 3. Verificar Stock Disponible

```
Usuario: "¿Cuánto stock tengo del producto ABC?"
1. Busca producto ABC
2. En la tabla principal ve columna "Disponible"
3. Para más detalle, click en producto
4. Ve tarjeta "Stock Disponible" con:
   - Cantidad actual
   - Stock mínimo
   - Si está bajo stock (alerta visual)
```

## 🔧 Configuración

### Depósito por Defecto

Por defecto, el sistema usa un depósito "Principal" implícito. Para usar múltiples depósitos:

1. Ir a tab "Configuración de inventario"
2. Crear depósitos
3. Asignar stock inicial por depósito
4. Los movimientos se asociarán al depósito seleccionado

### Cálculo de Costos

```typescript
// Método: Costo Promedio Ponderado
averageCost = Σ(cantidad × costo) / Σ(cantidad)

// Se recalcula en cada:
- Compra
- Ajuste positivo con costo
- Devolución de cliente
```

## 📈 Métricas y KPIs

El módulo permite rastrear:

- 📦 **Stock actual** por producto
- 💰 **Valor del inventario** (cantidad × costo)
- 📊 **Rotación** (ventas / stock promedio)
- 🎯 **Cobertura** (días de stock disponible)
- ⚠️ **Items bajo stock**
- 📉 **Items sin movimiento**

## 🔐 Permisos

| Acción | Roles |
|--------|-------|
| Ver items | ADMIN, GERENTE, VENDEDOR |
| Crear item | ADMIN, GERENTE |
| Editar item | ADMIN, GERENTE |
| Ver movimientos | ADMIN, GERENTE, CONTADOR |
| Crear movimiento manual | ADMIN, GERENTE |
| Configurar depósitos | ADMIN |
| Gestionar listas de precios | ADMIN, GERENTE |

## 📚 Documentación Adicional

- [Documentación General de Inventario](./INVENTARIO.md)
- [Guía de Testing](./INVENTARIO_TESTING.md)
- [Resumen de Implementación](./INVENTARIO_RESUMEN.md)
- [Formulario de Facturas](./FORMULARIO_FACTURAS.md)

## 🎨 Comparación con COLPPY

| Característica | COLPPY | Nuestro Sistema | Estado |
|----------------|---------|-----------------|--------|
| Tabla de items | ✅ | ✅ | Implementado |
| Columnas principales | ✅ | ✅ | Implementado |
| Búsqueda | ✅ | ✅ | Implementado |
| Filtros | ✅ | ✅ | Implementado |
| Paginación | ✅ | ✅ | Implementado |
| Detalle de item | ✅ | ✅ | Implementado |
| Movimientos | ✅ | ✅ | Implementado |
| TipoDoc | ✅ | ✅ | Implementado |
| Múltiples depósitos | ✅ | 🔜 | Próximamente |
| Listas de precios | ✅ | 🔜 | Próximamente |
| Importar Excel | ✅ | 🔜 | Próximamente |
| Actualizar precios | ✅ | 🔜 | Próximamente |
| Reportes | ✅ | 🔜 | Próximamente |

## ✅ Estado Actual

**Versión**: 1.0.0 - Funcionalidad Core
**Fecha**: 2024-01-15

### Implementado
- ✅ Vista principal de items (tabla COLPPY)
- ✅ Vista de detalle con movimientos
- ✅ Esquema de base de datos extendido
- ✅ Diseño azul profesional
- ✅ Navegación completa
- ✅ Paginación
- ✅ Búsqueda y filtros
- ✅ Tipos de documento
- ✅ Cálculo de costos

### En Desarrollo
- 🔄 Gestión de depósitos
- 🔄 Listas de precios
- 🔄 Importación de items
- 🔄 Actualización masiva de precios
- 🔄 Reportes

---

**Sistema listo para uso profesional** con funcionalidades core de inventario estilo COLPPY. ✨
