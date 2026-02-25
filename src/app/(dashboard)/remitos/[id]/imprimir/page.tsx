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
          ivaCondition: true,
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

const ivaLabels: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  EXENTO: 'Exento',
  MONOTRIBUTO: 'Monotributo',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  NO_RESPONSABLE: 'No Responsable',
  RESPONSABLE_NO_INSCRIPTO: 'Resp. No Inscripto',
}

export default async function DeliveryNotePrintPage({ params }: PageProps) {
  const { id } = await params
  const dn = await getDeliveryNote(id)

  const fechaEmision = new Date(dn.date).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  const ivaLabel = dn.customer.ivaCondition
    ? ivaLabels[dn.customer.ivaCondition] || dn.customer.ivaCondition
    : ''

  const totalARS = dn.totalAmountARS ? Number(dn.totalAmountARS) : null

  return (
    <div>
      <PrintButton />

      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area {
              position: absolute;
              left: 0; top: 0;
              width: 100%;
            }
            .no-print { display: none !important; }
            @page { margin: 1cm; size: A4; }
          }
          body { font-family: Arial, sans-serif; font-size: 10pt; }
          .print-area {
            max-width: 210mm;
            margin: 0 auto;
            padding: 12px 16px;
            background: white;
          }
          table { border-collapse: collapse; }
          .header-table { width: 100%; margin-bottom: 0; }
          .header-left { vertical-align: top; width: 55%; padding: 8px 10px 8px 4px; }
          .header-center {
            vertical-align: middle;
            text-align: center;
            width: 70px;
            border: 2px solid #000;
            padding: 6px;
          }
          .header-right { vertical-align: top; width: 40%; padding: 8px 4px 8px 10px; }
          .section-box {
            border: 1px solid #000;
            padding: 6px 8px;
            margin-bottom: 6px;
          }
          .items-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
          .items-table th, .items-table td {
            border: 1px solid #000;
            padding: 4px 6px;
            font-size: 9pt;
          }
          .items-table th {
            background: #e8e8e8;
            font-weight: bold;
            text-align: left;
          }
          .items-table .col-qty { width: 90px; text-align: center; }
          .footer-line { border-top: 1px solid #000; margin-top: 60px; padding-top: 4px; text-align: center; font-size: 8pt; }
          .row-flex { display: flex; gap: 16px; margin-bottom: 6px; }
          .field-label { font-weight: bold; font-size: 9pt; }
          .field-value { font-size: 9pt; border-bottom: 1px solid #555; min-width: 80px; display: inline-block; }
        `
      }} />

      <div className="print-area">

        {/* ===== CABECERA ===== */}
        <table className="header-table" style={{ border: '2px solid #000', marginBottom: '6px' }}>
          <tbody>
            <tr>
              {/* Izquierda: datos empresa */}
              <td className="header-left" style={{ borderRight: '2px solid #000' }}>
                <div style={{ fontWeight: 'bold', fontSize: '13pt', marginBottom: '4px' }}>VAL ARG S.R.L.</div>
                <div style={{ fontSize: '8pt', lineHeight: '1.5' }}>
                  <div>CUIT: 30-71537357-9</div>
                  <div>Ing. Responsable</div>
                  <div>14 de Julio 175, C.P: 1427 – C.A.B.A.</div>
                  <div>Tel: +54 11 4551-3343 / 4552-2874</div>
                </div>
              </td>

              {/* Centro: letra R */}
              <td className="header-center" style={{ borderRight: '2px solid #000', width: '70px' }}>
                <div style={{ fontSize: '36pt', fontWeight: 'bold', lineHeight: '1', marginBottom: '4px' }}>R</div>
                <div style={{ fontSize: '7pt' }}>COD. 0991</div>
              </td>

              {/* Derecha: tipo documento + número + fecha */}
              <td className="header-right">
                <div style={{ fontWeight: 'bold', fontSize: '12pt', marginBottom: '4px' }}>REMITO</div>
                <div style={{ fontFamily: 'monospace', fontSize: '11pt', fontWeight: 'bold', marginBottom: '4px' }}>
                  {dn.deliveryNumber}
                </div>
                <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                  <strong>Fecha:</strong> {fechaEmision}
                </div>
                <div style={{ fontSize: '7pt', color: '#333', marginTop: '6px' }}>
                  Documento no válido como factura
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ===== DATOS DEL CLIENTE ===== */}
        <div className="section-box" style={{ marginBottom: '4px' }}>
          <table style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td style={{ width: '60%', verticalAlign: 'top', paddingRight: '10px' }}>
                  <div style={{ fontSize: '9pt', marginBottom: '3px' }}>
                    <span className="field-label">Señor(es): </span>
                    <span style={{ fontSize: '9pt' }}>
                      {dn.customer.businessName || dn.customer.name}
                    </span>
                  </div>
                  <div style={{ fontSize: '9pt', marginBottom: '3px' }}>
                    <span className="field-label">Calle: </span>
                    <span>{dn.customer.address || ''}</span>
                  </div>
                  <div style={{ fontSize: '9pt' }}>
                    <span className="field-label">Localidad: </span>
                    <span>
                      {[dn.customer.city, dn.customer.province].filter(Boolean).join(', ')}
                    </span>
                  </div>
                </td>
                <td style={{ width: '40%', verticalAlign: 'top' }}>
                  {ivaLabel && (
                    <div style={{ fontSize: '9pt', marginBottom: '3px' }}>
                      <span className="field-label">I.V.A.: </span>
                      <span>{ivaLabel}</span>
                    </div>
                  )}
                  {dn.customer.cuit && (
                    <div style={{ fontSize: '9pt', marginBottom: '3px' }}>
                      <span className="field-label">C.U.I.T.: </span>
                      <span style={{ fontFamily: 'monospace' }}>{dn.customer.cuit}</span>
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===== TRANSPORTE + OC ===== */}
        <div className="section-box" style={{ marginBottom: '8px' }}>
          <table style={{ width: '100%' }}>
            <tbody>
              <tr>
                <td style={{ width: '55%', fontSize: '9pt', paddingRight: '8px' }}>
                  <span className="field-label">Transporte: </span>
                  <span>{dn.carrier || ''}</span>
                  {dn.transportAddress && (
                    <span style={{ color: '#555' }}> — {dn.transportAddress}</span>
                  )}
                </td>
                <td style={{ width: '45%', fontSize: '9pt' }}>
                  <span className="field-label">O.C.: </span>
                  <span>{dn.purchaseOrder || ''}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ===== ITEMS ===== */}
        <table className="items-table">
          <thead>
            <tr>
              <th>DETALLE</th>
              <th className="col-qty" style={{ textAlign: 'center' }}>CANTIDAD</th>
            </tr>
          </thead>
          <tbody>
            {dn.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {(item.sku || item.product?.sku) && (
                    <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                      {item.sku || item.product?.sku}
                      {' — '}
                    </span>
                  )}
                  {item.description || item.product?.name || ''}
                </td>
                <td className="col-qty">
                  {Number(item.quantity)} {item.unit || item.product?.unit || 'UN'}
                </td>
              </tr>
            ))}
            {/* Filas vacías para completar espacio */}
            {Array.from({ length: Math.max(0, 8 - dn.items.length) }).map((_, i) => (
              <tr key={`empty-${i}`}>
                <td style={{ height: '20px' }}>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ===== TOTALES: BULTOS + VD ===== */}
        <div style={{ display: 'flex', justifyContent: 'space-between', border: '1px solid #000', padding: '6px 8px', marginBottom: '20px', fontSize: '10pt' }}>
          <div>
            <span className="field-label">BULTOS: </span>
            <span>{dn.bultos ?? ''}</span>
          </div>
          <div>
            <span className="field-label">VD $: </span>
            <span style={{ fontFamily: 'monospace' }}>
              {totalARS != null
                ? totalARS.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : ''}
            </span>
          </div>
        </div>

        {/* ===== OBSERVACIONES ===== */}
        {dn.notes && (
          <div style={{ marginBottom: '16px', fontSize: '8pt', border: '1px solid #ccc', padding: '4px 8px' }}>
            <strong>Obs.: </strong>{dn.notes}
          </div>
        )}

        {/* ===== FIRMAS ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', marginTop: '40px' }}>
          <div className="footer-line">Firma y Aclaración (Entrega)</div>
          <div className="footer-line">Firma y Aclaración (Recepción)</div>
        </div>

        {/* ===== CAI ===== */}
        <div style={{ marginTop: '24px', border: '1px solid #000', padding: '6px 8px', fontSize: '8pt', display: 'flex', gap: '40px' }}>
          <div>
            <span className="field-label">CAI N°: </span>
            <span style={{ display: 'inline-block', minWidth: '160px', borderBottom: '1px solid #555' }}>&nbsp;</span>
          </div>
          <div>
            <span className="field-label">Fecha Vto. CAI: </span>
            <span style={{ display: 'inline-block', minWidth: '100px', borderBottom: '1px solid #555' }}>&nbsp;</span>
          </div>
        </div>

        {/* ===== PIE ===== */}
        <div style={{ marginTop: '12px', textAlign: 'center', fontSize: '7pt', color: '#555', borderTop: '1px solid #ccc', paddingTop: '6px' }}>
          VAL ARG S.R.L. | CUIT: 30-71537357-9 | 14 de Julio 175, C.P: 1427 – C.A.B.A. | Tel: +54 11 4551-3343 / 4552-2874
        </div>

      </div>
    </div>
  )
}
