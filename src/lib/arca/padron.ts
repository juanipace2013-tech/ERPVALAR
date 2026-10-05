/**
 * Consulta de Constancia de Inscripción de ARCA (ws_sr_constancia_inscripcion,
 * método getPersona_v2). Reemplaza al servicio público sr-padron/v2, dado de
 * baja por AFIP (responde 404).
 *
 * Usa el mismo certificado que la facturación (computador fiscal valarg-erp),
 * autorizado para este servicio en el Administrador de Relaciones el
 * 2026-09-27. SOLO LECTURA.
 */
import { XMLParser } from 'fast-xml-parser'
import { getArcaConfig } from './config'
import { getTicketAcceso } from './wsaa'
import { postSoap } from './http'
import { logger } from '@/lib/logger'

const SERVICE = 'ws_sr_constancia_inscripcion'
const URLS = {
  prod: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
  homo: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
} as const

// Nombres tal como los usan los selects de alta de clientes y proveedores.
const PROVINCIAS = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
  'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
  'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
]

export type CondicionIva = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | null

export interface PersonaPadron {
  cuit: string
  razonSocial: string
  tipoPersona: 'FISICA' | 'JURIDICA'
  activo: boolean
  /** Tipo de clave según ARCA ('CUIT' | 'CUIL' | 'CDI'); no siempre viene */
  tipoClave?: string | null
  /** Apellido (personas humanas; razonSocial = "APELLIDO NOMBRE"). null si ARCA no lo da */
  apellido?: string | null
  condicionIva: CondicionIva
  domicilio: { direccion: string; localidad: string; provincia: string; codigoPostal: string }
  actividadPrincipal: string | null
  /** Observaciones de ARCA que no impiden devolver los datos (errorConstancia). */
  observaciones: string[]
}

export class PadronError extends Error {
  /**
   * true SOLO cuando ARCA contesta que la clave no existe ("No existe persona
   * con ese Id"). Los demás 404 (clave inválida, errorConstancia sin datos
   * generales) NO dicen que la persona no exista: no hay que tratarlos como
   * "no registrada". `status` sigue igual para los demás usos (/api/afip/cuit).
   */
  readonly noExiste: boolean
  constructor(message: string, readonly status: number, opts: { noExiste?: boolean } = {}) {
    super(message)
    this.noExiste = opts.noExiste === true
  }
}

/** Texto exacto de ARCA (A5) para una clave que no existe: "No existe persona con ese Id". */
const NO_EXISTE_PERSONA = /no existe persona/i

const parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true })

const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** Provincia del ERP a partir de la descripción de ARCA / Mercado Libre ('' si no se reconoce). */
export function provincia(descripcion: string): string {
  const d = normalize(descripcion)
  if (!d) return ''
  if (d.includes('CIUDAD') || d.includes('CAPITAL FEDERAL')) return 'CABA'
  return PROVINCIAS.find((p) => normalize(p) === d) ?? ''
}

type Impuesto = { idImpuesto?: string; estadoImpuesto?: string }

function condicionIva(ret: Record<string, unknown>): CondicionIva {
  if (ret.datosMonotributo) return 'MONOTRIBUTO'
  const general = ret.datosRegimenGeneral as { impuesto?: Impuesto | Impuesto[] } | undefined
  const activos = list(general?.impuesto).filter((i) => i.estadoImpuesto === 'AC')
  if (activos.some((i) => i.idImpuesto === '30')) return 'RESPONSABLE_INSCRIPTO'
  if (activos.some((i) => i.idImpuesto === '32')) return 'EXENTO'
  return null // sin dato suficiente: que lo elija el usuario
}

export async function consultarPersona(cuitInput: string): Promise<PersonaPadron> {
  const cuit = cuitInput.replace(/\D/g, '')
  if (cuit.length !== 11) throw new PadronError('CUIT inválido: deben ser 11 dígitos', 400)

  const cfg = getArcaConfig()
  const ta = await getTicketAcceso(SERVICE)
  const body =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">' +
    '<soapenv:Body><a5:getPersona_v2>' +
    `<token>${ta.token}</token><sign>${ta.sign}</sign>` +
    `<cuitRepresentada>${cfg.cuit}</cuitRepresentada><idPersona>${cuit}</idPersona>` +
    '</a5:getPersona_v2></soapenv:Body></soapenv:Envelope>'

  const res = await postSoap(URLS[cfg.env], body, { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' }, 20000)
  const doc = parser.parse(res.text) as { Envelope?: { Body?: Record<string, unknown> } }
  const soapBody = doc.Envelope?.Body ?? {}

  const fault = soapBody.Fault as { faultstring?: string } | undefined
  if (fault) {
    const msg = String(fault.faultstring ?? 'Error de ARCA')
    logger.info(`[Padrón] ${cuit}: ${msg}`)
    // "No existe persona con ese Id" y similares son del dato consultado, no del servicio.
    throw new PadronError(msg, /no existe|inexistente|inv[aá]lid/i.test(msg) ? 404 : 502, {
      noExiste: NO_EXISTE_PERSONA.test(msg),
    })
  }

  const ret = (soapBody.getPersona_v2Response as { personaReturn?: Record<string, unknown> } | undefined)
    ?.personaReturn
  if (!ret) throw new PadronError('Respuesta inesperada de ARCA', 502)

  const observaciones = list(
    (ret.errorConstancia as { error?: string | string[] } | undefined)?.error
  ).map(String)
  const dg = ret.datosGenerales as Record<string, unknown> | undefined
  if (!dg) throw new PadronError(observaciones.join(' · ') || 'ARCA no devolvió datos para ese CUIT', 404)

  const dom = (dg.domicilioFiscal ?? {}) as Record<string, string | undefined>
  const nombre = [dg.apellido, dg.nombre].filter(Boolean).join(' ')
  const actividades = list(
    (ret.datosRegimenGeneral as { actividad?: Record<string, string> | Record<string, string>[] } | undefined)
      ?.actividad
  )
  const principal = actividades.find((a) => a.orden === '1') ?? actividades[0]

  return {
    cuit,
    razonSocial: String(dg.razonSocial || nombre || ''),
    tipoPersona: dg.tipoPersona === 'FISICA' ? 'FISICA' : 'JURIDICA',
    activo: dg.estadoClave === 'ACTIVO',
    tipoClave: dg.tipoClave ? String(dg.tipoClave) : null,
    apellido: dg.apellido ? String(dg.apellido) : null,
    condicionIva: condicionIva(ret),
    domicilio: {
      direccion: dom.direccion ?? '',
      // ARCA no informa localidad para domicilios en CABA.
      localidad: dom.localidad || (provincia(dom.descripcionProvincia ?? '') === 'CABA' ? 'CABA' : ''),
      provincia: provincia(dom.descripcionProvincia ?? ''),
      codigoPostal: dom.codPostal ?? '',
    },
    actividadPrincipal: principal?.descripcionActividad ?? null,
    observaciones,
  }
}
