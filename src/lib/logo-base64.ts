/**
 * Logo VAL ARG para PDFs generados server-side y client-side.
 * Carga el logo desde el filesystem (servidor) o via fetch (cliente).
 * Reemplaza el string base64 de 238KB que estaba embebido en el codigo.
 */

let cachedLogo: string | null = null

async function loadLogoAsync(): Promise<string> {
  if (cachedLogo) return cachedLogo

  if (typeof window === 'undefined') {
    // Server-side: leer desde filesystem
    try {
      const fs = await import('fs')
      const path = await import('path')
      const logoPath = path.join(process.cwd(), 'public', 'logo-valarg.png')
      const buffer = fs.readFileSync(logoPath)
      cachedLogo = `data:image/png;base64,${buffer.toString('base64')}`
      return cachedLogo
    } catch {
      // Fallback a URL
    }
  }

  // Client-side o fallback: cargar via URL publica
  try {
    const res = await fetch('/logo-valarg.png')
    const buf = await res.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    cachedLogo = `data:image/png;base64,${base64}`
    return cachedLogo
  } catch {
    return ''
  }
}

/**
 * Carga el logo como base64.
 * Usar en lugar del export LOGO_BASE64 en generadores async.
 */
export async function getLogo(): Promise<string> {
  return loadLogoAsync()
}

/**
 * LOGO_BASE64 - Nota: para compatibilidad con jsPDF que necesita sync.
 * Los generadores de PDF que usen esto deben esperar con await getLogo() primero.
 */
export let LOGO_BASE64 = ''

// Pre-cargar al importar (solo en servidor donde fs funciona)
if (typeof window === 'undefined') {
  import('fs').then(fs => {
    import('path').then(path => {
      try {
        const logoPath = path.join(process.cwd(), 'public', 'logo-valarg.png')
        const buffer = fs.readFileSync(logoPath)
        LOGO_BASE64 = `data:image/png;base64,${buffer.toString('base64')}`
        cachedLogo = LOGO_BASE64
      } catch {
        // silencio
      }
    })
  }).catch(() => {})
}
