/**
 * Archivo de la Orden de Compra del cliente adjunto a una cotización.
 * Lo comparten la subida manual (upload-oc) y el adjuntado desde el mail (oc-mail).
 */
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'cotizaciones-oc')

export const OC_MAX_SIZE = 10 * 1024 * 1024 // 10MB
export const OC_TIPOS = ['image/jpeg', 'image/png', 'application/pdf'] as const
export type OcTipo = (typeof OC_TIPOS)[number]

export const OC_ESTADOS = ['ACCEPTED', 'CONVERTED', 'FACTURADA_PARCIAL']

/**
 * Tipo real del archivo según sus primeros bytes. Los adjuntos de mail suelen
 * venir como application/octet-stream, así que no se confía en el tipo declarado.
 */
export function detectarTipoOC(bytes: Uint8Array): OcTipo | null {
  if (bytes.length < 4) return null
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf' // %PDF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  return null
}

/** Escribe el archivo y devuelve la URL a guardar en quote.purchaseOrderUrl */
export async function guardarArchivoOC(quoteNumber: string, bytes: Buffer, tipo: OcTipo): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  // La extensión sale del tipo ya validado, nunca del nombre que manda el cliente.
  const ext = tipo === 'application/pdf' ? 'pdf' : tipo === 'image/png' ? 'png' : 'jpg'
  const fileName = `${quoteNumber.replace(/[^\w-]/g, '-')}_oc_${Date.now()}.${ext}`
  await writeFile(path.join(UPLOAD_DIR, fileName), bytes)
  return `/uploads/cotizaciones-oc/${fileName}`
}
