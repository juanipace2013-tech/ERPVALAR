# AFIP Web Services - Inicio Rápido

## 🎯 Objetivo

Configurar la consulta automática de datos de contribuyentes en AFIP al ingresar un CUIT en el formulario de nuevo cliente.

## 📋 Checklist de Implementación

### ✅ FASE 1: Preparación (TÚ)

- [ ] **Paso 1:** Verificar acceso a AFIP
  - Ingresa a https://auth.afip.gob.ar/
  - Verifica que tengas Clave Fiscal nivel 3+
  - Tiempo: 5 minutos

- [ ] **Paso 2:** Generar certificados
  - Sigue: `docs/AFIP-CERTIFICADOS-GUIA.md` - Parte 2
  - Genera `afip.key` y `afip.csr`
  - Tiempo: 10 minutos

- [ ] **Paso 3:** Solicitar aprobación en AFIP
  - Sigue: `docs/AFIP-CERTIFICADOS-GUIA.md` - Parte 3
  - Sube CSR, espera aprobación, descarga CRT
  - Tiempo: 10 minutos + 1-24 horas de espera

- [ ] **Paso 4:** Configurar variables de entorno
  - Copia `.env.local.example` a `.env.local`
  - Completa rutas a certificados
  - Tiempo: 5 minutos

- [ ] **Paso 5:** Verificar configuración
  ```bash
  npx ts-node scripts/verify-afip-config.ts
  ```
  - Debe mostrar: ✅ CONFIGURACIÓN COMPLETA Y VÁLIDA
  - Tiempo: 2 minutos

### ✅ FASE 2: Integración (NOSOTROS)

Una vez que completes la Fase 1 y tengas los certificados:

- [ ] **Instalar librería AFIP**
  ```bash
  npm install @afipsdk/afip.js
  ```

- [ ] **Activar código de integración**
  - Descomentar código en `src/app/api/afip/cuit/[cuit]/route.ts`
  - Implementar WSAA (autenticación)
  - Implementar consulta a padrón

- [ ] **Probar conexión**
  ```bash
  npx ts-node scripts/test-afip-connection.ts
  ```

- [ ] **Probar consulta**
  ```bash
  npm run dev
  # Ve a /clientes/nuevo
  # Ingresa un CUIT y prueba
  ```

## 🚀 Inicio Rápido (Si ya tienes certificados)

```bash
# 1. Configurar variables de entorno
cp .env.local.example .env.local
# Edita .env.local con tus rutas

# 2. Verificar configuración
npx ts-node scripts/verify-afip-config.ts

# 3. Avísame para activar la integración
```

## 📂 Archivos Importantes

| Archivo | Descripción |
|---------|-------------|
| `docs/AFIP-CERTIFICADOS-GUIA.md` | Guía completa paso a paso |
| `docs/AFIP-INICIO-RAPIDO.md` | Este archivo (resumen) |
| `.env.local.example` | Template de configuración |
| `scripts/verify-afip-config.ts` | Verificar configuración |
| `scripts/test-afip-connection.ts` | Probar conexión |
| `src/app/api/afip/cuit/[cuit]/route.ts` | Código de integración |

## ⏱️ Tiempo Estimado Total

- **Tu parte (Fase 1):** 30 minutos + espera de aprobación (1-24h)
- **Nuestra parte (Fase 2):** 2-3 horas de desarrollo
- **Testing y ajustes:** 1 hora

**Total:** ~1-2 días (incluyendo espera de AFIP)

## 🆘 Soporte

Si tienes problemas:
1. Revisa la guía completa: `docs/AFIP-CERTIFICADOS-GUIA.md`
2. Ejecuta el verificador: `npx ts-node scripts/verify-afip-config.ts`
3. Consulta la sección de Troubleshooting en la guía

## 📞 Próximos Pasos

**Ahora mismo (TÚ):**
1. Lee `docs/AFIP-CERTIFICADOS-GUIA.md`
2. Empieza con la Parte 2 (Generar Certificados)
3. Cuando tengas el `.crt` aprobado, avísame

**Después (NOSOTROS):**
- Completaremos la integración del código
- Haremos pruebas
- Quedará funcionando en producción

---

**¿Listo para empezar?** → `docs/AFIP-CERTIFICADOS-GUIA.md`
