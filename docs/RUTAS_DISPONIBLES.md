# Rutas Disponibles en el Sistema

## Dashboard Principal
- ✅ `/` - Dashboard principal con métricas

## Gestión Comercial

### Clientes
- ✅ `/clientes` - Lista de clientes

### Productos
- ✅ `/productos` - Lista de productos con stock *(Nueva)*
  - Ver stock actual
  - Estado de inventario
  - Alertas de stock bajo

### Facturas
- ✅ `/facturas` - Lista de facturas *(Nueva)*
  - Integración con inventario
  - Descuento automático de stock
  - Generación de asientos CMV
- ⏳ `/facturas/nueva` - Crear nueva factura *(Pendiente)*
- ⏳ `/facturas/[id]` - Detalle de factura *(Pendiente)*

### Inventario
- ✅ `/inventario` - Movimientos de inventario *(Nueva)*
  - Historial completo de movimientos
  - Entradas y salidas
  - Estadísticas
- ⏳ `/inventario/movimientos/nuevo` - Crear movimiento *(Pendiente)*

## Contabilidad

### Asientos Contables
- ✅ `/contabilidad` - Módulo de contabilidad
- ✅ `/contabilidad/asientos` - Lista de asientos
- ✅ `/contabilidad/asientos/nuevo` - Crear asiento
- ✅ `/contabilidad/asientos/[id]` - Detalle de asiento

### Plan de Cuentas
- ✅ `/contabilidad/plan-cuentas` - Plan de cuentas

### Libros
- ✅ `/contabilidad/libro-diario` - Libro Diario
- ✅ `/contabilidad/libro-mayor` - Libro Mayor
- ✅ `/contabilidad/libro-iva` - Libro IVA

### Reportes
- ✅ `/contabilidad/balance-general` - Balance General
- ✅ `/contabilidad/balance-sumas-saldos` - Balance de Sumas y Saldos
- ✅ `/contabilidad/estado-resultados` - Estado de Resultados

## APIs del Backend

### Inventario
- ✅ `GET /api/inventario/movimientos` - Listar movimientos
- ✅ `POST /api/inventario/movimientos` - Crear movimiento manual
- ✅ `GET /api/inventario/movimientos/[id]` - Detalle de movimiento
- ✅ `GET /api/inventario/productos/[id]/stock` - Historial por producto
- ✅ `POST /api/inventario/productos/[id]/ajuste` - Ajustar stock

### Facturas
- ✅ `GET /api/facturas` - Listar facturas
- ✅ `POST /api/facturas` - Crear factura con inventario
- ✅ `GET /api/facturas/[id]` - Detalle completo
- ✅ `POST /api/facturas/preview` - Preview antes de crear

### Productos
- ✅ `GET /api/productos` - Listar productos
- ✅ `POST /api/productos` - Crear producto
- ✅ `GET /api/productos/[id]` - Detalle de producto
- ✅ `PUT /api/productos/[id]` - Actualizar producto

### Clientes
- ✅ `GET /api/clientes` - Listar clientes
- ✅ `POST /api/clientes` - Crear cliente
- ✅ `GET /api/clientes/[id]` - Detalle de cliente
- ✅ `PUT /api/clientes/[id]` - Actualizar cliente

### Contabilidad
- ✅ `GET /api/contabilidad/asientos` - Listar asientos
- ✅ `POST /api/contabilidad/asientos` - Crear asiento
- ✅ `GET /api/contabilidad/asientos/[id]` - Detalle de asiento
- ✅ `PUT /api/contabilidad/asientos/[id]` - Actualizar asiento
- ✅ `POST /api/contabilidad/asientos/[id]/confirm` - Confirmar asiento
- ✅ `GET /api/contabilidad/plan-cuentas` - Plan de cuentas
- ✅ `POST /api/contabilidad/plan-cuentas/initialize` - Inicializar plan
- ✅ `GET /api/contabilidad/balance-general` - Balance General
- ✅ `GET /api/contabilidad/balance-sumas-saldos` - Balance de Sumas y Saldos
- ✅ `GET /api/contabilidad/estado-resultados` - Estado de Resultados
- ✅ `GET /api/contabilidad/libro-mayor` - Libro Mayor
- ✅ `GET /api/contabilidad/libro-diario` - Libro Diario

## Navegación en el Menú Lateral

El sidebar muestra estos ítems según el rol del usuario:

