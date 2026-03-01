/**
 * Función para enviar emails de cotizaciones
 */

import { randomBytes } from 'crypto';
import { resend, emailConfig } from './resend';
import { generateQuoteEmailHTML, generateQuoteEmailText } from './templates/quote-email';
import { prisma } from '@/lib/prisma';

interface SendQuoteEmailOptions {
  quoteId: string;
  recipientEmail: string;
  message?: string;
}

/**
 * Envía una cotización por email al cliente
 */
export async function sendQuoteEmail(options: SendQuoteEmailOptions) {
  const { quoteId, recipientEmail, message } = options;

  // Buscar cotización con datos completos
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      salesPerson: true,
      items: {
        include: {
          product: true
        }
      }
    }
  });

  if (!quote) {
    throw new Error('Cotización no encontrada');
  }

  // Generar token único para acceso público
  const publicToken = await generatePublicToken(quoteId);

  // URLs públicas
  const viewUrl = `${emailConfig.appUrl}/public/quotes/${publicToken}`;
  const acceptUrl = `${emailConfig.appUrl}/public/quotes/${publicToken}/accept`;
  const rejectUrl = `${emailConfig.appUrl}/public/quotes/${publicToken}/reject`;

  // Formatear datos para el template
  const currencySymbol = quote.currency === 'USD' ? 'USD' : 'ARS';
  const formattedTotal = `${currencySymbol} ${Number(quote.total).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  const formattedValidUntil = quote.validUntil
    ? new Date(quote.validUntil).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      })
    : 'No especificada';

  const emailData = {
    quoteNumber: quote.quoteNumber,
    customerName: quote.customer.name,
    total: formattedTotal,
    validUntil: formattedValidUntil,
    viewUrl,
    acceptUrl,
    rejectUrl,
    companyName: 'Valarg',
    message
  };

  // Generar HTML y texto plano
  const htmlContent = generateQuoteEmailHTML(emailData);
  const textContent = generateQuoteEmailText(emailData);

  // Enviar email
  try {
    const result = await resend.emails.send({
      from: emailConfig.from,
      to: recipientEmail,
      subject: `Nueva Cotización ${quote.quoteNumber} - Valarg`,
      html: htmlContent,
      text: textContent,
      tags: [
        {
          name: 'category',
          value: 'quote'
        },
        {
          name: 'quote_id',
          value: quoteId
        }
      ]
    });

    // Registrar envío en la base de datos
    await prisma.quoteEmailLog.create({
      data: {
        quoteId,
        recipientEmail,
        subject: `Nueva Cotización ${quote.quoteNumber} - Valarg`,
        status: 'sent',
        emailId: result.data?.id || null,
        publicToken
      }
    });

    return {
      success: true,
      emailId: result.data?.id,
      publicToken,
      viewUrl
    };
  } catch (error) {
    console.error('Error enviando email:', error);

    // Registrar error
    await prisma.quoteEmailLog.create({
      data: {
        quoteId,
        recipientEmail,
        subject: `Nueva Cotización ${quote.quoteNumber} - Valarg`,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Error desconocido'
      }
    });

    throw new Error(`Error al enviar email: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}

/**
 * Genera un token único para acceso público a la cotización
 */
async function generatePublicToken(quoteId: string): Promise<string> {
  // Generar token único
  const token = generateRandomToken();

  // Guardar en base de datos
  await prisma.quotePublicToken.upsert({
    where: { quoteId },
    update: {
      token,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 días
    },
    create: {
      quoteId,
      token,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 días
    }
  });

  return token;
}

/**
 * Genera un token aleatorio criptográficamente seguro
 */
function generateRandomToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Verifica si un token es válido
 */
export async function verifyPublicToken(token: string) {
  const tokenData = await prisma.quotePublicToken.findUnique({
    where: { token },
    include: {
      quote: {
        include: {
          customer: true,
          salesPerson: true,
          items: {
            include: {
              product: true
            }
          }
        }
      }
    }
  });

  if (!tokenData) {
    throw new Error('Token inválido');
  }

  if (tokenData.expiresAt < new Date()) {
    throw new Error('Token expirado');
  }

  return tokenData.quote;
}
