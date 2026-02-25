# Integración con AFIP

Este documento explica cómo configurar la integración con los Web Services de AFIP para consultar datos de contribuyentes por CUIT.

## Estado Actual

✅ **Implementado**: Endpoint de consulta de CUIT con simulación para desarrollo
⏳ **Pendiente**: Configuración de credenciales y conexión real a AFIP

## Funcionalidad Disponible

### Consulta de CUIT en Formulario de Cliente

**Ubicación**: `/clientes/nuevo`

**Características**:
- Campo CUIT con botón "Buscar en AFIP"
- Autocompletado de formulario con datos de AFIP:
  - Nombre / Razón Social
  - Tipo de persona (Física/Jurídica)
  - Condición IVA
  - Domicilio fiscal completo
  - Actividad principal

**API Endpoint**: `GET /api/afip/cuit/[cuit]`

## Configuración para Producción

### 1. Requisitos Previos

Para conectar con AFIP necesitas:

1. **CUIT de tu empresa** habilitado para Web Services
2. **Certificado Digital** (.crt) emitido por AFIP
3. **Clave Privada** (.key) asociada al certificado
4. **Relación de servicios** en AFIP:
   - `ws_sr_padron_a13` (Padrón A13 - Consulta de Contribuyentes)

### 2. Obtener Certificados de AFIP

#### Paso 1: Generar clave privada y CSR

```bash
# Generar clave privada
openssl genrsa -out afip.key 2048

# Generar CSR (Certificate Signing Request)
openssl req -new -key afip.key -subj "/C=AR/O=TU EMPRESA/CN=TU_CUIT/serialNumber=CUIT TU_CUIT" -out afip.csr
```

#### Paso 2: Solicitar certificado en AFIP

1. Ingresa a https://auth.afip.gob.ar/contribuyente_/
2. Ve a "Administrador de Relaciones de Clave Fiscal"
3. Selecciona "Nueva Relación"
4. Busca el servicio: "ws_sr_padron_a13"
5. Sube el archivo CSR generado
6. Descarga el certificado (.crt) aprobado

#### Paso 3: Configurar en la aplicación

Crea o actualiza el archivo `.env.local`:

```env
# Configuración AFIP
AFIP_CUIT=20123456789
AFIP_CERT_PATH=/path/to/afip.crt
AFIP_KEY_PATH=/path/to/afip.key
AFIP_PRODUCTION=false  # true para producción, false para homologación

# Opcional: Configurar tiempo de cache
AFIP_CACHE_TTL=3600  # segundos (1 hora por defecto)
```

### 3. Instalar Dependencia para AFIP

Para conectar con AFIP, puedes usar una de estas librerías:

**Opción 1: @afipsdk/afip.js** (Recomendada)
```bash
npm install @afipsdk/afip.js
```

**Opción 2: afip-sdk**
```bash
npm install afip-sdk
```

### 4. Implementar Cliente AFIP

Descomenta y actualiza el código en:
`src/app/api/afip/cuit/[cuit]/route.ts`

```typescript
// Importar librería AFIP
import Afip from '@afipsdk/afip.js'

async function consultarAFIP(cuit: string): Promise<AFIPData | null> {
  // Inicializar cliente AFIP
  const afip = new Afip({
    CUIT: process.env.AFIP_CUIT,
    cert: process.env.AFIP_CERT_PATH,
    key: process.env.AFIP_KEY_PATH,
    production: process.env.AFIP_PRODUCTION === 'true',
  })

  try {
    // Consultar padrón A13
    const contribuyente = await afip.RegisterScopeFive.getTaxpayerDetails(cuit)

    // Transformar respuesta de AFIP a nuestro formato
    return {
      cuit: contribuyente.idPersona,
      denominacion: contribuyente.nombre,
      razonSocial: contribuyente.razonSocial,
      tipoPersona: contribuyente.tipoPersona === 'FISICA' ? 'FISICA' : 'JURIDICA',
      condicionIVA: contribuyente.impuesto?.idImpuesto === 30
        ? 'RESPONSABLE_INSCRIPTO'
        : 'MONOTRIBUTO',
      domicilioFiscal: {
        direccion: contribuyente.domicilioFiscal?.direccion || '',
        localidad: contribuyente.domicilioFiscal?.localidad || '',
        provincia: contribuyente.domicilioFiscal?.descripcionProvincia || '',
        codigoPostal: contribuyente.domicilioFiscal?.codPostal || '',
      },
      actividadPrincipal: contribuyente.actividad?.[0]?.descripcion,
      fechaInscripcion: contribuyente.fechaInscripcion,
      estadoContribuyente: contribuyente.estadoClave === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO',
    }
  } catch (error) {
    console.error('Error consultando AFIP:', error)
    return null
  }
}
```

## Modo de Desarrollo (Actual)

En desarrollo, el sistema usa datos simulados para no requerir credenciales de AFIP.

**CUITs de ejemplo con datos simulados**:
- `30-71523456-9` - VALARG S.A. (empresa)
- `20-12345678-9` - PEREZ JUAN CARLOS (persona física)
- Cualquier otro CUIT generará datos genéricos basados en el tipo

## Ambientes de AFIP

AFIP provee dos ambientes:

### Homologación (Testing)
- URL: `https://wswhomo.afip.gov.ar/`
- Para pruebas y desarrollo
- No afecta datos reales

### Producción
- URL: `https://servicios1.afip.gov.ar/`
- Datos reales de contribuyentes
- Requiere certificado habilitado en producción

## Limitaciones y Consideraciones

### Rate Limiting
AFIP implementa límites de consultas:
- Máximo recomendado: 10 consultas por minuto
- Implementar cache para reducir consultas repetidas

### Cache de Consultas
Implementado en el endpoint para evitar consultas repetidas:
```typescript
// Los datos se cachean por 1 hora (configurable)
// Cache key: `afip:cuit:${cuit}`
```

### Manejo de Errores
El endpoint maneja estos casos:
- ✅ CUIT no encontrado (404)
- ✅ CUIT inválido (400)
- ✅ Error de conexión con AFIP (500)
- ✅ Timeout de respuesta (500)

## Testing

### Probar en Desarrollo
```bash
# Ver info de prueba
npx ts-node scripts/test-afip-lookup.ts

# Probar endpoint directamente
curl http://localhost:3000/api/afip/cuit/30715234569
```

### Probar en Frontend
1. Ir a http://localhost:3000/clientes/nuevo
2. Ingresar CUIT: `30-71523456-9`
3. Hacer clic en "Buscar en AFIP"
4. Verificar que los campos se autocompleten

## Próximos Pasos

Para habilitar la integración real con AFIP:

1. ✅ Obtener credenciales de AFIP (certificado + clave)
2. ✅ Configurar variables de entorno
3. ✅ Instalar librería de AFIP
4. ✅ Descomentar código de integración real
5. ✅ Probar en ambiente de homologación
6. ✅ Habilitar en producción

## Soporte

Documentación oficial de AFIP:
- Web Services: https://www.afip.gob.ar/ws/
- Padrón A13: https://www.afip.gob.ar/ws/ws_sr_padron_a13/

## Notas de Seguridad

⚠️ **Importante**:
- Nunca commiteear certificados o claves privadas al repositorio
- Agregar a `.gitignore`: `*.crt`, `*.key`, `*.pem`
- Rotar certificados antes de su vencimiento (válidos por 2 años)
- Mantener el acceso a certificados restringido (permisos 600)
