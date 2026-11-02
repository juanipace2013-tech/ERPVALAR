import type { Prisma } from '@prisma/client'
import {
  generateCertificadoCalibracionPDF,
  type CertificadoCalibracionData,
} from '@/lib/pdf/certificado-calibracion-generator'
import { getLogoBlanco } from '@/lib/logo-blanco-base64'
import type { TechFields } from '@/lib/certificados-form'

/** Cuerpo que manda el formulario al crear o editar un certificado. */
export interface CertificadosBody {
  cliente: string
  oc?: string
  referencia?: string
  fecha?: string // YYYY-MM-DD; default hoy
  valvulas: string[]
  tituloPill: string
  titulo: string
  subtitulo: string
  specline: string
  descripcion: string
  marcaTipo: string
  materiales: Array<[string, string]>
  calibracion: Array<[string, string]>
  conexiones: Array<[string, string]>
  encargado: { nombre: string; rol: string }
  techFields?: TechFields
}

function isPairArray(value: unknown): value is Array<[string, string]> {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        Array.isArray(row) && row.length === 2 && row.every((cell) => typeof cell === 'string')
    )
  )
}

type Built =
  | { error: string }
  | {
      pdf: Buffer
      filename: string
      record: {
        fecha: Date
        cliente: string
        oc: string | null
        referencia: string | null
        valvulas: string[]
        titulo: string
        subtitulo: string | null
        payload: Prisma.InputJsonValue
      }
    }

/** Valida el cuerpo, genera el PDF y arma el registro a guardar (alta o edición). */
export async function buildCertificado(body: CertificadosBody): Promise<Built> {
  if (typeof body.cliente !== 'string' || !body.cliente.trim()) {
    return { error: 'Indicá el cliente' }
  }
  if (
    !Array.isArray(body.valvulas) ||
    body.valvulas.length === 0 ||
    body.valvulas.some((v) => typeof v !== 'string' || !v.trim())
  ) {
    return { error: 'Indicá al menos un número de válvula' }
  }
  if (
    !isPairArray(body.materiales) ||
    !isPairArray(body.calibracion) ||
    !isPairArray(body.conexiones)
  ) {
    return { error: 'Datos del certificado inválidos' }
  }

  let fecha = new Date()
  if (body.fecha) {
    const parsed = new Date(`${body.fecha}T12:00:00`)
    if (!isNaN(parsed.getTime())) fecha = parsed
  }

  const cliente = body.cliente.trim()
  const data: CertificadoCalibracionData = {
    cliente,
    oc: body.oc?.trim() || undefined,
    referencia: body.referencia?.trim() || '',
    fecha,
    valvulas: body.valvulas.map((v) => v.trim()),
    tituloPill: body.tituloPill || 'CERTIFICADO DE CALIBRACIÓN',
    titulo: body.titulo || 'VÁLVULA DE SEGURIDAD',
    subtitulo: body.subtitulo || '',
    specline: body.specline || '',
    descripcion: body.descripcion || '',
    marcaTipo: body.marcaTipo || 'VALAR · Seguridad',
    materiales: body.materiales,
    calibracion: body.calibracion,
    conexiones: body.conexiones,
    encargado: {
      nombre: body.encargado?.nombre || 'ING Gabriel Krawczynski',
      rol: body.encargado?.rol || 'Encargado',
    },
    logoBase64: await getLogoBlanco(),
  }

  const doc = generateCertificadoCalibracionPDF(data)
  const pdf = Buffer.from(doc.output('arraybuffer'))

  // Cuerpo completo para re-descargar el PDF, más los campos del formulario
  // para poder editarlo después.
  const payloadRaw: Record<string, unknown> = {
    ...data,
    fecha: fecha.toISOString(),
  }
  delete payloadRaw.logoBase64
  if (body.techFields && typeof body.techFields === 'object') {
    payloadRaw.techFields = body.techFields
  }

  return {
    pdf,
    filename: certificadoFilename(cliente, data.valvulas),
    record: {
      fecha,
      cliente,
      oc: data.oc || null,
      referencia: data.referencia || null,
      valvulas: data.valvulas,
      titulo: data.titulo,
      subtitulo: data.subtitulo || null,
      payload: payloadRaw as Prisma.InputJsonValue,
    },
  }
}

export function certificadoFilename(cliente: string, valvulas: string[]): string {
  const safeName = cliente.replace(/[/\\:*?"<>|]/g, '-').trim()
  const rangeLabel =
    valvulas.length > 1 ? `${valvulas[0]}-${valvulas[valvulas.length - 1]}` : valvulas[0]
  return `Certificados ${rangeLabel} ${safeName}.pdf`
}
