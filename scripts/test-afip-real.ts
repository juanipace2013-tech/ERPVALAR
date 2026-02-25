// Script para probar la consulta real de AFIP con un CUIT conocido

const testCUITs = [
  '30-70308853-4', // Google Argentina
  '30-71438743-7', // Microsoft Argentina
  '20-12345678-9', // Persona física (ejemplo)
]

console.log('🔍 Probando consulta REAL de AFIP\n')
console.log('═════════════════════════════════════════════════════\n')

console.log('CUITs a probar:')
testCUITs.forEach((cuit, index) => {
  console.log(`${index + 1}. ${cuit}`)
})

console.log('\n═════════════════════════════════════════════════════\n')
console.log('💡 Instrucciones:')
console.log('   1. Asegúrate de estar autenticado en http://localhost:3000')
console.log('   2. Ve a http://localhost:3000/clientes/nuevo')
console.log('   3. Ingresa uno de los CUITs de arriba')
console.log('   4. Haz clic en "Buscar en AFIP"')
console.log('   5. Observa si se autocompletan los datos reales\n')

console.log('📝 Logs a observar en el servidor:')
console.log('   • "[AFIP] Consultando CUIT real: ..." → Nuevo código')
console.log('   • "[AFIP] Datos obtenidos del servicio público" → Éxito')
console.log('   • "[AFIP] No se pudieron obtener datos..." → Servicio no disponible\n')

console.log('⚠️  Si no funciona:')
console.log('   El servicio público de AFIP puede estar bloqueado por:')
console.log('   - CORS (no permite requests desde navegador)')
console.log('   - Requiere autenticación específica')
console.log('   - Está temporalmente fuera de línea')
console.log('\n   Alternativas:')
console.log('   A) Configurar Web Services oficiales (con certificados)')
console.log('   B) Usar una API de terceros confiable\n')
