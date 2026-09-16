/**
 * Cotización del dólar billete del Banco Nación (BNA).
 *
 * Para facturar se usa siempre el billete VENTA del día hábil anterior
 * (la misma regla que se aplicaba cargando el valor a mano cada mañana).
 *
 * El BNA no publica API: se consulta el buscador histórico del cotizador
 * (GET /Cotizador/HistoricoPrincipales?id=billetes&fecha=d/M/yyyy&idMoneda=22),
 * que responde HTML con la tabla de "cotizaciones cercanas" a la fecha pedida.
 * Como la tabla incluye los días previos, un fin de semana o feriado se
 * resuelve con la misma consulta: se toma la última fecha <= la pedida.
 */

import axios from 'axios'
import { logger } from '@/lib/logger'

const BNA_HISTORICO_URL = 'https://www.bna.com.ar/Cotizador/HistoricoPrincipales'
const ID_MONEDA_DOLAR = '22'

const FETCH_TIMEOUT_MS = 10000
const MAX_FETCH_ATTEMPTS = 3
const FETCH_BACKOFF_MS = [500, 1000, 2000]

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const bnaClient = axios.create({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Requested-With': 'XMLHttpRequest',
  },
  timeout: FETCH_TIMEOUT_MS,
})

export interface BNABillete {
  /** Día de la cotización, como medianoche UTC (igual que ExchangeRate.validFrom). */
  fecha: Date
  compra: number
  venta: number
}

/** "1.530,0000" | "1530,0000" → 1530 */
function parseNumeroBNA(texto: string): number {
  return parseFloat(texto.replace(/\./g, '').replace(',', '.'))
}

/**
 * Extrae las filas "Dolar U.S.A" de la tabla de cotizaciones cercanas.
 * Cada fila del HTML es: moneda, compra, venta, fecha (d/M/yyyy).
 */
export function parseBNABilletesHTML(html: string): BNABillete[] {
  const filas: BNABillete[] = []
  const filaRegex =
    /<td>Dolar U\.S\.A<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>([\d.,]+)<\/td>\s*<td>(\d{1,2})\/(\d{1,2})\/(\d{4})<\/td>/g

  let match: RegExpExecArray | null
  while ((match = filaRegex.exec(html)) !== null) {
    const compra = parseNumeroBNA(match[1])
    const venta = parseNumeroBNA(match[2])
    const [dia, mes, anio] = [Number(match[3]), Number(match[4]), Number(match[5])]
    if (!Number.isFinite(compra) || !Number.isFinite(venta)) continue
    filas.push({ fecha: new Date(Date.UTC(anio, mes - 1, dia)), compra, venta })
  }

  return filas
}

/** Formatea una fecha (medianoche UTC) como d/M/yyyy, el formato del cotizador. */
function formatearFechaBNA(fecha: Date): string {
  return `${fecha.getUTCDate()}/${fecha.getUTCMonth() + 1}/${fecha.getUTCFullYear()}`
}

/**
 * Devuelve la cotización billete USD del BNA vigente a la fecha `hasta`:
 * la del mismo día si existe, o la del último día hábil anterior (la tabla
 * de cercanas cubre fines de semana y feriados). `hasta` debe ser una
 * medianoche UTC. Devuelve null si el BNA no informó ninguna fecha <= hasta.
 * Lanza si el BNA no responde tras los reintentos.
 */
export async function getBNABilleteUSD(hasta: Date): Promise<BNABillete | null> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      logger.info(`[BNA] Consultando billete USD al ${formatearFechaBNA(hasta)} (intento ${attempt}/${MAX_FETCH_ATTEMPTS})`)

      const response = await bnaClient.get<string>(BNA_HISTORICO_URL, {
        params: { id: 'billetes', fecha: formatearFechaBNA(hasta), idMoneda: ID_MONEDA_DOLAR },
        responseType: 'text',
      })

      const filas = parseBNABilletesHTML(response.data)
      if (filas.length === 0) {
        throw new Error('El BNA respondió sin cotizaciones de Dolar U.S.A (¿cambió el HTML del cotizador?)')
      }

      const vigentes = filas.filter((f) => f.fecha.getTime() <= hasta.getTime())
      if (vigentes.length === 0) {
        logger.warn(`[BNA] Sin cotización para el ${formatearFechaBNA(hasta)} ni días previos en la respuesta`)
        return null
      }

      const billete = vigentes.reduce((a, b) => (a.fecha.getTime() >= b.fecha.getTime() ? a : b))
      logger.info(`[BNA] Billete USD ${formatearFechaBNA(billete.fecha)}: compra ${billete.compra} / venta ${billete.venta}`)
      return billete
    } catch (error) {
      lastError = error
      logger.warn(
        `[BNA] Falló intento ${attempt}/${MAX_FETCH_ATTEMPTS}:`,
        error instanceof Error ? error.message : error
      )
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await sleep(FETCH_BACKOFF_MS[attempt - 1] ?? 2000)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Error desconocido al consultar el BNA')
}
