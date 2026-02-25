import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { PrintButton } from '@/app/(dashboard)/cotizaciones/[id]/pdf/PrintButton'

interface PageProps {
  params: Promise<{ id: string }>
}

async function getDeliveryNote(id: string) {
  const deliveryNote = await prisma.deliveryNote.findUnique({
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
      quote: {
        select: {
          quoteNumber: true,
          currency: true,
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

  if (!deliveryNote) {
    notFound()
  }

  return deliveryNote
}

const statusLabels: Record<string, string> = {
  PENDING: 'Pendiente',
  PREPARING: 'En Preparación',
  READY: 'Listo',
  DISPATCHED: 'Despachado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
}

export default async function DeliveryNotePrintPage({ params }: PageProps) {
  const { id } = await params
  const dn = await getDeliveryNote(id)

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
              <h1 style={{
                color: '#1e3a8a',
                fontSize: '20pt',
                margin: '0 0 5px 0'
              }}>
                REMITO {dn.deliveryNumber}
              </h1>
              <div style={{ color: '#64748b', fontSize: '10pt' }}>
                Fecha: {new Date(dn.date).toLocaleDateString('es-AR')}
              </div>
              <div style={{
                display: 'inline-block',
                marginTop: '4px',
                padding: '2px 10px',
                background: '#e0f2fe',
                color: '#0369a1',
                borderRadius: '4px',
                fontSize: '9pt',
                fontWeight: 'bold'
              }}>
                {statusLabels[dn.status] || dn.status}
              </div>
            </div>
          </div>
          <div style={{ fontSize: '8pt', color: '#64748b' }}>
            VAL ARG S.R.L. | CUIT: 30-71537357-9 | 14 de Julio 175, C.P: 1427 - C.A.B.A. | Tel: +54 11 4551-3343 / 4552-2874
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
              <strong>{dn.customer.businessName || dn.customer.name}</strong>
            </div>
            {dn.customer.cuit && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>CUIT:</span> {dn.customer.cuit}
              </div>
            )}
            {dn.customer.address && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Dirección:</span> {dn.customer.address}
              </div>
            )}
            {dn.customer.city && dn.customer.province && (
              <div style={{ margin: '4px 0' }}>
                {dn.customer.city}, {dn.customer.province}
              </div>
            )}
          </div>

          {/* Datos de Entrega */}
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
              DATOS DE ENTREGA
            </h3>
            {(dn.deliveryAddress || dn.customer.address) && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Dirección:</span>{' '}
                {dn.deliveryAddress || dn.customer.address}
              </div>
            )}
            {dn.deliveryCity && (
              <div style={{ margin: '4px 0' }}>
                {dn.deliveryCity}{dn.deliveryProvince ? `, ${dn.deliveryProvince}` : ''}
                {dn.deliveryPostalCode ? ` - CP ${dn.deliveryPostalCode}` : ''}
              </div>
            )}
            {dn.carrier && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Transportista:</span> {dn.carrier}
              </div>
            )}
            {dn.trackingNumber && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Seguimiento:</span> {dn.trackingNumber}
              </div>
            )}
            {dn.quote && (
              <div style={{ margin: '4px 0' }}>
                <span style={{ color: '#64748b', fontWeight: 'bold' }}>Cotización:</span> {dn.quote.quoteNumber}
              </div>
            )}
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
                textAlign: 'center',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '40px'
              }}>
                #
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'left',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '100px'
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
                width: '80px'
              }}>
                Cantidad
              </th>
              <th style={{
                background: '#f1f5f9',
                color: '#1e3a8a',
                padding: '8px',
                textAlign: 'center',
                borderBottom: '2px solid #cbd5e1',
                fontSize: '9pt',
                fontWeight: 'bold',
                width: '80px'
              }}>
                Ubicación
              </th>
            </tr>
          </thead>
          <tbody>
            {dn.items.map((item, idx) => (
              <tr key={item.id}>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'center',
                  fontWeight: 'bold',
                  color: '#1e3a8a'
                }}>
                  {idx + 1}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  fontFamily: 'monospace'
                }}>
                  {item.product.sku}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt'
                }}>
                  <strong>{item.product.name}</strong>
                  {item.product.brand && (
                    <span style={{ color: '#64748b', fontSize: '8pt' }}> | {item.product.brand}</span>
                  )}
                  {item.description && item.description !== item.product.name && (
                    <div style={{ fontSize: '8pt', color: '#64748b' }}>{item.description}</div>
                  )}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '9pt',
                  textAlign: 'center'
                }}>
                  {item.quantity} {item.product.unit}
                </td>
                <td style={{
                  padding: '8px',
                  borderBottom: '1px solid #e2e8f0',
                  fontSize: '8pt',
                  textAlign: 'center',
                  color: '#64748b'
                }}>
                  {item.warehouseLocation || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total */}
        <div style={{
          float: 'right',
          width: '200px',
          border: '2px solid #2563eb',
          padding: '12px',
          background: '#f8fafc'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '12pt',
            fontWeight: 'bold',
            color: '#1e3a8a'
          }}>
            <span>Total Items:</span>
            <span>{dn.items.reduce((sum, item) => sum + item.quantity, 0)} uds.</span>
          </div>
        </div>

        {/* Notas */}
        {dn.notes && (
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
              {dn.notes}
            </div>
          </div>
        )}

        {/* Firma */}
        <div style={{
          clear: 'both',
          marginTop: '40px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '40px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              borderTop: '1px solid #333',
              paddingTop: '5px',
              marginTop: '60px',
              fontSize: '9pt'
            }}>
              Firma y Aclaración (Entrega)
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              borderTop: '1px solid #333',
              paddingTop: '5px',
              marginTop: '60px',
              fontSize: '9pt'
            }}>
              Firma y Aclaración (Recepción)
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
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
          <div>VAL ARG S.R.L. | 14 de Julio 175, C.P: 1427 - C.A.B.A. | Tel: +54 11 4551-3343 / 4552-2874</div>
        </div>
      </div>
    </div>
  )
}
