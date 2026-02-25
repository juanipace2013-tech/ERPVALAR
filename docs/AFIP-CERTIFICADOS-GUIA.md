# Guía Completa: Certificados AFIP para Web Services

## 📋 Resumen

Para consultar datos de AFIP mediante Web Services oficiales necesitas:
- ✅ CUIT de tu empresa/organización
- ✅ Clave Fiscal nivel 3 o superior
- ✅ Certificado Digital (.crt)
- ✅ Clave Privada (.key)
- ✅ Relación de servicio habilitada

**Tiempo estimado total: 1-3 días** (dependiendo de aprobaciones de AFIP)

---

## PARTE 1: Requisitos Previos

### 1.1 Verificar Clave Fiscal
1. Ingresa a: https://auth.afip.gob.ar/
2. Inicia sesión con tu CUIT y Clave Fiscal
3. Verifica que tengas **nivel 3 o superior**
   - Si no tienes nivel 3, debes elevarlo en AFIP

### 1.2 Herramientas Necesarias
- OpenSSL instalado (viene con Git en Windows)
- Acceso administrativo de AFIP
- Email para notificaciones

---

## PARTE 2: Generar Certificado y Clave

### 2.1 Crear Directorio de Trabajo

```bash
# En tu proyecto
mkdir -p afip-certs
cd afip-certs
```

### 2.2 Generar Clave Privada (Private Key)

```bash
openssl genrsa -out afip.key 2048
```

**⚠️ IMPORTANTE:**
- Guarda este archivo de forma SEGURA
- NO lo compartas ni lo subas a Git
- Si lo pierdes, debes repetir todo el proceso

### 2.3 Generar CSR (Certificate Signing Request)

```bash
openssl req -new -key afip.key -subj "/C=AR/O=TU EMPRESA SA/CN=TU_CUIT/serialNumber=CUIT TU_CUIT" -out afip.csr
```

**Reemplaza:**
- `TU EMPRESA SA` → Razón social de tu empresa
- `TU_CUIT` → Tu CUIT sin guiones (ej: 30712345678)

**Ejemplo real:**
```bash
openssl req -new -key afip.key -subj "/C=AR/O=VALARG SA/CN=30712345678/serialNumber=CUIT 30712345678" -out afip.csr
```

### 2.4 Verificar archivos generados

```bash
ls -la
# Deberías ver:
# afip.key (clave privada - 1679 bytes aprox)
# afip.csr (solicitud de certificado - 900 bytes aprox)
```

---

## PARTE 3: Solicitar Certificado en AFIP

### 3.1 Acceder al Administrador de Relaciones

1. Ingresa a: https://auth.afip.gob.ar/contribuyente_/
2. Ve a: **"Administrador de Relaciones de Clave Fiscal"**
3. Selecciona: **"Nueva Relación"**

### 3.2 Buscar el Servicio

1. En el buscador escribe: **"ws_sr_padron_a13"**
   - Nombre completo: "Web Service de Consulta a Padrón Alcance 13"
2. Selecciona el servicio
3. Click en **"Generar Solicitud"**

### 3.3 Subir el CSR

1. Click en **"Adjuntar Certificado (CSR)"**
2. Sube el archivo `afip.csr` generado anteriormente
3. Completa los datos requeridos:
   - Alias/Descripción: "Certificado CRM Producción"
   - Motivo: "Integración sistema de gestión"
4. Click en **"Enviar Solicitud"**

### 3.4 Esperar Aprobación

- **Tiempo de espera:** 10 minutos a 24 horas
- Recibirás un email cuando esté aprobado
- También puedes verificar en el administrador de relaciones

### 3.5 Descargar Certificado Aprobado

1. Una vez aprobado, vuelve al administrador de relaciones
2. Busca tu solicitud aprobada
3. Click en **"Descargar Certificado"**
4. Guarda el archivo como `afip.crt`

---

## PARTE 4: Configurar en el Proyecto

### 4.1 Mover certificados a ubicación segura

```bash
# Desde afip-certs/ mueve a una carpeta segura FUERA del proyecto
mkdir ~/afip-credentials
mv afip.key ~/afip-credentials/
mv afip.crt ~/afip-credentials/

# En Windows sería:
# mkdir C:\afip-credentials
# move afip.key C:\afip-credentials\
# move afip.crt C:\afip-credentials\
```

**⚠️ MUY IMPORTANTE:**
- Nunca subas estos archivos a Git
- Configura permisos restrictivos (600 en Linux/Mac)
- Haz backup en un lugar seguro

### 4.2 Configurar Variables de Entorno

Crea/edita `.env.local` en la raíz del proyecto:

