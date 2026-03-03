import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'

// Map file extensions to MIME types
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Auth: require valid session
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { path: pathSegments } = await params

    // Security: reject if any segment contains ".." or starts with "."
    if (pathSegments.some((seg) => seg.includes('..') || seg.startsWith('.'))) {
      return NextResponse.json({ error: 'Ruta no válida' }, { status: 400 })
    }

    // Build file path relative to public/uploads/
    const relativePath = pathSegments.join('/')
    const filePath = path.join(process.cwd(), 'public', 'uploads', relativePath)

    // Security: ensure resolved path is within public/uploads/
    const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads')
    const resolvedPath = path.resolve(filePath)
    if (!resolvedPath.startsWith(uploadsDir)) {
      return NextResponse.json({ error: 'Ruta no válida' }, { status: 400 })
    }

    // Check file exists
    try {
      await stat(resolvedPath)
    } catch {
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }

    // Read file
    const fileBuffer = await readFile(resolvedPath)

    // Determine content type
    const ext = path.extname(resolvedPath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': ext === '.pdf' ? 'inline' : `inline; filename="${path.basename(resolvedPath)}"`,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Error serving file:', error)
    return NextResponse.json({ error: 'Error al servir archivo' }, { status: 500 })
  }
}
