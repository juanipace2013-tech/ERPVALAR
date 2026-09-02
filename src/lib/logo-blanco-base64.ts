/**
 * Logo VALAR blanco con transparencia (public/logo-valarg-blanco.png), usado
 * sobre la banda navy de los certificados de calibración. Mismo patrón de
 * carga que logo-base64.ts.
 */

let cachedLogo: string | null = null

export async function getLogoBlanco(): Promise<string> {
  if (cachedLogo) return cachedLogo

  if (typeof window === 'undefined') {
    try {
      const fs = await import('fs')
      const path = await import('path')
      const logoPath = path.join(process.cwd(), 'public', 'logo-valarg-blanco.png')
      const buffer = fs.readFileSync(logoPath)
      cachedLogo = `data:image/png;base64,${buffer.toString('base64')}`
      return cachedLogo
    } catch {
      // Fallback a URL
    }
  }

  try {
    const response = await fetch('/logo-valarg-blanco.png')
    const blob = await response.blob()
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        cachedLogo = reader.result as string
        resolve(cachedLogo)
      }
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}
