import React from 'react'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PrintButton } from './PrintButton'

interface PageProps {
  params: Promise<{ id: string }>
}

async function getQuote(id: string) {
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          name: true,
          businessName: true,
          cuit: true,
          address: true,
          city: true,
          province: true,
          phone: true,
          email: true,
        },
      },
      salesPerson: {
        select: {
          name: true,
          email: true,
          phone: true,
        },
      },
      items: {
        orderBy: [{ itemNumber: 'asc' }, { isAlternative: 'asc' }],
        include: {
          product: {
            select: {
              sku: true,
              name: true,
              brand: true,
              unit: true,
            },
          },
          additionals: {
            orderBy: { position: 'asc' },
            include: {
              product: {
                select: {
                  sku: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!quote) {
    notFound()
  }

  return quote
}

export default async function QuotePDFPage({ params }: PageProps) {
  const { id } = await params
  const quote = await getQuote(id)

  const totalInARS = Number(quote.total) * Number(quote.exchangeRate)

  // Agrupar items por número base (principal + alternativas)
  const groupedItems = quote.items.reduce((acc, item) => {
    if (item.isAlternative) {
      const parentNumber = item.itemNumber
      if (!acc[parentNumber]) {
        acc[parentNumber] = []
      }
      acc[parentNumber].push(item)
    } else {
      if (!acc[item.itemNumber]) {
        acc[item.itemNumber] = []
      }
      acc[item.itemNumber].unshift(item)
    }
    return acc
  }, {} as Record<number, typeof quote.items>)

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
        {/* Header */}
        <div style={{
          borderBottom: '3px solid #2563eb',
          paddingBottom: '15px',
          marginBottom: '20px'
        }}>
          <h1 style={{
            color: '#1e3a8a',
            fontSize: '24pt',
            margin: '0 0 5px 0'
          }}>
            COTIZACIÓN {quote.quoteNumber}
          </h1>
          <div style={{ color: '#64748b', fontSize: '12pt' }}>
            Fecha: {new Date(quote.date).toLocaleDateString('es-AR')}
            {quote.validUntil && (
              <> | Válida hasta: {new Date(quote.validUntil).toLocaleDateString('es-AR')}</>
            )}
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
            borderRadius: '4px'
          }}>
            <h3 style={{
              color: '#1e3a8a',
              fontSize: '11pt',
              margin: '0 0 8px 0',
              fontWeight: 'bold'
            }}>
              CLIENTE
            </h3>
            <div style={{ margin: '4px 0', lineHeight: '1.4' }}>
              <strong>{quote.customer.businessName || quote.customer.name}</strong>
            </div>
            {quote.customer.cuit && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>CUIT:</span> {quote.customer.cuit}
              </div>
            )}
            {quote.customer.address && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Dirección:</span> {quote.customer.address}
              </div>
            )}
            {quote.customer.city && quote.customer.province && (
              <div style={{ margin: '4px 0' }}>
                {quote.customer.city}, {quote.customer.province}
              </div>
            )}
            {quote.customer.phone && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Tel:</span> {quote.customer.phone}
              </div>
            )}
            {quote.customer.email && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Email:</span> {quote.customer.email}
              </div>
            )}
          </div>

          {/* Vendedor */}
          <div style={{
            border: '1px solid #e2e8f0',
            padding: '12px',
            borderRadius: '4px'
          }}>
            <h3 style={{
              color: '#1e3a8a',
              fontSize: '11pt',
              margin: '0 0 8px 0',
              fontWeight: 'bold'
            }}>
              VENDEDOR
            </h3>
            <div style={{ margin: '4px 0' }}>
              <strong>{quote.salesPerson.name}</strong>
            </div>
            <div style={{ margin: '4px 0' }}>
              <span style={{ color: '#64748b', fontWeight: 'bold' }}>Email:</span> {quote.salesPerson.email}
            </div>
            {quote.salesPerson.phone && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Tel:</span> {quote.salesPerson.phone}
              </div>
            )}
            <div style={{ margin: '4px 0', marginTop: '10px' }}>
              <span style={{ color: '#64748b', fontWeight: 'bold' }}>Tipo de Cambio:</span>{' '}
              USD 1 = ARS {Number(quote.exchangeRate).toFixed(2)}
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
                width: '40px'
              }}>
                Item
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
                width: '80px'
              }}>
                P. Unit. USD
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
                Total USD
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(groupedItems)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map((itemNumber) => {
                const items = groupedItems[parseInt(itemNumber)]
                const mainItem = items[0]
                const alternatives = items.slice(1)

                return (
                  <React.Fragment key={itemNumber}>
                    {/* Main Item */}
                    <tr>
                      <td style={{
                        padding: '8px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '9pt'
                      }}>
                        <span style={{
                          fontWeight: 'bold',
                          color: '#1e3a8a',
                          fontSize: '14pt'
                        }}>
                          {mainItem.itemNumber}
                        </span>
                      </td>
                      <td style={{
                        padding: '8px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '9pt'
                      }}>
                        <strong>{mainItem.product.name}</strong>
                        <div style={{ fontSize: '8pt', color: '#64748b' }}>
                          SKU: {mainItem.product.sku}
                          {mainItem.product.brand && ` | Marca: ${mainItem.product.brand}`}
                        </div>
                        {mainItem.description && mainItem.description !== mainItem.product.name && (
                          <div style={{ fontSize: '8pt', marginTop: '2px' }}>
                            {mainItem.description}
                          </div>
                        )}
                        {/* Additionals */}
                        {mainItem.additionals.length > 0 && (
                          <div style={{ marginTop: '4px' }}>
                            {mainItem.additionals.map((add, idx) => (
                              <div key={idx} style={{
                                color: '#64748b',
                                fontSize: '8pt',
                                paddingLeft: '10px'
                              }}>
                                + {add.product.sku} - {add.product.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{
                        padding: '8px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '9pt',
                        textAlign: 'center'
                      }}>
                        {mainItem.quantity} {mainItem.product.unit}
                      </td>
                      <td style={{
                        padding: '8px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '9pt',
                        textAlign: 'right',
                        fontFamily: 'monospace'
                      }}>
                        {Number(mainItem.unitPrice).toFixed(2)}
                      </td>
                      <td style={{
                        padding: '8px',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '9pt',
                        textAlign: 'right',
                        fontFamily: 'monospace',
                        fontWeight: 'bold'
                      }}>
                        {Number(mainItem.totalPrice).toFixed(2)}
                      </td>
                    </tr>

                    {/* Alternatives */}
                    {alternatives.map((alt, altIdx) => (
                      <tr key={alt.id} style={{ background: '#f8fafc' }}>
                        <td style={{
                          padding: '8px',
                          borderBottom: '1px solid #e2e8f0',
                          fontSize: '9pt'
                        }}>
                          <span style={{ fontSize: '10pt', color: '#64748b' }}>
                            {mainItem.itemNumber}{String.fromCharCode(65 + altIdx)}
                          </span>
                        </td>
                        <td style={{
                          padding: '8px',
                          borderBottom: '1px solid #e2e8f0',
                          fontSize: '9pt'
                        }}>
                          <em style={{ color: '#64748b' }}>Alternativa:</em>{' '}
                          {alt.product.name}
                          <div style={{ fontSize: '8pt', color: '#64748b' }}>
                            SKU: {alt.product.sku}
                          </div>
                        </td>
                        <td style={{
                          padding: '8px',
                          borderBottom: '1px solid #e2e8f0',
                          fontSize: '9pt',
                          textAlign: 'center',
                          color: '#64748b'
                        }}>
                          {alt.quantity} {alt.product.unit}
                        </td>
                        <td style={{
                          padding: '8px',
                          borderBottom: '1px solid #e2e8f0',
                          fontSize: '9pt',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          color: '#64748b'
                        }}>
                          {Number(alt.unitPrice).toFixed(2)}
                        </td>
                        <td style={{
                          padding: '8px',
                          borderBottom: '1px solid #e2e8f0',
                          fontSize: '9pt',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          color: '#64748b'
                        }}>
                          {Number(alt.totalPrice).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
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
            borderBottom: '1px solid #e2e8f0'
          }}>
            <span>Subtotal:</span>
            <span style={{ fontFamily: 'monospace' }}>
              USD {Number(quote.subtotal).toFixed(2)}
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
              USD {Number(quote.total).toFixed(2)}
            </span>
          </div>
          <div style={{
            fontSize: '9pt',
            color: '#64748b',
            marginTop: '8px',
            textAlign: 'right'
          }}>
            ARS {totalInARS.toFixed(2)}
          </div>
        </div>

        {/* Terms and Notes */}
        {(quote.terms || quote.notes) && (
          <div style={{
            clear: 'both',
            marginTop: '20px',
            paddingTop: '15px',
            borderTop: '1px solid #e2e8f0'
          }}>
            {quote.terms && (
              <div style={{ marginBottom: '15px' }}>
                <h3 style={{
                  color: '#1e3a8a',
                  fontSize: '11pt',
                  margin: '0 0 8px 0'
                }}>
                  Condiciones de Pago
                </h3>
                <div style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: '9pt'
                }}>
                  {quote.terms}
                </div>
              </div>
            )}
            {quote.notes && (
              <div>
                <h3 style={{
                  color: '#1e3a8a',
                  fontSize: '11pt',
                  margin: '0 0 8px 0'
                }}>
                  Observaciones
                </h3>
                <div style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: '9pt'
                }}>
                  {quote.notes}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: '30px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '8pt',
          borderTop: '1px solid #e2e8f0',
          paddingTop: '10px'
        }}>
          Cotización generada el {new Date().toLocaleDateString('es-AR')} a las{' '}
          {new Date().toLocaleTimeString('es-AR')}
        </div>
      </div>
    </div>
  )
}
