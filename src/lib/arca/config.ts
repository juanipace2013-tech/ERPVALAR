/**
 * Configuración de los Web Services de ARCA (ex AFIP) para facturación
 * electrónica propia del ERP (WSAA + WSFEv1 + WSFEX).
 *
 * Variables de entorno:
 *   ARCA_ENV            "prod" | "homo"   (default: homo — por seguridad)
 *   ARCA_CUIT           CUIT emisor sin guiones (30715373579)
 *   ARCA_CERT_PATH      ruta al certificado X.509 (.crt / .pem) emitido por ARCA
 *   ARCA_KEY_PATH       ruta a la clave privada (.key) del CSR
 *   ARCA_PUNTO_VENTA    punto de venta electrónico del ERP (7)
 *   ARCA_TA_DIR         directorio donde cachear el Ticket de Acceso (default: dir del cert)
 *   ARCA_CBU            CBU del emisor para FCE MiPyME (Opcional 2101; sin él no se emite FCE)
 *   ARCA_FCE_MONTO_MINIMO  umbral en ARS desde el cual una factura A a cliente
 *                       obligado sale como FCE (default 5.549.862 — Res 1/2026, se actualiza)
 *   ARCA_PUNTO_VENTA_EXPO  PV "Comprobantes de Exportación - Web Services" para la
 *                       Factura E por WSFEX (10). Opcional: sin ella la Factura E queda
 *                       deshabilitada (no se agrega a las variables obligatorias).
 *
 * En prod los archivos viven en /home/deploy/afip/ (fuera del repo, perms 600).
 */
import path from 'path'

export type ArcaEnv = 'prod' | 'homo'

export interface ArcaConfig {
  env: ArcaEnv
  cuit: string
  certPath: string
  keyPath: string
  puntoVenta: number
  taDir: string
  wsaaUrl: string
  wsfeUrl: string
  /** WSFEX: Factura E de exportación (tipos 19/20/21) */
  wsfexUrl: string
  /** PV de exportación por web services (null = Factura E deshabilitada) */
  puntoVentaExportacion: number | null
  /** CBU del emisor para FCE (null = FCE deshabilitada) */
  cbu: string | null
  /** Umbral ARS para FCE a clientes obligados */
  fceMontoMinimo: number
}

const URLS: Record<ArcaEnv, { wsaa: string; wsfe: string; wsfex: string }> = {
  prod: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    wsfex: 'https://servicios1.afip.gov.ar/wsfexv1/service.asmx',
  },
  homo: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    wsfex: 'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx',
  },
}

export function getArcaConfig(): ArcaConfig {
  const env: ArcaEnv = process.env.ARCA_ENV === 'prod' ? 'prod' : 'homo'
  const cuit = (process.env.ARCA_CUIT || '').replace(/\D/g, '')
  const certPath = process.env.ARCA_CERT_PATH || ''
  const keyPath = process.env.ARCA_KEY_PATH || ''
  const puntoVenta = Number(process.env.ARCA_PUNTO_VENTA || 0)

  const missing: string[] = []
  if (cuit.length !== 11) missing.push('ARCA_CUIT')
  if (!certPath) missing.push('ARCA_CERT_PATH')
  if (!keyPath) missing.push('ARCA_KEY_PATH')
  if (!puntoVenta) missing.push('ARCA_PUNTO_VENTA')
  if (missing.length) {
    throw new Error(`Configuración ARCA incompleta: faltan ${missing.join(', ')}`)
  }

  return {
    env,
    cuit,
    certPath,
    keyPath,
    puntoVenta,
    taDir: process.env.ARCA_TA_DIR || path.dirname(certPath),
    wsaaUrl: URLS[env].wsaa,
    wsfeUrl: URLS[env].wsfe,
    wsfexUrl: URLS[env].wsfex,
    puntoVentaExportacion: puntoVentaExportacionDesdeEnv(),
    cbu: (() => {
      const c = (process.env.ARCA_CBU || '').replace(/\D/g, '')
      return c.length === 22 ? c : null
    })(),
    fceMontoMinimo: Number(process.env.ARCA_FCE_MONTO_MINIMO) > 0
      ? Number(process.env.ARCA_FCE_MONTO_MINIMO)
      : 5_549_862,
  }
}

/** ARCA_PUNTO_VENTA_EXPO como entero positivo, o null si no está seteada o es inválida. */
function puntoVentaExportacionDesdeEnv(): number | null {
  const n = Number(process.env.ARCA_PUNTO_VENTA_EXPO)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** true si ARCA está configurado Y hay PV de exportación: la Factura E se puede emitir. */
export function isFacturaExportacionConfigured(): boolean {
  try {
    return getArcaConfig().puntoVentaExportacion !== null
  } catch {
    return false
  }
}

export function isArcaConfigured(): boolean {
  try {
    getArcaConfig()
    return true
  } catch {
    return false
  }
}
