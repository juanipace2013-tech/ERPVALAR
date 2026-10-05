/**
 * Reconciliación de facturas directas inciertas o trabadas
 * (scripts/factura-directa-reconciliar.ts): ¿ARCA emitió el comprobante que
 * pidió esta fila? Decide sin efectos (las consultas a ARCA y a la DB se
 * inyectan, para probarlo sin red); el script aplica la decisión.
 *
 *  - Con el número del intento (EmisionInciertaError lo trae siempre: es el
 *    número exacto que se pidió dentro del lock de la emisión) se consulta
 *    SOLO ese número: si ARCA no llegó a él, o es de otro receptor / total, o
 *    ya es otra factura del ERP, ARCA no emitió esta (DESCARTADA). Si es el
 *    mismo receptor y total, es esta (AUTORIZADA).
 *  - Sin número (TRABADA, o incierta sin número) se recorre ARCA para atrás
 *    desde el día de la factura (escanearArcaParaCandado), sin contar los
 *    comprobantes que ya son otra factura del ERP (otro flujo).
 *  - Ante la duda (varios candidatos, un consumidor final sin identificar,
 *    errores de ARCA) no se concluye nada: revisar a mano.
 *
 * Módulo puro: solo importa módulos sin dependencias de servidor.
 */
import { normalizeCuit } from '@/lib/cuit-utils'
import { escanearArcaParaCandado, type ComprobanteArca } from '@/lib/mercadolibre/reconciliar-emitiendo'
import { fechaDesdeYmd } from './factura-directa-form'

const soloDigitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

const NOMBRE_CBTE: Record<number, string> = { 1: 'Factura A', 6: 'Factura B', 201: 'FCE A' }
const nombreCbte = (tipo: number) => NOMBRE_CBTE[tipo] ?? `comprobante tipo ${tipo}`

/** Tipos a buscar en ARCA: el del intento si se sabe; si no, A → Factura A y FCE A, B → Factura B */
export function tiposAReconciliar(letra: string, cbteTipoIntento: number | null | undefined): number[] {
  if (cbteTipoIntento) return [cbteTipoIntento]
  return letra === 'A' ? [1, 201] : [6]
}

/**
 * ¿El comprobante de ARCA es el de esta factura directa? Se sabe exactamente
 * qué se mandó: mismo receptor (DocTipo + DocNro) y mismo total (±1 centavo)
 * → 'coincide'. A un consumidor final sin identificar (99) nunca se afirma:
 * 'posible' (revisar a mano). Sin receptor guardado: 'posible' si el total
 * coincide (nunca se descarta a ciegas).
 */
export function compararConFacturaDirecta(
  c: { ImpTotal: number; DocTipo: number; DocNro: string },
  f: { docTipo: number | null; docNro: string | null; total: number }
): 'coincide' | 'posible' | null {
  const mismoTotal = Math.abs(Number(c.ImpTotal) - Number(f.total)) <= 0.01
  const doc = soloDigitos(f.docNro).replace(/^0+/, '')
  if (f.docTipo === null || f.docTipo === undefined || !f.docNro) return mismoTotal ? 'posible' : null
  const mismoDoc = Number(c.DocTipo) === f.docTipo && soloDigitos(c.DocNro).replace(/^0+/, '') === doc
  if (!mismoDoc || !mismoTotal) return null
  return f.docTipo === 99 ? 'posible' : 'coincide'
}

/**
 * Documento con que la factura directa toma el candado de la venta de ML
 * (MlOrderInvoice.cuit): el CUIT/CUIL formateado, o los dígitos del DNI (o
 * '0') en una B a consumidor final. La reconciliación de ML no compara un
 * DNI: esos candados los resuelve scripts/factura-directa-reconciliar.ts.
 */
export function cuitParaCandadoMl(receptor: { docNro: string }): string {
  const d = soloDigitos(receptor.docNro)
  return d.length === 11 ? normalizeCuit(d)! : d
}

/**
 * ¿El candado de la venta de ML es el que tomó esta factura directa? Sigue en
 * EMITIENDO sin factura, con el documento y el total que se mandaron a ARCA, y
 * se tomó después de crear la fila (y, si quedó INCIERTA, antes de marcarla:
 * el candado se toma antes de pedir el CAE). Si no, es de otra emisión (por
 * ejemplo el flujo de ML, que lo volvió a tomar) y no se toca.
 */
