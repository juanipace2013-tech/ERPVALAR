/**
 * Seed de Proveedores
 *
 * Crea 5 proveedores de ejemplo con marcas argentinas reales:
 * - GENEBRE ARGENTINA (Marcas: GENEBRE)
 * - WINTERS INSTRUMENTS (Marcas: WINTERS, ASHCROFT)
 * - CEPEX ARGENTINA (Marcas: CEPEX, FIP)
 * - KITO ARGENTINA (Marcas: KITO)
 * - AERRE INOXIDABLES (Marcas: AERRE)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding proveedores...\n');

  // Obtener el primer usuario como comprador por defecto
  const firstUser = await prisma.user.findFirst({
    where: { status: 'ACTIVE' },
  });

  if (!firstUser) {
    throw new Error('No hay usuarios activos en la base de datos');
  }

  const suppliers = [
    {
      name: 'GENEBRE ARGENTINA',
      legalName: 'Genebre Argentina S.A.',
      taxId: '30712345678',
      email: 'ventas@genebre.com.ar',
      phone: '011-4321-5678',
      mobile: '011-15-6789-1234',
      address: 'Av. Industrial 1234',
      city: 'Buenos Aires',
      province: 'Buenos Aires',
      postalCode: 'B1640',
      website: 'https://www.genebre.com.ar',
      discount: 15.00, // 15% de descuento
      paymentDays: 30,
      balance: 0,
      category: 'Válvulas',
      brands: ['GENEBRE'],
      status: 'ACTIVE' as const,
      isPreferred: true,
      paymentTerms: '30 días fecha de factura',
      notes: 'Proveedor de válvulas industriales de alta calidad. Representante oficial de GENEBRE en Argentina.',
      internalNotes: 'Excelente relación precio-calidad. Siempre cumple con los plazos de entrega.',
      buyerUserId: firstUser.id,
    },
    {
      name: 'WINTERS INSTRUMENTS',
      legalName: 'Winters Instruments Argentina S.R.L.',
      taxId: '30723456789',
      email: 'info@winters.com.ar',
      phone: '011-4567-8901',
      mobile: '011-15-7890-2345',
      address: 'Calle Medidores 567',
      city: 'San Martín',
      province: 'Buenos Aires',
      postalCode: 'B1650',
      website: 'https://www.winters.com.ar',
      discount: 10.00, // 10% de descuento
      paymentDays: 45,
      balance: 0,
      category: 'Instrumentos de Medición',
      brands: ['WINTERS', 'ASHCROFT'],
      status: 'ACTIVE' as const,
      isPreferred: true,
      paymentTerms: '45 días fecha de factura',
      notes: 'Especialista en manómetros, termómetros y otros instrumentos de medición. Distribuidor exclusivo de WINTERS y ASHCROFT.',
      internalNotes: 'Muy buenos precios en manómetros. Stock permanente.',
      buyerUserId: firstUser.id,
    },
    {
      name: 'CEPEX ARGENTINA',
      legalName: 'Cepex Argentina S.A.',
      taxId: '30734567890',
      email: 'ventas@cepex.com.ar',
      phone: '011-4890-1234',
      mobile: '011-15-8901-3456',
      address: 'Parque Industrial 890',
      city: 'Pilar',
      province: 'Buenos Aires',
      postalCode: 'B1629',
      website: 'https://www.cepex.com.ar',
      discount: 12.00, // 12% de descuento
      paymentDays: 30,
      balance: 0,
      category: 'Válvulas y Accesorios',
      brands: ['CEPEX', 'FIP'],
      status: 'ACTIVE' as const,
      isPreferred: false,
      paymentTerms: '30 días fecha de factura',
      notes: 'Proveedor de válvulas y accesorios de PVC. Marcas CEPEX y FIP.',
      internalNotes: 'Buen proveedor para válvulas de PVC. Los plazos de entrega son variables.',
      buyerUserId: firstUser.id,
    },
    {
      name: 'KITO ARGENTINA',
      legalName: 'Kito Argentina S.A.',
      taxId: '30745678901',
      email: 'info@kito.com.ar',
      phone: '011-5012-3456',
      mobile: '011-15-9012-4567',
      address: 'Zona Industrial 345',
      city: 'Lomas de Zamora',
      province: 'Buenos Aires',
      postalCode: 'B1832',
      website: 'https://www.kito.com.ar',
      discount: 8.00, // 8% de descuento
      paymentDays: 60,
      balance: 0,
      category: 'Equipos de Izaje',
      brands: ['KITO'],
      status: 'ACTIVE' as const,
      isPreferred: false,
      paymentTerms: '60 días fecha de factura',
      notes: 'Equipos de izaje, grúas y aparejos. Marca KITO.',
      internalNotes: 'Compras esporádicas. Buenos precios en grúas.',
      buyerUserId: firstUser.id,
    },
    {
      name: 'AERRE INOXIDABLES',
      legalName: 'A.R. Inoxidables S.A.',
      taxId: '30756789012',
      email: 'ventas@aerre.com.ar',
      phone: '011-5678-9012',
      mobile: '011-15-0123-5678',
      address: 'Av. Acero 2345',
      city: 'Avellaneda',
      province: 'Buenos Aires',
      postalCode: 'B1870',
      website: 'https://www.aerre.com.ar',
      discount: 10.00, // 10% de descuento
      paymentDays: 30,
      balance: 0,
      category: 'Acero Inoxidable',
      brands: ['AERRE'],
      status: 'ACTIVE' as const,
      isPreferred: true,
      paymentTerms: '30 días fecha de factura',
      notes: 'Fabricante de accesorios de acero inoxidable. Marca propia AERRE.',
      internalNotes: 'Excelente calidad. Fabrican a medida. Proveedor confiable.',
      buyerUserId: firstUser.id,
    },
  ];

  console.log(`👤 Usuario comprador asignado: ${firstUser.name} (${firstUser.email})\n`);

  for (const supplierData of suppliers) {
    const supplier = await prisma.supplier.upsert({
      where: { taxId: supplierData.taxId },
      update: supplierData,
      create: supplierData,
    });

    console.log(`✅ ${supplier.name}`);
    console.log(`   - CUIT: ${supplier.taxId}`);
    console.log(`   - Marcas: ${supplier.brands.join(', ')}`);
    console.log(`   - Descuento: ${supplier.discount}%`);
    console.log(`   - Preferido: ${supplier.isPreferred ? 'Sí' : 'No'}`);
    console.log(`   - Estado: ${supplier.status}`);
    console.log('');
  }

  console.log('✨ Seed de proveedores completado!\n');
  console.log('📊 Resumen:');
  const totalSuppliers = await prisma.supplier.count();
  const preferredSuppliers = await prisma.supplier.count({ where: { isPreferred: true } });
  console.log(`   - Total proveedores: ${totalSuppliers}`);
  console.log(`   - Proveedores preferidos: ${preferredSuppliers}`);
  console.log(`   - Proveedores activos: ${await prisma.supplier.count({ where: { status: 'ACTIVE' } })}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error en seed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
