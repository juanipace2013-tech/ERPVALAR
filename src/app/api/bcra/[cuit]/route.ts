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

// ── Flujo BCRA via web + Cloudflare Turnstile ───────────────────────────────
// Usa puppeteer-core con anti-detección manual para resolver el captcha.
// Flujo:
//   1. Headless Chrome navega a /situacion-crediticia/, resuelve Turnstile
//   2. Submit redirige a /deudores/?cuit=XXX&ts=YYY&token=ZZZ
//   3. Llama a /api-deudores.php con esos tokens → JSON
//   4. Si Turnstile falla, fallback: scrapea el DOM de /deudores/ directamente
//
// Requiere chromium en el VPS: apt install chromium-browser (o snap)
// ─────────────────────────────────────────────────────────────────────────────

function findChromePath(): string {
  const paths = [
    '/snap/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]

  for (const p of paths) {
    try {
      execSync(
        process.platform === 'win32'
          ? `if exist "${p}" (echo found) else (exit 1)`
          : `test -f "${p}"`,
        { timeout: 2000, stdio: 'pipe' }
      )
      return p
    } catch {
      // not found
    }
  }

  // Fallback: which
  for (const cmd of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 2000,
      }).trim()
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
 * Lanza un browser puppeteer-core con anti-detección manual.
 */
async function launchBrowser() {
  const puppeteer = await import('puppeteer-core')
  const chromePath = findChromePath()
  console.log(`[BCRA] Launching Chrome: ${chromePath}`)

  const browser = await puppeteer.default.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1366,768',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    timeout: 30000,
  })

  return browser
}

/**
 * Configura una página con anti-detección manual (sin stealth plugin).
 */
async function setupStealthPage(browser: any) {
  const page = await browser.newPage()

  // Eliminar señales de automatización
  await page.evaluateOnNewDocument(() => {
    // Ocultar webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    // Simular chrome runtime
    // @ts-ignore
    window.chrome = { runtime: {} }
    // Ocultar plugins vacíos
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    })
    // Ocultar languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['es-AR', 'es', 'en-US', 'en'],
    })
  })

  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  )
  await page.setViewport({ width: 1366, height: 768 })

  return page
}

// ── Estrategia 1: Capturar tokens via Turnstile → llamar API ────────────────

async function getBcraViaApi(cuit: string): Promise<any> {
  const browser = await launchBrowser()

  try {
    const page = await setupStealthPage(browser)

    console.log(`[BCRA] [API] Navigating to situacion-crediticia...`)
    await page.goto('https://www.bcra.gob.ar/situacion-crediticia/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    })

    // Escribir CUIT con delay humano
    await page.type('#user_cuit', cuit, { delay: 80 })

    // Esperar Turnstile
    console.log(`[BCRA] [API] Waiting for Turnstile...`)
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'input[name="cf-turnstile-response"]'
        ) as HTMLInputElement | null
        return input && input.value && input.value.length > 10
      },
      { timeout: 30000 }
    )
    console.log(`[BCRA] [API] Turnstile solved!`)

    // Submit y capturar redirect
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#consulta-cuit'),
    ])

    const finalUrl = new URL(page.url())
    const ts = finalUrl.searchParams.get('ts')
    const token = finalUrl.searchParams.get('token')

    if (!ts || !token) {
      throw new Error(`No tokens in URL: ${page.url()}`)
    }

    console.log(`[BCRA] [API] Got tokens, calling api-deudores.php...`)

    // Llamar a la API con curl
    const apiUrl = `https://www.bcra.gob.ar/api-deudores.php?cuit=${cuit}&ts=${ts}&token=${encodeURIComponent(token)}&lang=es`
    const result = execSync(
      `curl -sk "${apiUrl}" -H "Accept: application/json" --max-time 15`,
      { encoding: 'utf-8', timeout: 20000 }
    )

    const parsed = JSON.parse(result.trim())
    if (!parsed.success) throw new Error(parsed.error || 'API error')

    return parsed
  } finally {
    await browser.close()
  }
}

// ── Estrategia 2 (fallback): Scrapear DOM directamente ─────────────────────

