/**
 * Transporte HTTPS para los web services de ARCA.
 *
 * Los servidores de ARCA (wsaa.afip.gov.ar, servicios1.afip.gov.ar) negocian
 * TLS con parámetros Diffie-Hellman de 1024 bits, que OpenSSL 3 rechaza con
 * "dh key too small" (ERR_SSL_DH_KEY_TOO_SMALL). Se usa un agente propio
 * que excluye los cifrados DH/DHE (fuerza ECDHE o RSA) SOLO para estas
 * llamadas, sin bajar la seguridad TLS del resto del servidor.
 */
import https from 'https'
import { URL } from 'url'

const arcaAgent = new https.Agent({
  keepAlive: true,
  minVersion: 'TLSv1.2',
  ciphers: 'DEFAULT:!DH:!DHE:!EDH:@SECLEVEL=1',
})

export interface SoapResponse {
  status: number
  text: string
}

export function postSoap(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 60000
): Promise<SoapResponse> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        agent: arcaAgent,
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body, 'utf8'),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        )
        res.on('error', reject)
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`ARCA timeout (${timeoutMs} ms) en ${u.hostname}`))
    })
    req.on('error', reject)
    req.write(body, 'utf8')
    req.end()
  })
}
