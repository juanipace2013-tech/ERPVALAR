import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'child_process'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCuit(cuit: string): string {
  return cuit.replace(/[-.\s]/g, '').slice(0, 11)
}

function formatCuit(cuit: string): string {
  const c = normalizeCuit(cuit)
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`
}

function calcularSemaforo(
  situacionPeor: number,
  cantidadCheques: number
): 'verde' | 'amarillo' | 'rojo' {
  if (situacionPeor >= 4) return 'rojo'
  if (situacionPeor >= 2 || cantidadCheques > 0) return 'amarillo'
  return 'verde'
}

// ── Flujo BCRA (web + Cloudflare Turnstile) ─────────────────────────────────
// La vieja API REST (api.bcra.gob.ar/CentralDeDeudores) está muerta.
// El nuevo flujo usa el sitio web del BCRA:
//   1. Headless Chrome con stealth resuelve Turnstile en /situacion-crediticia/
//   2. Submit del form redirige a /deudores/?cuit=XXX&ts=YYY&token=ZZZ
//   3. GET /api-deudores.php?cuit=XXX&ts=YYY&token=ZZZ → JSON
//
// Usa puppeteer-extra + stealth plugin para evadir detección de bot.
// En el VPS se necesita chromium: apt install chromium-browser (o snap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detecta la ruta del ejecutable de Chromium/Chrome en el sistema.
 */
function findChromePath(): string {
  const paths = [
    // Linux
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]

  for (const p of paths) {
    try {
      // Check if file exists (cross-platform)
      execSync(`${process.platform === 'win32' ? 'where' : 'which'} "${p}" 2>/dev/null || test -f "${p}"`, {
        timeout: 2000,
        stdio: 'pipe',
      })
      return p
    } catch {
      // not found, try next
    }
  }

  // Fallback: try 'which' commands
  for (const cmd of ['chromium-browser', 'chromium', 'google-chrome', 'google-chrome-stable']) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8', timeout: 2000 }).trim()
      if (result) return result
    } catch {
      // not found
    }
  }

  throw new Error(
    'No se encontró Chromium/Chrome. Instalá con: apt install chromium-browser'
  )
}

/**
 * Obtiene ts + token del BCRA usando puppeteer-extra + stealth plugin.
 * El stealth plugin evita que Cloudflare Turnstile detecte headless Chrome.
 */
async function getBcraTokens(cuit: string): Promise<{ ts: string; token: string }> {
  // Dynamic imports para que no falle si los paquetes no están instalados
  const puppeteerExtra = await import('puppeteer-extra')
  const StealthPlugin = await import('puppeteer-extra-plugin-stealth')

  const puppeteer = puppeteerExtra.default
  puppeteer.use(StealthPlugin.default())

  const chromePath = findChromePath()
  console.log(`[BCRA] Launching Chrome (stealth): ${chromePath}`)

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
    ],
    timeout: 30000,
  })

  try {
    const page = await browser.newPage()

    // Viewport realista
    await page.setViewport({ width: 1366, height: 768 })

    console.log(`[BCRA] Navigating to situacion-crediticia...`)
    await page.goto('https://www.bcra.gob.ar/situacion-crediticia/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    })

    // Escribir el CUIT con delay humano
    await page.type('#user_cuit', cuit, { delay: 80 })

    // Esperar a que Turnstile se resuelva (el hidden input cf-turnstile-response se llena)
    console.log(`[BCRA] Waiting for Turnstile to solve...`)
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'input[name="cf-turnstile-response"]'
        ) as HTMLInputElement | null
        return input && input.value && input.value.length > 10
      },
      { timeout: 30000 }
    )
    console.log(`[BCRA] Turnstile solved!`)

    // Submit el formulario y esperar el redirect a /deudores/
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#consulta-cuit'),
    ])

    // Extraer ts y token de la URL de redirect
    const finalUrl = new URL(page.url())
    const ts = finalUrl.searchParams.get('ts')
    const token = finalUrl.searchParams.get('token')

    if (!ts || !token) {
      const currentUrl = page.url()
      console.error(`[BCRA] No tokens in redirect URL: ${currentUrl}`)
      throw new Error(`BCRA no devolvió tokens. URL: ${currentUrl}`)
    }

    console.log(`[BCRA] Got tokens: ts=${ts}, token=${token.substring(0, 16)}...`)
    return { ts, token }
  } finally {
    await browser.close()
  }
}

/**
 * Llama a la API de deudores del BCRA con los tokens obtenidos.
 * Usa curl para evitar problemas de TLS con Node.js.
 */
function fetchBcraApi(cuit: string, ts: string, token: string): any {
  const url = `https://www.bcra.gob.ar/api-deudores.php?cuit=${cuit}&ts=${ts}&token=${encodeURIComponent(token)}&lang=es`
  console.log(`[BCRA] Fetching API: ${url.substring(0, 80)}...`)

  try {
    const result = execSync(
      `curl -sk "${url}" -H "Accept: application/json" --max-time 15`,
      { encoding: 'utf-8', timeout: 20000 }
    )

    if (!result || !result.trim()) {
      throw new Error('Respuesta vacía de la API del BCRA')
    }

    const parsed = JSON.parse(result.trim())

    if (!parsed.success) {
      throw new Error(parsed.error || 'Error en la API del BCRA')
    }

    return parsed
  } catch (error) {
    console.error(`[BCRA] API fetch error:`, error instanceof Error ? error.message : error)
    throw error
  }
}

