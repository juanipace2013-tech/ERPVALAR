/**
 * Validación del fix de facturación parcial con adicionales.
 *
 * Verifica que el número de la línea (cabecera == items == payload Colppy) sea
 * EXACTAMENTE el que factura Colppy (suma de componentes ya redondeados).
 *
 * Caso real: VAL-2026-1160 (GUTE WASSER SAS).
 *   PFP925ZRR1R11S x6 @ 161,84 = conjunto compuesto:
 *     Lista 64,94 + G-SELLO-1 52,65 + D20980-1/2 125,89 + 110S0804 26,25
 *     Subtotal 269,73 − 40% marca × 1,00 mult = 161,84/u
 *
 * Correr: npx tsx scripts/test-split-billing.ts
 */
import { buildSplitItem, calcComponentPrice, splitItemUnitTotal, splitItemLineTotal } from '@/lib/colppy'

const quote = { quoteNumber: 'VAL-2026-1160', notes: null }

// Línea compuesta de VAL-2026-1160
const lineaCompuesta = {
  product: { name: 'PFP925ZRR1R11S', sku: 'PFP925ZRR1R11S' },
  description: null,
  manualSku: null,
  quantity: 6,
  listPrice: 64.94,
  brandDiscount: 0.4,
  customerMultiplier: 1.0,
  unitPrice: 161.84, // combinado guardado en QuoteItem
  deliveryTime: null,
  additionals: [
    { product: { name: 'G-SELLO-1', sku: 'G-SELLO-1' }, description: null, listPrice: 52.65 },
    { product: { name: 'D20980-1/2', sku: 'D20980-1/2' }, description: null, listPrice: 125.89 },
    { product: { name: '110S0804', sku: '110S0804' }, description: null, listPrice: 26.25 },
  ],
}

// Línea simple (sin adicionales) para regresión
const lineaSimple = {
  product: { name: 'VALV-SIMPLE', sku: 'VALV-SIMPLE' },
  description: null,
  manualSku: null,
  quantity: 3,
  listPrice: 100,
  brandDiscount: 0,
  customerMultiplier: 1,
  unitPrice: 100,
  deliveryTime: null,
  additionals: [] as any[],
}

let fails = 0
function check(label: string, got: number, want: number) {
  const ok = Math.abs(got - want) < 0.005
  if (!ok) fails++
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${got.toFixed(2)} ${ok ? '==' : '!= esperado'} ${want.toFixed(2)}`)
}

function colppyLineas(split: any) {
  // Replica el flatMap de sendQuoteToColppy: principal + cada adicional, todos
  // con cantidad = split.quantity. Total = Σ ImporteUnitario × Cantidad.
  const lineas = [
    { desc: split.productName, sku: split.productSku, cant: split.quantity, precio: split.unitPrice },
    ...split.additionals.map((a: any) => ({ desc: a.name, sku: a.sku, cant: split.quantity, precio: a.unitPrice })),
  ]
  const total = Math.round(lineas.reduce((s, l) => s + l.precio * l.cant, 0) * 100) / 100
  return { lineas, total }
}

console.log('\n=== CASO VAL-2026-1160: facturar 5 de 6 ===')
{
  const split = buildSplitItem(lineaCompuesta as any, calcComponentPrice, quote, { cantidad: 5 })
  const { lineas, total } = colppyLineas(split)
  console.log('  Payload Colppy:')
  lineas.forEach((l) => console.log(`    - ${l.desc.padEnd(16)} sku=${(l.sku || '∅').padEnd(16)} cant=${l.cant} x ${l.precio.toFixed(2)}`))
  console.log(`  Líneas Colppy: ${lineas.length} (esperado 4), todas cantidad ${split.quantity}`)
  check('total payload Colppy', total, 809.15)
  check('splitItemUnitTotal (precio unit. combinado)', splitItemUnitTotal(split), 161.83)
  check('splitItemLineTotal (cabecera == items)', splitItemLineTotal(split), 809.15)
  console.log(`  → cabecera(${splitItemLineTotal(split).toFixed(2)}) == items(${splitItemLineTotal(split).toFixed(2)}) == Colppy(${total.toFixed(2)})`)
}

console.log('\n=== Regresión: línea SIN adicionales (producto simple), 3 u ===')
{
  const split = buildSplitItem(lineaSimple as any, calcComponentPrice, quote, { cantidad: 3 })
  const { total } = colppyLineas(split)
  const antes = Number(lineaSimple.unitPrice) * 3 // cómo se calculaba antes
  check('splitItemLineTotal == cálculo viejo (no cambia)', splitItemLineTotal(split), antes)
  check('== total Colppy', total, 300)
}

console.log('\n=== Factura completa: 6 de 6 ===')
{
  const split = buildSplitItem(lineaCompuesta as any, calcComponentPrice, quote, { cantidad: 6 })
  const { total } = colppyLineas(split)
  check('splitItemLineTotal', splitItemLineTotal(split), 970.98)
  check('== total Colppy', total, 970.98)
}

console.log('\n=== Segundo envío: la 1 pendiente (5 + 1 == 6) ===')
{
  const s5 = buildSplitItem(lineaCompuesta as any, calcComponentPrice, quote, { cantidad: 5 })
  const s1 = buildSplitItem(lineaCompuesta as any, calcComponentPrice, quote, { cantidad: 1 })
  const total5 = splitItemLineTotal(s5)
  const total1 = splitItemLineTotal(s1)
  check('envío 1ª (5u)', total5, 809.15)
  check('envío 2ª (1u)', total1, 161.83)
  check('suma de ambos envíos == total 6u', Math.round((total5 + total1) * 100) / 100, 970.98)
}

console.log(`\n${fails === 0 ? '✅ TODOS OK' : `❌ ${fails} CHECK(S) FALLARON`}`)
process.exit(fails === 0 ? 0 : 1)
