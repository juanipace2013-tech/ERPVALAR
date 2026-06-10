/**
 * Test del manejo de rate limit (HTTP 429) en callColppyAPI.
 *
 * Mockea global.fetch para simular las respuestas 429 de Colppy (con y sin
 * header Retry-After) y verifica que el wrapper espera y reintenta de forma
 * no bloqueante, y que tras agotar los reintentos lanza ColppyRateLimitError.
 *
 *   npx tsx scripts/test-colppy-429.ts
 *
 * No pega a la API real ni necesita .env (el wrapper no usa credenciales).
 */

import { callColppyAPI, ColppyRateLimitError } from '../src/lib/colppy'

interface TestResponse {
  result?: { estado: number; mensaje: string }
  response?: { success: boolean; data?: { ping?: string } }
}

const okBody = JSON.stringify({
  result: { estado: 0, mensaje: 'OK' },
  response: { success: true, data: { ping: 'pong' } },
})

const payload = {
  auth: { usuario: 'test', password: 'test' },
  service: { provision: 'Test', operacion: 'test_429' },
  parameters: {},
}

function mockFetchSequence(responses: Array<() => Response>): () => number {
  let calls = 0
  globalThis.fetch = (async () => {
    const factory = responses[Math.min(calls, responses.length - 1)]
    calls++
    return factory()
  }) as typeof fetch
  return () => calls
}

const r429 = (retryAfter?: string) =>
  new Response('Too Many Requests', {
    status: 429,
    headers: retryAfter !== undefined ? { 'Retry-After': retryAfter } : {},
  })

const r200 = () => new Response(okBody, { status: 200 })

let failures = 0

function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✔ ${label}`)
  } else {
    failures++
    console.error(`  ✘ FALLO: ${label}`)
  }
}

async function test1_retryAfterHeader() {
  console.log('\nTest 1: 429 con Retry-After: 1 → espera ~2s y reintenta OK')
  const getCalls = mockFetchSequence([() => r429('1'), r200])
  const t0 = Date.now()
  const result = await callColppyAPI<TestResponse>(payload)
  const elapsed = Date.now() - t0
  assert(result?.response?.data?.ping === 'pong', 'devolvió la respuesta del segundo intento')
  assert(getCalls() === 2, `hizo exactamente 2 requests (hizo ${getCalls()})`)
  assert(elapsed >= 1900 && elapsed < 4000, `esperó Retry-After+1s ≈ 2s (esperó ${elapsed}ms)`)
}

async function test2_backoffSinHeader() {
  console.log('\nTest 2: 429 SIN Retry-After → backoff 5s y reintenta OK')
  const getCalls = mockFetchSequence([() => r429(), r200])
  const t0 = Date.now()
  const result = await callColppyAPI<TestResponse>(payload)
  const elapsed = Date.now() - t0
  assert(result?.response?.data?.ping === 'pong', 'devolvió la respuesta del segundo intento')
  assert(getCalls() === 2, `hizo exactamente 2 requests (hizo ${getCalls()})`)
  assert(elapsed >= 4900 && elapsed < 8000, `esperó backoff ≈ 5s (esperó ${elapsed}ms)`)
}

async function test3_agotaReintentos() {
  console.log('\nTest 3: 429 persistente → 3 reintentos y ColppyRateLimitError')
  // Retry-After: 0 → espera 1s por intento, para que el test no tarde 65s
  const getCalls = mockFetchSequence([() => r429('0')])
  const t0 = Date.now()
  try {
    await callColppyAPI<TestResponse>(payload)
    assert(false, 'debería haber lanzado ColppyRateLimitError')
  } catch (e: unknown) {
    const elapsed = Date.now() - t0
    const err = e instanceof Error ? e : new Error(String(e))
    assert(e instanceof ColppyRateLimitError, `lanzó ColppyRateLimitError (lanzó ${err.name})`)
    assert(
      err.message === 'Colppy rate limit alcanzado. Esperá unos minutos y reintentá.',
      `mensaje claro para el usuario ("${err.message}")`
    )
    assert(getCalls() === 4, `hizo 1 intento + 3 reintentos = 4 requests (hizo ${getCalls()})`)
    assert(elapsed >= 2900 && elapsed < 6000, `esperó ~3s total entre reintentos (esperó ${elapsed}ms)`)
  }
}

async function test4_noBloqueante() {
  console.log('\nTest 4: la espera es no bloqueante (el event loop sigue corriendo)')
  const getCalls = mockFetchSequence([() => r429('1'), r200])
  let ticks = 0
  const interval = setInterval(() => ticks++, 100)
  await callColppyAPI<TestResponse>(payload)
  clearInterval(interval)
  assert(getCalls() === 2, 'completó el retry')
  assert(ticks >= 10, `el event loop tickeó durante la espera (${ticks} ticks — un sleep bloqueante daría 0)`)
}

async function main() {
  const realFetch = globalThis.fetch
  try {
    await test1_retryAfterHeader()
    await test2_backoffSinHeader()
    await test3_agotaReintentos()
    await test4_noBloqueante()
  } finally {
    globalThis.fetch = realFetch
  }

  if (failures > 0) {
    console.error(`\n${failures} aserciones fallaron`)
    process.exit(1)
  }
  console.log('\nTodos los tests pasaron ✔')
}

main()
