/**
 * Crea una cotización en BORRADOR (DRAFT) en el ERP con la misma cuenta que hace
 * la pantalla "Nueva cotización" (src/app/api/quotes/route.ts y [id]/items/route.ts):
 *   unitario = lista × (1 − dto. de marca) × multiplicador × (1,21 si el cliente no es RI)
 *
 * Se corre en producción con prod.sh:
 *   prod.sh crear-cotizacion.ts cotizacion.json              → simulación, no escribe nada
 *   prod.sh crear-cotizacion.ts cotizacion.json --confirmar  → la crea
 *
 * cotizacion.json:
 * {
 *   "cliente": "30-70966758-7",            // CUIT, o el id del cliente en el ERP
 *   "vendedorEmail": "x@val-ar.com.ar",    // opcional si el cliente ya tiene vendedor asignado
 *   "multiplicador": 1.15,                 // opcional: por defecto el del cliente
 *   "condiciones": "Condición de pago: ...",
 *   "notas": "visible en el PDF",
 *   "notasInternas": "no visible",
 *   "validezDias": 30,
 *   "licitacion": null,
 *   "items": [
 *     { "sku": "2232S 06", "cantidad": 39, "plazo": "60 días", "refCliente": "TAG V404 · ítem 22" },
 *     { "sku": "2528A 08", "cantidad": 6, "alternativaDe": 1 },          // alternativa del 1er ítem
 *     { "sku": "2528A 12", "cantidad": 2, "adicionales": ["5803 53", "5012 17 22"] },  // conjunto armado:
 *                                    // válvula + actuador + dado en una sola línea (ver "conjuntos" en consultar-erp)
 *     { "manual": true, "codigo": "5262.2032", "marca": "LESER", "descripcion": "Válvula de seguridad...",
 *       "precioUnitario": 4100, "cantidad": 3, "plazo": "12 semanas" }
 *   ]
 * }
 * En los ítems de catálogo se puede pasar "descuentoMarca" (0-1) o "multiplicador" para pisar
 * el valor por defecto de esa línea. En los manuales "precioUnitario" es ANTES del multiplicador
 * (el ERP lo multiplica igual que a los de catálogo); usar "multiplicador": 1 si ya es el precio final.
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { prisma } from '@/lib/prisma'
import { generateNextQuoteNumber } from '@/lib/quotes/generate-quote-number'
import { normalizeClientReference } from '@/lib/quotes/client-reference'

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const confirmar = process.argv.includes('--confirmar')
const r2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const errores: string[] = []

  // ── Cliente ──
  const ref = String(input.cliente ?? '')
  const digitos = ref.replace(/\D/g, '')
  const clientes = await prisma.customer.findMany({
    where:
      digitos.length === 11
        ? { cuit: { in: [digitos, `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`] } }
        : { id: ref },
    include: { salesPerson: true },
  })
  if (clientes.length !== 1) {
    throw new Error(`Cliente "${ref}": ${clientes.length} coincidencias (pasar CUIT o id exacto)`)
  }
  const cliente = clientes[0]

  // ── Vendedor ──
  const vendedor = input.vendedorEmail
    ? await prisma.user.findUnique({ where: { email: input.vendedorEmail } })
    : cliente.salesPerson
  if (!vendedor) {
    const vs = await prisma.user.findMany({ where: { isVendedor: true, status: 'ACTIVE' }, select: { email: true } })
    throw new Error(
      `Falta el vendedor: el cliente no tiene uno asignado. Pasar "vendedorEmail" (${vs.map((v) => v.email).join(', ')})`
    )
  }

  const multiplicador = Number(input.multiplicador ?? cliente.priceMultiplier) || 1
  const conIVA = cliente.taxCondition !== 'RESPONSABLE_INSCRIPTO' && cliente.taxCondition !== 'CLIENTE_EXTERIOR'
  const ivaFactor = conIVA ? 1.21 : 1

  const tc = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'USD', toCurrency: 'ARS' },
    orderBy: { validFrom: 'desc' },
  })
  if (!tc) throw new Error('No hay tipo de cambio USD→ARS cargado')

  // ── Ítems ──
  const descuentos = await prisma.brandDiscount.findMany()
  type Linea = {
    n: number
    itemNumber: number
    alternativaDe: number | null
    data: Record<string, unknown>
    resumen: Record<string, unknown>
  }
  const lineas: Linea[] = []
  let proximo = 10

  for (let i = 0; i < (input.items ?? []).length; i++) {
    const it = input.items[i]
    const n = i + 1
    const cantidad = Number(it.cantidad)
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      errores.push(`Ítem ${n}: cantidad inválida (${it.cantidad})`)
      continue
    }
    const multOverride = it.multiplicador !== undefined && it.multiplicador !== null ? Number(it.multiplicador) : null
    const mult = multOverride ?? multiplicador

    let itemNumber: number
    let alternativaDe: number | null = null
    if (it.alternativaDe) {
      const padre = lineas.find((l) => l.n === Number(it.alternativaDe) && l.alternativaDe === null)
      if (!padre) {
        errores.push(`Ítem ${n}: alternativaDe ${it.alternativaDe} no apunta a un ítem principal anterior`)
        continue
      }
      itemNumber = padre.itemNumber
      alternativaDe = padre.n
    } else {
      itemNumber = proximo
      proximo += 10
    }

    const comun = {
      itemNumber,
      quantity: cantidad,
      customerMultiplier: mult,
      multiplierOverride: multOverride,
      clientReference: normalizeClientReference(it.refCliente),
      isAlternative: alternativaDe !== null,
    }

    if (it.manual) {
      if (!it.descripcion) {
        errores.push(`Ítem ${n}: los ítems manuales necesitan "descripcion"`)
        continue
      }
      const precio = Number(it.precioUnitario) || 0
      if (precio <= 0) errores.push(`Ítem ${n}: ítem manual sin "precioUnitario"`)
      const unit = precio * mult * ivaFactor
      lineas.push({
        n,
        itemNumber,
        alternativaDe,
        data: {
          ...comun,
          manualSku: it.codigo || null,
          manualBrand: it.marca || null,
          description: it.descripcion,
          listPrice: precio,
          brandDiscount: 0,
          unitPrice: unit,
          totalPrice: unit * cantidad,
          deliveryTime: it.plazo || 'A confirmar',
        },
        resumen: { codigo: it.codigo ?? '(manual)', marca: it.marca ?? null, lista: precio, dto: 0, mult },
      })
      continue
    }

    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE REPLACE(UPPER(sku), ' ', '') = ${String(it.sku ?? '').replace(/\s+/g, '').toUpperCase()}`
    if (ids.length !== 1) {
      errores.push(`Ítem ${n}: SKU "${it.sku}" ${ids.length === 0 ? 'no existe en el ERP' : 'es ambiguo'}`)
      continue
    }
    const p = await prisma.product.findUniqueOrThrow({ where: { id: ids[0].id }, include: { category: true } })
    const lista = Number(p.listPriceUSD || 0)
    if (lista <= 0) {
      errores.push(`Ítem ${n}: ${p.sku} no tiene precio de lista en el ERP (cargarlo o pasarlo como ítem manual)`)
      continue
    }
    if (p.status !== 'ACTIVE') errores.push(`Ítem ${n}: ${p.sku} está ${p.status}`)

    let dto = 0
    if (it.descuentoMarca !== undefined && it.descuentoMarca !== null) {
      dto = Math.max(0, Math.min(1, Number(it.descuentoMarca)))
    } else if (p.brand) {
      const d =
        descuentos.find((x) => x.brand === p.brand && x.productType === (p.category?.name || '')) ||
        descuentos.find((x) => x.brand === p.brand)
      if (d) dto = Number(d.discountPercent) / 100
    }
    // Adicionales (actuador, dados, bobina): se suman a la lista del ítem, como en el ERP
    const adicionales: { productId: string; position: number; listPrice: number }[] = []
    const skusAd: string[] = []
    for (const a of (it.adicionales ?? []) as string[]) {
      const ad = await prisma.product.findFirst({ where: { sku: { equals: a, mode: 'insensitive' } } })
      if (!ad || Number(ad.listPriceUSD || 0) <= 0) {
        errores.push(`Ítem ${n}: adicional "${a}" ${ad ? 'sin precio de lista' : 'no existe en el ERP'}`)
        continue
      }
      adicionales.push({ productId: ad.id, position: adicionales.length + 1, listPrice: Number(ad.listPriceUSD) })
      skusAd.push(ad.sku)
    }
    const listaConAd = lista + adicionales.reduce((s, a) => s + a.listPrice, 0)
    const unit = listaConAd * (1 - dto) * mult * ivaFactor
    lineas.push({
      n,
      itemNumber,
      alternativaDe,
      data: {
        ...comun,
        ...(adicionales.length ? { additionals: { create: adicionales } } : {}),
        productId: p.id,
        description: it.descripcion || null,
        listPrice: lista,
        brandDiscount: dto,
        unitPrice: unit,
        totalPrice: unit * cantidad,
        // "Inmediato" solo si el stock propio cubre la cantidad; si no, que lo defina el vendedor
        deliveryTime: it.plazo || (p.stockQuantity >= cantidad ? 'Inmediato' : 'A confirmar'),
      },
      resumen: {
        codigo: p.sku,
        marca: p.brand,
        lista,
        adicionales: skusAd.length ? skusAd : undefined,
        listaConAdicionales: skusAd.length ? listaConAd : undefined,
        dto,
        mult,
        stock: p.stockQuantity,
      },
    })
  }

  const subtotal = lineas.filter((l) => l.alternativaDe === null).reduce((s, l) => s + Number(l.data.totalPrice), 0)
  const validUntil = new Date(Date.now() + (Number(input.validezDias) || 30) * 86400000)

  const vista = {
    modo: confirmar ? 'CREAR' : 'SIMULACIÓN (no se escribió nada)',
    cliente: { nombre: cliente.name, cuit: cliente.cuit, condicionIVA: cliente.taxCondition },
    vendedor: vendedor.email,
    multiplicador,
    multiplicadorDelCliente: Number(cliente.priceMultiplier),
    preciosConIVA: conIVA,
    tipoCambio: Number(tc.rate),
    validaHasta: validUntil.toISOString().slice(0, 10),
    condiciones: input.condiciones ?? null,
    items: lineas.map((l) => ({
      item: l.alternativaDe === null ? l.itemNumber : `${l.itemNumber} (alternativa)`,
      ...l.resumen,
      cantidad: l.data.quantity,
      unitarioUSD: r2(Number(l.data.unitPrice)),
      totalUSD: r2(Number(l.data.totalPrice)),
      plazo: l.data.deliveryTime,
      refCliente: l.data.clientReference,
    })),
    totalUSD: r2(subtotal),
    errores,
  }

  if (errores.length || !confirmar) {
    console.log(JSON.stringify(vista, null, 1))
    if (errores.length) process.exitCode = 2
    return
  }

  const quote = await prisma.$transaction(
    async (tx) => {
      const quoteNumber = await generateNextQuoteNumber(tx)
      const q = await tx.quote.create({
        data: {
          quoteNumber,
          customerId: cliente.id,
          salesPersonId: vendedor.id,
          creadoPorId: vendedor.id,
          exchangeRate: tc.rate,
          currency: 'USD',
          multiplier: multiplicador,
          subtotal,
          total: subtotal,
          validUntil,
          terms: input.condiciones || null,
          notes: input.notas || null,
          internalNotes: [input.notasInternas, 'Borrador armado con Claude (skill presupuesto-valarg).']
            .filter(Boolean)
            .join('\n'),
          tenderNumber: input.licitacion || null,
          status: 'DRAFT',
          pricesIncludeTax: conIVA,
        },
      })
      const idPorN = new Map<number, string>()
      for (const l of lineas) {
        const creado = await tx.quoteItem.create({
          data: {
            ...(l.data as any),
            quoteId: q.id,
            alternativeToItemId: l.alternativaDe ? idPorN.get(l.alternativaDe) : undefined,
          },
        })
        idPorN.set(l.n, creado.id)
      }
      return q
    },
    { maxWait: 10000, timeout: 60000 }
  )

  await prisma.activity.create({
    data: {
      type: 'QUOTE_CREATED',
      userId: vendedor.id,
      entityType: 'quote',
      entityId: quote.id,
      customerId: cliente.id,
      title: `Cotización creada: ${quote.quoteNumber}`,
      description: `Se creó la cotización ${quote.quoteNumber} para ${cliente.name} (borrador armado con Claude)`,
    },
  })

  console.log(
    JSON.stringify(
      { ...vista, numero: quote.quoteNumber, url: `https://crm.val-ar.com.ar/cotizaciones/${quote.id}` },
      null,
      1
    )
  )
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