async function getBcraViaScraping(cuit: string): Promise<any> {
  const browser = await launchBrowser()

  try {
    const page = await setupStealthPage(browser)

    console.log(`[BCRA] [SCRAPE] Navigating to situacion-crediticia...`)
    await page.goto('https://www.bcra.gob.ar/situacion-crediticia/', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    })

    // Escribir CUIT
    await page.type('#user_cuit', cuit, { delay: 80 })

    // Esperar Turnstile
    console.log(`[BCRA] [SCRAPE] Waiting for Turnstile...`)
    await page.waitForFunction(
      () => {
        const input = document.querySelector(
          'input[name="cf-turnstile-response"]'
        ) as HTMLInputElement | null
        return input && input.value && input.value.length > 10
      },
      { timeout: 30000 }
    )

    // Submit
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
      page.click('#consulta-cuit'),
    ])

    console.log(`[BCRA] [SCRAPE] Page loaded: ${page.url()}`)

    // Esperar a que la app Vue renderice los resultados (o un error)
    await page.waitForFunction(
      () => {
        const container = document.getElementById('deudores-resultados')
        if (!container) return false
        // Esperar que desaparezca el loading spinner
        const loading = container.querySelector('.deudores-loading')
        if (loading) return false
        // Tiene contenido renderizado
        return container.innerHTML.length > 100
      },
      { timeout: 20000 }
    )

    // Interceptar los datos de la variable global apiData (la app Vue los guarda)
    // O extraer directamente del DOM si apiData no está accesible
    const scrapedData = await page.evaluate(() => {
      const container = document.getElementById('deudores-resultados')
      if (!container) return null

      // Verificar si hay error
      const errorEl = container.querySelector('.deudores-error')
      if (errorEl) {
        return { error: errorEl.textContent?.trim() || 'Error desconocido' }
      }

      // Extraer titular del header
      const titular =
        container.querySelector('.info-actualizacion-fecha-n b')?.textContent?.trim() || ''

      // Extraer deudas de la tabla principal
      const deudas: any[] = []
      const tablaDeudas = container.querySelector('#tabla-rowcolspan-int tbody')
      if (tablaDeudas) {
        const rows = tablaDeudas.querySelectorAll('tr')
        rows.forEach((row) => {
          const cells = row.querySelectorAll('td')
          if (cells.length >= 5) {
            deudas.push({
              denominacion: cells[0]?.textContent?.trim() || '',
              entidad: cells[1]?.textContent?.trim() || '',
              periodo: cells[2]?.textContent?.trim() || '',
              situacion: parseInt(cells[3]?.textContent?.trim() || '1') || 1,
              monto: parseFloat(
                (cells[4]?.textContent?.trim() || '0')
                  .replace(/\./g, '')
                  .replace(',', '.')
              ) || 0,
              dias_atraso:
                cells[5]?.textContent?.trim() === '-' || cells[5]?.textContent?.trim() === 'N/A'
                  ? null
                  : parseInt(cells[5]?.textContent?.trim() || '0') || null,
              observaciones_text: cells[6]?.textContent?.trim() || '-',
            })
          }
        })
      }

      // Verificar si dice "sin deudas"
      const sinDeudas = container.querySelector('.alert-success')
      const tieneDeudas = deudas.length > 0

      // Extraer cheques rechazados
      let tieneChequesRechazados = false
      const chequesSection = container.innerHTML
      if (
        chequesSection.includes('Sin cheques rechazados') ||
        chequesSection.includes('no registra cheques')
      ) {
        tieneChequesRechazados = false
      }

      return {
        titular,
        tieneDeudas,
        deudas,
        sinDeudas: !!sinDeudas && !tieneDeudas,
        tieneChequesRechazados,
      }
    })

    if (!scrapedData) throw new Error('No se pudo extraer datos del DOM')
    if ('error' in scrapedData) throw new Error(scrapedData.error as string)

    // Convertir datos scrapeados al formato de la API
    return {
      success: true,
      cuit: parseInt(cuit),
      titular: scrapedData.titular,
      sistema_disponible: true,
      deudas: {
        tiene_datos: scrapedData.tieneDeudas,
        registros: scrapedData.deudas.map((d: any) => ({
          denominacion: d.denominacion,
          entidad: d.entidad,
          codigo_entidad: 0,
          periodo: d.periodo,
          situacion: d.situacion,
          monto: d.monto,
          dias_atraso: d.dias_atraso,
          observaciones: d.observaciones_text === '-' ? [] : [d.observaciones_text],
        })),
        referencias: {
          proceso_judicial: false,
          revision: false,
          refinanciaciones: false,
          recategorizacion: false,
          situacion_juridica: false,
          irrecuperable: false,
        },
      },
      cheques: {
        tiene_datos_personales: false,
        tiene_datos_juridicos: false,
      },
      historia24: {
        tiene_datos: false,
        entidades: [],
      },
      _source: 'scraping',
    }
  } finally {
    await browser.close()
  }
}

