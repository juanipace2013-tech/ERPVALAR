# Módulo de Configuración de Empresa - VAL ARG S.R.L.

## 📌 Resumen

Módulo completo de configuración de empresa basado en COLPPY, adaptado para VAL ARG S.R.L. (Argentina).

## ✅ FASE 1 - COMPLETADA

### Modelos de Base de Datos

✅ **CompanySettings** - Configuración general de empresa
- Datos generales (nombre, dirección, contacto, CUIT, IIBB)
- Logo (URL, dimensiones)
- Datos impositivos (condición IVA, cuentas fiscales)
- Agentes de retención (Ganancias, IVA, IIBB, ARBA, AGIP)
- Retenciones sufridas
- Percepciones sufridas
- Clientes/Proveedores (cuentas contables)
- Avisos de vencimiento
- Tesorería

✅ **InvoiceNumbering** - Talonarios de numeración
- Descripción, prefijo, rango de números
- Tipos de comprobante (facturas, NC/ND, recibos, remitos, etc.)
- Método de numeración (manual/automático)

✅ **BankCheckbook** - Chequeras bancarias

✅ **Check** - Cheques (común, diferido, terceros)

### Interfaz de Usuario

✅ **Página Principal**: `/dashboard/configuracion`
- 8 pestañas navegables
- Solo accesible para rol ADMIN
- Integrado en el sidebar

✅ **Pestaña 1: Datos Generales**
- Formulario completo con todos los campos
- Selector de provincias argentinas
- Sección de logo (preview y dimensiones)
- Botón guardar con feedback visual
- Notificaciones toast

✅ **Pestaña 2: Datos Impositivos**
- Condición IVA (Responsable Inscripto, Monotributo, Exento, Consumidor Final)
- Cuentas fiscales (Débito/Crédito Fiscal IVA)
- Agente de retención:
  - Imp. a las Ganancias ✓
  - IVA
  - IIBB
  - ARBA
  - Cálculo automático AGIP
- Retenciones sufridas (Ganancias, IVA, SUSS, IIBB)
- Percepciones sufridas (IVA, IIBB)
- Botón guardar con feedback visual

### APIs

✅ **GET /api/configuracion** - Obtener configuración de empresa
✅ **PUT /api/configuracion** - Actualizar configuración de empresa

✅ **GET /api/configuracion/talonarios** - Listar talonarios
✅ **POST /api/configuracion/talonarios** - Crear talonario
✅ **PUT /api/configuracion/talonarios/[id]** - Actualizar talonario
✅ **DELETE /api/configuracion/talonarios/[id]** - Eliminar talonario

✅ **GET /api/configuracion/chequeras** - Listar chequeras (con cheques)
✅ **POST /api/configuracion/chequeras** - Crear chequera
✅ **DELETE /api/configuracion/chequeras/[id]** - Eliminar chequera

### Seed de Datos

✅ **prisma/seed-company.ts**
- Datos iniciales de VAL ARG S.R.L.
- 9 talonarios preconfigurados:
  1. FACTURA POR AFIP (0001) - actual: 563
  2. Facturas Electrónicas (0003)
  3. FACTURAS X (0001)
  4. NC/ND POR AFIP (0001)
  5. Orden de Pago (0001) - actual: 4879
  6. OTRAS FACTURAS (0009)
  7. PRUEBAS OPPEN (0004)
  8. RECIBOS (0001) - actual: 11157
  9. REMITOS (0002)

### Componentes UI

✅ **Toast System**
- Hook personalizado `use-toast`
- Componente Toast para notificaciones
- Componente Toaster integrado en layout
- Notificaciones de éxito/error

## ✅ FASE 2 - COMPLETADA

### Pestaña 3: Clientes/Proveedores
- ✅ Configuración de cuentas contables (Clientes y Proveedores)
- ✅ Avisos automáticos de vencimiento (3 niveles configurables)
- ✅ Envío automático de recibos
- ✅ Envío automático de órdenes de pago
- ✅ Configuración Antes/Después del vencimiento
- ✅ Habilitar/Deshabilitar avisos individualmente

### Pestaña 4: Talonarios
- ✅ Gestión completa de talonarios
- ✅ CRUD de talonarios (Crear, Editar, Eliminar)
- ✅ Lista de talonarios con prefijo y numeración
- ✅ Configuración de rangos de numeración
- ✅ Tipos de comprobante (Factura, NC, ND, Recibo, Remito, etc.)
- ✅ Talonario por defecto
- ✅ Método de numeración (Automático/Manual)
- ✅ Factura electrónica
- ✅ Tabla de documentos por talonario

### Pestaña 5: Tesorería
- ✅ Gestión de chequeras (Agregar, Eliminar)
- ✅ Selección de banco (13 bancos argentinos)
- ✅ Configuración de rangos de cheques
- ✅ Visualización de cheques emitidos
- ✅ Valores a depositar (cuenta contable)
- ✅ Cheques diferidos (cuenta contable)
- ✅ Estados de cheques (Pendiente, Cobrado, Rechazado, Cancelado)
- ✅ Tipos de cheque (Común, Diferido, Terceros)

## 🔮 FASE 3 - FUTURO

### Pestañas Adicionales
- [ ] Portal Clientes
- [ ] Integraciones
- [ ] Centros de Costos

### Funcionalidades Avanzadas
- [ ] Upload de logo
- [ ] Validación CUIT/IIBB con AFIP
- [ ] Configuración de jurisdicciones IIBB
- [ ] Exportación de configuración

## 📊 Datos de VAL ARG S.R.L.

```typescript
{
  name: 'VAL ARG S.R.L.',
  legalName: 'VAL ARG S.R.L.',
  address: '14 de Julio 175',
  city: 'CABA',
  province: 'CABA',
  postalCode: '1427',
  country: 'Argentina',
  phone: '011-4551-3343',
  email: 'ventas@val-ar.com.ar',
  taxId: '30-71537357-9',
  iibbNumber: '901-71537357-9',
  logoUrl: '/logo-valarg.png',
  taxCondition: 'RESPONSABLE_INSCRIPTO'
}
```

## 🛠️ Tecnologías

- **Framework**: Next.js 16 (App Router)
- **UI**: Tailwind CSS + shadcn/ui
- **Base de Datos**: PostgreSQL + Prisma ORM
- **Autenticación**: NextAuth.js
- **Validaciones**: Zod (futuro)

## 📝 Rutas

- **Página**: `/dashboard/configuracion`
- **API GET**: `/api/configuracion`
- **API PUT**: `/api/configuracion`

## 🎯 Acceso

- Solo usuarios con rol **ADMIN** pueden acceder
- Visible en el sidebar de navegación
- Icono: Settings (engranaje)

## 🚀 Uso

1. Acceder como ADMIN
2. Ir a Configuración desde el sidebar
3. Editar datos en pestañas 1 o 2
4. Guardar cambios
5. Ver notificación de éxito/error

## ✨ Características Destacadas

- ✅ Diseño fiel a COLPPY
- ✅ Validación de campos
- ✅ Feedback visual (loading, toast)
- ✅ Datos precargados de VAL ARG
- ✅ Provincias argentinas completas
- ✅ Sistema de notificaciones toast
- ✅ Responsive design
- ✅ Integración completa con el sistema

## 📌 Próximos Pasos

1. ~~Completar Pestaña 3 (Clientes/Proveedores)~~ ✅
2. ~~Completar Pestaña 4 (Talonarios)~~ ✅
3. ~~Completar Pestaña 5 (Tesorería)~~ ✅
4. Implementar upload de logo
5. Añadir validaciones avanzadas
6. Implementar pestañas de FASE 3
