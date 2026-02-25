import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

interface QuotePDFData {
  quoteNumber: string
  date: Date
  validUntil: Date
  customer: {
    name: string
    legalName?: string
    taxId?: string
    address?: string
  }
  salesPerson: {
    name: string
    email: string
  }
  items: Array<{
    itemNumber: string
    code: string
    description: string
    brand: string
    quantity: number
    unitPrice: number
    totalPrice: number
    deliveryTime: string
    isAlternative?: boolean
  }>
  subtotal: number
  total: number
  exchangeRate: number
  paymentTerms: string
  validityDays: number
}

export async function generateQuotePDF(data: QuotePDFData): Promise<Blob> {
  const doc = new jsPDF()

  // Convertir logo a base64
  let logoBase64: string
  try {
    logoBase64 = await fetch('/logo-valarg.png')
      .then(res => res.blob())
      .then(blob => new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }))
  } catch (error) {
    console.error('Error cargando logo:', error)
    // Continuar sin logo si falla
    logoBase64 = ''
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PÁGINA 1 - COTIZACIÓN
  // ═══════════════════════════════════════════════════════════════════════

  // Logo
  if (logoBase64) {
    doc.addImage(logoBase64, 'PNG', 10, 10, 60, 18)
  }

  // Header derecho
  doc.setFontSize(10)
  doc.text(formatDate(data.date), 200, 15, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.text(`Oferta: ${data.quoteNumber}`, 200, 20, { align: 'right' })
  doc.setFont('helvetica', 'normal')

  // Datos de VAL ARG
  doc.setFontSize(9)
  doc.text('14 de Julio 175, C.P: 1427 - C.A.B.A.', 10, 35)
  doc.text('Teléfono: + 54 11 4551-3343 | 4552-2874', 10, 40)
  doc.text('VAL ARG S.R.L. CUIT: 30-71537357-9', 10, 45)

  // Cliente
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text((data.customer.legalName || data.customer.name).toUpperCase(), 10, 55)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  if (data.customer.taxId) {
    doc.text(`CUIT: ${data.customer.taxId}`, 10, 60)
  }
  if (data.customer.address) {
    doc.text(`Dirección: ${data.customer.address}`, 10, 65)
  }

  // Intro
  doc.setFontSize(10)
  doc.text('Por medio de la presente tenemos el agrado de cotizarles los siguientes ítems:', 10, 77)

  // Tabla de items
  const tableData = data.items.map(item => [
    item.itemNumber,
    item.code,
    `${item.description}\nMarca: ${item.brand}`,
    item.quantity.toString(),
    `USD ${item.unitPrice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `USD ${item.totalPrice.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    item.deliveryTime
  ])

  autoTable(doc, {
    startY: 85,
    head: [[
      'Item',
      'Código',
      'Descripción',
      'Cantidad',
      'Precio\n(Unitario)',
      'Precio\n(Total)',
      'Plazo de\nentrega'
    ]],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [0, 102, 204], // Azul VAL ARG
      textColor: 255,
      fontSize: 9,
      halign: 'center'
    },
    bodyStyles: {
      fontSize: 8
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'center', cellWidth: 22 },
      2: { cellWidth: 62 },
      3: { halign: 'center', cellWidth: 18 },
      4: { halign: 'right', cellWidth: 23 },
      5: { halign: 'right', cellWidth: 23 },
      6: { halign: 'center', cellWidth: 20 }
    },
    // Estilar alternativas con fondo gris claro y texto gris
    didParseCell: (hookData) => {
      if (hookData.section === 'body') {
        const itemData = data.items[hookData.row.index]
        if (itemData?.isAlternative) {
          hookData.cell.styles.fillColor = [240, 244, 248]
          hookData.cell.styles.textColor = [100, 116, 139]
          hookData.cell.styles.fontStyle = 'italic'
        }
      }
    }
  })

  // Total
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 10
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Total', 140, finalY)
  doc.text(`USD ${data.total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 195, finalY, { align: 'right' })

  // Condiciones comerciales
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Condiciones comerciales:', 10, finalY + 10)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  const conditions = [
    'Los precios No incluyen IVA (21%) y estan expresados en dólares americanos cotización BNA billete vendedor.',
    `Validez de la oferta: ${data.validityDays} días.`,
    'Lugar de entrega: 14 de Julio 175 - Paternal. CABA',
    `Condición de pago: ${data.paymentTerms}`,
    'Si hubiere una diferencia de cambio ±3% entre la fecha real de acreditación de los fondos y la fecha de',
    'emisión de la factura, nos veremos obligados a la emisión de una nota de débito o de crédito',
    'correspondiente a dicha diferencia.'
  ]

  let yPos = finalY + 15
  conditions.forEach(line => {
    doc.text(line, 10, yPos)
    yPos += 5
  })

  // Firma
  doc.text('Sin otro particular, le saluda muy atentamente', 10, yPos + 10)
  doc.setFont('helvetica', 'bold')
  doc.text(data.salesPerson.name, 10, yPos + 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Office: + 54 (11) 4552-2874 | 4551-3343', 10, yPos + 25)
  doc.text('www.val-ar.com.ar', 10, yPos + 30)
  doc.text(data.salesPerson.email, 10, yPos + 35)

  // ═══════════════════════════════════════════════════════════════════════
  // PÁGINA 2 - TÉRMINOS Y CONDICIONES (OBLIGATORIA)
  // ═══════════════════════════════════════════════════════════════════════

  doc.addPage()

  // Logo
  if (logoBase64) {
    doc.addImage(logoBase64, 'PNG', 10, 10, 60, 18)
  }

  // Header
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('VAL ARG S.R.L.', 10, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('14 de Julio 175, Ciudad Autónoma de Buenos Aires (CP 1427)', 10, 45)
  doc.text('Teléfono +54 11 4551-3343', 10, 50)

  // Título
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Términos y Condiciones Generales de Cotización de Precios de Materiales', 10, 60)

  // Secciones
  doc.setFontSize(10)
  let currentY = 70

  const sections = [
    {
      title: 'General',
      content: 'VAL ARG S.R.L. efectúa la provisión de acuerdo a los requerimientos del Comprador, y en ningún caso será responsable por la mala interpretación de especificaciones técnicas vinculadas al material cotizado o derivados de la presente cotización. El material cotizado deberá ser objeto de aprobación técnica por parte del comprador, interpretándose su conformidad con la orden de compra correspondiente.\n\nVAL ARG S.R.L. no será, bajo ninguna circunstancia, responsable ante la otra parte por lucro cesante, por las consecuencias mediatas, remotas o indirectas de los daños y perjuicios que se pudieren ocasionar con relación a la presente cotización de materiales. A todos los fines y supuestos, VAL ARG S.R.L. limita su responsabilidad en virtud de la presente al doble del monto aquí cotizado del material que originó el perjuicio.'
    },
    {
      title: 'Precios',
      content: 'Los precios detallados en la presente cotización serán validos exclusivamente en caso de adjudicación total de los materiales y cantidades indicadas. Los precios estarán sujetos a modificación en caso de que hubiere cambios en las especificaciones, cantidades o requerimientos de los materiales aquí cotizados.\n\nSalvo acuerdo por escrito en caso contrario, los precios indicados en la presente cotización no incluyen condiciones especiales de pintura, embalaje, ensayos, pruebas e inspección por parte del cliente o de terceras partes.'
    },
    {
      title: 'Aceptación',
      content: 'No existirá compromiso alguno entre VAL ARG S.R.L. y el comprador, hasta que la orden sea aceptada por escrito.\n\nCon la aceptación por escrito de la orden de compra por parte de VAL ARG S.R.L., estos términos y condiciones, así como aquellos establecidos de común acuerdo con el comprador, constituyen un compromiso para el suministro del material descrito en la presente cotización, el cual solo podrá ser modificado por escrito.'
    },
    {
      title: 'Pago',
      content: 'Mora: La falta de pago en término de las facturas que emitiera VAL ARG S.R.L.., facultará a VAL ARG S.R.L. a reclamar el pago de un interés compensatorio equivalente a dos veces la Tasa Activa del Banco de la Nación Argentina S.A. para Operaciones de Descuento, sobre el saldo deudor, hasta que se haga efectivo el pago de las mismas.'
    },
    {
      title: 'Garantía',
      content: 'Los usos y servicios normales, quedarán establecidos a través de las especificaciones técnicas y condiciones de servicio por parte del cliente. Este material se entiende aceptado y apto para la aplicación por parte del cliente al ordenarlo.\n\nNinguna garantía mantendrá su vigencia para productos o componentes, que habiendo sido entregados en condiciones óptimas, hubiesen sido objeto de uso o instalación inadecuada, mal almacenados, modificados o reparados por personal no autorizado por VAL ARG S.R.L.\n\nTodo gasto incurrido en la reparación o inspección de materiales, que estando dentro del período de garantía, hubieren resultado dañados por mal uso, mala instalación o maltrato, serán facturados al cliente en su totalidad.'
    },
    {
      title: 'Ley y Jurisdicción',
      content: 'La validez, ejecución de esta cotización y de la contratación resultante se regirá por las leyes de la República Argentina. A todos los efectos, serán competentes en forma exclusiva los Tribunales Ordinarios Nacionales en lo Comercial de la Ciudad Autónoma de Buenos Aires.'
    },
    {
      title: 'Domicilio',
      content: 'Los domicilios indicados en el encabezamiento de este instrumento se tendrán por válidos para todo tipo de emplazamientos, requerimientos y/o notificaciones judiciales o extrajudiciales que en ellos se realicen.'
    }
  ]

  sections.forEach(section => {
    doc.setFont('helvetica', 'bold')
    doc.text(section.title, 10, currentY)
    currentY += 5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const lines = doc.splitTextToSize(section.content, 190)
    doc.text(lines, 10, currentY)
    currentY += lines.length * 3.5 + 3
  })

  // Footer
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('14 de Julio 175 - C.P: 1427 - C.A.B.A.', 105, 285, { align: 'center' })
  doc.text('TE:(011) 4551-3343 | 4552-2874', 105, 290, { align: 'center' })

  return doc.output('blob')
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date)
}