export function candadoEsDeLaFila(
  candado: { status: string; invoiceId: string | null; createdAt: Date; total: unknown; cuit: string | null },
  fila: { estado: string; createdAt: Date; updatedAt: Date; total: unknown; docNro: string | null }
): boolean {
  if (candado.status !== 'EMITIENDO' || candado.invoiceId) return false
  if (!fila.docNro || candado.cuit !== cuitParaCandadoMl({ docNro: fila.docNro })) return false
  if (candado.total === null || candado.total === undefined || !(Math.abs(Number(candado.total) - Number(fila.total)) <= 0.005)) return false
  if (candado.createdAt.getTime() < fila.createdAt.getTime()) return false
  if (fila.estado === 'INCIERTA' && candado.createdAt.getTime() > fila.updatedAt.getTime()) return false
  return true
}

/** Fila del diario a reconciliar (INCIERTA o EMITIENDO trabada) */
export interface FilaAReconciliar {
  id: string
  letra: string
  docTipo: number | null
  docNro: string | null
  total: number
  /** YYYY-MM-DD (CbteFch que se mandó) */
  fechaFactura: string
  /** Intento guardado por la emisión (null en una TRABADA) */
  intento: { cbteTipo: number; numero: number | null } | null
}

/** Invoice del ERP que ya tiene ese comprobante (PV + tipo + número) */
export interface InvoiceDelComprobante {
  id: string
  invoiceNumber: string
  /** Factura directa vinculada a esa Invoice (si la hay) */
  facturaDirectaId: string | null
}

export interface DepsReconciliacionDirecta {
  ultimoAutorizado: (cbteTipo: number) => Promise<number>
  consultar: (cbteTipo: number, numero: number) => Promise<ComprobanteArca | null>
  /** Invoice del ERP registrada con ese comprobante (en el PV de la config) */
  invoiceDelComprobante: (cbteTipo: number, numero: number) => Promise<InvoiceDelComprobante | null>
  /** Tope de números a recorrer por tipo (default el de la reconciliación de ML) */
  ventana?: number
}

export type DecisionReconciliacionDirecta =
  /** ARCA tiene el comprobante de esta fila: pasa a AUTORIZADA con su CAE y se registra la Invoice */
  | { accion: 'autorizar'; comprobante: ComprobanteArca; detalle: string }
  /** ARCA seguro no emitió esta factura: DESCARTADA (la clave se puede reusar) */
  | { accion: 'descartar'; detalle: string }
  /** No se puede concluir: revisar a mano (no se cambia nada) */
  | { accion: 'revisar'; detalle: string; candidatos: ComprobanteArca[]; errores: string[] }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Es esta fila: la Invoice ya está vinculada a ella (no debería pasar en una incierta, pero no es "otra factura") */
const esDeEstaFila = (inv: InvoiceDelComprobante | null, filaId: string) => !!inv && inv.facturaDirectaId === filaId

/** Qué hacer con una factura directa INCIERTA o TRABADA (ver el encabezado del módulo) */
export async function decidirReconciliacionDirecta(fila: FilaAReconciliar, deps: DepsReconciliacionDirecta): Promise<DecisionReconciliacionDirecta> {
  const numero = fila.intento?.numero ?? null
  if (fila.intento && numero && numero > 0) return decidirConNumero(fila, fila.intento.cbteTipo, numero, deps)
  return decidirEscaneando(fila, deps)
}

