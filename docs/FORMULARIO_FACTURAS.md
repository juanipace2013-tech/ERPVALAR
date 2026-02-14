# Guía de Uso: Formulario de Nueva Factura

## Acceso
**URL**: http://localhost:3000/facturas/nueva

## Características Principales

### ✨ Funcionalidades

1. **Selección de Cliente**
   - Dropdown con todos los clientes registrados
   - Muestra: Nombre - CUIT
   - Detalle: Razón social y condición fiscal

2. **Configuración de Factura**
   - **Tipo**: A, B, C, E (Exportación)
   - **Moneda**: ARS, USD, EUR
   - **Fecha de Emisión**: Por defecto hoy
   - **Fecha de Vencimiento**: Por defecto +30 días
   - **Notas**: Campo opcional para observaciones

3. **Agregar Productos**
   - Selector muestra solo productos con stock disponible
   - Muestra stock actual de cada producto
   - Input de cantidad con validación
   - Botón "Agregar" para incluir en la factura

4. **Tabla de Productos**
   - Lista todos los productos agregados
   - Columnas:
     - Producto (nombre + SKU)
     - Stock Actual (badge con color)
     - Cantidad (editable)
     - Precio Unitario
     - Descuento % (editable)
     - IVA %
     - Subtotal (calculado automáticamente)
     - Acción (eliminar)
   - Cálculo automático de subtotales al cambiar cantidad/descuento

5. **Resumen de Totales**
   - Subtotal
   - IVA total
   - Descuentos (si aplican)
   - Total a pagar
   - Cantidad de productos
   - Cantidad de unidades

6. **Preview de Inventario** 🎯
   - Valida stock disponible
   - Calcula CMV (Costo de Mercadería Vendida)
   - Muestra impacto por producto:
     - Stock actual
     - Cantidad a vender
     - Stock que quedará
     - CMV por producto
   - Alertas visuales:
     - ✅ Verde: Stock suficiente
     - ❌ Rojo: Stock insuficiente
   - Mensaje sobre asiento contable automático

7. **Creación de Factura**
   - Validaciones antes de crear:
     - Cliente seleccionado
     - Al menos un producto
     - Stock suficiente (via preview)
   - Genera número de factura automático
   - Descuenta stock automáticamente
   - Crea asiento contable de CMV
   - Redirige a página de detalle de la factura

## Flujo de Uso

### Paso 1: Datos Básicos
```
1. Selecciona el cliente
2. Elige tipo de factura (B es común)
3. Verifica/ajusta fechas
4. Agrega notas si necesario
```

### Paso 2: Agregar Productos
```
1. Selecciona producto del dropdown
2. Ingresa cantidad
3. Click en "Agregar"
4. Repite para más productos
```

### Paso 3: Ajustar Items
```
1. Modifica cantidades si necesario
2. Aplica descuentos (opcional)
3. Elimina productos si te equivocaste
```

### Paso 4: Preview de Inventario
```
1. Click en "Preview de Inventario"
2. Revisa el impacto en stock:
   - ✅ Si todo OK, pasa al siguiente paso
   - ❌ Si hay errores, ajusta cantidades
3. Verifica el CMV calculado
```

### Paso 5: Crear Factura
```
1. Click en "Crear Factura"
2. Espera confirmación
3. Serás redirigido al detalle de la factura
```

## Validaciones Automáticas

### Al Agregar Producto
- ✅ Producto debe tener stock > 0
- ✅ Producto no debe estar ya en la lista
- ✅ Cantidad debe ser > 0
- ✅ Producto debe tener precio de venta definido

### Al Generar Preview
- ✅ Debe haber al menos un producto
- ✅ Conecta con API para validar stock en tiempo real
- ✅ Calcula CMV con costos reales

### Al Crear Factura
- ✅ Cliente requerido
- ✅ Al menos un producto
- ✅ Stock suficiente para todos los productos
- ✅ Todos los productos deben tener costo definido

## Badges de Stock

| Color | Significado | Condición |
|-------|-------------|-----------|
| 🟢 Verde | Stock OK | Stock actual ≥ Cantidad solicitada |
| 🔴 Rojo | Stock Insuficiente | Stock actual < Cantidad solicitada |

## Cálculos Automáticos

### Subtotal por Item
```
Subtotal = Cantidad × Precio Unitario × (1 - Descuento/100)
```

### Subtotal Factura
```
Subtotal = Σ(Subtotal de cada item)
```

### IVA
```
IVA = Σ(Subtotal item × IVA% item / 100)
```

### Total
```
Total = Subtotal + IVA - Descuentos
```

### CMV (Calculado en Preview)
```
CMV = Σ(Cantidad item × Costo Unitario item)
```

## Preview de Inventario - Detalle

### Información Mostrada

