// Estados y veredictos de las licitaciones de Exiros. Strings planos (no enum
// de Prisma) para que el agente pueda evolucionar sin migración.

export const EXIROS_ESTADOS = [
  'NUEVA',
  'EN_PROCESO',
  'COTIZADA',
  'DECLINAR_PENDIENTE',
  'DECLINADA',
  'DECLINE_ERROR',
  'IGNORADA',
  'VENCIDA',
] as const

export type ExirosEstado = (typeof EXIROS_ESTADOS)[number]

export const EXIROS_VEREDICTOS = ['COTIZAR', 'REVISAR', 'DECLINAR'] as const

export type ExirosVeredicto = (typeof EXIROS_VEREDICTOS)[number]

// Transiciones permitidas desde la UI (PATCH /api/exiros/licitaciones/[numero]).
// DECLINADA / DECLINE_ERROR son terminales: las setea solo el agente.
// VENCIDA no se persiste: se computa al vuelo comparando `cierre` con now().
export const UI_TRANSICIONES: Record<string, ExirosEstado[]> = {
  NUEVA: ['EN_PROCESO', 'COTIZADA', 'IGNORADA', 'DECLINAR_PENDIENTE'],
  EN_PROCESO: ['NUEVA', 'COTIZADA', 'IGNORADA', 'DECLINAR_PENDIENTE'],
  COTIZADA: ['NUEVA'],
  IGNORADA: ['NUEVA'],
  DECLINAR_PENDIENTE: ['NUEVA'], // "Cancelar" antes de que el agente lo tome
}

// Plataformas de origen de las licitaciones. El agente externo detecta y
// pushea de todas; el flujo de decline automático solo existe para EXIROS.
export const EXIROS_PLATAFORMAS = ['EXIROS', 'ARIBA_PAMPA'] as const

export type ExirosPlataforma = (typeof EXIROS_PLATAFORMAS)[number]

export const PLATAFORMA_LABELS: Record<string, string> = {
  EXIROS: 'Exiros',
  ARIBA_PAMPA: 'Ariba (Pampa)',
}

// Home del portal de proveedores de Exiros. El deep-link al evento requiere
// sesión activa en el Bidding Point; si da error hay que entrar primero acá.
export const EXIROS_PORTAL_URL = 'https://suppliersworkplace.exiros.com/EPR/Portal'

export function deepLinkExiros(idInterno: number | null | undefined): string | null {
  if (!idInterno) return null
  return `https://biddingpoint.exiros.com/BNE/supplier/Auction/Details/${idInterno}`
}