async function decidirConNumero(fila: FilaAReconciliar, tipo: number, numero: number, deps: DepsReconciliacionDirecta): Promise<DecisionReconciliacionDirecta> {
  const cbte = `${nombreCbte(tipo)} N° ${numero}`
  const revisar = (detalle: string, candidatos: ComprobanteArca[] = [], errores: string[] = []) => ({ accion: 'revisar' as const, detalle, candidatos, errores })

  let ultimo: number
  try {
    ultimo = await deps.ultimoAutorizado(tipo)
  } catch (e) {
    return revisar(`No se pudo consultar el último ${nombreCbte(tipo)} autorizado: volver a correr más tarde`, [], [`FECompUltimoAutorizado: ${msg(e)}`])
  }
  if (ultimo < numero) {
    return { accion: 'descartar', detalle: `ARCA no llegó a autorizar la ${cbte} que pidió esta factura (el último autorizado es el ${ultimo})` }
  }
  let c: ComprobanteArca | null
  try {
    c = await deps.consultar(tipo, numero)
  } catch (e) {
    return revisar(`No se pudo consultar la ${cbte} en ARCA: volver a correr más tarde`, [], [`FECompConsultar: ${msg(e)}`])
  }
  if (!c) return revisar(`ARCA informa autorizados hasta el ${ultimo} pero no devolvió la ${cbte}: volver a correr más tarde`)

  const comparacion = compararConFacturaDirecta(c, fila)
  const registrada = await deps.invoiceDelComprobante(tipo, numero)
  if (registrada && !esDeEstaFila(registrada, fila.id)) {
    // El número lo usó otro flujo del ERP: esta emisión no lo obtuvo. Si
    // además coincide receptor y total no se afirma nada (revisar a mano).
    if (comparacion === 'coincide' || comparacion === 'posible') {
      return revisar(
        `La ${cbte} de ARCA tiene el mismo receptor y total pero ya está registrada en el ERP como ${registrada.invoiceNumber} (${registrada.id}): revisar a mano`,
        [c]
      )
    }
    return { accion: 'descartar', detalle: `La ${cbte} es ${registrada.invoiceNumber}, de otro flujo del ERP (otro receptor o total): ARCA no emitió esta factura` }
  }
  if (comparacion === 'coincide') return { accion: 'autorizar', comprobante: c, detalle: `ARCA tiene la ${cbte} con el mismo receptor y total` }
  if (comparacion === 'posible') {
    return revisar(`La ${cbte} de ARCA tiene el mismo total pero no se puede afirmar que sea esta (consumidor final sin identificar o sin receptor guardado): revisar a mano`, [c])
  }
  return {
    accion: 'descartar',
    detalle: `La ${cbte} de ARCA es de otro receptor o total (doc ${c.DocTipo} ${c.DocNro}, total ${c.ImpTotal}): ARCA no emitió esta factura`,
  }
}

async function decidirEscaneando(fila: FilaAReconciliar, deps: DepsReconciliacionDirecta): Promise<DecisionReconciliacionDirecta> {
  const tipos = tiposAReconciliar(fila.letra, fila.intento?.cbteTipo ?? null)
  // Comprobantes parecidos que ya son otra factura del ERP: de otro flujo, no cuentan
  const ajenos = new Map<string, InvoiceDelComprobante>()
  const clave = (tipo: number, numero: number) => `${tipo}-${numero}`
  const r = await escanearArcaParaCandado(
    { packId: fila.id, cuit: null, total: fila.total, createdAt: fechaDesdeYmd(fila.fechaFactura) },
    {
      ultimoAutorizado: deps.ultimoAutorizado,
      consultar: async (tipo, numero) => {
        const c = await deps.consultar(tipo, numero)
        if (c && compararConFacturaDirecta(c, fila) !== null) {
          const inv = await deps.invoiceDelComprobante(tipo, numero)
          if (inv && !esDeEstaFila(inv, fila.id)) ajenos.set(clave(tipo, numero), inv)
        }
        return c
      },
    },
    { tipos, ventana: deps.ventana, comparar: (c) => (ajenos.has(clave(c.cbteTipo, c.numero)) ? null : compararConFacturaDirecta(c, fila)) }
  )
  const buscados = `${tipos.map(nombreCbte).join(', ')} desde el ${fila.fechaFactura} (${r.revisados} revisados${ajenos.size ? `; ${ajenos.size} ya registrados en el ERP por otro flujo, no cuentan` : ''})`
  if (r.coincidencias.length > 1 || r.posibles.length) {
    return {
      accion: 'revisar',
      detalle: `Hay más de un candidato o no se puede afirmar cuál es (${buscados}): revisar a mano`,
      candidatos: [...r.coincidencias, ...r.posibles],
      errores: r.errores,
    }
  }
  if (r.coincidencias.length === 1) {
    return { accion: 'autorizar', comprobante: r.coincidencias[0], detalle: `ARCA tiene un único comprobante con el mismo receptor y total (${buscados})` }
  }
  if (r.errores.length) {
    return { accion: 'revisar', detalle: `No se pudo revisar todo en ARCA (${buscados}): no se concluye nada, volver a correr más tarde`, candidatos: [], errores: r.errores }
  }
  if (fila.docTipo === null || fila.docTipo === undefined || !fila.docNro) {
    return { accion: 'revisar', detalle: 'La fila no tiene el receptor guardado: no se puede comparar con ARCA. Revisar a mano', candidatos: [], errores: [] }
  }
  return { accion: 'descartar', detalle: `ARCA no tiene ningún comprobante con ese receptor y ese total (${buscados})` }
}
