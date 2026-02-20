/**
 * Template de email para envío de cotizaciones
 */

interface QuoteEmailData {
  quoteNumber: string;
  customerName: string;
  total: string;
  validUntil: string;
  viewUrl: string;
  acceptUrl: string;
  rejectUrl: string;
  companyName: string;
  message?: string;
}

export function generateQuoteEmailHTML(data: QuoteEmailData): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nueva Cotización - ${data.quoteNumber}</title>
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
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
      background-color: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .quote-details {
      background-color: #f8f9fa;
      border-radius: 8px;
      padding: 25px;
      margin: 25px 0;
    }
    .quote-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e0e0e0;
    }
    .quote-row:last-child {
      border-bottom: none;
      font-weight: 600;
      font-size: 18px;
      color: #667eea;
      padding-top: 15px;
      margin-top: 5px;
      border-top: 2px solid #667eea;
    }
    .quote-label {
      color: #666;
    }
    .quote-value {
      font-weight: 500;
      color: #333;
    }
    .actions {
      text-align: center;
      margin: 35px 0;
    }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      margin: 8px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s ease;
    }
    .btn-primary {
      background-color: #10b981;
      color: white;
    }
    .btn-primary:hover {
      background-color: #059669;
    }
    .btn-secondary {
      background-color: #ef4444;
      color: white;
    }
    .btn-secondary:hover {
      background-color: #dc2626;
    }
    .btn-outline {
      background-color: transparent;
      color: #667eea;
      border: 2px solid #667eea;
    }
    .btn-outline:hover {
      background-color: #667eea;
      color: white;
    }
    .divider {
      height: 1px;
      background-color: #e0e0e0;
      margin: 30px 0;
    }
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
    .footer-links {
      margin-top: 15px;
    }
    .footer-links a {
      color: #667eea;
      text-decoration: none;
      margin: 0 10px;
    }
    .validity-notice {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 12px 15px;
      margin: 20px 0;
      border-radius: 4px;
      font-size: 14px;
    }
    @media only screen and (max-width: 600px) {
      .container {
        margin: 0;
        border-radius: 0;
      }
      .content {
        padding: 30px 20px;
      }
      .btn {
        display: block;
        margin: 10px 0;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>📋 Nueva Cotización</h1>
      <p>${data.companyName}</p>
    </div>

    <!-- Content -->
    <div class="content">
      <p class="greeting">Estimado/a ${data.customerName},</p>

      <p>Nos complace enviarle la siguiente cotización para su revisión:</p>

      ${data.message ? `
      <div class="message">
        <p style="margin: 0;"><strong>Mensaje del vendedor:</strong></p>
        <p style="margin: 10px 0 0;">${data.message}</p>
      </div>
      ` : ''}

      <!-- Quote Details -->
      <div class="quote-details">
        <div class="quote-row">
          <span class="quote-label">Número de Cotización:</span>
          <span class="quote-value">${data.quoteNumber}</span>
        </div>
        <div class="quote-row">
          <span class="quote-label">Válida hasta:</span>
          <span class="quote-value">${data.validUntil}</span>
        </div>
        <div class="quote-row">
          <span class="quote-label">Total:</span>
          <span class="quote-value">${data.total}</span>
        </div>
      </div>

      <!-- Validity Notice -->
      <div class="validity-notice">
        ⏰ <strong>Importante:</strong> Esta cotización es válida hasta el ${data.validUntil}
      </div>

      <!-- Actions -->
      <div class="actions">
        <p style="margin-bottom: 20px; font-size: 16px;">¿Qué desea hacer con esta cotización?</p>

        <a href="${data.acceptUrl}" class="btn btn-primary">
          ✅ Aceptar Cotización
        </a>

        <a href="${data.rejectUrl}" class="btn btn-secondary">
          ❌ Rechazar Cotización
        </a>

        <div style="margin-top: 20px;">
          <a href="${data.viewUrl}" class="btn btn-outline">
            👁️ Ver Cotización Completa
          </a>
        </div>
      </div>

      <div class="divider"></div>

      <p style="font-size: 14px; color: #666;">
        Si tiene alguna pregunta o necesita aclaraciones, no dude en contactarnos respondiendo a este email.
      </p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p><strong>${data.companyName}</strong></p>
      <p>Sistema de Gestión Comercial</p>
      <div class="footer-links">
        <a href="${data.viewUrl}">Ver Cotización</a>
        <span style="color: #ccc;">•</span>
        <a href="mailto:ventas@valarg.com">Contacto</a>
      </div>
      <p style="margin-top: 15px; font-size: 12px; color: #999;">
        Este es un email automático, por favor no responder.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export function generateQuoteEmailText(data: QuoteEmailData): string {
  return `
Nueva Cotización - ${data.quoteNumber}

Estimado/a ${data.customerName},

Nos complace enviarle la siguiente cotización para su revisión:

${data.message ? `Mensaje del vendedor:\n${data.message}\n\n` : ''}

Detalles de la Cotización:
- Número: ${data.quoteNumber}
- Válida hasta: ${data.validUntil}
- Total: ${data.total}

Para aceptar esta cotización:
${data.acceptUrl}

Para rechazar esta cotización:
${data.rejectUrl}

Ver cotización completa:
${data.viewUrl}

IMPORTANTE: Esta cotización es válida hasta el ${data.validUntil}

Si tiene alguna pregunta o necesita aclaraciones, no dude en contactarnos.

---
${data.companyName}
Sistema de Gestión Comercial
  `.trim();
}
