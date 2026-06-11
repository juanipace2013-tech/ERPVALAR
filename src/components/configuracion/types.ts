/**
 * Shape del CompanySettings que devuelve GET /api/configuracion
 * (model CompanySettings de Prisma serializado por JSON).
 * Compartido entre la página de configuración y sus tabs.
 */
export interface CompanySettings {
  id: string

  // Datos generales
  name: string
  legalName: string
  address: string
  city: string
  province: string
  postalCode: string
  country: string
  phone: string
  email: string
  cbu: string | null
  taxId: string
  iibbNumber: string | null

  // Logo
  logoUrl: string | null
  logoWidth: number | null
  logoHeight: number | null

  // Datos impositivos
  taxCondition: string
  fiscalDebitAccount: string | null
  fiscalCreditAccount: string | null

  // Agentes de retención
  isWithholdingAgent: boolean
  withholdingGananciasAccount: string | null
  withholdingIIBB: boolean
  withholdingIIBBAccount: string | null
  withholdingIVA: boolean
  withholdingIVAAccount: string | null
  withholdingARBA: boolean
  autoCalculateAGIP: boolean

  // Retenciones sufridas
  retentionGananciasAccount: string | null
  retentionIVAAccount: string | null
  retentionSUSSAccount: string | null

  // Percepciones sufridas
  perceptionIVAAccount: string | null

  // Clientes/Proveedores
  customerDefaultAccount: string | null
  customerAdvanceAccount: string | null
  customerInterestAccount: string | null
  customerDiscountAccount: string | null
  customerExchangeAccount: string | null

  supplierDefaultAccount: string | null
  supplierAdvanceAccount: string | null
  supplierInterestAccount: string | null
  supplierDiscountAccount: string | null
  supplierExchangeAccount: string | null

  // Avisos de vencimiento
  invoiceReminder1Enabled: boolean
  invoiceReminder1Days: number
  invoiceReminder1Before: boolean
  invoiceReminder2Enabled: boolean
  invoiceReminder2Days: number
  invoiceReminder2Before: boolean
  invoiceReminder3Enabled: boolean
  invoiceReminder3Days: number
  invoiceReminder3Before: boolean

  autoSendReceipts: boolean
  autoSendPaymentOrders: boolean

  // Tesorería
  valuesToDepositAccount: string | null
  deferredChecksAccount: string | null
}
