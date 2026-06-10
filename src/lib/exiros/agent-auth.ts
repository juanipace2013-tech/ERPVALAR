import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

// Auth de los endpoints que consume el agente Python de Exiros (corre en el
// mismo VPS, fuera del ERP). Manda `Authorization: Bearer ${EXIROS_AGENT_API_KEY}`.
// La key la setea Santiago en el .env del ERP y en el config del agente.

function safeEquals(a: string, b: string): boolean {
  // Hasheamos antes de comparar para igualar longitudes (timingSafeEqual
  // exige buffers del mismo tamaño).
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

// Devuelve null si la request está autenticada, o la respuesta de error a
// devolver tal cual si no lo está.
export function requireExirosAgent(req: NextRequest): NextResponse | null {
  const expected = process.env.EXIROS_AGENT_API_KEY
  if (!expected) {
    return NextResponse.json(
      { error: 'EXIROS_AGENT_API_KEY no configurada en el servidor' },
      { status: 503 }
    )
  }

  const header = req.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (!token || !safeEquals(token, expected)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  return null
}
