import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

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
    "puntoVenta": "4 dígitos del punto de venta",
    "numero": "8 dígitos del número de comprobante",
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
        "descripcion": "nombre de la percepción (ej: PERCEP. AGIP 352/22 G11)",
        "porcentaje": "porcentaje si aparece, o null",
        "monto": "monto de la percepción"
      }
    ],
    "totalPercepciones": "suma de todas las percepciones",
    "total": "TOTAL final de la factura"
  }
}

IMPORTANTE:
- Todos los montos deben ser números, no strings
- Los precios unitarios e importes pueden tener puntos como separador de miles y comas para decimales (formato argentino). Convertí a números (ej: 1.234.567,89 => 1234567.89)
- Extraé TODOS los items, no resumas ni agrupes
- El descuento general se aplica al subtotal, NO al precio unitario
- Las percepciones de IIBB pueden ser varias (AGIP, Buenos Aires, Jujuy, Salta, etc). Extraelas TODAS como array
- Si hay tipo de cambio (TC BASE), extraelo
- Si hay monto en USD, extraelo en totalUsd
- Las fechas en formato YYYY-MM-DD
- El punto de venta y número deben tener ceros a la izquierda
- Si no podés leer un campo, poné null
- En condicionPago incluí el texto COMPLETO (ej: "CUENTA CORRIENTE 30 DIAS", no solo "CUENTA CORRIENTE")
`

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY no configurada. Agregala en el archivo .env' },
        { status: 500 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    // Validar tipo de archivo
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Formato no soportado. Usá PDF, JPG, PNG, WebP o GIF.' },
        { status: 400 }
      )
    }

    // Validar tamaño (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'El archivo supera el límite de 10MB' },
        { status: 400 }
      )
    }

    // Convertir archivo a base64
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    const anthropic = new Anthropic({ apiKey })

    // Determinar media type para la API
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf' = 'image/jpeg'
    if (file.type === 'application/pdf') {
      mediaType = 'application/pdf'
    } else if (file.type === 'image/png') {
      mediaType = 'image/png'
    } else if (file.type === 'image/webp') {
      mediaType = 'image/webp'
    } else if (file.type === 'image/gif') {
      mediaType = 'image/gif'
    }

    // Construir el content según el tipo de archivo
    const imageContent: Anthropic.Messages.ContentBlockParam[] = []

    if (file.type === 'application/pdf') {
      imageContent.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: base64,
        },
      } as unknown as Anthropic.Messages.ContentBlockParam)
    } else {
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: base64,
        },
      })
    }

    imageContent.push({
      type: 'text',
      text: EXTRACTION_PROMPT,
    })

    // Llamar a Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: imageContent,
        },
      ],
    })

    // Extraer texto de la respuesta
    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { error: 'No se pudo obtener respuesta de la IA' },
        { status: 500 }
      )
    }

    // Parsear JSON de la respuesta
    let extractedData
    try {
      // Limpiar posibles backticks o texto extra
      let jsonText = textBlock.text.trim()
      // Remover markdown code blocks si los hay
      jsonText = jsonText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '')
      extractedData = JSON.parse(jsonText)
    } catch {
      console.error('Error parsing Claude response:', textBlock.text)
      return NextResponse.json(
        {
          error: 'Error al parsear la respuesta de la IA. Intentá con una imagen más clara.',
          rawResponse: textBlock.text,
        },
        { status: 422 }
      )
    }

    return NextResponse.json({
      success: true,
      data: extractedData,
      fileName: file.name,
    })
  } catch (error) {
    console.error('Error in OCR endpoint:', error)

    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        return NextResponse.json(
          { error: 'API key de Anthropic inválida. Verificá ANTHROPIC_API_KEY en .env' },
          { status: 500 }
        )
      }
      return NextResponse.json(
        { error: `Error de Anthropic API: ${error.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno al procesar la factura' },
      { status: 500 }
    )
  }
}
