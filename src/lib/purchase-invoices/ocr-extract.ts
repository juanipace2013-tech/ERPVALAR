/**
 * Extracción de datos de una factura de compra (PDF o imagen) con Claude.
 *
 * Es el corazón del endpoint /api/purchase-invoices/ocr (carga manual desde la
 * UI) y del cron ingest-facturas-mail (carga automática desde la casilla de
 * facturación). Devuelve el JSON crudo del modelo ya normalizado: punto de
 * venta / número con ceros, códigos GENEBRE sin el prefijo "001" y sin el
 * descuento general duplicado en cada item.
 */

import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'

export const OCR_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type OcrMimeType = (typeof OCR_ALLOWED_MIME_TYPES)[number]

export const OCR_MAX_FILE_BYTES = 10 * 1024 * 1024

export interface OcrPercepcion {
  tipo?: string
  descripcion: string
  jurisdiccion?: string | null
  jurisdiccion_inferida?: boolean | null
  jurisdiccion_hint?: string | null
  texto_original?: string | null
  porcentaje: number | null
  monto: number
}

export interface OcrData {
  proveedor: {
    razonSocial: string
    cuit: string
    condicionIva: string
    direccion: string
  }
  factura: {
    tipo: string
    tipoComprobante?: string // formato viejo
    puntoVenta: string
    numero: string
    fecha: string
    fechaVencimiento: string | null
    cae: string | null
    vencimientoCae: string | null
    condicionPago: string | null
    moneda: string
    tipoCambio: number | null
    descuentoGeneral?: number
    totalUsd?: number | null
  }
  items: Array<{
    codigo: string | null
    descripcion: string
    unidad?: string
    cantidad: number
    precioUnitario: number
    descuento?: number
    bonificacion?: number // formato viejo
    importe?: number
    subtotal?: number // formato viejo
    alicuotaIva: number
  }>
  totales: {
    subtotalBruto?: number
    descuentoGeneral?: number
    subtotalNeto?: number
    percepciones?: OcrPercepcion[]
    totalPercepciones?: number
    subtotal?: number
    netoNoGravado?: number
    exento?: number
    iva21: number
    iva105: number
    iva27: number
    percepcionIIBB?: number
    percepcionIva?: number
    impuestosInternos?: number
    otrosImpuestos?: number
    descuento?: number
    total: number
  }
}

export class OcrParseError extends Error {
  constructor(public readonly rawResponse: string) {
    super('Error al parsear la respuesta de la IA')
    this.name = 'OcrParseError'
  }
}

