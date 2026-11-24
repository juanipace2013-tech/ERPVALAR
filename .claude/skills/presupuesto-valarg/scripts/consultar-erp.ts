/**
 * Consulta de SOLO LECTURA al ERP para armar presupuestos.
 * Se corre en producción con prod.sh:  prod.sh consultar-erp.ts entrada.json
 *
 * entrada.json (todas las claves son opcionales):
 * {
 *   "skus":     ["2232S 06", "2229A18"],          // código exacto (tolera espacios y mayúsculas)
 *   "prefijos": ["2232S", "PFQ"],                 // toda la serie: SKU que empieza con...
 *   "marcaPrefijos": "GENEBRE",                   // opcional: limita "prefijos" a una marca (los códigos
 *                                                 // numéricos cortos chocan con otras marcas)
 *   "compacto": true,                             // nombres cortados a 90 caracteres: para explorar series
 *                                                 // grandes sin recibir cientos de KB; pedir el nombre
 *                                                 // completo de los códigos elegidos antes de decidir
 *   "conjuntos": ["2528A 12"],                    // válvula GENEBRE → actuadores y dados de la tabla oficial
 *                                                 // de conjuntos armados (neumático, eléctrico, reductor)
 *   "textos":   [{ "q": "esclusa \"clase 600\" SW", "marca": "GENEBRE", "limite": 40 }],
 *                                                 // todas las palabras de q en SKU/nombre/descripción, sin
 *                                                 // acentos; entre comillas = frase exacta (evita que
 *                                                 // "clase 600" matchee "API 600")
 *   "cotizaciones": ["VAL-2026-3330"],            // cotización anterior con sus ítems (qué se ofreció y a cuánto)
 *   "clientes": ["EXAR", "30-70966758-7"],        // por nombre, razón social o CUIT
 *   "stockVivo": ["CODIGO-FAMIQ", "CODIGO-JMH"],  // stock en vivo en la web de FAMIQ / JMH (lento)
 *   "marcas": true,                               // resumen de marcas cargadas y descuentos de marca
 *   "vendedores": true
 * }
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getFamiqLiveData } from '@/lib/famiq/client'
import { getJmhLiveData } from '@/lib/jmh/client'
import { getConjuntosGenebre } from '@/lib/genebre-conjuntos'

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))

const select = {
  id: true,
  sku: true,
  name: true,
  brand: true,
  status: true,
  listPriceUSD: true,
  lastCostUsd: true,
  stockQuantity: true,
  technicalSheetUrl: true,
  category: { select: { name: true } },
  supplier: { select: { name: true } },
  famiqLink: { select: { webId: true, precioListaWeb: true, precioListaWebAt: true } },
  jmhLink: { select: { templateId: true, precioListaWeb: true, precioListaWebAt: true } },
} satisfies Prisma.ProductSelect

type Row = Prisma.ProductGetPayload<{ select: typeof select }>

let descuentos: { brand: string; productType: string | null; discountPercent: Prisma.Decimal }[] = []
let winters = new Map<string, { cantidad: number; fechaLista: Date }>()

function descuentoMarca(p: Row): number {
  if (!p.brand) return 0
  const exacto = descuentos.find((d) => d.brand === p.brand && d.productType === (p.category?.name || ''))
  const generico = descuentos.find((d) => d.brand === p.brand)
  return Number((exacto || generico)?.discountPercent ?? 0)
}

function fmt(p: Row) {
  const lista = p.listPriceUSD === null ? null : Number(p.listPriceUSD)
  const dto = descuentoMarca(p)
  const w = winters.get(p.sku)
  return {
    sku: p.sku,
    nombre: input.compacto && p.name.length > 90 ? p.name.slice(0, 90) + '…' : p.name,
    marca: p.brand,
    categoria: p.category?.name ?? null,
    proveedor: p.supplier?.name ?? null,
    estado: p.status,
    listaUSD: lista,
    descuentoMarcaPct: dto,
    // Precio neto antes del multiplicador del cliente (así lo calcula el ERP)
    netoUSD: lista === null ? null : Math.round(lista * (1 - dto / 100) * 100) / 100,
    costoUSD: p.lastCostUsd === null ? null : Number(p.lastCostUsd),
    stockPropio: p.stockQuantity, // sincronizado desde Colppy
    stockWintersBsAs: w ? { cantidad: w.cantidad, alDia: w.fechaLista.toISOString().slice(0, 10) } : undefined,
    tieneFicha: !!p.technicalSheetUrl,
    famiq: p.famiqLink
      ? { listaWebUSD: p.famiqLink.precioListaWeb && Number(p.famiqLink.precioListaWeb) }
      : undefined,
    jmh: p.jmhLink ? { listaWebUSD: p.jmhLink.precioListaWeb && Number(p.jmhLink.precioListaWeb) } : undefined,
  }
}

const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase()
const sinAcentos = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

async function main() {
  const out: Record<string, unknown> = {}

  descuentos = await prisma.brandDiscount.findMany({
    select: { brand: true, productType: true, discountPercent: true },
  })
  const ws = await prisma.wintersStock.findMany({ select: { codigo: true, cantidad: true, fechaLista: true } })
  winters = new Map(ws.map((w) => [w.codigo, w]))

  if (input.skus?.length) {
    const res: Record<string, unknown> = {}
    for (const pedido of input.skus as string[]) {
      const ids = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE REPLACE(UPPER(sku), ' ', '') = ${norm(pedido)} LIMIT 5`
      const rows = ids.length
        ? await prisma.product.findMany({ where: { id: { in: ids.map((i) => i.id) } }, select })
        : []
      res[pedido] = rows.length ? rows.map(fmt) : null
    }
    out.skus = res
  }

  if (input.prefijos?.length) {
    const res: Record<string, unknown> = {}
    for (const pref of input.prefijos as string[]) {
      const rows = await prisma.product.findMany({
        where: {
          sku: { startsWith: pref, mode: 'insensitive' },
          ...(input.marcaPrefijos ? { brand: { equals: input.marcaPrefijos, mode: 'insensitive' as const } } : {}),
        },
        select,
        orderBy: { sku: 'asc' },
        take: 200,
      })
      res[pref] = rows.map(fmt)
    }
    out.prefijos = res
  }

  if (input.textos?.length) {
    const res: unknown[] = []
    for (const t of input.textos as { q: string; marca?: string; limite?: number }[]) {
      // Sin acentos ni mayúsculas: "retencion" encuentra "Retención"
      const palabras = (t.q.match(/"[^"]+"|\S+/g) ?? []).map((w) => sinAcentos(w.replace(/"/g, '')))
      const conds = palabras.map(
        (w) => Prisma.sql`translate(lower(sku || ' ' || name || ' ' || coalesce(description, '')), 'áéíóúüñ', 'aeiouun') LIKE ${'%' + w + '%'}`
      )
      if (t.marca) conds.push(Prisma.sql`upper(brand) = ${t.marca.toUpperCase()}`)
      const limite = Math.min(t.limite ?? 40, 200)
      const ids = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM products WHERE status = 'ACTIVE' AND ${Prisma.join(conds, ' AND ')}
        ORDER BY sku LIMIT ${limite}`
      const total = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM products WHERE status = 'ACTIVE' AND ${Prisma.join(conds, ' AND ')}`
      const rows = await prisma.product.findMany({
        where: { id: { in: ids.map((i) => i.id) } },
        select,
        orderBy: { sku: 'asc' },
      })
      res.push({ busqueda: t, totalCoincidencias: Number(total[0].n), resultados: rows.map(fmt) })
    }
    out.textos = res
  }

  if (input.clientes?.length) {
    const res: Record<string, unknown> = {}
    for (const q of input.clientes as string[]) {
      const digitos = q.replace(/\D/g, '')
      const esCuit = digitos.length === 11
      const guiones = `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
      const rows = await prisma.customer.findMany({
        where: esCuit
          ? { cuit: { in: [digitos, guiones] } }
          : {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { businessName: { contains: q, mode: 'insensitive' } },
              ],
            },
        select: {
          id: true,
          name: true,
          businessName: true,
          cuit: true,
          taxCondition: true,
          priceMultiplier: true,
          status: true,
          salesPerson: { select: { name: true, email: true } },
          _count: { select: { quotes: true } },
          // Las últimas cotizaciones dicen con qué multiplicador y vendedor se le viene cotizando
          quotes: {
            orderBy: { date: 'desc' },
            take: 4,
            select: {
              quoteNumber: true,
              date: true,
              status: true,
              multiplier: true,
              total: true,
              terms: true,
              salesPerson: { select: { name: true, email: true } },
            },
          },
        },
        take: 15,
      })
      res[q] = rows.map((c) => ({
        id: c.id,
        nombre: c.name,
        razonSocial: c.businessName,
        cuit: c.cuit,
        condicionIVA: c.taxCondition,
        multiplicador: Number(c.priceMultiplier),
        estado: c.status,
        vendedor: c.salesPerson,
        cotizaciones: c._count.quotes,
        ultimas: c.quotes.map((q) => ({
          numero: q.quoteNumber,
          fecha: q.date.toISOString().slice(0, 10),
          estado: q.status,
          multiplicador: Number(q.multiplier),
          totalUSD: Number(q.total),
          condiciones: q.terms,
          vendedor: q.salesPerson?.email,
        })),
      }))
    }
    out.clientes = res
  }

  if (input.conjuntos?.length) {
    const res: Record<string, unknown> = {}
    for (const sku of input.conjuntos as string[]) {
      const opciones = getConjuntosGenebre(sku)
      const codigos = [...new Set(opciones.flatMap((o) => [o.actuadorSku, ...(o.dadoSkus ?? [])]).filter(Boolean))]
      const prods = await prisma.product.findMany({ where: { sku: { in: codigos as string[] } }, select })
      const porSku = new Map(prods.map((p) => [p.sku, fmt(p)]))
      res[sku] = opciones.length
        ? opciones.map((o) => ({
            tipo: o.label,
            cotizarAparte: o.cotizar || undefined,
            nota: o.nota,
            actuador: o.actuadorSku ? porSku.get(o.actuadorSku) ?? { sku: o.actuadorSku, noEstaEnERP: true } : null,
            dados: (o.dadoSkus ?? []).map((d) => porSku.get(d) ?? { sku: d, noEstaEnERP: true }),
          }))
        : null // la tabla GENEBRE no tiene conjunto para ese código
    }
    out.conjuntos = res
  }

  if (input.cotizaciones?.length) {
    const qs = await prisma.quote.findMany({
      where: { quoteNumber: { in: input.cotizaciones } },
      select: {
        quoteNumber: true,
        date: true,
        status: true,
        multiplier: true,
        total: true,
        terms: true,
        notes: true,
        customer: { select: { name: true, cuit: true } },
        salesPerson: { select: { email: true } },
        items: {
          orderBy: [{ itemNumber: 'asc' }, { isAlternative: 'asc' }],
          select: {
            itemNumber: true,
            isAlternative: true,
            quantity: true,
            listPrice: true,
            brandDiscount: true,
            customerMultiplier: true,
            unitPrice: true,
            deliveryTime: true,
            clientReference: true,
            description: true,
            manualSku: true,
            manualBrand: true,
            product: { select: { sku: true, brand: true } },
          },
        },
      },
    })
    out.cotizaciones = qs.map((q) => ({
      numero: q.quoteNumber,
      fecha: q.date.toISOString().slice(0, 10),
      estado: q.status,
      cliente: q.customer,
      vendedor: q.salesPerson?.email,
      multiplicador: Number(q.multiplier),
      totalUSD: Number(q.total),
      condiciones: q.terms,
      notas: q.notes,
      items: q.items.map((i) => ({
        item: i.itemNumber,
        alternativa: i.isAlternative || undefined,
        codigo: i.product?.sku ?? i.manualSku ?? '(manual)',
        marca: i.product?.brand ?? i.manualBrand,
        descripcion: i.description ?? undefined,
        cantidad: i.quantity,
        listaUSD: Number(i.listPrice),
        dtoMarca: Number(i.brandDiscount),
        multiplicador: Number(i.customerMultiplier),
        unitarioUSD: Number(i.unitPrice),
        plazo: i.deliveryTime,
        refCliente: i.clientReference ?? undefined,
      })),
    }))
  }

  if (input.stockVivo?.length) {
    const res: Record<string, unknown> = {}
    for (const sku of input.stockVivo as string[]) {
      const p = await prisma.product.findFirst({
        where: { sku: { equals: sku, mode: 'insensitive' } },
        select: { famiqLink: { select: { webId: true } }, jmhLink: { select: { templateId: true } } },
      })
      try {
        if (p?.famiqLink) res[sku] = { fuente: 'FAMIQ', ...(await getFamiqLiveData(p.famiqLink.webId)) }
        else if (p?.jmhLink) res[sku] = { fuente: 'JMH', ...(await getJmhLiveData(p.jmhLink.templateId)) }
        else res[sku] = null
      } catch (e) {
        res[sku] = { error: e instanceof Error ? e.message : String(e) }
      }
    }
    out.stockVivo = res
  }

  if (input.marcas) {
    const g = await prisma.product.groupBy({
      by: ['brand'],
      where: { status: 'ACTIVE' },
      _count: { _all: true, listPriceUSD: true },
      orderBy: { _count: { brand: 'desc' } },
    })
    out.marcas = g.map((m) => ({ marca: m.brand, articulos: m._count._all, conPrecioLista: m._count.listPriceUSD }))
    out.descuentosMarca = descuentos.map((d) => ({
      marca: d.brand,
      tipo: d.productType,
      pct: Number(d.discountPercent),
    }))
  }

  if (input.vendedores) {
    out.vendedores = await prisma.user.findMany({
      where: { isVendedor: true, status: 'ACTIVE' },
      select: { name: true, email: true },
    })
  }

  const tc = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'USD', toCurrency: 'ARS' },
    orderBy: { validFrom: 'desc' },
    select: { rate: true, validFrom: true, source: true },
  })
  out.tipoCambio = tc && { rate: Number(tc.rate), desde: tc.validFrom.toISOString().slice(0, 10), fuente: tc.source }

  console.log(JSON.stringify(out, null, 1))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
