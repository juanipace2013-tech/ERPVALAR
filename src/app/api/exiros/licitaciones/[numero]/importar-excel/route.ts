import { NextRequest, NextResponse } from 'next/server'

import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { parseAribaExcel } from '@/lib/exiros/ariba-excel'
import { clasificarLicitacion } from '@/lib/exiros/clasificar'

// POST /api/exiros/licitaciones/[numero]/importar-excel — multipart con el
// Excel de contenido del evento de Ariba ("Descargar contenido" → Excel).
// Solo para plataforma ARIBA_*: las de Exiros ya vienen con ítems del agente.
//
// Reemplaza los ExirosItem con los del archivo, actualiza clienteFinal (Ship
// To), agrega los requisitos de papeleo a la razón y re-clasifica con IA
// (veredicto/confianza/razón) usando el detalle completo. NUNCA pisa `estado`.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ numero: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { numero } = await params
    const lic = await prisma.exirosLicitacion.findUnique({
      where: { numero },
      select: { id: true, plataforma: true, titulo: true, empresa: true, razon: true },
    })
    if (!lic) {
      return NextResponse.json({ error: `Licitación ${numero} no encontrada` }, { status: 404 })
    }
    if (!lic.plataforma.startsWith('ARIBA')) {
      return NextResponse.json(
        { error: 'La importación de Excel es solo para licitaciones de Ariba' },
        { status: 400 }
      )
    }

    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo (campo "file")' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let parsed
    try {
      parsed = parseAribaExcel(buffer)
    } catch (e) {
      logger.error('[exiros/importar-excel] Error parseando archivo', e)
      return NextResponse.json(
        { error: 'No se pudo leer el archivo. ¿Es el Excel descargado de Ariba?' },
        { status: 400 }
      )
    }

    if (parsed.items.length === 0) {
      return NextResponse.json(
        {
          error:
            'No se encontraron ítems en el archivo (se busca una hoja con columnas "Descripción" y "Cantidad" y filas numeradas tipo "3.1").',
        },
        { status: 400 }
      )
    }

    // Re-clasificar con IA usando el detalle completo. Si falla (key no
    // configurada, error de API), igual importamos los ítems — la
    // clasificación vieja queda y se reporta el problema en la respuesta.
    let clasificacion: Awaited<ReturnType<typeof clasificarLicitacion>> | null = null
    let iaError: string | null = null
    try {
      clasificacion = await clasificarLicitacion({
        titulo: lic.titulo,
        empresa: lic.empresa,
        items: parsed.items,
        requisitos: parsed.requisitos,
      })
    } catch (e) {
      iaError = e instanceof Error ? e.message : 'Error desconocido'
      logger.error('[exiros/importar-excel] Re-clasificación IA falló', e)
    }

    // Razón final: la nueva de la IA (o la existente si la IA falló) + línea
    // de requisitos del evento.
    const razonBase = (clasificacion?.razon || lic.razon || '').trim()
    const lineaRequisitos = parsed.requisitos.length
      ? `Requisitos del evento: ${parsed.requisitos.join('; ')}.`
      : null
    const razonFinal = [razonBase, lineaRequisitos].filter(Boolean).join('\n\n') || null

    // Ship To más frecuente entre los ítems → clienteFinal
    const shipTos = parsed.items.map((i) => i.cliente).filter((c): c is string => !!c)
    const clienteFinal = shipTos.length
      ? [...new Map(shipTos.map((s) => [s, shipTos.filter((x) => x === s).length])).entries()].sort(
          (a, b) => b[1] - a[1]
        )[0][0]
      : null

    await prisma.$transaction(async (tx) => {
      await tx.exirosItem.deleteMany({ where: { licitacionId: lic.id } })
      await tx.exirosLicitacion.update({
        where: { id: lic.id },
        data: {
          // estado NO se toca
          razon: razonFinal,
          ...(clienteFinal ? { clienteFinal } : {}),
          ...(clasificacion
            ? { veredicto: clasificacion.veredicto, confianza: clasificacion.confianza }
            : {}),
          items: {
            create: parsed.items.map((it) => ({
              nro: it.nro,
              descCorta: it.descCorta,
              descLarga: it.descLarga,
              cantidad: it.cantidad,
              unidad: it.unidad,
              cliente: it.cliente,
              fechaRequerida: it.fechaRequerida,
            })),
          },
        },
      })
    })

    return NextResponse.json({
      ok: true,
      itemsImportados: parsed.items.length,
      requisitos: parsed.requisitos.length,
      hoja: parsed.hojaItems,
      veredicto: clasificacion?.veredicto ?? null,
      confianza: clasificacion?.confianza ?? null,
      iaError,
    })
  } catch (e) {
    logger.error('[exiros/importar-excel] error', e)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
