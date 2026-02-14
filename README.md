# Valarg ERP/CRM - Sistema de Gestión Empresarial

Sistema ERP/CRM moderno para distribuidora industrial argentina con gestión de clientes, productos, inventario, ventas y facturación.

## 🚀 Características Principales

- **Gestión de Clientes**: CRUD completo con validación de CUIT, condición IVA y datos fiscales argentinos
- **Gestión de Productos**: Control de inventario, precios multi-moneda (ARS/USD/EUR)
- **CRM**: Pipeline de ventas, oportunidades y cotizaciones
- **Facturación**: Integración futura con AFIP para facturación electrónica
- **Multi-moneda**: Tipos de cambio y conversión automática
- **Autenticación**: Sistema de roles (Admin, Gerente, Vendedor, Contador)
- **Audit Log**: Registro completo de actividades

## 🛠️ Stack Tecnológico

- **Frontend**: Next.js 14 (App Router), React 19, TypeScript
- **UI**: Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes
- **Base de Datos**: PostgreSQL (Supabase)
- **ORM**: Prisma
- **Autenticación**: NextAuth.js
- **Validación**: Zod
- **Gestión de Estado**: Zustand

## 📋 Requisitos Previos

- Node.js 20+
- PostgreSQL (recomendado: Supabase)
- npm o yarn

## 🔧 Instalación y Configuración

### 1. Configurar variables de entorno

Edita el archivo `.env` con tus credenciales:

```env
# Database - Supabase PostgreSQL
# Obtener de: https://supabase.com -> Project Settings -> Database -> Connection String
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# NextAuth Configuration
NEXTAUTH_URL="http://localhost:3000"
# Generar con: openssl rand -base64 32
NEXTAUTH_SECRET="tu-secret-key-aquí"

# App Settings
NODE_ENV="development"
```

#### Cómo obtener DATABASE_URL de Supabase:

1. Crear cuenta en https://supabase.com
2. Crear nuevo proyecto
3. Ir a **Project Settings** → **Database**
4. Copiar "Connection string" en modo **Session** o **Transaction**
5. Reemplazar `[YOUR-PASSWORD]` con tu contraseña de PostgreSQL

#### Generar NEXTAUTH_SECRET:

```bash
openssl rand -base64 32
```

### 2. Configurar Base de Datos

```bash
# Generar cliente de Prisma
npm run db:generate

# Crear tablas en la base de datos
npm run db:push

# Poblar con datos iniciales (usuarios, categorías, productos de ejemplo)
npm run db:seed
```

### 3. Ejecutar en desarrollo

```bash
npm run dev
```

Abre http://localhost:3000

## 👥 Usuarios de Prueba

Después de ejecutar `npm run db:seed`, puedes iniciar sesión con:

| Email | Contraseña | Rol |
|-------|------------|-----|
| admin@valarg.com | admin123 | Administrador |
| gerente@valarg.com | gerente123 | Gerente |
| vendedor@valarg.com | vendedor123 | Vendedor |

## 📁 Estructura del Proyecto

```
crm-valarg/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── (auth)/              # Grupo de rutas: autenticación
│   │   │   └── login/
│   │   ├── (dashboard)/         # Grupo de rutas: área autenticada
│   │   │   ├── clientes/
│   │   │   ├── productos/
│   │   │   └── page.tsx         # Dashboard
│   │   ├── api/                 # API Routes
│   │   │   ├── auth/
│   │   │   ├── clientes/
│   │   │   └── productos/
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   ├── layout/              # Navbar, Sidebar
│   │   ├── dashboard/           # Dashboard components
│   │   └── clientes/            # Cliente components
│   ├── lib/
│   │   ├── prisma.ts            # Prisma client
│   │   ├── auth.ts              # NextAuth config
│   │   ├── utils.ts             # Utilidades (CUIT, formato)
│   │   ├── validations.ts       # Schemas Zod
│   │   ├── currency.ts          # Conversión de monedas
│   │   └── constants.ts         # Constantes argentinas
│   └── types/                   # TypeScript types
├── prisma/
│   ├── schema.prisma            # Esquema de base de datos
│   └── seed.ts                  # Datos iniciales
└── package.json
```

