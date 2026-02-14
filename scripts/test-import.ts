import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('🧪 Probando importación de clientes...\n')

  // Leer el archivo CSV de ejemplo
  const csvPath = path.join(process.cwd(), 'ejemplo-importacion-clientes.csv')

  if (!fs.existsSync(csvPath)) {
    console.log('❌ Archivo ejemplo-importacion-clientes.csv no encontrado\n')
    process.exit(1)
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8')
  const lines = csvContent.split('\n').filter(line => line.trim())

  console.log(`📄 Archivo CSV cargado: ${lines.length - 1} registros\n`)

  // Parsear CSV
  const headers = lines[0].split(',').map(h => h.trim())
  const customers = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    const customer: any = {}
    headers.forEach((header, index) => {
      customer[header] = values[index] || ''
    })
    customers.push(customer)
  }

  console.log('📋 Clientes a importar:')
  console.log('────────────────────────────────────────────────')
  customers.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name} - CUIT: ${c.cuit}`)
  })
  console.log('────────────────────────────────────────────────\n')

  // Validar que no existan CUITs duplicados en la base de datos
  console.log('🔍 Validando CUITs existentes...\n')

  const validationResults = []
  for (const customer of customers) {
    const existing = await prisma.customer.findUnique({
      where: { cuit: customer.cuit },
    })

    if (existing) {
      validationResults.push({
        customer: customer.name,
        cuit: customer.cuit,
        status: 'DUPLICADO',
        message: `Ya existe un cliente con este CUIT: ${existing.name}`,
      })
    } else {
      validationResults.push({
        customer: customer.name,
        cuit: customer.cuit,
        status: 'VÁLIDO',
        message: 'Listo para importar',
      })
    }
  }

  // Mostrar resultados de validación
  console.log('✅ Resultados de validación:')
  console.log('────────────────────────────────────────────────')
  validationResults.forEach((result, i) => {
    const icon = result.status === 'VÁLIDO' ? '✓' : '✗'
    const color = result.status === 'VÁLIDO' ? '' : ''
    console.log(`${icon} ${i + 1}. ${result.customer}`)
    console.log(`   CUIT: ${result.cuit}`)
    console.log(`   ${result.message}`)
    console.log()
  })

  const validCount = validationResults.filter(r => r.status === 'VÁLIDO').length
  const duplicateCount = validationResults.filter(r => r.status === 'DUPLICADO').length

  console.log('────────────────────────────────────────────────')
  console.log(`Total: ${customers.length} | Válidos: ${validCount} | Duplicados: ${duplicateCount}\n`)

  if (validCount === 0) {
    console.log('⚠️  No hay clientes válidos para importar (todos son duplicados)\n')
    console.log('💡 Tip: Puedes eliminar los clientes duplicados con:')
    console.log('   npx ts-node scripts/delete-test-customers.ts\n')
    return
  }

  // Importar solo los clientes válidos
  console.log(`🚀 Importando ${validCount} clientes válidos...\n`)

  const importedCustomers = []
  for (const result of validationResults) {
    if (result.status === 'VÁLIDO') {
      const customer = customers.find(c => c.cuit === result.cuit)

      try {
        const newCustomer = await prisma.customer.create({
          data: {
            name: customer.name,
            businessName: customer.businessName || customer.name,
            type: customer.type as any,
            cuit: customer.cuit,
            taxCondition: customer.taxCondition as any,
            email: customer.email || null,
            phone: customer.phone || null,
            mobile: customer.mobile || null,
            website: customer.website || null,
            address: customer.address || null,
            city: customer.city || null,
            province: customer.province || null,
            postalCode: customer.postalCode || null,
            country: customer.country || 'Argentina',
            status: customer.status as any,
            creditLimit: customer.creditLimit ? parseFloat(customer.creditLimit) : null,
            creditCurrency: customer.creditCurrency as any || 'ARS',
            paymentTerms: customer.paymentTerms ? parseInt(customer.paymentTerms) : 30,
            discount: customer.discount ? parseFloat(customer.discount) : 0,
            priceMultiplier: customer.priceMultiplier ? parseFloat(customer.priceMultiplier) : 1.0,
            notes: customer.notes || null,
          },
        })

        importedCustomers.push(newCustomer)
        console.log(`✅ ${newCustomer.name} importado (ID: ${newCustomer.id})`)
      } catch (error) {
        console.log(`❌ Error al importar ${customer.name}:`, error)
      }
    }
  }

  console.log('\n────────────────────────────────────────────────')
  console.log(`✅ Importación completada: ${importedCustomers.length} clientes importados\n`)

  console.log('📊 Clientes importados:')
  importedCustomers.forEach((c, i) => {
    console.log(`${i + 1}. ${c.name}`)
    console.log(`   CUIT: ${c.cuit}`)
    console.log(`   Email: ${c.email || 'N/A'}`)
    console.log(`   Ciudad: ${c.city || 'N/A'}, ${c.province || 'N/A'}`)
    console.log()
  })

  console.log('🌐 Ver clientes en: http://localhost:3000/clientes\n')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
