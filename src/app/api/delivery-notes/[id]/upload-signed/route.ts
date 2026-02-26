import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'remitos-firmados');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { id } = await params;

    // Verificar que el remito existe
    const deliveryNote = await prisma.deliveryNote.findUnique({
      where: { id },
      select: { id: true, deliveryNumber: true },
    });

    if (!deliveryNote) {
      return NextResponse.json({ error: 'Remito no encontrado' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }

    // Validar tipo
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido. Solo JPG, PNG o PDF.' },
        { status: 400 }
      );
    }

    // Validar tamaño
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'El archivo excede el límite de 10MB.' },
        { status: 400 }
      );
    }

    // Crear directorio si no existe
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Generar nombre de archivo único
    const ext = file.name.split('.').pop() || 'pdf';
    const safeNumber = deliveryNote.deliveryNumber.replace(/\s/g, '-');
    const timestamp = Date.now();
    const fileName = `${safeNumber}_firmado_${timestamp}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    // Escribir archivo
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    // Actualizar remito en la base de datos
    const updated = await prisma.deliveryNote.update({
      where: { id },
      data: {
        signedDocUrl: `/uploads/remitos-firmados/${fileName}`,
        signedDocName: file.name,
        signedAt: new Date(),
      },
      select: {
        signedDocUrl: true,
        signedDocName: true,
        signedAt: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error uploading signed document:', error);
    return NextResponse.json(
      { error: 'Error al subir el archivo' },
      { status: 500 }
    );
  }
}