// ── Mapeo de datos: nueva API → formato del frontend ────────────────────────

function mapBcraResponse(apiData: any, cuit: string) {
  const denominacion = apiData.titular?.trim() || ''

  // ── Deudas ──
  const registros: any[] = apiData.deudas?.registros ?? []
  const referencias = apiData.deudas?.referencias ?? {}

  const entidadesMapped = registros.map((r: any) => ({
    entidad: r.codigo_entidad ?? 0,
    entidadNombre: r.entidad?.trim() ?? undefined,
    situacion: r.situacion ?? 1,
    monto: r.monto ?? 0,
    diasAtrasoPago: r.dias_atraso,
    refinanciaciones: referencias.refinanciaciones ?? false,
    recategorizacionObligacion: referencias.recategorizacion ?? false,
    situacionJuridica: referencias.situacion_juridica ?? false,
    procesoJudicial: referencias.proceso_judicial ?? false,
  }))

  const situacionPeor =
    entidadesMapped.length > 0
      ? Math.max(...entidadesMapped.map((e: any) => Number(e.situacion) || 1))
      : 0

  // Los montos de la API ya vienen en pesos (no en miles)
  const montoTotalDeuda = entidadesMapped.reduce(
    (sum: number, e: any) => sum + (Number(e.monto) || 0),
    0
  )

  // Extraer período del primer registro (formato "MM/YY" → "YYYYMM")
  let periodoInformacion = ''
  if (registros.length > 0 && registros[0].periodo) {
    const [mm, yy] = registros[0].periodo.split('/')
    periodoInformacion = `20${yy}${mm}`
  }

  const deudasTransformed = apiData.deudas?.tiene_datos
    ? {
        status: 200,
        results: {
          denominacion,
          periodoInformacion,
          entidades: entidadesMapped,
        },
      }
    : { status: 200, results: { denominacion, entidades: [] } }

  // ── Cheques rechazados ──
  let cantidadChequesRechazados = 0
  const causalesTransformed: any[] = []

  const chequesData = apiData.cheques
  if (chequesData) {
    // Procesar cheques personales y jurídicos
    for (const tipo of ['personales', 'juridicos'] as const) {
      const tipoData = chequesData[tipo]
      if (!tipoData?.registros?.length) continue

      const chequesRegistros = tipoData.registros
      cantidadChequesRechazados += chequesRegistros.length

      // Agrupar por causal
      const byCausal: Record<string, any[]> = {}
      for (const ch of chequesRegistros) {
        const causal = ch.causal || 'Sin fondos'
        if (!byCausal[causal]) byCausal[causal] = []
        byCausal[causal].push({
          entidad: 0,
          entidadNombre: undefined,
          numeroCheque: ch.cheque || '',
          fechaRechazo: ch.fecha_rechazo || null,
          monto: ch.monto ?? null,
          moneda: 'ARS',
          pagado: !!ch.fecha_pago,
          fechaPago: ch.fecha_pago || null,
        })
      }

      for (const [causal, cheques] of Object.entries(byCausal)) {
        causalesTransformed.push({
          descripcionCausal: causal,
          entidades: cheques,
        })
      }
    }
  }

  const chequesTransformed = {
    status: 200,
    results: {
      denominacion,
      causales: causalesTransformed,
    },
  }

  // ── Históricos (historia24) → formato periodos[] del frontend ──
  let historicasTransformed: any = { status: 200, results: { denominacion, periodos: [] } }
  if (apiData.historia24?.tiene_datos && apiData.historia24.entidades?.length > 0) {
    const periodosMap: Record<string, any[]> = {}
    for (const ent of apiData.historia24.entidades) {
      for (const per of ent.periodos ?? []) {
        const key = `${per.anio}${String(per.mes).padStart(2, '0')}`
        if (!periodosMap[key]) periodosMap[key] = []
        periodosMap[key].push({
          entidad: ent.nombre?.trim() ?? '',
          situacion: per.situacion,
          monto: per.monto,
          procesoJudicial: per.proceso_judicial,
        })
      }
    }

    historicasTransformed = {
      status: 200,
      results: {
        denominacion,
        periodos: Object.entries(periodosMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([periodo, entidades]) => ({
            periodo,
            entidades: entidades.map((e) => ({
              entidad: 0,
              entidadNombre: e.entidad,
              situacion: e.situacion,
              monto: e.monto,
            })),
          })),
      },
    }
  }

  // ── Semáforo ──
  const semaforo =
    situacionPeor === 0 && cantidadChequesRechazados === 0
      ? 'verde'
      : calcularSemaforo(situacionPeor, cantidadChequesRechazados)

  return {
    cuit: formatCuit(cuit),
    denominacion,
    deudas: deudasTransformed,
    historicas: historicasTransformed,
    cheques: chequesTransformed,
    resumen: {
      situacionPeor,
      montoTotalDeuda,
      cantidadEntidades: entidadesMapped.length,
      cantidadChequesRechazados,
      semaforo,
    },
  }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cuit: string }> }
) {
  const { cuit: rawCuit } = await params
  const cuit = normalizeCuit(rawCuit)

  if (cuit.length !== 11 || !/^\d+$/.test(cuit)) {
    return NextResponse.json({ error: 'CUIT inválido' }, { status: 400 })
  }

  // ?refresh=true fuerza reconsulta (ignora caché)
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

  // Check 1h cache (unless forced refresh)
  if (!forceRefresh) {
    const cache = await prisma.bcraCache.findUnique({ where: { cuit } })
    if (cache) {
      const age = Date.now() - new Date(cache.consultedAt).getTime()
      if (age < 1 * 60 * 60 * 1000) {
        const cached = cache.data as any
        if (cached?.resumen && cached?.deudas) {
          console.log(`[BCRA] Cache hit for ${cuit} (age: ${Math.round(age / 60000)}min)`)
          return NextResponse.json(cached)
        }
        console.warn(`[BCRA] Cache for ${cuit} is invalid, refetching...`)
      }
    }
  } else {
    console.log(`[BCRA] Force refresh for ${cuit}`)
  }

  try {
    // Paso 1: Obtener tokens via headless Chrome + Turnstile
    console.log(`[BCRA] Starting token acquisition for ${cuit}...`)
    const { ts, token } = await getBcraTokens(cuit)

    // Paso 2: Llamar a la API con los tokens
    const apiData = fetchBcraApi(cuit, ts, token)
    console.log(`[BCRA] API response: success=${apiData.success}, titular=${apiData.titular}`)

    // Paso 3: Verificar disponibilidad del sistema
    if (!apiData.sistema_disponible) {
      return NextResponse.json(
        { error: 'El sistema de la Central de Deudores del BCRA no está disponible en este momento.' },
        { status: 503 }
      )
    }

    // Paso 4: Mapear al formato del frontend
    const result = mapBcraResponse(apiData, cuit)

    console.log(
      `[BCRA] Result: semaforo=${result.resumen.semaforo}, deuda=$${result.resumen.montoTotalDeuda}, entidades=${result.resumen.cantidadEntidades}`
    )

    // Upsert cache
    await prisma.bcraCache.upsert({
      where: { cuit },
      update: { data: result as any, consultedAt: new Date() },
      create: { cuit, data: result as any },
    })

    // Save to search history (best-effort)
    try {
      const session = await auth()
      if (session?.user?.id) {
        await prisma.bcraSearchHistory.create({
          data: {
            cuit,
            customerName: result.denominacion || '',
            semaforo: result.resumen.semaforo,
            userId: session.user.id,
            result: result as any,
          },
        })
      }
    } catch (e) {
      console.error('Error saving BCRA search history:', e)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[BCRA] Error:', error instanceof Error ? error.message : error)

    const message =
      error instanceof Error ? error.message : 'Error al consultar la Central de Deudores del BCRA'

    // Si es un error de Chrome/puppeteer, dar indicación clara
    if (message.includes('Chromium') || message.includes('Chrome') || message.includes('puppeteer')) {
      return NextResponse.json(
        {
          error:
            'No se pudo iniciar el navegador para consultar el BCRA. ' +
            'Verificá que Chromium esté instalado en el servidor (apt install chromium-browser).',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
