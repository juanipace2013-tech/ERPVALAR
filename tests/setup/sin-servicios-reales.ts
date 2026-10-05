/**
 * Red de seguridad de TODOS los tests: ninguno puede hablar con Colppy, ARCA,
 * Mercado Libre, Microsoft, Anthropic ni la base de datos de verdad.
 *
 * - Las credenciales reales del .env local se pisan con valores falsos ANTES
 *   de que nada cargue el .env (dotenv y Prisma no pisan variables ya puestas).
 * - fetch y https.request quedan bloqueados: un test que necesite red la
 *   simula con vi.stubGlobal('fetch', ...) / vi.mock del módulo, que tienen
 *   prioridad sobre este bloqueo.
 *
 * Origen: el 5/10/2026 un test con un mock incompleto llamó al Colppy real
 * con las credenciales del .env (Colppy rechazó todo; no quedó nada creado).
 */
import http from 'http'
import https from 'https'

const FALSAS: Record<string, string> = {
  DATABASE_URL: 'postgresql://tests:tests@127.0.0.1:1/sin_base_en_tests',
  COLPPY_USER: 'tests-sin-colppy',
  COLPPY_PASSWORD: 'tests-sin-colppy',
  COLPPY_ID_EMPRESA: '0',
  ML_CLIENT_ID: 'tests-sin-ml',
  ML_CLIENT_SECRET: 'tests-sin-ml',
  AZURE_TENANT_ID: 'tests-sin-azure',
  AZURE_CLIENT_ID: 'tests-sin-azure',
  AZURE_CLIENT_SECRET: 'tests-sin-azure',
  ANTHROPIC_API_KEY: 'tests-sin-anthropic',
  META_WHATSAPP_ACCESS_TOKEN: 'tests-sin-whatsapp',
  ARCA_CERT_PATH: '/tests/sin-certificado.crt',
  ARCA_KEY_PATH: '/tests/sin-certificado.key',
  ARCA_TA_DIR: '/tests/sin-ta',
}
for (const [k, v] of Object.entries(FALSAS)) process.env[k] = v

function bloqueado(destino: string): never {
  throw new Error(`Red bloqueada en tests (${destino}): simulala con vi.stubGlobal('fetch', ...) o vi.mock del módulo`)
}

globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: string })?.url ?? input)
  bloqueado(url)
}) as typeof fetch

const destinoDe = (args: unknown[]) => {
  const a = args[0]
  if (typeof a === 'string') return a
  if (a instanceof URL) return a.href
  const o = (a ?? {}) as { hostname?: string; host?: string; path?: string }
  return `${o.hostname ?? o.host ?? '?'}${o.path ?? ''}`
}
for (const mod of [http, https]) {
  mod.request = ((...args: unknown[]) => bloqueado(destinoDe(args))) as typeof mod.request
  mod.get = ((...args: unknown[]) => bloqueado(destinoDe(args))) as typeof mod.get
}
