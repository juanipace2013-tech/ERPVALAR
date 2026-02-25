/**
 * Configuración de Resend para envío de emails
 */

import { Resend } from 'resend';

if (!process.env.RESEND_API_KEY) {
  console.warn('⚠️  RESEND_API_KEY no está configurada. Los emails no se enviarán.');
}

export const resend = new Resend(process.env.RESEND_API_KEY || '');

export const emailConfig = {
  from: process.env.EMAIL_FROM || 'CRM Valarg <noreply@valarg.com>',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
};