const EXTRACTION_PROMPT = `Analizá esta factura de compra argentina y extraé TODOS los datos con precisión.
Es CRÍTICO que extraigas las cantidades, precios unitarios e importes EXACTOS como figuran en la factura.
Respondé SOLO con JSON válido, sin texto adicional, sin markdown, sin backticks.

{
  "proveedor": {
    "razonSocial": "nombre exacto del emisor de la factura",
    "cuit": "CUIT del emisor en formato XX-XXXXXXXX-X",
    "condicionIva": "Responsable Inscripto, Monotributista, etc",
    "direccion": "dirección del emisor"
  },
  "factura": {
    "tipo": "FC A, FC B, FC C, ND A, NC A, etc (detectar de la letra y tipo)",
    "puntoVenta": "5 dígitos del punto de venta (ej: 00031)",
    "numero": "8 dígitos del número de comprobante (ej: 00295265)",
    "fecha": "YYYY-MM-DD",
    "fechaVencimiento": "YYYY-MM-DD o null",
    "cae": "número CAE completo",
    "vencimientoCae": "YYYY-MM-DD",
    "condicionPago": "texto completo de la condición de venta/pago (ej: CUENTA CORRIENTE 30 DIAS)",
    "moneda": "ARS o USD (la moneda en que están los importes de la factura)",
    "tipoCambio": "tipo de cambio si aparece, o null",
    "descuentoGeneral": "porcentaje de descuento general si aparece (ej: 30.00), o 0",
    "totalUsd": "monto en USD si aparece en la factura, o null"
  },
  "items": [
    {
      "codigo": "código de artículo del proveedor (puede tener espacios, ej: '0012416 04')",
      "descripcion": "descripción completa del artículo",
      "unidad": "UNI, KG, MT, etc",
      "cantidad": "número EXACTO de la columna CANT",
      "descuento": "porcentaje de descuento por item si existe, o 0",
      "precioUnitario": "número EXACTO de la columna P.UNI (precio unitario antes de descuento)",
      "importe": "número EXACTO de la columna IMPORTE (cantidad x precio unitario)",
      "alicuotaIva": 21
    }
  ],
  "totales": {
    "subtotalBruto": "suma de importes de items ANTES del descuento general",
    "descuentoGeneral": "monto del descuento general aplicado",
    "subtotalNeto": "subtotal después del descuento (neto gravado)",
    "iva21": "monto IVA 21%",
    "iva105": "monto IVA 10.5% o 0",
    "iva27": "monto IVA 27% o 0",
    "percepciones": [
      {
        "tipo": "IIBB | IVA | Ganancias | SUSS | OTRA",
        "descripcion": "nombre de la percepción tal como figura (ej: PERCEP. AGIP 352/22 G11, Reg. DN38)",
        "jurisdiccion": "Nombre canónico de la jurisdicción IIBB si lo pudiste determinar con alta confianza — uno de: CABA, Buenos Aires, Catamarca, Chaco, Chubut, Córdoba, Corrientes, Entre Ríos, Formosa, Jujuy, La Pampa, La Rioja, Mendoza, Misiones, Neuquén, Río Negro, Salta, San Juan, San Luis, Santa Cruz, Santa Fé, Santiago del Estero, Tierra del Fuego, Tucumán. Sólo aplica para tipo=IIBB. Si no podés determinarla con confianza razonable, devolvé null (NO inventes, NO uses 'Nacional' ni 'CABA' por default).",
        "jurisdiccion_inferida": "true si la jurisdicción NO está explícita en la percepción y la inferiste a partir del domicilio del emisor o prefijo del número de Ingresos Brutos. false si viene de un nombre explícito o un código regulatorio conocido. null si jurisdiccion=null.",
        "jurisdiccion_hint": "Texto crudo del código/regulación detectado que deberían revisar manualmente (ej: 'Reg. DN38', 'RG 1415'). Llenalo siempre que jurisdiccion=null o jurisdiccion_inferida=true para trazabilidad.",
        "texto_original": "Línea exacta de la percepción como figura en la factura (ej: 'Reg. DN38   25.81')",
        "porcentaje": "porcentaje si aparece, o null",
        "monto": "monto de la percepción"
      }
    ],
    "totalPercepciones": "suma de todas las percepciones",
    "total": "TOTAL final de la factura"
  }
}

IMPORTANTE:
- CÓDIGOS DE ARTÍCULO CON ESPACIOS INTERNOS: Algunos proveedores (ej: GENEBRE) usan códigos con formato "XXXXX YY" donde YY son 2 dígitos de diámetro. El espacio entre XXXXX y YY es PARTE del código, NO es el inicio de la descripción. Ejemplo: en la línea "0012108A 12  VALV.MARIPOSA WAFER", el código completo es "0012108A 12" y la descripción es "VALV.MARIPOSA WAFER". Otros ejemplos: "0012034 09", "0013190 05", "0012416 04". NO cortar el código en el espacio antes de los últimos 2 dígitos.
- Todos los montos deben ser números, no strings
- Los precios unitarios e importes pueden tener puntos como separador de miles y comas para decimales (formato argentino). Convertí a números (ej: 1.234.567,89 => 1234567.89)
- Extraé TODOS los items, no resumas ni agrupes
- El descuento general se aplica al subtotal, NO al precio unitario
- IMPORTANTE: Si hay un descuento general (DESC GRAL, BONIF, etc.), NO pongas ese mismo porcentaje en el campo "descuento" de cada item. El descuento va SOLO en factura.descuentoGeneral. Los items deben tener descuento=0 si el descuento es general
- Las percepciones de IIBB pueden ser varias (AGIP, Buenos Aires, Jujuy, Salta, etc). Extraelas TODAS como array

JURISDICCIÓN DE PERCEPCIONES IIBB — reglas de determinación (aplicar EN ESTE ORDEN):
  a) JURISDICCIÓN EXPLÍCITA: si la línea de la percepción nombra una provincia o CABA
     (ej. "Perc. IIBB Buenos Aires", "Retención IIBB Córdoba", "Ingresos Brutos CABA"),
     devolvé esa jurisdicción en "jurisdiccion", "jurisdiccion_inferida": false.
  b) CÓDIGO REGULATORIO CONOCIDO: algunos agentes de percepción usan el código de la
     resolución en lugar del nombre. Mapeo:
       - "DN38", "Reg. DN38", "Régimen DN38", "RN 38/2011" → "Buenos Aires" (ARBA)
       - "ARBA"                                           → "Buenos Aires"
       - "AGIP"                                           → "CABA"
       - "API" (contexto Santa Fe)                        → "Santa Fé"
       - "DGR Córdoba", "RG 1415"                         → "Córdoba"
       - "DGR Mendoza", "DGR MNES"                        → "Mendoza"
       - "ATM Misiones"                                   → "Misiones"
     Si mapea, "jurisdiccion_inferida": false; copiá el código original en "jurisdiccion_hint".
     Si ves otro código que NO está en este mapeo, devolvé "jurisdiccion": null y poné
     el código en "jurisdiccion_hint" para revisión humana.
  c) INFERENCIA POR EMISOR (menor confianza): si la percepción no tiene jurisdicción
     explícita ni código conocido, podés inferirla a partir del domicilio del emisor
     y/o el prefijo del número de Ingresos Brutos del emisor (ej. "901-..." suele ser
     Convenio Multilateral con cabecera Buenos Aires/CABA). Si usás esta vía, marcá
     "jurisdiccion_inferida": true y copiá la señal usada en "jurisdiccion_hint"
     (ej. "Inferida por domicilio Buenos Aires" o "Inferida por IIBB 901-...").
  d) SIN CONFIANZA: si nada de lo anterior permite determinar la jurisdicción con
     confianza razonable, devolvé "jurisdiccion": null, "jurisdiccion_inferida": null,
     y poné en "jurisdiccion_hint" el texto crudo de la percepción. NO inventes.
     NO uses default "Nacional" ni "CABA".
  e) Para percepciones NO-IIBB (IVA, Ganancias, SUSS): "jurisdiccion" va en null, "tipo"
     debe indicar el tipo correspondiente.
  f) Siempre devolvé "texto_original" con la línea exacta que aparece en la factura
     para trazabilidad, incluso si determinaste la jurisdicción con confianza.
- Si hay tipo de cambio (TC BASE), extraelo
- Si hay monto en USD, extraelo en totalUsd
- Las fechas en formato YYYY-MM-DD
- El punto de venta y número deben tener ceros a la izquierda
- Si no podés leer un campo, poné null
- En condicionPago incluí el texto COMPLETO (ej: "CUENTA CORRIENTE 30 DIAS", no solo "CUENTA CORRIENTE")
- TIPO DE COMPROBANTE: Detectar cuidadosamente si es FACTURA (FC), NOTA DE CRÉDITO (NC), o NOTA DE DÉBITO (ND). Buscar las palabras exactas "NOTA DE CRÉDITO" o "NOTA DE DÉBITO" en el encabezado del comprobante. El COD. también indica: COD.01=Factura, COD.02=Nota de Débito, COD.03=Nota de Crédito. Devolver como "NC A", "ND B", "FC A", etc.
`

