/**
 * Bootstrap OAuth de Mercado Libre — one-shot CLI.
 *
 * Obtiene el primer par de tokens (access + refresh) vía authorization_code grant
 * y deja lista la fila única de MlCredential. A partir de ahí el cliente
 * (src/lib/mercadolibre/client.ts) refresca solo.
 *
 *   npm run ml:oauth
 *
 * Env necesarias:
 *   ML_CLIENT_ID            — App ID de la integración ML
 *   ML_CLIENT_SECRET        — Secret de la app (NUNCA se imprime)
 *   ML_OAUTH_REDIRECT_URI   — redirect URI EXACTA registrada en la app
 *   ML_PKCE_ENABLED         — "true"/"false" (default false)
 *   ML_OAUTH_MODE           — "manual" | "listen" (default "manual")
 *
 * El flujo es server-side. Si la respuesta del token no trae refresh_token, la
 * app no tiene el scope offline_access habilitado y el script aborta.
 */

import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import readline from 'readline'
import http from 'http'

const prisma = new PrismaClient()

const AUTH_BASE = 'https://auth.mercadolibre.com.ar/authorization'
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token'

interface MlTokenResponse {
  access_token: string
  token_type?: string
  expires_in: number
  scope?: string
  user_id?: number
  refresh_token?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) {
    console.error(`❌ Falta la variable de entorno ${name}`)
    process.exit(1)
  }
  return v.trim()
}

