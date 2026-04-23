import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '@/lib/logger'

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
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
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
      logger.error('Error parsing Claude response:', textBlock.text)
      return NextResponse.json(
        {
          error: 'Error al parsear la respuesta de la IA. Intentá con una imagen más clara.',
          rawResponse: textBlock.text,
        },
        { status: 422 }
      )
    }

    // Check stop reason - if max_tokens, the response was truncated
    const stopReason = response.stop_reason
    if (stopReason === 'max_tokens') {
      logger.warn('⚠️ OCR response was TRUNCATED (max_tokens reached)')
    }

    // ── Normalizar punto de venta (5 dígitos) y número de comprobante (8 dígitos)
    if (extractedData.factura) {
      if (extractedData.factura.puntoVenta) {
        extractedData.factura.puntoVenta = String(extractedData.factura.puntoVenta).replace(/\D/g, '').padStart(5, '0')
      }
      if (extractedData.factura.numero) {
        extractedData.factura.numero = String(extractedData.factura.numero).replace(/\D/g, '').padStart(8, '0')
      }
    }

    // Limpiar códigos de proveedor: eliminar prefijo "001" de facturas GENEBRE
    // OCR extrae "0012835AE 11" pero el catálogo tiene "2835AE 11"
    if (extractedData.items && Array.isArray(extractedData.items)) {
      for (const item of extractedData.items) {
        const code = item.codigo || item.code || item.supplierProductCode || ''
        if (typeof code === 'string' && code.startsWith('001')) {
          const cleanCode = code.substring(3)
          if (item.codigo !== undefined) item.codigo = cleanCode
          if (item.code !== undefined) item.code = cleanCode
          if (item.supplierProductCode !== undefined) item.supplierProductCode = cleanCode
        }
      }
    }

    // ── FIX: Evitar doble descuento ──────────────────────────────────────────
    // Si hay descuento general (factura.descuentoGeneral > 0), los items NO deben
    // tener descuento individual porque es el mismo descuento reportado dos veces.
    // Ponemos el descuento SOLO a nivel general y los items en 0.
    const generalDesc = Number(extractedData.factura?.descuentoGeneral) || 0
    if (generalDesc > 0 && extractedData.items && Array.isArray(extractedData.items)) {
      const allItemsSameDiscount = extractedData.items.every((item: any) => {
        const itemDisc = Number(item.descuento) || Number(item.bonificacion) || 0
        return itemDisc === 0 || Math.abs(itemDisc - generalDesc) < 0.01
      })
      if (allItemsSameDiscount) {
        for (const item of extractedData.items) {
          item.descuento = 0
          item.bonificacion = 0
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: extractedData,
      fileName: file.name,
      debug: {
        stopReason,
        itemCount: extractedData.items?.length || 0,
        truncated: stopReason === 'max_tokens',
      },
    })
  } catch (error) {
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