| Ruta | Ícono | Roles con acceso |
|------|-------|------------------|
| Dashboard | 📊 | Todos |
| Clientes | 👥 | ADMIN, GERENTE, VENDEDOR |
| Productos | 📦 | ADMIN, GERENTE, VENDEDOR |
| Oportunidades | 📈 | ADMIN, GERENTE, VENDEDOR |
| Cotizaciones | 📄 | ADMIN, GERENTE, VENDEDOR |
| Facturas | 🧾 | ADMIN, GERENTE, CONTADOR |
| **Inventario** | 🛒 | ADMIN, GERENTE |
| Tipos de Cambio | 💱 | ADMIN, GERENTE, CONTADOR |
| Contabilidad | 💰 | ADMIN, GERENTE, CONTADOR |
| Configuración | ⚙️ | ADMIN |

## Páginas Creadas Recientemente

### 1. `/inventario` ✨
**Características:**
- Lista de movimientos de stock
- Tarjetas con estadísticas (Total, Entradas, Salidas)
- Tabla con historial completo
- Filtros por tipo de movimiento
- Links a crear nuevo movimiento

**Componentes:**
- Badges de colores según tipo de movimiento
- Iconos indicadores (entrada/salida)
- Formateo de fechas y montos
- Estados de carga

### 2. `/productos` ✨
**Características:**
- Lista completa de productos
- Búsqueda por nombre o SKU
- Tarjetas con estadísticas (Total, Activos, Stock Bajo, Sin Stock)
- Indicadores visuales de estado de stock
- Links a historial de inventario por producto

**Alertas de Stock:**
- 🔴 Sin stock (cantidad = 0)
- 🟠 Stock bajo (cantidad ≤ mínimo)
- 🟢 Stock OK

### 3. `/facturas` ✨
**Características:**
- Lista de facturas emitidas
- Búsqueda por número, cliente o CUIT
- Tarjetas con estadísticas (Total Facturado, Pagadas, Pendientes, Con Inventario)
- Indicadores de integración con inventario
- Indicadores de asientos contables generados

**Columnas Especiales:**
- ✓ Stock: Indica si se descontó inventario
- ✓ Asiento: Indica si se generó asiento CMV

## Próximas Páginas a Crear

### Alta Prioridad
1. `/facturas/nueva` - Formulario para crear factura con preview de inventario
2. `/facturas/[id]` - Detalle completo con movimientos y asientos
3. `/inventario/movimientos/nuevo` - Formulario para registrar compras/ajustes
4. `/productos/nuevo` - Formulario para crear producto
5. `/productos/[id]` - Detalle y edición de producto

### Media Prioridad
6. `/inventario/productos/[id]/stock` - Historial detallado por producto
7. `/oportunidades` - CRM: gestión de oportunidades
8. `/cotizaciones` - Generación de cotizaciones
9. `/tipos-cambio` - Gestión de tipos de cambio

### Baja Prioridad
10. `/configuracion` - Configuración del sistema
11. `/reportes/inventario` - Reportes de inventario (valoración, rotación)
12. `/reportes/ventas` - Reportes de ventas

## Estado Actual del Sistema

### ✅ Completamente Funcional
- Backend completo de inventario
- APIs REST para todas las operaciones
- Integración factura-inventario-contabilidad
- Páginas de visualización (inventario, productos, facturas)
- Sistema de navegación
- Autenticación y autorización

### ⏳ En Desarrollo Frontend
- Formularios de creación
- Páginas de detalle
- Formularios de edición

### 📝 Documentación
- ✅ Documentación técnica completa
- ✅ Guía de testing
- ✅ Resumen de implementación
- ✅ Este archivo de rutas

## Cómo Acceder

1. **Inicia sesión** en http://localhost:3000/login
2. **Navega** usando el menú lateral
3. **Rutas disponibles inmediatamente:**
   - `/inventario` - Ver movimientos
   - `/productos` - Ver productos y stock
   - `/facturas` - Ver facturas emitidas
   - `/contabilidad` - Ver asientos y reportes

## Testing de Rutas

```bash
# Verificar que las rutas respondan (requiere autenticación)
curl http://localhost:3000/inventario
curl http://localhost:3000/productos
curl http://localhost:3000/facturas

# APIs (requieren autenticación con cookie/token)
curl http://localhost:3000/api/inventario/movimientos
curl http://localhost:3000/api/facturas
curl http://localhost:3000/api/productos
```

## Notas Importantes

- 🔐 Todas las rutas del dashboard requieren autenticación
- 👤 Las rutas filtran contenido según el rol del usuario
- 📱 Las páginas son responsive (mobile-first)
- ⚡ Las páginas usan Server-Side Rendering (SSR) para mejor SEO
- 🎨 UI consistente con shadcn/ui + Tailwind CSS

---

**Última actualización:** 2024-01-15
**Versión:** 1.0.0
