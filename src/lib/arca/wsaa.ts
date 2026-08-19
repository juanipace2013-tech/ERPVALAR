/**
 * WSAA — Web Service de Autenticación y Autorización de ARCA.
 *
 * Flujo: armar un LoginTicketRequest (XML) → firmarlo CMS/PKCS#7 con el
 * certificado de ARCA → enviarlo a loginCms → recibir token + sign válidos
 * por ~12 h. Hay que cachear el TA: pedir uno nuevo mientras hay uno vigente
 * devuelve error ("El CEE ya posee un TA valido para el acceso al WSN").
 *
 * Cache: memoria + archivo JSON en ARCA_TA_DIR (sobrevive reinicios de pm2).
 */
import fs from 'fs'
import path from 'path'
import forge from 'node-forge'
import { XMLParser } from 'fast-xml-parser'
import { getArcaConfig } from './config'
import { postSoap } from './http'
import { logger } from '@/lib/logger'

export interface TicketAcceso {
  token: string
  sign: string
  expirationTime: string // ISO
  generationTime: string
  service: string
}

const memCache = new Map<string, TicketAcceso>()
const inflight = new Map<string, Promise<TicketAcceso>>()

// Margen de seguridad antes del vencimiento del TA
const EXPIRY_MARGIN_MS = 10 * 60 * 1000

function taFilePath(service: string): string {
  const { taDir, env } = getArcaConfig()
  return path.join(taDir, `ta-${service}-${env}.json`)
}

function isValid(ta: TicketAcceso | undefined | null): ta is TicketAcceso {
  if (!ta) return false
  return new Date(ta.expirationTime).getTime() - EXPIRY_MARGIN_MS > Date.now()
}

function readTaFile(service: string): TicketAcceso | null {
  try {
    const raw = fs.readFileSync(taFilePath(service), 'utf8')
    return JSON.parse(raw) as TicketAcceso
  } catch {
    return null
  }
}

function writeTaFile(service: string, ta: TicketAcceso): void {
  try {
    const file = taFilePath(service)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(ta, null, 2), { mode: 0o600 })
  } catch (err) {
    logger.warn('[WSAA] No se pudo persistir el TA en disco:', err)
  }
}

function buildLoginTicketRequest(service: string): string {
  const now = Date.now()
  // ARCA tolera desfasaje de reloj: generación 10 min atrás, expiración +12h
  const generation = new Date(now - 10 * 60 * 1000).toISOString()
  const expiration = new Date(now + 12 * 60 * 60 * 1000).toISOString()
  const uniqueId = Math.floor(now / 1000)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header><uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generation}</generationTime>` +
    `<expirationTime>${expiration}</expirationTime></header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  )
}

/** Firma CMS (PKCS#7 signedData, attached) del XML, devuelta en base64. */
function signCms(xml: string, certPem: string, keyPem: string): string {
  const cert = forge.pki.certificateFromPem(certPem)
  const key = forge.pki.privateKeyFromPem(keyPem)

  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(xml, 'utf8')
  p7.addCertificate(cert)
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  })
  p7.sign()
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes()
  return forge.util.encode64(der)
}

function dig(obj: unknown, keys: string[]): unknown {
  let cur: unknown = obj
  for (const k of keys) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

async function requestTa(service: string): Promise<TicketAcceso> {
  const cfg = getArcaConfig()
  const certPem = fs.readFileSync(cfg.certPath, 'utf8')
  const keyPem = fs.readFileSync(cfg.keyPath, 'utf8')

  const ltr = buildLoginTicketRequest(service)
  const cms = signCms(ltr, certPem, keyPem)

  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`

  const res = await postSoap(
    cfg.wsaaUrl,
    envelope,
    { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    30000
  )
  const text = res.text

  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
  const doc = parser.parse(text) as Record<string, unknown>

  const fault = dig(doc, ['Envelope', 'Body', 'Fault'])
  if (fault) {
    const f = fault as Record<string, unknown>
    throw new Error(`WSAA fault: ${String(f.faultcode ?? '')} ${String(f.faultstring ?? '')}`.trim())
  }
  const loginReturn = dig(doc, ['Envelope', 'Body', 'loginCmsResponse', 'loginCmsReturn'])
  if (typeof loginReturn !== 'string') {
    throw new Error(`WSAA: respuesta inesperada (HTTP ${res.status}): ${text.slice(0, 300)}`)
  }

  const ta = parser.parse(loginReturn) as Record<string, unknown>
  const resp = (ta.loginTicketResponse ?? {}) as Record<string, unknown>
  const header = (resp.header ?? {}) as Record<string, unknown>
  const creds = (resp.credentials ?? {}) as Record<string, unknown>
  if (!creds.token || !creds.sign) {
    throw new Error(`WSAA: TA sin credenciales: ${loginReturn.slice(0, 300)}`)
  }
  return {
    token: String(creds.token),
    sign: String(creds.sign),
    generationTime: String(header.generationTime),
    expirationTime: String(header.expirationTime),
    service,
  }
}

/**
 * Devuelve un Ticket de Acceso vigente para el servicio (default "wsfe"),
 * reutilizando el cacheado si sigue válido.
 */
export async function getTicketAcceso(service = 'wsfe'): Promise<TicketAcceso> {
  const cached = memCache.get(service)
  if (isValid(cached)) return cached

  const fromDisk = readTaFile(service)
  if (isValid(fromDisk)) {
    memCache.set(service, fromDisk)
    return fromDisk
  }

  // Evitar pedir dos TA en paralelo (ARCA rechaza el segundo)
  const pending = inflight.get(service)
  if (pending) return pending

  const p = (async () => {
    try {
      logger.info(`[WSAA] Solicitando nuevo TA para ${service}`)
      const ta = await requestTa(service)
      memCache.set(service, ta)
      writeTaFile(service, ta)
      return ta
    } finally {
      inflight.delete(service)
    }
  })()
  inflight.set(service, p)
  return p
}

/** Para tests: olvida el TA cacheado (no lo invalida en ARCA). */
export function clearTicketCache(service = 'wsfe'): void {
  memCache.delete(service)
  try {
    fs.unlinkSync(taFilePath(service))
  } catch {
    /* noop */
  }
}
