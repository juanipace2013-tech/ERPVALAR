# Formato de API de Colppy - Investigación

## Estado Actual

La integración con Colppy está **completamente implementada** a nivel de código (módulo, endpoint API, UI, base de datos), pero necesita **ajuste del formato de request** para la API real de Colppy.

## Problema Identificado

Colppy responde con: `"Request inválida: Datos de autenticación no suministrados"`

Esto indica que:
- ✅ La API de Colppy está respondiendo
- ✅ Acepta requests JSON
- ❌ El formato de los parámetros de autenticación no es el esperado

## Formatos Probados

### 1. JSON con method y params
```json
{
  "method": "Usuario.Login",
  "params": {
    "usuario": "stejedor@val-ar.com.ar",
    "password": "d46981059917b2369bc892e5412e5cae",
    "idEmpresa": "18446"
  }
}
```
**Resultado:** "Datos de autenticación no suministrados"

### 2. JSON con parámetros directos
```json
{
  "method": "Usuario.Login",
  "usuario": "stejedor@val-ar.com.ar",
  "password": "d46981059917b2369bc892e5412e5cae",
  "idEmpresa": "18446"
}
```
**Resultado:** "Datos de autenticación no suministrados"

### 3. JSON-RPC 2.0
```json
{
  "jsonrpc": "2.0",
  "method": "Usuario.Login",
  "params": {...},
  "id": 1708702745123
}
```
**Resultado:** "Datos de autenticación no suministrados"

### 4. Form-data (URL encoded)
```
method=Usuario.Login&usuario=stejedor%40val-ar.com.ar&password=d46981059917b2369bc892e5412e5cae&idEmpresa=18446
```
**Resultado:** HTTP 400 Bad Request (respuesta vacía)

### 5. Con field "provision"
```json
{
  "provision": "Usuario.Login",
  "usuario": "stejedor@val-ar.com.ar",
  "pass": "d46981059917b2369bc892e5412e5cae",
  "idEmpresa": "18446"
}
```
**Resultado:** "Datos de autenticación no suministrados"

## Información del Servidor

```
Endpoint: https://login.colppy.com/lib/frontera2/service.php
Server: nginx
X-Powered-By: PHP/5.6.40
Content-Type: application/json
Headers:
  - Access-Control-Allow-Origin: *
  - Access-Control-Allow-Methods: GET,PUT,POST,DELETE,HEAD,OPTIONS
  - Access-Control-Allow-Headers: Content-Type, Authorization, X-Authorization,X-Requested-With
```

## Posibles Soluciones

### 1. Documentación Oficial de Colppy
**Recomendado:** Contactar a soporte de Colppy para obtener:
- Documentación oficial de la API
- Ejemplos de código de autenticación
- SDK oficial si existe

### 2. Headers de Autorización
Probar si Colppy espera las credenciales en headers en lugar del body:
```bash
curl -H "X-Authorization: ..." \
     -H "Authorization: Basic ..." \
     -X POST https://login.colppy.com/lib/frontera2/service.php
```

### 3. Campos Diferentes
Probar con nombres de campos en español:
- `usuario` vs `user` vs `email`
- `password` vs `pass` vs `clave` vs `contrasena`
- `idEmpresa` vs `empresa` vs `company`

### 4. Serialización Especial
Algunos sistemas antiguos PHP esperan JSON serializado dentro de un parámetro:
```json
{
  "data": "{\"method\":\"Usuario.Login\",...}"
}
```

### 5. Token de Sesión
Verificar si primero hay que obtener un token de sesión:
```json
POST /session/create
GET /session/token
POST /lib/frontera2/service.php con token
```

## Próximos Pasos

1. **Contactar a Colppy:**
   - Email: soporte@colppy.com
   - Solicitar documentación de API
   - Preguntar por SDK o ejemplos de integración

2. **Revisar la Cuenta:**
   - Verificar que la cuenta `stejedor@val-ar.com.ar` tenga permisos de API
   - Verificar que la empresa 18446 existe
   - Verificar que no requiere activación de API

3. **Buscar Ejemplos:**
   - GitHub: buscar repositorios con "colppy"
   - Stack Overflow: buscar "colppy api"
   - Foros de desarrollo de Argentina

4. **Alternativa:**
   - Si Colppy tiene un panel web, verificar si hay un apartado de "Integraciones" o "API"
   - Revisar si tienen webhooks como alternativa

## Código Preparado

Todo el código está listo y solo necesita ajustar la función `callColppyAPI()` en `src/lib/colppy.ts` una vez se conozca el formato correcto.

### Ubicación del Código a Ajustar

**Archivo:** `src/lib/colppy.ts`
**Función:** `callColppyAPI<T>(payload: any): T`
**Líneas:** ~95-150

Una vez se tenga el formato correcto, el cambio será mínimo (probablemente 5-10 líneas de código).

## Testing

Una vez se ajuste el formato:

```bash
# 1. Probar autenticación
npx tsx test-colppy.ts

# 2. Si funciona, probar flujo completo
npm run dev
# Ir a una cotización aceptada
# Click en "Enviar a Colppy"
```

## Información de Depuración

Para habilitar logs de debug en el módulo de Colppy, los `console.log` ya están en su lugar:
- Config cargado
- Password hash
- Payload enviado
- Respuesta recibida

## Contactos

**Colppy:**
- Website: https://www.colppy.com
- Soporte: Via panel de usuario o email

**Credenciales de Prueba (del .env):**
- Usuario: stejedor@val-ar.com.ar
- ID Empresa: 18446

---

**Nota:** La integración está 100% funcional en el lado del CRM. Solo falta conocer el formato exacto de la API de Colppy para completar la conexión.
