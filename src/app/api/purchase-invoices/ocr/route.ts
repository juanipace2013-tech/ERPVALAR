import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'
import {
  extractPurchaseInvoice,
  isOcrMimeType,
  OcrParseError,
  OCR_MAX_FILE_BYTES,
} from '@/lib/purchase-invoices/ocr-extract'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    if (!process.env.ANTHROPIC_API_KEY) {
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

    if (!isOcrMimeType(file.type)) {
      return NextResponse.json(
        { error: 'Formato no soportado. Usá PDF, JPG, PNG, WebP o GIF.' },
        { status: 400 }
      )
    }

    if (file.size > OCR_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: 'El archivo supera el límite de 10MB' },
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { data, truncated, stopReason } = await extractPurchaseInvoice(buffer, file.type)

    return NextResponse.json({
      success: true,
      data,
      fileName: file.name,
      debug: {
        stopReason,
        itemCount: data.items?.length || 0,
        truncated,
      },
    })
  } catch (error) {
    if (error instanceof OcrParseError) {
      return NextResponse.json(
        {
          error: 'Error al parsear la respuesta de la IA. Intentá con una imagen más clara.',
          rawResponse: error.rawResponse,
        },
        { status: 422 }
      )
    }

    logger.error('Error in OCR endpoint:', error)

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