export function isOcrMimeType(type: string): type is OcrMimeType {
  return (OCR_ALLOWED_MIME_TYPES as readonly string[]).includes(type)
}

export async function extractPurchaseInvoice(
  file: Buffer,
  mimeType: OcrMimeType
): Promise<{ data: OcrData; truncated: boolean; stopReason: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada. Agregala en el archivo .env')

  const anthropic = new Anthropic({ apiKey })
  const base64 = file.toString('base64')

  const content: Anthropic.Messages.ContentBlockParam[] = []
  if (mimeType === 'application/pdf') {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    } as unknown as Anthropic.Messages.ContentBlockParam)
  } else {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mimeType, data: base64 },
    })
  }
  content.push({ type: 'text', text: EXTRACTION_PROMPT })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No se pudo obtener respuesta de la IA')
  }

  let data: OcrData
  try {
    const jsonText = textBlock.text
      .trim()
      .replace(/^```json?\s*/i, '')
      .replace(/\s*```$/i, '')
    data = JSON.parse(jsonText)
  } catch {
    logger.error('Error parsing Claude response:', textBlock.text)
    throw new OcrParseError(textBlock.text)
  }

  const stopReason = response.stop_reason
  if (stopReason === 'max_tokens') {
    logger.warn('⚠️ OCR response was TRUNCATED (max_tokens reached)')
  }

  normalizeOcrData(data)

  return { data, truncated: stopReason === 'max_tokens', stopReason }
}

/** Ajustes post-modelo que aplican a cualquier origen (UI o mail). Muta `data`. */
export function normalizeOcrData(data: OcrData): void {
  // Punto de venta (5 dígitos) y número de comprobante (8 dígitos)
  if (data.factura) {
    if (data.factura.puntoVenta) {
      data.factura.puntoVenta = String(data.factura.puntoVenta).replace(/\D/g, '').padStart(5, '0')
    }
    if (data.factura.numero) {
      data.factura.numero = String(data.factura.numero).replace(/\D/g, '').padStart(8, '0')
    }
  }

  // Códigos GENEBRE: el OCR lee "0012835AE 11" pero el catálogo tiene "2835AE 11"
  if (Array.isArray(data.items)) {
    for (const item of data.items as Array<Record<string, unknown>>) {
      const code = item.codigo || item.code || item.supplierProductCode || ''
      if (typeof code === 'string' && code.startsWith('001')) {
        const cleanCode = code.substring(3)
        if (item.codigo !== undefined) item.codigo = cleanCode
        if (item.code !== undefined) item.code = cleanCode
        if (item.supplierProductCode !== undefined) item.supplierProductCode = cleanCode
      }
    }
  }

  // Evitar doble descuento: si hay descuento general y todos los items traen ese
  // mismo porcentaje, es el mismo descuento reportado dos veces.
  const generalDesc = Number(data.factura?.descuentoGeneral) || 0
  if (generalDesc > 0 && Array.isArray(data.items)) {
    const allItemsSameDiscount = data.items.every((item) => {
      const itemDisc = Number(item.descuento) || Number(item.bonificacion) || 0
      return itemDisc === 0 || Math.abs(itemDisc - generalDesc) < 0.01
    })
    if (allItemsSameDiscount) {
      for (const item of data.items) {
        item.descuento = 0
        item.bonificacion = 0
      }
    }
  }
}
