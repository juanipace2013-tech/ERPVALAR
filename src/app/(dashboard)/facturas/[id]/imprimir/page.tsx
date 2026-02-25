import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PrintButton } from '@/app/(dashboard)/cotizaciones/[id]/pdf/PrintButton'

interface PageProps {
  params: Promise<{ id: string }>
}

async function getInvoice(id: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          name: true,
          businessName: true,
          cuit: true,
          taxCondition: true,
          address: true,
          city: true,
          province: true,
          phone: true,
          email: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              brand: true,
              unit: true,
            },
          },
        },
      },
    },
  })

  if (!invoice) {
    notFound()
  }

  return invoice
}

const typeLabels: Record<string, string> = {
  A: 'FACTURA A',
  B: 'FACTURA B',
  C: 'FACTURA C',
  E: 'FACTURA E',
}

const taxConditionLabels: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'IVA Responsable Inscripto',
  MONOTRIBUTO: 'Monotributo',
  EXENTO: 'IVA Exento',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
}

export default async function InvoicePrintPage({ params }: PageProps) {
  const { id } = await params
  const invoice = await getInvoice(id)

  const currencySymbol = invoice.currency === 'USD' ? 'USD' : 'ARS'

  const formatCurrency = (amount: number | { toNumber?: () => number }) => {
    const num = typeof amount === 'number' ? amount : (amount?.toNumber?.() ?? Number(amount))
    return `${currencySymbol} ${num.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  return (
    <div>
      <PrintButton />

      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            body * {
              visibility: hidden;
            }
            .print-container,
            .print-container * {
              visibility: visible;
            }
            .print-container {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .no-print {
              display: none !important;
            }
            @page {
              margin: 1cm;
            }
          }

          .print-container {
            max-width: 210mm;
            margin: 0 auto;
            padding: 20px;
            background: white;
            font-family: Arial, sans-serif;
            font-size: 10pt;
          }
        `
      }} />

      <div className="print-container">
        {/* Header con Logo */}
        <div style={{
          borderBottom: '3px solid #2563eb',
          paddingBottom: '15px',
          marginBottom: '20px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '10px'
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-valarg.png"
              alt="VAL ARG S.R.L."
              style={{ height: '50px', objectFit: 'contain' }}
            />
            <div style={{ textAlign: 'right' }}>
              <div style={{
                display: 'inline-block',
                padding: '4px 16px',
                background: '#1e3a8a',
                color: 'white',
                fontSize: '14pt',
                fontWeight: 'bold',
                borderRadius: '4px',
                marginBottom: '5px'
              }}>
                {typeLabels[invoice.invoiceType] || `FACTURA ${invoice.invoiceType}`}
              </div>
              <div style={{
                fontSize: '14pt',
                fontWeight: 'bold',
                color: '#1e3a8a'
              }}>
                N° {invoice.invoiceNumber}
              </div>
              <div style={{ color: '#64748b', fontSize: '10pt' }}>
                Fecha: {new Date(invoice.issueDate).toLocaleDateString('es-AR')}
              </div>
              <div style={{ color: '#64748b', fontSize: '10pt' }}>
                Vto: {new Date(invoice.dueDate).toLocaleDateString('es-AR')}
              </div>
            </div>
          </div>
          <div style={{ fontSize: '8pt', color: '#64748b' }}>
            VAL ARG S.R.L. | CUIT: 30-71537357-9 | IVA Responsable Inscripto | 14 de Julio 175, C.P: 1427 - C.A.B.A. | Tel: +54 11 4551-3343 / 4552-2874
          </div>
        </div>

        {/* Info Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          marginBottom: '20px'
        }}>
          {/* Cliente */}
          <div style={{
            border: '1px solid #e2e8f0',
            padding: '12px',
            borderRadius: '4px',
            gridColumn: '1 / -1'
          }}>
            <h3 style={{
              color: '#1e3a8a',
              fontSize: '11pt',
              margin: '0 0 8px 0',
              fontWeight: 'bold'
            }}>
              CLIENTE
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <div style={{ margin: '4px 0', lineHeight: '1.4' }}>
                  <strong>{invoice.customer.businessName || invoice.customer.name}</strong>
                </div>
                {invoice.customer.cuit && (
                  <div style={{ margin: '4px 0', fontSize: '9pt' }}>
                    <span style={{ color: '#64748b', fontWeight: 'bold' }}>CUIT:</span> {invoice.customer.cuit}
                  </div>
                )}
                {invoice.customer.taxCondition && (
                  <div style={{ margin: '4px 0', fontSize: '9pt' }}>
                    <span style={{ color: '#64748b', fontWeight: 'bold' }}>Cond. IVA:</span>{' '}
                    {taxConditionLabels[invoice.customer.taxCondition] || invoice.customer.taxCondition}
                  </div>
                )}
              </div>
              <div>
                {invoice.customer.address && (
                  <div style={{ margin: '4px 0', fontSize: '9pt' }}>
                    <span style={{ color: '#64748b', fontWeight: 'bold' }}>Dirección:</span> {invoice.customer.address}
                  </div>
                )}
                {invoice.customer.city && invoice.customer.province && (
                  <div style={{ margin: '4px 0', fontSize: '9pt' }}>
                    {invoice.customer.city}, {invoice.customer.province}
                  </div>
                )}
                {invoice.customer.phone && (
                  <div style={{ margin: '4px 0', fontSize: '9pt' }}>
                    <span style={{ color: '#64748b', fontWeight: 'bold' }}>Tel:</span> {invoice.customer.phone}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Items */}
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginBottom: '15px'
        }}>
          <thead>
            <tr>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'left',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '80px'
              }}>
                Código
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'left',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold'
              }}>
                Descripción
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'center',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '60px'
              }}>
                Cant.
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'right',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '90px'
              }}>
                P. Unit.
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'right',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '60px'
              }}>
                Desc.
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'right',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '60px'
              }}>
                IVA
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'right',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '90px'
              }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id}>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '8pt',
                  fontFamily: 'monospace'
                }}>
                  {item.product?.sku || '-'}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt'
                }}>
                  {item.description}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'center'
                }}>
                  {Number(item.quantity)}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'right',
                  fontFamily: 'monospace'
                }}>
                  {formatCurrency(item.unitPrice)}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'right'
                }}>
                  {Number(item.discount) > 0 ? `${Number(item.discount)}%` : '-'}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'right'
                }}>
                  {Number(item.taxRate)}%
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'right',
                  fontFamily: 'monospace',
                  fontWeight: 'bold'
                }}>
                  {formatCurrency(item.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{
          float: 'right',
          width: '300px',
          border: '2px solid #2563eb',
          padding: '12px',
          background: '#f8fafc'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '6px 0',
            borderBottom: '1px solid #e2e8f0',
            fontSize: '10pt'
          }}>
            <span>Subtotal:</span>
            <span style={{ fontFamily: 'monospace' }}>
              {formatCurrency(invoice.subtotal)}
            </span>
          </div>
          {Number(invoice.discount) > 0 && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '6px 0',
              borderBottom: '1px solid #e2e8f0',
              fontSize: '10pt',
              color: '#dc2626'
            }}>
              <span>Descuento:</span>
              <span style={{ fontFamily: 'monospace' }}>
                -{formatCurrency(invoice.discount)}
              </span>
            </div>
          )}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '6px 0',
            borderBottom: '1px solid #e2e8f0',
            fontSize: '10pt'
          }}>
            <span>IVA:</span>
            <span style={{ fontFamily: 'monospace' }}>
              {formatCurrency(invoice.taxAmount)}
            </span>
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '6px 0',
            borderTop: '2px solid #2563eb',
            fontSize: '13pt',
            fontWeight: 'bold',
            color: '#1e3a8a',
            marginTop: '6px'
          }}>
            <span>TOTAL:</span>
            <span style={{ fontFamily: 'monospace' }}>
              {formatCurrency(invoice.total)}
            </span>
          </div>
          <div style={{ fontSize: '8pt', color: '#64748b', textAlign: 'right', marginTop: '4px' }}>
            Moneda: {invoice.currency}
          </div>
        </div>

        {/* Notas */}
        {invoice.notes && (
          <div style={{
            clear: 'both',
            marginTop: '20px',
            paddingTop: '15px',
            borderTop: '1px solid #e2e8f0'
          }}>
            <h3 style={{
              color: '#1e3a8a',
              fontSize: '11pt',
              margin: '0 0 8px 0'
            }}>
              Observaciones
            </h3>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '9pt' }}>
              {invoice.notes}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          clear: 'both',
          marginTop: '30px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '8pt',
          borderTop: '1px solid #e2e8f0',
          paddingTop: '10px'
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-valarg.png"
            alt="VAL ARG S.R.L."
            style={{ height: '25px', objectFit: 'contain', marginBottom: '5px', opacity: 0.6 }}
          />
          <div>VAL ARG S.R.L. | CUIT: 30-71537357-9 | 14 de Julio 175, C.P: 1427 - C.A.B.A. | Tel: +54 11 4551-3343 / 4552-2874</div>
        </div>
      </div>
    </div>
  )
}
