import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const EXTRACTION_PROMPT = `Analizá esta factura de compra argentina y extraé los siguientes datos en formato JSON.
Respondé SOLO con el JSON, sin texto adicional, sin markdown, sin backticks.

{
  "proveedor": {
    "razonSocial": "string",
    "cuit": "string (formato XX-XXXXXXXX-X)",
    "condicionIva": "string",
    "direccion": "string"
  },
  "factura": {
    "tipo": "string (A, B o C)",
    "tipoComprobante": "string (FA, NC, ND)",
    "puntoVenta": "string (4-5 dígitos, con ceros a la izquierda)",
    "numero": "string (8 dígitos, con ceros a la izquierda)",
    "fecha": "string (YYYY-MM-DD)",
    "fechaVencimiento": "string (YYYY-MM-DD) o null",
    "cae": "string o null",
    "vencimientoCae": "string (YYYY-MM-DD) o null",
    "condicionPago": "string o null",
    "moneda": "string (ARS o USD)",
    "tipoCambio": "number o null"
  },
  "items": [
    {
      "codigo": "string o null",
      "descripcion": "string",
      "cantidad": "number",
      "precioUnitario": "number",
      "bonificacion": "number (%) o 0",
      "subtotal": "number",
      "alicuotaIva": "number (21, 10.5, 27, 0, etc)"
    }
  ],
  "totales": {
    "subtotal": "number (neto gravado)",
    "netoNoGravado": "number o 0",
    "exento": "number o 0",
    "iva21": "number o 0",
    "iva105": "number o 0",
    "iva27": "number o 0",
    "percepcionIIBB": "number o 0",
    "percepcionIva": "number o 0",
    "impuestosInternos": "number o 0",
    "otrosImpuestos": "number o 0",
    "descuento": "number o 0",
    "total": "number"
  }
}

IMPORTANTE:
- Los montos deben ser números, no strings
- Si no podés leer un campo, poné null
- Las fechas en formato YYYY-MM-DD
- El punto de venta y número deben tener los ceros a la izquierda
- Si hay descuento por línea, reflejalo en bonificacion del item
- Calculá correctamente los subtotales de cada item (cantidad * precioUnitario * (1 - bonificacion/100))
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
