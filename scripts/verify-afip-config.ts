import * as fs from 'fs'

console.log('🔍 Verificando configuración de AFIP Web Services\n')
console.log('═══════════════════════════════════════════════════\n')

// Verificar variables de entorno
const requiredEnvVars = {
  AFIP_CUIT: process.env.AFIP_CUIT,
  AFIP_CERT_PATH: process.env.AFIP_CERT_PATH,
  AFIP_KEY_PATH: process.env.AFIP_KEY_PATH,
  AFIP_PRODUCTION: process.env.AFIP_PRODUCTION,
}

let allValid = true

console.log('1️⃣  Variables de Entorno:')
console.log('─────────────────────────────────────────────────\n')

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.log(`❌ ${key}: NO CONFIGURADA`)
    allValid = false
  } else {
    console.log(`✅ ${key}: ${value}`)
  }
}

console.log('\n2️⃣  Verificación de Archivos:')
console.log('─────────────────────────────────────────────────\n')

// Verificar certificado
if (requiredEnvVars.AFIP_CERT_PATH) {
  if (fs.existsSync(requiredEnvVars.AFIP_CERT_PATH)) {
    const stats = fs.statSync(requiredEnvVars.AFIP_CERT_PATH)
    console.log(`✅ Certificado encontrado: ${requiredEnvVars.AFIP_CERT_PATH}`)
    console.log(`   Tamaño: ${stats.size} bytes`)
    console.log(`   Última modificación: ${stats.mtime.toISOString()}`)

    // Verificar contenido básico
    const content = fs.readFileSync(requiredEnvVars.AFIP_CERT_PATH, 'utf-8')
    if (content.includes('BEGIN CERTIFICATE')) {
      console.log(`   ✅ Formato válido (PEM)`)
    } else {
      console.log(`   ⚠️  Formato desconocido (esperado: PEM)`)
      allValid = false
    }
  } else {
    console.log(`❌ Certificado NO encontrado: ${requiredEnvVars.AFIP_CERT_PATH}`)
    allValid = false
  }
} else {
  console.log('❌ Ruta de certificado no configurada')
  allValid = false
}

console.log()

// Verificar clave privada
if (requiredEnvVars.AFIP_KEY_PATH) {
  if (fs.existsSync(requiredEnvVars.AFIP_KEY_PATH)) {
    const stats = fs.statSync(requiredEnvVars.AFIP_KEY_PATH)
    console.log(`✅ Clave privada encontrada: ${requiredEnvVars.AFIP_KEY_PATH}`)
    console.log(`   Tamaño: ${stats.size} bytes`)

    // Verificar permisos (solo en Unix)
    if (process.platform !== 'win32') {
      const mode = (stats.mode & parseInt('777', 8)).toString(8)
      console.log(`   Permisos: ${mode}`)
      if (mode !== '600') {
        console.log(`   ⚠️  Permisos recomendados: 600 (solo lectura/escritura propietario)`)
        console.log(`   Ejecuta: chmod 600 ${requiredEnvVars.AFIP_KEY_PATH}`)
      } else {
        console.log(`   ✅ Permisos correctos`)
      }
    }

    // Verificar contenido básico
    const content = fs.readFileSync(requiredEnvVars.AFIP_KEY_PATH, 'utf-8')
    if (content.includes('BEGIN RSA PRIVATE KEY') || content.includes('BEGIN PRIVATE KEY')) {
      console.log(`   ✅ Formato válido (PEM)`)
    } else {
      console.log(`   ⚠️  Formato desconocido (esperado: PEM)`)
      allValid = false
    }
  } else {
    console.log(`❌ Clave privada NO encontrada: ${requiredEnvVars.AFIP_KEY_PATH}`)
    allValid = false
  }
} else {
  console.log('❌ Ruta de clave privada no configurada')
  allValid = false
}

console.log('\n3️⃣  Validación de CUIT:')
console.log('─────────────────────────────────────────────────\n')

if (requiredEnvVars.AFIP_CUIT) {
  const cuit = requiredEnvVars.AFIP_CUIT.replace(/[-\s]/g, '')
  if (cuit.length === 11 && /^\d+$/.test(cuit)) {
    console.log(`✅ CUIT válido: ${cuit}`)
    console.log(`   Tipo: ${cuit.startsWith('30') || cuit.startsWith('33') ? 'Persona Jurídica' : 'Persona Física'}`)
  } else {
    console.log(`❌ CUIT inválido: ${requiredEnvVars.AFIP_CUIT}`)
    console.log(`   Debe ser 11 dígitos sin guiones`)
    allValid = false
  }
}

console.log('\n4️⃣  Ambiente:')
console.log('─────────────────────────────────────────────────\n')

const isProduction = requiredEnvVars.AFIP_PRODUCTION === 'true'
console.log(`${isProduction ? '🔴' : '🟡'} Ambiente: ${isProduction ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`)

if (isProduction) {
  console.log('\n   ⚠️  ATENCIÓN: Estás usando el ambiente de PRODUCCIÓN')
  console.log('   Asegúrate de tener el certificado de producción correcto')
}

console.log('\n═══════════════════════════════════════════════════')

if (allValid) {
  console.log('\n✅ CONFIGURACIÓN COMPLETA Y VÁLIDA\n')
  console.log('Próximo paso:')
  console.log('  npx ts-node scripts/test-afip-connection.ts\n')
  process.exit(0)
} else {
  console.log('\n❌ CONFIGURACIÓN INCOMPLETA O INVÁLIDA\n')
  console.log('Por favor revisa:')
  console.log('  1. Archivo .env.local con las variables correctas')
  console.log('  2. Rutas a certificados válidas')
  console.log('  3. Archivos de certificados existentes\n')
  console.log('Ver guía completa en: docs/AFIP-CERTIFICADOS-GUIA.md\n')
  process.exit(1)
}
