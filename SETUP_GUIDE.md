# 🚀 Guía de Configuración Rápida - Valarg ERP/CRM

## ✅ Estado de Implementación

### Completado ✓

- ✅ Proyecto Next.js 14 configurado
- ✅ Todas las dependencias instaladas
- ✅ shadcn/ui componentes agregados
- ✅ Esquema completo de base de datos (Prisma)
- ✅ Sistema de autenticación (NextAuth)
- ✅ API Routes para clientes (CRUD completo)
- ✅ API Routes para productos (CRUD completo)
- ✅ Dashboard con métricas
- ✅ Navbar y Sidebar con navegación por roles
- ✅ Página de login
- ✅ Lista de clientes con filtros y paginación
- ✅ Utilidades argentinas (CUIT, moneda, fechas)
- ✅ Sistema de tipos de cambio
- ✅ Seed con datos de ejemplo

## 📝 Pasos para Ejecutar el Proyecto

### 1. Configurar Base de Datos (Supabase)

#### Opción A: Crear proyecto en Supabase (Recomendado - Gratis)

1. Ir a https://supabase.com
2. Crear cuenta (si no tienes)
3. Click en "New Project"
4. Completar:
   - **Project Name**: valarg-crm
   - **Database Password**: (guardar esta contraseña)
   - **Region**: South America (São Paulo)
5. Esperar 2-3 minutos a que se cree el proyecto
6. Ir a **Settings** → **Database**
7. Copiar "Connection String" en modo **Session**
8. Reemplazar `[YOUR-PASSWORD]` con tu contraseña

#### Opción B: PostgreSQL Local

```bash
# Si tienes PostgreSQL instalado localmente
DATABASE_URL="postgresql://usuario:password@localhost:5432/valarg_crm"
```

### 2. Configurar Variables de Entorno

Edita el archivo `.env` en la raíz del proyecto:

```env
# Reemplazar con tu connection string de Supabase
DATABASE_URL="postgresql://postgres:TU_PASSWORD@db.xxxxxxxxxxxxx.supabase.co:5432/postgres"

# Mantener estos valores
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="change-this-to-a-secure-random-string-in-production"
NODE_ENV="development"
```

**Opcional - Generar NEXTAUTH_SECRET seguro:**

```bash
# En Windows con Git Bash
openssl rand -base64 32

# O usar cualquier string aleatorio largo
```

### 3. Configurar Base de Datos con Prisma

Ejecuta estos comandos **en orden**:

```bash
# 1. Generar el cliente de Prisma
npm run db:generate

# 2. Crear todas las tablas en la base de datos
npm run db:push

# 3. Poblar con datos iniciales (usuarios, productos de ejemplo, etc.)
npm run db:seed
```

**Resultado esperado del seed:**
```
✅ Seed completed successfully!

📊 Summary:
   Users: 3
   - admin@valarg.com / admin123 (ADMIN)
   - vendedor@valarg.com / vendedor123 (VENDEDOR)
   - gerente@valarg.com / gerente123 (GERENTE)
   Categories: 4
   Products: 3
   Customers: 2
   Exchange rates: 6
```

### 4. Ejecutar el Proyecto

```bash
npm run dev
```

Abrir en el navegador: http://localhost:3000

### 5. Iniciar Sesión

Usar uno de estos usuarios:

| Email | Contraseña | Rol | Permisos |
|-------|------------|-----|----------|
| admin@valarg.com | admin123 | Administrador | Acceso total |
| gerente@valarg.com | gerente123 | Gerente | Todo excepto configuración |
| vendedor@valarg.com | vendedor123 | Vendedor | Clientes, productos, ventas |

## 🎯 Qué Puedes Hacer Ahora

### ✅ Funcional

1. **Login/Logout** - http://localhost:3000/login
2. **Dashboard** - http://localhost:3000
   - Ver métricas de clientes, productos y oportunidades
   - Ver actividad reciente
3. **Ver lista de clientes** - http://localhost:3000/clientes
   - Búsqueda por nombre, CUIT o email
   - Filtros por estado y provincia
   - Paginación

### 🔨 Backend Completo (API Routes)

Puedes probar estas APIs con Postman/Thunder Client:

#### Clientes
- `GET /api/clientes` - Lista con filtros
- `POST /api/clientes` - Crear cliente
- `GET /api/clientes/[id]` - Detalle de cliente
- `PUT /api/clientes/[id]` - Actualizar cliente
- `DELETE /api/clientes/[id]` - Eliminar cliente (solo ADMIN)

#### Productos
- `GET /api/productos` - Lista con filtros
- `POST /api/productos` - Crear producto
- `GET /api/productos/[id]` - Detalle de producto
- `PUT /api/productos/[id]` - Actualizar producto
- `DELETE /api/productos/[id]` - Eliminar producto (solo ADMIN)

## 🔄 Pendiente de Implementar

### Formularios Frontend (Próxima tarea)

1. **Formulario crear cliente** - `/clientes/nuevo`
2. **Formulario editar cliente** - `/clientes/[id]`
3. **Vista detalle cliente** - `/clientes/[id]`
4. **Lista de productos** - `/productos`
5. **Formulario crear producto** - `/productos/nuevo`
6. **Formulario editar producto** - `/productos/[id]`

### Módulos Futuros

- Oportunidades de venta (CRM)
- Cotizaciones
- Facturas
- Integración AFIP
- Reportes

## 🛠️ Comandos Útiles

```bash
# Desarrollo
npm run dev              # Iniciar servidor de desarrollo
npm run build            # Compilar para producción
npm run start            # Ejecutar en producción

# Base de Datos
npm run db:generate      # Regenerar cliente Prisma después de cambios en schema
npm run db:push          # Aplicar cambios del schema a la BD
npm run db:seed          # Volver a poblar datos de ejemplo
npm run db:studio        # Abrir Prisma Studio (interfaz visual de la BD)
```

## 🐛 Solución de Problemas

### Error: "Can't reach database server"

**Causa**: DATABASE_URL mal configurado o Supabase no disponible.

**Solución**:
1. Verificar que el proyecto de Supabase esté activo
2. Verificar que DATABASE_URL en `.env` sea correcto
3. Verificar que la contraseña no tenga caracteres especiales sin escapar

### Error: "Module not found" o errores de TypeScript

**Solución**:
```bash
# Limpiar y reinstalar
rm -rf node_modules package-lock.json
npm install
npm run db:generate
```

### Error: "Prisma Client not generated"

**Solución**:
```bash
npm run db:generate
```

### La página no carga estilos

**Solución**:
```bash
# Reiniciar el servidor de desarrollo
# Ctrl+C para detener
npm run dev
```

## 📊 Explorar la Base de Datos

Para ver tus datos visualmente:

```bash
npm run db:studio
```

Esto abrirá Prisma Studio en http://localhost:5555 donde puedes:
- Ver todas las tablas
- Editar registros
- Crear nuevos registros manualmente
- Ver relaciones entre tablas

## 🎨 Próximos Pasos de Desarrollo

Para continuar el desarrollo, se recomienda:

1. **Crear formulario de clientes** usando react-hook-form + shadcn/ui
2. **Crear formulario de productos** con precios multi-moneda
3. **Implementar vista de detalle de cliente** con tabs (info, contactos, oportunidades)
4. **Implementar vista de detalle de producto** con historial de precios

---

¿Necesitas ayuda? Revisa el archivo `README.md` para más información.