function truncate(s: string, head = 8, tail = 4): string {
  if (s.length <= head + tail) return s
  return `${s.slice(0, head)}…${s.slice(-tail)} (${s.length} chars)`
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

// ---------------------------------------------------------------------------
// Captura del code
// ---------------------------------------------------------------------------

/** Modo manual: el usuario pega el code (y opcionalmente el state) de la barra. */
async function captureManual(expectedState: string): Promise<string> {
  console.log(
    '\n📋 Autorizá en el browser. ML te va a redirigir al redirect_uri con ?code=...&state=...'
  )
  console.log('   Copiá SOLO el valor de `code` de la barra de direcciones.\n')

  const pastedState = await prompt(
    '¿Querés validar el state? Pegá el `state` de la URL (o Enter para saltar): '
  )
  if (pastedState && pastedState !== expectedState) {
    console.error(
      `❌ El state no coincide (esperado ${expectedState}, pegado ${pastedState}). Posible CSRF — abortando.`
    )
    process.exit(1)
  }

  const code = await prompt('Pegá el `code`: ')
  if (!code) {
    console.error('❌ No ingresaste ningún code.')
    process.exit(1)
  }
  return code
}

/** Modo listen: levanta un server efímero en el puerto del redirect_uri. */
async function captureListen(redirectUri: string, expectedState: string): Promise<string> {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    console.error(`❌ ML_OAUTH_REDIRECT_URI no es una URL válida: ${redirectUri}`)
    process.exit(1)
  }
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    console.error(
      `❌ Modo "listen" requiere un redirect_uri http://localhost:PORT/... — recibí ${redirectUri}`
    )
    process.exit(1)
  }

  const port = Number(url.port || 80)
  const expectedPath = url.pathname

  return new Promise<string>((resolve) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://${url.host}`)
      if (reqUrl.pathname !== expectedPath) {
        res.writeHead(404).end('Not found')
        return
      }

      const code = reqUrl.searchParams.get('code')
      const state = reqUrl.searchParams.get('state')
      const error = reqUrl.searchParams.get('error')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<h1>Error de autorización</h1><p>${error}</p>`)
        console.error(`❌ ML devolvió error de autorización: ${error}`)
        server.close()
        process.exit(1)
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<h1>State inválido</h1><p>Posible CSRF. Revisá la consola.</p>')
        console.error(`❌ State inválido (esperado ${expectedState}, recibido ${state}).`)
        server.close()
        process.exit(1)
      }

      if (!code) {
        res.writeHead(400).end('Falta code')
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h1>✅ Listo</h1><p>Code capturado. Podés cerrar esta pestaña y volver a la terminal.</p>')
      server.close()
      resolve(code)
    })

    server.listen(port, () => {
      console.log(`\n👂 Escuchando en ${redirectUri} — autorizá en el browser...`)
    })
    server.on('error', (err) => {
      console.error(`❌ No se pudo levantar el server en el puerto ${port}:`, err.message)
      process.exit(1)
    })
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const clientId = requireEnv('ML_CLIENT_ID')
  const clientSecret = requireEnv('ML_CLIENT_SECRET')
  const redirectUri = requireEnv('ML_OAUTH_REDIRECT_URI')
  const pkceEnabled = (process.env.ML_PKCE_ENABLED ?? 'false').toLowerCase() === 'true'
  const mode = (process.env.ML_OAUTH_MODE ?? 'manual').toLowerCase()

  if (mode !== 'manual' && mode !== 'listen') {
    console.error(`❌ ML_OAUTH_MODE inválido: "${mode}" (usá "manual" o "listen")`)
    process.exit(1)
  }

  // 2. state CSRF
  const state = base64url(crypto.randomBytes(24))

  // 3. PKCE (opcional)
  let codeVerifier: string | null = null
  let codeChallenge: string | null = null
  if (pkceEnabled) {
    codeVerifier = base64url(crypto.randomBytes(48)) // 64 chars URL-safe
    codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
  }

  // 4. URL de autorización
  const authUrl = new URL(AUTH_BASE)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  if (pkceEnabled && codeChallenge) {
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
  }

  console.log('\n🔗 Abrí esta URL en el browser y autorizá la app:\n')
  console.log(authUrl.toString())
  console.log(`\n(state=${state}${pkceEnabled ? ', PKCE S256 activado' : ''}, modo=${mode})`)

  // 5. Capturar el code
  const code =
    mode === 'listen'
      ? await captureListen(redirectUri, state)
      : await captureManual(state)

  // 6. Intercambiar code por tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })
  if (pkceEnabled && codeVerifier) body.set('code_verifier', codeVerifier)

  console.log('\n🔄 Intercambiando code por tokens...')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })

  const rawBody = await res.text()
  if (!res.ok) {
    console.error(`❌ El token endpoint devolvió HTTP ${res.status}:`)
    console.error(rawBody)
    if (rawBody.includes('redirect_uri') || rawBody.includes('invalid_grant')) {
      console.error(
        '\n💡 Causa #1 de fallo: el redirect_uri NO matchea EXACTO el registrado en la app de ML.\n' +
          `   Verificá que ML_OAUTH_REDIRECT_URI ("${redirectUri}") sea idéntico (esquema, host, puerto,\n` +
          '   path y barra final) al de developers.mercadolibre.com. También el code se usa una sola vez.'
      )
    }
    process.exit(1)
  }

  let data: MlTokenResponse
  try {
    data = JSON.parse(rawBody) as MlTokenResponse
  } catch {
    console.error('❌ No se pudo parsear la respuesta del token endpoint:', rawBody)
    process.exit(1)
  }

  // 7. Validar respuesta
  if (!data.refresh_token) {
    console.error(
      '❌ La respuesta NO trae refresh_token. La app de ML necesita el scope `offline_access`\n' +
        '   habilitado (revisá la configuración de la app en developers.mercadolibre.com y volvé\n' +
        '   a autorizar). Sin refresh_token no podemos mantener la sesión.'
    )
    process.exit(1)
  }
  if (data.user_id == null) {
    console.error('❌ La respuesta no trae user_id; no puedo identificar al seller. Body:', rawBody)
    process.exit(1)
  }

  const expiresAt = new Date(Date.now() + data.expires_in * 1000)
  const mlUserId = BigInt(data.user_id)

  // 8. Persistencia (fila única): upsert por mlUserId + limpiar cualquier otra fila.
  await prisma.mlCredential.upsert({
    where: { mlUserId },
    create: {
      mlUserId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    },
    update: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    },
  })
  // MlCredential es fila única: si quedó alguna otra fila de un user distinto, la borramos.
  await prisma.mlCredential.deleteMany({ where: { mlUserId: { not: mlUserId } } })

  console.log(
    `\n✅ Credencial ML cargada para user_id ${mlUserId}, expira en ${expiresAt.toISOString()}`
  )

  // 9. Mostrar valores + recordatorio
  console.log('\n📦 Valores persistidos:')
  console.log(`   mlUserId:     ${mlUserId}`)
  console.log(`   accessToken:  ${truncate(data.access_token)}`)
  console.log(`   refreshToken: ${truncate(data.refresh_token)}`)
  console.log(`   expiresAt:    ${expiresAt.toISOString()}`)
  console.log(
    '\n⚠️  Si corriste esto contra la DB de DEV, todavía falta cargar la fila en PROD:\n' +
      '   corré este mismo script en el VPS (con el .env de prod) o copiá los valores\n' +
      '   de arriba a la tabla ml_credentials de producción. El refresh_token es de un\n' +
      '   solo uso: una vez que el cliente lo rota, el viejo deja de servir.'
  )
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Error en ml-oauth-bootstrap:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
