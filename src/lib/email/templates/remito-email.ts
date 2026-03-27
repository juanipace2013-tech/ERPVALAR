/**
 * Template de email para envío de remitos
 * Diseño profesional con tablas (compatible Outlook/Gmail/Apple Mail)
 */

import { VALARG_LOGO_BASE64 } from './logo-base64'

interface RemitoEmailData {
  deliveryNumber: string
  customerName: string
  date: string
  itemCount: number
  deliveryAddress?: string
  companyName: string
  message?: string
  trackingNumber?: string
}

export function generateRemitoEmailHTML(data: RemitoEmailData): string {
  const messageBlock = data.message
    ? `
    <tr>
      <td style="padding: 0 40px 25px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #eff6ff; border-left: 4px solid #2563eb; border-radius: 4px;">
          <tr>
            <td style="padding: 16px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937;">
              <strong style="color: #1e40af;">Mensaje:</strong><br />
              <span style="color: #374151; line-height: 1.6;">${data.message}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    : ''

  const trackingBlock = data.trackingNumber
    ? `
    <tr>
      <td style="padding: 0 40px 25px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
          <tr>
            <td style="padding: 12px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #92400e;">
              <strong>Seguimiento:</strong> N° de tracking: ${data.trackingNumber}
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    : ''

  const deliveryAddressRow = data.deliveryAddress
    ? `
                <tr>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6b7280; width: 50%;">
                    Dirección de entrega
                  </td>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; font-weight: 600; text-align: right;">
                    ${data.deliveryAddress}
                  </td>
                </tr>`
    : ''

  return `
<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Remito ${data.deliveryNumber} - VAL ARG</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: Arial, Helvetica, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 30px 10px;">

        <!-- Main container 600px -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

          <!-- ═══ HEADER ═══ -->
          <tr>
            <td align="center" bgcolor="#1a365d" style="background-color: #1a365d; padding: 30px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <img src="${VALARG_LOGO_BASE64}" alt="VAL ARG" width="160" style="display: block; max-width: 160px; height: auto; border: 0;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-family: Arial, Helvetica, sans-serif; font-size: 22px; font-weight: bold; color: #ffffff; letter-spacing: 0.5px;">
                    VAL ARG S.R.L.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #bfdbfe; padding-top: 6px;">
                    Remito N° ${data.deliveryNumber}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══ GREETING ═══ -->
          <tr>
            <td style="padding: 35px 40px 10px 40px; font-family: Arial, Helvetica, sans-serif; font-size: 17px; color: #1f2937; line-height: 1.5;">
              Estimado/a <strong>${data.customerName}</strong>,
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 20px 40px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #4b5563; line-height: 1.6;">
              Le enviamos adjunto el remito correspondiente a su pedido.
            </td>
          </tr>

          <!-- ═══ MESSAGE (optional) ═══ -->
          ${messageBlock}

          <!-- ═══ DETAILS TABLE ═══ -->
          <tr>
            <td style="padding: 0 40px 25px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb;">
                <!-- Row: Remito N° -->
                <tr>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb; width: 50%;">
                    Remito N°
                  </td>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; font-weight: 600; border-bottom: 1px solid #e5e7eb; text-align: right;">
                    ${data.deliveryNumber}
                  </td>
                </tr>
                <!-- Row: Fecha -->
                <tr>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6b7280; border-bottom: 1px solid #e5e7eb;">
                    Fecha
                  </td>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; font-weight: 600; border-bottom: 1px solid #e5e7eb; text-align: right;">
                    ${data.date}
                  </td>
                </tr>
                <!-- Row: Items -->
                <tr>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #6b7280;${data.deliveryAddress ? ' border-bottom: 1px solid #e5e7eb;' : ''}">
                    Cantidad de items
                  </td>
                  <td style="padding: 14px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; font-weight: 600; text-align: right;${data.deliveryAddress ? ' border-bottom: 1px solid #e5e7eb;' : ''}">
                    ${data.itemCount}
                  </td>
                </tr>
                <!-- Row: Dirección (optional) -->
                ${deliveryAddressRow}
              </table>
            </td>
          </tr>

          <!-- ═══ ATTACHMENT NOTICE ═══ -->
          <tr>
            <td style="padding: 0 40px 25px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #ecfdf5; border-left: 4px solid #10b981; border-radius: 4px;">
                <tr>
                  <td style="padding: 12px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #065f46;">
                    <strong>Adjunto:</strong> El remito en formato PDF se encuentra adjunto a este email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══ TRACKING (optional) ═══ -->
          ${trackingBlock}

          <!-- ═══ DIVIDER ═══ -->
          <tr>
            <td style="padding: 0 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="border-top: 1px solid #e5e7eb; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══ CONTACT NOTE ═══ -->
          <tr>
            <td style="padding: 20px 40px 25px 40px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #6b7280; line-height: 1.5;">
              Si tiene alguna consulta sobre esta entrega, no dude en contactarnos a los datos indicados abajo.
            </td>
          </tr>

          <!-- ═══ FOOTER ═══ -->
          <tr>
            <td bgcolor="#1a365d" style="background-color: #1a365d; padding: 28px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; color: #ffffff; padding-bottom: 8px;">
                    VAL ARG S.R.L.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #bfdbfe; line-height: 1.8;">
                    14 de Julio 175, C.P: 1427 – C.A.B.A.<br />
                    Tel: +54 11 4551-3343 / 4552-2874<br />
                    <a href="mailto:ventas@val-ar.com.ar" style="color: #93c5fd; text-decoration: none;">ventas@val-ar.com.ar</a>
                    &nbsp;|&nbsp;
                    <a href="https://www.val-ar.com.ar" style="color: #93c5fd; text-decoration: none;">www.val-ar.com.ar</a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #64748b; padding-top: 16px;">
                    Este es un email generado automáticamente por el sistema de gestión de VAL ARG.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Main container -->

      </td>
    </tr>
  </table>

</body>
</html>
  `.trim()
}

export function generateRemitoEmailText(data: RemitoEmailData): string {
  return `
REMITO ${data.deliveryNumber} - VAL ARG S.R.L.
${'='.repeat(50)}

Estimado/a ${data.customerName},

Le enviamos adjunto el remito correspondiente a su pedido.

${data.message ? `Mensaje:\n${data.message}\n` : ''}
Detalles:
- Remito N°: ${data.deliveryNumber}
- Fecha: ${data.date}
- Cantidad de items: ${data.itemCount}
${data.deliveryAddress ? `- Dirección de entrega: ${data.deliveryAddress}` : ''}
${data.trackingNumber ? `- N° de tracking: ${data.trackingNumber}` : ''}

El remito en formato PDF se encuentra adjunto a este email.

Si tiene alguna consulta sobre esta entrega, no dude en contactarnos.

---
VAL ARG S.R.L.
14 de Julio 175, C.P: 1427 – C.A.B.A.
Tel: +54 11 4551-3343 / 4552-2874
ventas@val-ar.com.ar | www.val-ar.com.ar
  `.trim()
}
