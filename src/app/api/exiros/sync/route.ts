import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { requireExirosAgent } from '@/lib/exiros/agent-auth'
import { EXIROS_VEREDICTOS, EXIROS_PLATAFORMAS } from '@/lib/exiros/constants'

// POST /api/exiros/sync — el agente Python pushea una licitación (nueva o
// re-detectada). Upsert por `numero`: si ya existe se actualizan metadata e
// ítems, pero NUNCA se pisa `estado` (respeta lo que decidió el usuario).
// Auth: Bearer EXIROS_AGENT_API_KEY.

const fechaIso = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'fecha inválida (se espera ISO 8601)')
  .transform((s) => new Date(s))

const itemSchema = z.object({
  nro: z.number().int(),
  descCorta: z.string().min(1),
  descLarga: z.string().nullish(),
  cantidad: z.number().nullish(),
  unidad: z.string().nullish(),
  cliente: z.string().nullish(),
  fechaRequerida: fechaIso.nullish(),
  quePide: z.string().nullish(),
  match: z.string().nullish(),
})

const syncSchema = z.object({
  numero: z.string().min(1),
  plataforma: z.enum(EXIROS_PLATAFORMAS).default('EXIROS'),
  idInterno: z.number().int().nullish(),
  linkPortal: z.string().url().nullish(),
  titulo: z.string().min(1),
  empresa: z.string().nullish(),
  comprador: z.string().nullish(),
  clienteFinal: z.string().nullish(),
  cierre: fechaIso.nullish(),
  veredicto: z.enum(EXIROS_VEREDICTOS),
  confianza: z.number().int().min(0).max(100).nullish(),
  razon: z.string().nullish(),
  origen: z.string().nullish(),
  items: z.array(itemSchema).default([]),
})

export async function POST(req: NextRequest) {
  const authError = requireExirosAgent(req)
  if (authError) return authError

  try {
    const parsed = syncSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Body inválido', detalles: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { items, ...lic } = parsed.data

    const metadata = {
      plataforma: lic.plataforma,
      idInterno: lic.idInterno ?? null,
      linkPortal: lic.linkPortal ?? null,
      titulo: lic.titulo,
      empresa: lic.empresa ?? null,
      comprador: lic.comprador ?? null,
      clienteFinal: lic.clienteFinal ?? null,
      cierre: lic.cierre ?? null,
      veredicto: lic.veredicto,
      confianza: lic.confianza ?? null,
      razon: lic.razon ?? null,
      origen: lic.origen ?? null,
    }

    const itemsData = items.map((it) => ({
      nro: it.nro,
      descCorta: it.descCorta,
      descLarga: it.descLarga ?? null,
      cantidad: it.cantidad ?? null,
      unidad: it.unidad ?? null,
      cliente: it.cliente ?? null,
      fechaRequerida: it.fechaRequerida ?? null,
      quePide: it.quePide ?? null,
      match: it.match ?? null,
    }))

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.exirosLicitacion.findUnique({
        where: { numero: lic.numero },
        select: { id: true, estado: true },
      })

      if (!existing) {
        const created = await tx.exirosLicitacion.create({
          data: {
            numero: lic.numero,
            ...metadata,
            items: { create: itemsData },
          },
        })
        return { id: created.id, estado: created.estado, created: true }
      }

      // Re-sync: refrescamos metadata e ítems. El estado no se toca nunca
      // desde acá — lo maneja la UI y el flujo de decline del agente.
      await tx.exirosItem.deleteMany({ where: { licitacionId: existing.id } })
      const updated = await tx.exirosLicitacion.update({
        where: { id: existing.id },
        data: {
          ...metadata,
          items: { create: itemsData },
        },
      })
      return { id: updated.id, estado: updated.estado, created: false }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    logger.error('[exiros/sync] error', e)
    const message = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
