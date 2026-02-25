# 📧 Sistema de Emails para Cotizaciones - Guía Completa

## ✅ IMPLEMENTACIÓN COMPLETADA

El sistema de emails para cotizaciones está **completamente implementado** y listo para usar. Solo necesitas configurar tu API key de Resend.

---

## 🚀 CONFIGURACIÓN RÁPIDA

### 1. Crear Cuenta en Resend

1. Ve a [https://resend.com](https://resend.com)
2. Crea una cuenta gratuita
3. Verifica tu email

### 2. Obtener API Key

1. En el dashboard de Resend, ve a **API Keys**
2. Click en **Create API Key**
3. Nombre: `CRM Valarg - Production` (o el nombre que prefieras)
4. Permisos: **Sending access**
5. Copia la API key (empieza con `re_...`)

### 3. Configurar Variables de Entorno

Abre tu archivo `.env` y actualiza estas líneas:

```env
# Email Configuration (Resend)
RESEND_API_KEY="re_TU_API_KEY_AQUÍ"
EMAIL_FROM="CRM Valarg <cotizaciones@tudominio.com>"
APP_URL="http://localhost:3000"
```

**Importante:**
- Reemplaza `re_TU_API_KEY_AQUÍ` con tu API key real de Resend
- Para desarrollo, puedes usar cualquier email en `EMAIL_FROM`
- En producción, necesitarás verificar tu dominio en Resend

### 4. Verificar Dominio (Producción)

Para enviar desde tu propio dominio en producción:

1. En Resend, ve a **Domains**
2. Click en **Add Domain**
3. Ingresa tu dominio (ej: `valarg.com`)
4. Agrega los registros DNS que te proporciona Resend
5. Espera la verificación (puede tomar hasta 48 horas)

Una vez verificado, actualiza `.env` con tu email real:
```env
EMAIL_FROM="Cotizaciones Valarg <cotizaciones@valarg.com>"
```

### 5. Reiniciar Servidor

```bash
# Detener el servidor (Ctrl+C)
# Iniciar nuevamente
npm run dev
```

---

## 📋 CÓMO FUNCIONA

### Flujo Completo del Email

```
1. VENDEDOR crea cotización → Estado: BORRADOR
   ↓
2. VENDEDOR hace click en "Enviar al Cliente"
   ↓
3. Se abre diálogo para confirmar email del cliente
   ↓
4. Sistema:
   - Cambia estado a ENVIADA
   - Genera token único (válido 90 días)
   - Envía email al cliente
   - Registra en log de emails
   ↓
5. CLIENTE recibe email con:
   - Detalles de la cotización
   - Botón "Aceptar Cotización"
   - Botón "Rechazar Cotización"
   - Link para ver cotización completa
   ↓
6. CLIENTE hace click en botón
   ↓
7. Se abre página pública (sin login)
   - Muestra cotización completa
   - Permite aceptar o rechazar
   ↓
8. CLIENTE responde
   ↓
9. Sistema actualiza estado automáticamente
   - ACEPTADA → Listo para facturar
   - RECHAZADA → Estado final
```

---

## 💻 USO DEL SISTEMA

### Desde la UI (Dashboard)

#### 1. Enviar Cotización

1. Abre cotización: `/cotizaciones/[id]/ver`
2. Click en **"Enviar al Cliente"**
3. Verificar/editar email del cliente
4. (Opcional) Agregar mensaje personalizado
5. Click en **"Enviar Email"**

**El sistema automáticamente:**
- ✅ Cambia estado a ENVIADA
- ✅ Genera token de acceso público
- ✅ Envía email al cliente
- ✅ Registra envío en log

#### 2. Reenviar Cotización

Si el cliente no recibió el email:
1. Desde la cotización en estado ENVIADA
2. Click en **"Reenviar Email"**
3. Confirmar
4. Se envía nuevo email con el mismo token

### Vista del Cliente (Pública)

El cliente recibe un link como:
```
http://tudominio.com/public/quotes/ABC123XYZ...
```

En esta página el cliente puede:
- ✅ Ver toda la cotización
- ✅ Ver items y precios
- ✅ Ver términos y condiciones
- ✅ **Aceptar** con comentarios opcionales
- ✅ **Rechazar** con motivo obligatorio
- ✅ Contactar al vendedor

**Características:**
- ✅ Sin necesidad de login
- ✅ Token seguro con expiración
- ✅ Responsive (funciona en mobile)
- ✅ Actualización automática del estado

---

## 🔧 ARCHIVOS CREADOS/MODIFICADOS

### Nuevos Archivos

#### Configuración y Email
- `src/lib/email/resend.ts` - Configuración de Resend
- `src/lib/email/templates/quote-email.ts` - Template HTML del email
- `src/lib/email/send-quote-email.ts` - Función de envío

#### APIs
- `src/app/api/quotes/[id]/send-email/route.ts` - Endpoint para enviar email
- `src/app/api/public/quotes/[token]/route.ts` - Ver cotización pública
- `src/app/api/public/quotes/[token]/accept/route.ts` - Aceptar cotización
- `src/app/api/public/quotes/[token]/reject/route.ts` - Rechazar cotización

#### Componentes UI
- `src/components/quotes/SendQuoteDialog.tsx` - Diálogo de envío
- `src/app/public/quotes/[token]/page.tsx` - Vista pública

### Modificados
- `.env` - Agregadas variables de email
- `prisma/schema.prisma` - Agregados modelos `QuotePublicToken` y `QuoteEmailLog`
- `src/app/(dashboard)/cotizaciones/[id]/ver/page.tsx` - Integrado diálogo de envío

---

## 📊 MODELOS DE BASE DE DATOS

### QuotePublicToken
Almacena tokens únicos para acceso público a cotizaciones.

```prisma
model QuotePublicToken {
  id          String      @id
  quoteId     String      @unique
  token       String      @unique  // Token aleatorio de 32 caracteres
  expiresAt   DateTime             // Expira en 90 días
  createdAt   DateTime
}
```

### QuoteEmailLog
Registra todos los emails enviados.

```prisma
model QuoteEmailLog {
  id              String      @id
  quoteId         String
  recipientEmail  String
  subject         String
  status          String      // 'sent' | 'failed'
  emailId         String?     // ID del email en Resend
  publicToken     String?
  error           String?
  createdAt       DateTime
}
```

---

## 🎨 TEMPLATE DEL EMAIL

El email incluye:

### Header
- 🎨 Degradado púrpura
- Título: "Nueva Cotización"
- Nombre de la empresa

### Contenido
- Saludo personalizado
- Mensaje del vendedor (si lo hay)
- Detalles clave:
  - Número de cotización
  - Válida hasta
  - Total
- Aviso de validez destacado

### Botones de Acción
- 🟢 **Aceptar Cotización** (verde)
- 🔴 **Rechazar Cotización** (rojo)
- 🔵 **Ver Cotización Completa** (azul outline)

### Footer
- Nombre de la empresa
- Links de contacto
- Aviso de email automático

### Responsive
- ✅ Optimizado para mobile
- ✅ Botones táctiles
- ✅ Texto legible en pantallas pequeñas

---

## 🧪 TESTING

### Modo Desarrollo (con cualquier email)

En desarrollo, Resend permite enviar a **cualquier email** sin verificar dominio:

```env
EMAIL_FROM="CRM Test <test@example.com>"
```

**Prueba:**
1. Crear cotización de prueba
2. Enviar a tu email personal
3. Verificar que el email llegue
4. Click en botones
5. Verificar que los estados cambien

### Modo Producción

En producción, debes usar un dominio verificado:

```env
EMAIL_FROM="Cotizaciones <cotizaciones@valarg.com>"
```

---

## ⚠️ TROUBLESHOOTING

### Error: "RESEND_API_KEY no está configurada"

**Solución:**
1. Verifica que el archivo `.env` tenga la línea:
   ```env
   RESEND_API_KEY="re_..."
   ```
2. Reinicia el servidor de desarrollo

### Error: "Email inválido"

**Solución:**
- Asegúrate de que el email del cliente esté bien escrito
- Formato correcto: `nombre@dominio.com`

### Email no llega

**Posibles causas:**
1. API key incorrecta → Verifica en Resend
2. Email del cliente en spam → Pedir que revise carpeta spam
3. Error en Resend → Revisar logs en dashboard de Resend

### Token expirado

Si han pasado más de 90 días desde el envío:
1. Reenviar cotización (genera nuevo token)
2. El cliente usa el nuevo link

### "Esta cotización ya no puede ser aceptada"

Ocurre si:
- Ya fue aceptada
- Ya fue rechazada
- Fue convertida a factura

**Solución:**
- Si fue error, crear nueva cotización (duplicar)

---

## 📈 MÉTRICAS Y LOGS

### Ver Log de Emails Enviados

```sql
-- Ver todos los emails enviados
SELECT * FROM quote_email_logs
ORDER BY "createdAt" DESC;

-- Ver emails fallidos
SELECT * FROM quote_email_logs
WHERE status = 'failed';

-- Ver emails de una cotización específica
SELECT * FROM quote_email_logs
WHERE "quoteId" = 'cml...';
```

### Dashboard de Resend

En [resend.com/dashboard](https://resend.com/dashboard) puedes ver:
- ✅ Emails enviados exitosamente
- ❌ Emails fallidos
- 📊 Estadísticas de aperturas (con plan pago)
- 📊 Estadísticas de clicks

---

## 🔐 SEGURIDAD

### Tokens Públicos
- ✅ 32 caracteres aleatorios
- ✅ Expiran en 90 días
- ✅ Un token por cotización
- ✅ Se regeneran al reenviar

### Validaciones
- ✅ Token debe existir
- ✅ Token no debe estar expirado
- ✅ Cotización debe estar en estado SENT para aceptar/rechazar
- ✅ Motivo de rechazo obligatorio

### Privacidad
- ❌ No se requiere login
- ✅ Solo quien tenga el token puede acceder
- ✅ El token no es fácil de adivinar
- ✅ Enlaces únicos por cotización

---

## 💰 COSTOS DE RESEND

### Plan Gratuito
- **3,000 emails/mes** - Gratis
- Suficiente para ~100 cotizaciones/mes

### Plan Pago
Si necesitas más:
- **$20/mes** por 50,000 emails
- Analytics de aperturas y clicks
- Soporte prioritario

---

## 🎯 PRÓXIMAS MEJORAS

Funcionalidades que se pueden agregar:

### 1. **Notificaciones al Vendedor** 🔔
Cuando cliente acepta/rechaza, enviar email al vendedor.

### 2. **Recordatorios Automáticos** ⏰
Enviar recordatorio si cliente no respondió en X días.

### 3. **Analytics** 📊
- Tasa de aperturas
- Tasa de aceptación
- Tiempo promedio de respuesta

### 4. **PDF Adjunto** 📄
Adjuntar PDF de la cotización al email.

### 5. **Multi-idioma** 🌍
Detectar idioma del cliente y enviar email en su idioma.

### 6. **Firma del Vendedor** ✍️
Agregar foto y firma del vendedor en el email.

---

## 📞 SOPORTE

### Problemas con Resend
- Dashboard: [https://resend.com/dashboard](https://resend.com/dashboard)
- Documentación: [https://resend.com/docs](https://resend.com/docs)
- Soporte: [support@resend.com](mailto:support@resend.com)

### Problemas con el Código
- Revisar logs del servidor
- Revisar tabla `quote_email_logs`
- Contactar al desarrollador

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

- [x] Instalar Resend
- [x] Crear templates de email
- [x] Crear API de envío
- [x] Crear vista pública
- [x] Integrar con UI
- [x] Agregar modelos a Prisma
- [ ] **Configurar API key de Resend** ← PENDIENTE
- [ ] **Verificar dominio en producción** ← PENDIENTE
- [ ] **Probar envío de email real** ← PENDIENTE

---

## 🚀 ¡LISTO PARA USAR!

El sistema está **100% implementado**. Solo necesitas:

1. ✅ Crear cuenta en Resend
2. ✅ Obtener API key
3. ✅ Configurar `.env`
4. ✅ Reiniciar servidor
5. ✅ ¡Enviar tu primera cotización!

**URL del servidor:**
http://localhost:3000

**Prueba el flujo:**
1. Ve a http://localhost:3000/cotizaciones
2. Selecciona una cotización en BORRADOR
3. Click en "Enviar al Cliente"
4. Ingresa tu email personal
5. Revisa tu bandeja de entrada
6. Click en los botones del email
7. ¡Verifica que funcione!

---

**Última actualización:** 16 de febrero de 2026
**Estado:** ✅ Implementación completa - Listo para configurar