```env
# ============================================
# CONFIGURACIÓN AFIP WEB SERVICES
# ============================================

# CUIT de tu empresa (sin guiones)
AFIP_CUIT=30712345678

# Rutas a los certificados (usar rutas absolutas)
AFIP_CERT_PATH=/Users/tuusuario/afip-credentials/afip.crt
AFIP_KEY_PATH=/Users/tuusuario/afip-credentials/afip.key

# En Windows usar rutas estilo:
# AFIP_CERT_PATH=C:\afip-credentials\afip.crt
# AFIP_KEY_PATH=C:\afip-credentials\afip.key

# Ambiente (false = homologación, true = producción)
AFIP_PRODUCTION=false

# Opcional: Cache de tokens (en segundos, default: 600)
AFIP_TOKEN_CACHE_TTL=600
```

### 4.3 Verificar configuración

```bash
# Ejecutar script de verificación
npm run afip:verify

# O manualmente:
npx ts-node scripts/verify-afip-config.ts
```

---

## PARTE 5: Ambiente de Homologación (Testing)

### 5.1 Crear Certificado para Homologación

**IMPORTANTE:** Necesitas un certificado SEPARADO para homologación.

Repite los pasos 2.2 a 3.5 pero:
- Usa nombres diferentes: `afip-homo.key` y `afip-homo.crt`
- En el administrador de relaciones, selecciona el ambiente de **"Homologación"**

### 5.2 Configurar ambos ambientes

```env
# Producción
AFIP_CUIT=30712345678
AFIP_CERT_PATH=/path/to/afip-prod.crt
AFIP_KEY_PATH=/path/to/afip-prod.key
AFIP_PRODUCTION=true

# Homologación (para testing)
AFIP_HOMO_CERT_PATH=/path/to/afip-homo.crt
AFIP_HOMO_KEY_PATH=/path/to/afip-homo.key
```

---

## PARTE 6: Testing y Verificación

### 6.1 Test básico de conexión

```bash
# Verificar que los certificados son válidos
npm run afip:test-connection

# O manualmente:
npx ts-node scripts/test-afip-connection.ts
```

### 6.2 Test de consulta de CUIT

```bash
# Probar consulta de un CUIT conocido
npm run afip:test-query 30712345678

# O manualmente:
npx ts-node scripts/test-afip-query.ts 30712345678
```

### 6.3 Verificar en la aplicación

1. Inicia el servidor: `npm run dev`
2. Ve a: http://localhost:3000/clientes/nuevo
3. Ingresa un CUIT real
4. Click en "Buscar en AFIP"
5. **Resultado esperado:** Datos reales autocompletados

---

## 🔒 Seguridad

### Permisos de archivos (Linux/Mac)

```bash
chmod 600 ~/afip-credentials/afip.key
chmod 644 ~/afip-credentials/afip.crt
```

### Gitignore

Asegúrate que `.gitignore` incluya:

```gitignore
# Certificados AFIP
*.key
*.crt
*.pem
*.p12
*.pfx
afip-certs/
afip-credentials/

# Variables de entorno
.env.local
.env.production.local
```

---

## 📅 Mantenimiento

### Renovación de Certificados

Los certificados de AFIP vencen cada **2 años**.

**30 días antes del vencimiento:**
1. Genera nuevos certificados (repetir Parte 2)
2. Solicita nuevo certificado en AFIP (repetir Parte 3)
3. Actualiza las rutas en `.env.local`
4. Testea antes de que expire el anterior

**Configurar recordatorio:**
- Agregar al calendario: fecha de vencimiento - 30 días
- AFIP te enviará un email recordatorio

---

## ❓ Troubleshooting

### Error: "Certificado inválido"
- Verifica que el certificado no haya vencido
- Verifica que sea el certificado correcto (prod vs homo)
- Verifica que el CUIT en el certificado coincida con AFIP_CUIT

### Error: "No se pudo obtener ticket de acceso"
- Verifica conectividad con AFIP
- Verifica que la relación de servicio esté activa en AFIP
- Verifica formato de fecha/hora del sistema

### Error: "Servicio no autorizado"
- Verifica que hayas habilitado ws_sr_padron_a13 en AFIP
- Verifica que la relación esté en estado "Aprobado"

---

## 📚 Referencias

- **Documentación oficial:** https://www.afip.gob.ar/ws/
- **Padrón A13:** https://www.afip.gob.ar/ws/ws_sr_padron_a13/
- **WSAA (Autenticación):** https://www.afip.gob.ar/ws/WSAA/
- **Administrador de relaciones:** https://auth.afip.gob.ar/contribuyente_/

---

## ✅ Checklist Final

- [ ] Clave Fiscal nivel 3 o superior
- [ ] Certificado generado (.csr)
- [ ] Certificado aprobado por AFIP (.crt)
- [ ] Clave privada segura (.key)
- [ ] Relación ws_sr_padron_a13 activa
- [ ] Variables de entorno configuradas
- [ ] Archivos en ubicación segura (fuera de Git)
- [ ] Permisos correctos
- [ ] Gitignore actualizado
- [ ] Test de conexión exitoso
- [ ] Test de consulta exitoso
- [ ] Recordatorio de renovación configurado

---

**¿Listo para comenzar?** Sigue los pasos en orden y avísame cuando tengas los certificados aprobados para configurar el código.
