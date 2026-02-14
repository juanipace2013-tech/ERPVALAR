async function main() {
  console.log('🔍 Verificando listado de clientes...\n')

  try {
    const response = await fetch('http://localhost:3000/api/clientes?page=1&limit=50&status=ACTIVE&sortBy=balance&sortOrder=desc')

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = await response.json()

    console.log('📊 Resultado del API:\n')
    console.log(`Total clientes: ${data.pagination.total}`)
    console.log(`Página: ${data.pagination.page} de ${data.pagination.totalPages}`)
    console.log(`Mostrando: ${data.customers.length} clientes\n`)

    if (data.customers.length > 0) {
      console.log('👥 Lista de clientes:\n')
      data.customers.forEach((customer: any, index: number) => {
        console.log(`${index + 1}. ${customer.name}`)
        console.log(`   Razón Social: ${customer.businessName || 'N/A'}`)
        console.log(`   CUIT: ${customer.cuit}`)
        console.log(`   Balance: $${Number(customer.balance).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`)
        console.log(`   Multiplicador: ${Number(customer.priceMultiplier)}x`)
        console.log(`   Vendedor: ${customer.salesPerson?.name || 'Sin asignar'}`)
        console.log(`   Estado: ${customer.status}`)
        console.log(`   URL: http://localhost:3000/clientes/${customer.id}\n`)
      })
    } else {
      console.log('⚠️  No hay clientes activos\n')
    }

    console.log('✅ API funcionando correctamente!\n')
    console.log('🌐 Puedes ver el listado en:')
    console.log('   http://localhost:3000/clientes\n')

  } catch (error) {
    console.error('❌ Error:', error)
    if (error instanceof Error) {
      console.error(`   ${error.message}\n`)
    }
  }
}

main()
