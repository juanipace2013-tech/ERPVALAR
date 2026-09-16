/**
 * Actualización del tipo de cambio de facturación desde el BNA.
 *
 * Regla del negocio: se factura siempre con el dólar billete VENTA del BNA
 * del día hábil anterior. Cada mañana el cron carga en ExchangeRate la
 * cotización de ayer (o del último día hábil si ayer no hubo), con
 * validFrom = día de la cotización — igual que se venía cargando a mano.
 *
 * Un TC MANUAL ya cargado para esa fecha se respeta: si Santiago pisó el
 * valor a propósito, el cron no lo sobreescribe.
 */

import { prisma } from '@/lib/prisma'
import { getBNABilleteUSD } from '@/lib/bna'
import { logger } from '@/lib/logger'

export interface ResultadoTcBNA {
  accion: 'creado' | 'actualizado' | 'sin_cambios' | 'respetado_manual'
  rate: number
  /** Día de la cotización BNA (YYYY-MM-DD), que es el validFrom del registro. */
  fechaCotizacion: string
  exchangeRateId: string
}

/** Día de hoy en Buenos Aires, como medianoche UTC (formato de validFrom). */
function hoyEnArgentina(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return new Date(`${ymd}T00:00:00.000Z`)
}

const DIA_MS = 24 * 60 * 60 * 1000
/** Hasta cuántos días hacia atrás buscar cotización (feriados largos + finde). */
const MAX_DIAS_ATRAS = 7

export async function actualizarTipoCambioBNA(): Promise<ResultadoTcBNA> {
  const hoy = hoyEnArgentina()

  // El cotizador del BNA solo devuelve la fecha pedida (o posteriores), así
  // que un domingo/feriado responde sin cotización: se retrocede día por día
  // hasta encontrar el último día hábil.
  let billete = null
  for (let dias = 1; dias <= MAX_DIAS_ATRAS && !billete; dias++) {
    billete = await getBNABilleteUSD(new Date(hoy.getTime() - dias * DIA_MS))
  }
  if (!billete) {
    throw new Error(`El BNA no informó cotización en los últimos ${MAX_DIAS_ATRAS} días`)
  }

  const validFrom = billete.fecha
  const fechaCotizacion = validFrom.toISOString().slice(0, 10)
  const rate = billete.venta

  const existente = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'USD', toCurrency: 'ARS', validFrom },
  })

  if (!existente) {
    const creado = await prisma.exchangeRate.create({
      data: { fromCurrency: 'USD', toCurrency: 'ARS', rate, source: 'BNA', validFrom },
    })
    logger.info(`[TC BNA] Creado TC ${fechaCotizacion}: $${rate} (billete venta BNA)`)
    return { accion: 'creado', rate, fechaCotizacion, exchangeRateId: creado.id }
  }

  if (existente.source === 'MANUAL') {
    logger.info(`[TC BNA] TC ${fechaCotizacion} ya cargado a mano ($${existente.rate}); no se pisa`)
    return { accion: 'respetado_manual', rate: Number(existente.rate), fechaCotizacion, exchangeRateId: existente.id }
  }

  if (Number(existente.rate) !== rate) {
    await prisma.exchangeRate.update({
      where: { id: existente.id },
      data: { rate, source: 'BNA' },
    })
    logger.info(`[TC BNA] Actualizado TC ${fechaCotizacion}: $${existente.rate} → $${rate}`)
    return { accion: 'actualizado', rate, fechaCotizacion, exchangeRateId: existente.id }
  }

  return { accion: 'sin_cambios', rate, fechaCotizacion, exchangeRateId: existente.id }
}