## 🗄️ Modelos de Base de Datos

### Principales

- **User**: Usuarios del sistema con roles
- **Customer**: Clientes con datos fiscales argentinos
- **Product**: Productos con control de inventario
- **ProductPrice**: Precios multi-moneda por producto
- **ExchangeRate**: Tipos de cambio históricos
- **Opportunity**: Oportunidades de venta (CRM)
- **Quote**: Cotizaciones
- **Invoice**: Facturas
- **Activity**: Audit log de actividades

## 🔐 Sistema de Permisos por Rol

| Módulo | Admin | Gerente | Vendedor | Contador |
|--------|-------|---------|----------|----------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Clientes | ✅ | ✅ | ✅ | ❌ |
| Productos | ✅ | ✅ | ✅ | ❌ |
| Oportunidades | ✅ | ✅ | ✅ | ❌ |
| Cotizaciones | ✅ | ✅ | ✅ | ❌ |
| Facturas | ✅ | ✅ | ❌ | ✅ |
| Tipos de Cambio | ✅ | ✅ | ❌ | ✅ |
| Configuración | ✅ | ❌ | ❌ | ❌ |

## 🌐 Características Argentinas

- ✅ Validación de CUIT con algoritmo de dígito verificador
- ✅ Condiciones IVA (Responsable Inscripto, Monotributo, etc.)
- ✅ Provincias argentinas
- ✅ Tipos de factura (A, B, C, E)
- ✅ Multi-moneda (ARS, USD, EUR)
- ✅ Formato de fecha argentino (DD/MM/YYYY)
- ✅ Formato de moneda con separadores correctos

## 📝 Scripts Disponibles

```bash
npm run dev          # Ejecutar en desarrollo
npm run build        # Compilar para producción
npm run start        # Ejecutar en producción
npm run lint         # Linter

# Prisma
npm run db:generate  # Generar cliente Prisma
npm run db:push      # Empujar esquema a la BD
npm run db:seed      # Poblar con datos iniciales
npm run db:studio    # Abrir Prisma Studio (GUI)
```

## 🚧 Estado del Proyecto - Fase 1

### ✅ Backend Completado

- [x] Setup inicial del proyecto Next.js
- [x] Configuración de Tailwind CSS y shadcn/ui
- [x] Esquema completo de base de datos con Prisma
- [x] Sistema de autenticación con NextAuth y roles
- [x] Estructura de carpetas modular
- [x] API Routes completas para clientes
- [x] API Routes completas para productos
- [x] Dashboard con métricas básicas
- [x] Layout con Navbar y Sidebar
- [x] Utilidades para validación de CUIT
- [x] Sistema de tipos de cambio
- [x] Audit log de actividades

### 🔄 Pendiente

**Frontend de Clientes y Productos:**
- [ ] Formulario de creación de clientes
- [ ] Formulario de edición de clientes
- [ ] Página de detalle de cliente
- [ ] Formulario de creación de productos
- [ ] Formulario de edición de productos
- [ ] Página de detalle de producto

**Próximas Fases:**
- [ ] Módulo de oportunidades (CRM)
- [ ] Módulo de cotizaciones
- [ ] Módulo de facturación
- [ ] Integración con AFIP
- [ ] Reportes y analytics

## 🎯 Próximos Pasos

1. **Configurar base de datos:**
   ```bash
   npm run db:generate
   npm run db:push
   npm run db:seed
   ```

2. **Iniciar desarrollo:**
   ```bash
   npm run dev
   ```

3. **Completar frontend de clientes y productos** (siguientes tareas)

---

**Desarrollado con ❤️ para Valarg**