// ── Mapeo de datos: API nueva → formato del frontend ────────────────────────

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

  const montoTotalDeuda = entidadesMapped.reduce(
    (sum: number, e: any) => sum + (Number(e.monto) || 0),
    0
  )

  // Período: "MM/YY" → "YYYYMM"
  let periodoInformacion = ''
  if (registros.length > 0 && registros[0].periodo) {
    const parts = registros[0].periodo.split('/')
    if (parts.length === 2) {
      const [mm, yy] = parts
      periodoInformacion = `20${yy}${mm}`
    }
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
    for (const tipo of ['personales', 'juridicos'] as const) {
      const tipoData = (chequesData as any)[tipo]
      if (!tipoData?.registros?.length) continue

      cantidadChequesRechazados += tipoData.registros.length

      const byCausal: Record<string, any[]> = {}
      for (const ch of tipoData.registros) {
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
    results: { denominacion, causales: causalesTransformed },
  }

  // ── Históricos ──
  let historicasTransformed: any = {
    status: 200,
    results: { denominacion, periodos: [] },
  }
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

  const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true'

  // Cache 1h
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
        console.warn(`[BCRA] Cache invalid for ${cuit}, refetching...`)
      }
    }
  } else {
    console.log(`[BCRA] Force refresh for ${cuit}`)
  }

  let apiData: any = null

  // Estrategia 1: Turnstile → tokens → API JSON
  try {
    console.log(`[BCRA] Trying API strategy for ${cuit}...`)
    apiData = await getBcraViaApi(cuit)
    console.log(`[BCRA] API strategy succeeded`)
  } catch (apiError) {
    console.warn(
      `[BCRA] API strategy failed: ${apiError instanceof Error ? apiError.message : apiError}`
    )

    // Estrategia 2 (fallback): Scrapear DOM
    try {
      console.log(`[BCRA] Trying scraping fallback for ${cuit}...`)
      apiData = await getBcraViaScraping(cuit)
      console.log(`[BCRA] Scraping fallback succeeded`)
    } catch (scrapeError) {
      console.error(
        `[BCRA] Scraping fallback also failed: ${scrapeError instanceof Error ? scrapeError.message : scrapeError}`
      )

      const message =
        scrapeError instanceof Error
          ? scrapeError.message
          : 'Error al consultar la Central de Deudores del BCRA'

      if (
        message.includes('Chromium') ||
        message.includes('Chrome') ||
        message.includes('puppeteer')
      ) {
        return NextResponse.json(
          {
            error:
              'No se pudo iniciar el navegador. Verificá que Chromium esté instalado: apt install chromium-browser',
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  // Verificar disponibilidad
  if (!apiData.sistema_disponible) {
    return NextResponse.json(
      { error: 'El sistema de la Central de Deudores del BCRA no está disponible en este momento.' },
      { status: 503 }
    )
  }

  // Mapear al formato del frontend
  const result = mapBcraResponse(apiData, cuit)

  console.log(
    `[BCRA] Result: semaforo=${result.resumen.semaforo}, deuda=$${result.resumen.montoTotalDeuda}, entidades=${result.resumen.cantidadEntidades}, source=${apiData._source || 'api'}`
  )

  // Upsert cache
  await prisma.bcraCache.upsert({
    where: { cuit },
    update: { data: result as any, consultedAt: new Date() },
    create: { cuit, data: result as any },
  })

  // Search history (best-effort)
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
}
