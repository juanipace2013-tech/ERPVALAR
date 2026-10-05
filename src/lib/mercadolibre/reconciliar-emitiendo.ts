/**
 * Ventas de ML con el candado del ERP en EMITIENDO y sin factura: quedaron
 * "para revisar" después de un ARCA_INCIERTO (se pidió el CAE y ARCA no lo
 * confirmó). ¿ARCA tiene un comprobante para esa venta?
 *
 * Lo usa scripts/ml-reconciliar-emitiendo.ts. Sin imports: la consulta a ARCA
 * (FECompUltimoAutorizado / FECompConsultar) se inyecta, para probarlo sin red.
 */

/** Candado (fila MlOrderInvoice) a revisar */
export interface CandadoEmitiendo {
  packId: string
  /** CUIT/CUIL con el que se iba a facturar (NN-NNNNNNNN-N) */
  cuit: string | null
  /** Total que cobró ML */
  total: number | null
  createdAt: Date
}

/** Lo que importa de un FECompConsultar */
export interface ComprobanteArca {
  cbteTipo: number
  numero: number
  ImpTotal: number
  DocTipo: number
  DocNro: string
  /** yyyymmdd */
  CbteFch: string
  CodAutorizacion: string
  Resultado: string
}

/** Facturas que puede emitir una venta de ML: Factura A (1), Factura B (6) y FCE A (201) */
export const TIPOS_FACTURA_ML = [1, 6, 201]

/**
 * Tope de números a revisar para atrás por tipo. Se recorre hasta llegar a un
 * comprobante de antes del día del candado (el PV 7 es compartido con la
 * facturación de cotizaciones: pueden ser muchos); si se llega al tope sin
 * llegar a ese día es un ERROR (no se revisó todo), nunca "no hay nada".
 */
export const VENTANA_NUMEROS = 500

const digitos = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

/** Fecha → yyyymmdd en hora local (= toCbteFch de wsfe.ts, como se armó el comprobante) */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/**
 * ¿El comprobante de ARCA es de esta venta? El total a 1 peso o menos del que
 * cobró ML (la A redondea neto e IVA por separado: $100 → 99,99) y el
 * documento del receptor igual al CUIT/CUIL del candado o al DNI que tiene
 * adentro (dígitos 3 a 10: la B a un consumidor que ARCA no tiene sale con el
 * DNI). Sin CUIT o sin total en el candado no se puede afirmar nada: false.
 */
export function coincideConCandado(
  c: Pick<ComprobanteArca, 'ImpTotal' | 'DocNro'>,
  candado: Pick<CandadoEmitiendo, 'cuit' | 'total'>
): boolean {
  const cuit = digitos(candado.cuit)
  const total = candado.total === null ? NaN : Number(candado.total)
  if (cuit.length !== 11 || !Number.isFinite(total)) return false
  if (!(Math.abs(Number(c.ImpTotal) - total) <= 1)) return false
  return mismoReceptor(c, candado)
}

/**
 * ¿El receptor del comprobante es el comprador del candado (CUIT/CUIL o el DNI
 * de adentro)? Sin mirar el total: un borrador editado (otro precio, otra
 * línea) emite por un importe distinto al que cobró ML.
 */
export function mismoReceptor(c: Pick<ComprobanteArca, 'DocNro'>, candado: Pick<CandadoEmitiendo, 'cuit'>): boolean {
  const cuit = digitos(candado.cuit)
  if (cuit.length !== 11) return false
  const doc = digitos(c.DocNro)
  if (doc === cuit) return true
  return doc.length >= 7 && doc.length <= 8 && Number(doc) === Number(cuit.slice(2, 10))
}

export interface ResultadoEscaneoArca {
  /** Comprobantes de ARCA que coinciden con la venta (registrarlos a mano: NO liberar) */
  coincidencias: ComprobanteArca[]
  /** Mismo receptor desde el día del candado pero otro total (¿borrador editado?): revisar a mano, NO liberar */
  posibles: ComprobanteArca[]
  /** Consultas a ARCA que fallaron: sin revisar todo no se puede liberar */
  errores: string[]
  /** Comprobantes revisados (existentes en ARCA) */
  revisados: number
}

/**
 * Recorre, para cada tipo (A, B, FCE A), del último número autorizado hacia
 * atrás (hasta VENTANA_NUMEROS) y junta los que coinciden con la venta. Corta
 * cada tipo al llegar a comprobantes de antes del día del candado (no pueden
 * ser de esta emisión).
 */
export async function escanearArcaParaCandado(
  candado: CandadoEmitiendo,
  deps: {
    ultimoAutorizado: (cbteTipo: number) => Promise<number>
    consultar: (cbteTipo: number, numero: number) => Promise<ComprobanteArca | null>
  },
  opts: { tipos?: number[]; ventana?: number } = {}
): Promise<ResultadoEscaneoArca> {
  const tipos = opts.tipos ?? TIPOS_FACTURA_ML
  const ventana = opts.ventana ?? VENTANA_NUMEROS
  const desde = ymdLocal(candado.createdAt)
  const out: ResultadoEscaneoArca = { coincidencias: [], posibles: [], errores: [], revisados: 0 }
  for (const tipo of tipos) {
    let ultimo: number
    try {
      ultimo = await deps.ultimoAutorizado(tipo)
    } catch (e) {
      out.errores.push(`tipo ${tipo}: FECompUltimoAutorizado: ${(e as Error).message}`)
      continue
    }
    let llegoAlDia = false
    for (let n = ultimo; n > 0 && n > ultimo - ventana; n--) {
      let c: ComprobanteArca | null
      try {
        c = await deps.consultar(tipo, n)
      } catch (e) {
        out.errores.push(`tipo ${tipo} N° ${n}: FECompConsultar: ${(e as Error).message}`)
        continue
      }
      if (!c) continue
      out.revisados++
      // Anterior al día en que se tomó el candado: de acá para atrás no hay nada de esta venta
      if (c.CbteFch && c.CbteFch < desde) {
        llegoAlDia = true
        break
      }
      if (coincideConCandado(c, candado)) out.coincidencias.push(c)
      else if (mismoReceptor(c, candado)) out.posibles.push(c)
    }
    // Se revisó todo si se llegó a un comprobante anterior al candado o al N° 1
    if (!llegoAlDia && ultimo > 0 && ultimo - ventana > 0) {
      out.errores.push(`tipo ${tipo}: se revisaron ${ventana} números para atrás desde el ${ultimo} sin llegar al día del candado (${desde})`)
    }
  }
  return out
}
