/**
 * Template de email para envío de remitos
 */

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
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Remito ${data.deliveryNumber}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      background: linear-gradient(135deg, #2563eb 0%, #1e40af 100%);
      color: white;
      padding: 40px 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    .header p {
      margin: 10px 0 0;
      font-size: 16px;
      opacity: 0.9;
    }
    .content {
      padding: 40px 30px;
    }
    .greeting {
      font-size: 18px;
      margin-bottom: 20px;
      color: #333;
    }
    .message {
      background-color: #f0f7ff;
      border-left: 4px solid #2563eb;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .details {
      background-color: #f8f9fa;
      border-radius: 8px;
      padding: 25px;
      margin: 25px 0;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: #666;
      font-size: 14px;
    }
    .detail-value {
      font-weight: 500;
      color: #333;
    }
    .attachment-notice {
      background-color: #ecfdf5;
      border-left: 4px solid #10b981;
      padding: 12px 15px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
    }
    ${data.trackingNumber ? `
    .tracking-notice {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 12px 15px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
    }` : ''}
    .footer {
      background-color: #f8f9fa;
      padding: 25px 30px;
      text-align: center;
      color: #666;
      font-size: 14px;
    }
    .footer p {
      margin: 5px 0;
    }
    @media only screen and (max-width: 600px) {
      .container { margin: 0; border-radius: 0; }
      .content { padding: 30px 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Remito ${data.deliveryNumber}</h1>
      <p>${data.companyName}</p>
    </div>

    <div class="content">
      <p class="greeting">Estimado/a ${data.customerName},</p>

      <p>Le enviamos adjunto el remito correspondiente a su pedido.</p>

      ${data.message ? `
      <div class="message">
        <p style="margin: 0;"><strong>Mensaje:</strong></p>
        <p style="margin: 10px 0 0;">${data.message}</p>
      </div>
      ` : ''}

      <div class="details">
        <div class="detail-row">
          <span class="detail-label">Remito N°:</span>
          <span class="detail-value">${data.deliveryNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Fecha:</span>
          <span class="detail-value">${data.date}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Cantidad de items:</span>
          <span class="detail-value">${data.itemCount}</span>
        </div>
        ${data.deliveryAddress ? `
        <div class="detail-row">
          <span class="detail-label">Dirección de entrega:</span>
          <span class="detail-value">${data.deliveryAddress}</span>
        </div>
        ` : ''}
      </div>

      <div class="attachment-notice">
        <strong>Adjunto:</strong> El remito en formato PDF se encuentra adjunto a este email.
      </div>

      ${data.trackingNumber ? `
      <div class="tracking-notice">
        <strong>Seguimiento:</strong> N° de tracking: ${data.trackingNumber}
      </div>
      ` : ''}

      <p style="font-size: 14px; color: #666; margin-top: 30px;">
        Si tiene alguna consulta sobre esta entrega, no dude en contactarnos.
      </p>
    </div>

    <div class="footer">
      <p><strong>${data.companyName}</strong></p>
      <p>Sistema de Gestión Comercial</p>
      <p style="margin-top: 15px; font-size: 12px; color: #999;">
        Este es un email automático generado por el sistema ERP.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim()
}

export function generateRemitoEmailText(data: RemitoEmailData): string {
  return `
Remito ${data.deliveryNumber} - ${data.companyName}

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
${data.companyName}
Sistema de Gestión Comercial
  `.trim()
}