1. **Estado General**
   - ✅ "Stock disponible para todos los productos"
   - ❌ "Hay productos sin stock suficiente"

2. **CMV Total**
   - Monto calculado
   - Mensaje: "Asiento contable generado automáticamente"
   - Indica que se creará el asiento:
     - DEBE: 5.1.01 (CMV)
     - HABER: 1.1.05.001 (Mercaderías)

3. **Errores de Stock** (si los hay)
   - Lista de productos con stock insuficiente
   - Mensaje específico por producto
   - Detalle: disponible vs requerido

4. **Impacto por Producto**
   - Stock actual
   - Cantidad a vender
   - Stock que quedará (en verde si OK, rojo si negativo)
   - CMV calculado para ese producto

## Ejemplo de Uso Completo

### Caso: Vender 10 unidades del Producto A

```
1. Datos de Factura:
   - Cliente: "Empresa XYZ - 20-12345678-9"
   - Tipo: B
   - Moneda: ARS
   - Fecha: 15/01/2024
   - Vencimiento: 14/02/2024

2. Agregar Productos:
   - Producto A, Cantidad: 10
   - Stock actual mostrado: 50 unidades
   - Precio: $100.00

3. Tabla muestra:
   - Producto A
   - Stock Actual: 50 (badge verde)
   - Cantidad: 10
   - Precio: $100.00
   - IVA: 21%
   - Subtotal: $1,000.00

4. Resumen:
   - Subtotal: $1,000.00
   - IVA: $210.00
   - Total: $1,210.00

5. Preview de Inventario:
   ✅ Stock disponible

   CMV: $500.00 (suponiendo costo $50/unidad)

   Producto A:
   - Stock actual: 50
   - Venta: 10
   - Quedarán: 40 ✅
   - CMV: $500.00

6. Crear Factura:
   ✅ Factura 0001-00123 creada
   ✅ Stock actualizado: 50 → 40
   ✅ Asiento CMV generado
   → Redirigido a /facturas/[id]
```

## Errores Comunes y Soluciones

### "Selecciona un producto"
**Causa**: No seleccionaste ningún producto del dropdown
**Solución**: Abre el dropdown y selecciona un producto

### "El producto ya está en la lista"
**Causa**: Intentas agregar el mismo producto dos veces
**Solución**: Modifica la cantidad del producto existente en la tabla

### "El producto no tiene precio de venta definido"
**Causa**: El producto no tiene un ProductPrice con priceType = SALE
**Solución**: Ve a la página del producto y define un precio de venta

### "Stock insuficiente" (en preview)
**Causa**: Stock actual < Cantidad solicitada
**Solución**:
1. Reduce la cantidad en la tabla
2. O registra una compra primero en /inventario/movimientos/nuevo

### "Producto sin costo definido" (al crear)
**Causa**: El producto no tiene costo registrado
**Solución**:
1. Registra una compra con costo en /inventario/movimientos/nuevo
2. O define un ProductPrice con priceType = COST

## Características Técnicas

### Tecnologías
- **Frontend**: React + Next.js 16
- **UI**: shadcn/ui + Tailwind CSS
- **Validación**: Zod (lado servidor)
- **State**: React useState hooks
- **API**: Fetch API con async/await

### APIs Consumidas
- `GET /api/clientes` - Lista de clientes
- `GET /api/productos` - Lista de productos
- `POST /api/facturas/preview` - Preview de inventario
- `POST /api/facturas` - Crear factura

### Responsive
- ✅ Mobile-friendly
- ✅ Diseño en grid adaptativo
- ✅ Columnas ajustables según pantalla

### Accesibilidad
- ✅ Labels en todos los inputs
- ✅ Placeholders descriptivos
- ✅ Mensajes de error claros
- ✅ Estados de carga visibles

## Próximas Mejoras Sugeridas

1. **Búsqueda de Productos**
   - Campo de búsqueda en el selector
   - Filtros por categoría

2. **Productos Recientes**
   - Mostrar productos más vendidos
   - Quick-add de productos frecuentes

3. **Templates de Factura**
   - Guardar borradores
   - Duplicar facturas existentes

4. **Calculadora de Precios**
   - Calcular precio desde margen
   - Sugerencias de precio

5. **Multi-moneda Avanzada**
   - Tipo de cambio automático
   - Conversión en tiempo real

6. **Impresión**
   - Preview de PDF
   - Descarga de factura

7. **Notificaciones**
   - Email al cliente
   - WhatsApp con link

## Shortcuts de Teclado (Futuro)

```
Enter en cantidad → Agregar producto
Tab → Navegar entre campos
Escape → Cancelar/Volver
Ctrl+S → Guardar borrador
Ctrl+Enter → Crear factura
```

---

**Documentación**: v1.0.0
**Fecha**: 2024-01-15
**Ruta**: `/facturas/nueva`
