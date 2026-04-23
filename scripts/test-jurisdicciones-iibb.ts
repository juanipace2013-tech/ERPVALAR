/**
 * Tests unitarios del helper `resolveJurisdiccionIIBB`.
 *
 * Cómo correr:
 *   npx tsx scripts/test-jurisdicciones-iibb.ts
 *
 * Exit code 0 si pasan todos, 1 si alguno falla.
 */

import {
  resolveJurisdiccionIIBB,
  resolveJurisdiccionIIBBOrThrow,
  isJurisdiccionIIBB,
  COLPPY_JURISDICCIONES,
  type JurisdiccionIIBB,
} from '../src/lib/jurisdicciones-iibb'

interface TestCase {
  desc: string
  input: string
  expected: JurisdiccionIIBB | null
}

const cases: TestCase[] = [
  // --- nombres canónicos y alias existentes (regresión) ---
  { desc: 'canónico CABA', input: 'CABA', expected: 'CABA' },
  { desc: 'canónico Buenos Aires', input: 'Buenos Aires', expected: 'Buenos Aires' },
  { desc: 'canónico Santa Fé (con tilde)', input: 'Santa Fé', expected: 'Santa Fé' },
  { desc: 'canónico Córdoba (con tilde)', input: 'Córdoba', expected: 'Córdoba' },
  { desc: 'AGIP → CABA', input: 'AGIP', expected: 'CABA' },
  { desc: 'ARBA → Buenos Aires', input: 'ARBA', expected: 'Buenos Aires' },
  { desc: 'prefijo IB', input: 'IB Bs As', expected: 'Buenos Aires' },
  { desc: 'prefijo IIBB', input: 'IIBB Córdoba', expected: 'Córdoba' },
  { desc: 'PERCEP. AGIP 352/22', input: 'PERCEP. AGIP 352/22 G11', expected: 'CABA' },

  // --- NUEVOS aliases: códigos regulatorios ARBA (Buenos Aires) ---
  { desc: 'DN38 pelado', input: 'DN38', expected: 'Buenos Aires' },
  { desc: 'Reg. DN38', input: 'Reg. DN38', expected: 'Buenos Aires' },
  { desc: 'Régimen DN38', input: 'Régimen DN38', expected: 'Buenos Aires' },
  { desc: 'RN 38/2011', input: 'RN 38/2011', expected: 'Buenos Aires' },
  { desc: 'Reg. DN38 con monto pegado (texto OCR crudo)', input: 'Reg. DN38   25.81', expected: 'Buenos Aires' },

  // --- NUEVOS aliases: otras jurisdicciones ---
  { desc: 'DGR Córdoba', input: 'DGR Córdoba', expected: 'Córdoba' },
  { desc: 'RG 1415 → Córdoba', input: 'RG 1415', expected: 'Córdoba' },
  { desc: 'DGR Mendoza', input: 'DGR Mendoza', expected: 'Mendoza' },
  { desc: 'DGR MNES → Mendoza', input: 'DGR MNES', expected: 'Mendoza' },
  { desc: 'ATM Misiones', input: 'ATM Misiones', expected: 'Misiones' },
  { desc: 'API Santa Fe → Santa Fé', input: 'API Santa Fe', expected: 'Santa Fé' },
  { desc: 'API Sta Fe (abreviado)', input: 'API Sta Fe', expected: 'Santa Fé' },

  // --- casos negativos: NO debe inventar ---
  { desc: 'texto vacío → null', input: '', expected: null },
  { desc: 'texto irrelevante → null', input: 'Otros impuestos', expected: null },
  { desc: 'NACIONAL no es una jurisdicción IIBB válida', input: 'Nacional', expected: null },
  { desc: 'solo "API" sin contexto → null (evita falso positivo)', input: 'API', expected: null },
]

let passed = 0
let failed = 0
const failures: string[] = []

for (const tc of cases) {
  const actual = resolveJurisdiccionIIBB(tc.input)
  if (actual === tc.expected) {
    passed++
    console.log(`  ✓ ${tc.desc}`)
  } else {
    failed++
    const msg = `  ✗ ${tc.desc}\n      input:    ${JSON.stringify(tc.input)}\n      expected: ${JSON.stringify(tc.expected)}\n      actual:   ${JSON.stringify(actual)}`
    failures.push(msg)
    console.error(msg)
  }
}

// --- isJurisdiccionIIBB ---
console.log('\n[isJurisdiccionIIBB]')
const isCases: Array<[string, boolean]> = [
  ['CABA', true],
  ['Buenos Aires', true],
  ['Santa Fé', true],
  ['DN38', false], // es alias, no nombre canónico
  ['NACIONAL', false],
  ['', false],
]
for (const [label, expected] of isCases) {
  const actual = isJurisdiccionIIBB(label)
  if (actual === expected) {
    passed++
    console.log(`  ✓ isJurisdiccionIIBB(${JSON.stringify(label)}) === ${expected}`)
  } else {
    failed++
    const msg = `  ✗ isJurisdiccionIIBB(${JSON.stringify(label)}): expected ${expected}, got ${actual}`
    failures.push(msg)
    console.error(msg)
  }
}

// --- resolveJurisdiccionIIBBOrThrow ---
console.log('\n[resolveJurisdiccionIIBBOrThrow]')
try {
  const r = resolveJurisdiccionIIBBOrThrow('Reg. DN38')
  if (r === 'Buenos Aires') {
    passed++
    console.log('  ✓ orThrow resuelve DN38 → Buenos Aires')
  } else {
    failed++
    console.error(`  ✗ orThrow DN38: esperaba Buenos Aires, got ${r}`)
  }
} catch (e) {
  failed++
  console.error(`  ✗ orThrow DN38 lanzó error: ${(e as Error).message}`)
}

try {
  resolveJurisdiccionIIBBOrThrow('xxxxx inexistente xxxxx')
  failed++
  console.error('  ✗ orThrow con texto inválido NO lanzó error')
} catch (e) {
  const msg = (e as Error).message
  if (msg.includes('no reconocida') && COLPPY_JURISDICCIONES.every((j) => msg.includes(j))) {
    passed++
    console.log('  ✓ orThrow con texto inválido lanza error con lista de jurisdicciones')
  } else {
    failed++
    console.error(`  ✗ orThrow con texto inválido: mensaje inesperado: ${msg}`)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('\nFallas:')
  for (const f of failures) console.error(f)
  process.exit(1)
}
process.exit(0)
