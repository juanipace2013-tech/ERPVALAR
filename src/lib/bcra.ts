/**
 * Servicio para obtener datos del Banco Central de la República Argentina (BCRA)
 */

import axios from 'axios'
import https from 'https'

interface BCRAMoneda {
  codigoMoneda: string
  descripcion: string
  tipoPase: number
  tipoCotizacion: number
}

interface BCRACotizacionResponse {
  status: number
  results: {
    fecha: string
    detalle: BCRAMoneda[]
  }
}

// Agente HTTPS que ignora errores de certificado SSL
// Necesario porque el certificado del BCRA puede tener problemas de verificación
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
})

// Cliente axios configurado para BCRA
const bcraClient = axios.create({
  httpsAgent,
  headers: {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
  timeout: 10000, // 10 segundos
})

/**
 * Obtiene el tipo de cambio USD oficial del BCRA
 * Endpoint: https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones
 */
export async function getBCRAUSDRate(): Promise<{
  rate: number
  date: Date
  source: string
}> {
  try {
    // API del BCRA v1 - Cotizaciones
    const url = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones'

    console.log('📊 Consultando BCRA:', url)

    const response = await bcraClient.get<BCRACotizacionResponse>(url)

    const data = response.data

    if (!data.results || !data.results.detalle) {
      throw new Error('No hay datos disponibles del BCRA')
    }

    // Buscar USD en el detalle
    const usdData = data.results.detalle.find(
      (moneda) => moneda.codigoMoneda === 'USD'
    )

    if (!usdData || !usdData.tipoCotizacion) {
      throw new Error('No se encontró cotización USD en los datos del BCRA')
    }

    console.log('✅ Tipo de cambio BCRA obtenido:', {
      fecha: data.results.fecha,
      moneda: usdData.descripcion,
      tipoCotizacion: usdData.tipoCotizacion,
    })

    return {
      rate: usdData.tipoCotizacion,
      date: new Date(data.results.fecha),
      source: 'BANCO_CENTRAL',
    }
  } catch (error) {
    console.error('❌ Error al obtener tipo de cambio del BCRA:', error)
    throw new Error(
      error instanceof Error
        ? `Error BCRA: ${error.message}`
        : 'Error desconocido al consultar BCRA'
    )
  }
}

/**
 * Obtiene todas las cotizaciones disponibles del BCRA
 */
export async function getBCRACotizaciones(): Promise<BCRACotizacionResponse> {
  try {
    const url = 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones'

    console.log('📊 Consultando cotizaciones BCRA:', url)

    const response = await bcraClient.get<BCRACotizacionResponse>(url)

    const data = response.data

    console.log('✅ Cotizaciones BCRA obtenidas:', {
      fecha: data.results.fecha,
      monedas: data.results.detalle.length,
    })

    return data
  } catch (error) {
    console.error('❌ Error al obtener cotizaciones del BCRA:', error)
    throw new Error(
      error instanceof Error
        ? `Error BCRA: ${error.message}`
        : 'Error desconocido al consultar BCRA'
    )
  }
}

/**
 * Formatea un número como tipo de cambio (6 decimales)
 */
export function formatExchangeRate(rate: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(rate)
}
