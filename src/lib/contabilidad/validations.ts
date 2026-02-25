import { z } from 'zod'

// Validación para crear/editar cuenta contable
export const chartOfAccountSchema = z.object({
  code: z.string()
    .min(1, 'El código es requerido')
    .regex(/^\d+(\.\d+)*$/, 'El código debe tener formato numérico jerárquico (ej: 1.1.01.001)'),
  name: z.string()
    .min(3, 'El nombre debe tener al menos 3 caracteres')
    .max(200, 'El nombre no puede exceder 200 caracteres'),
  accountType: z.enum(['ACTIVO', 'PASIVO', 'PATRIMONIO_NETO', 'INGRESO', 'EGRESO'], {
    errorMap: () => ({ message: 'Tipo de cuenta inválido' }),
  }),
  parentId: z.string().optional().nullable(),
  acceptsEntries: z.boolean().default(true),
})

export type ChartOfAccountInput = z.infer<typeof chartOfAccountSchema>

// Validación para asiento contable
export const journalEntrySchema = z.object({
  date: z.string().or(z.date()),
  description: z.string()
    .min(5, 'La descripción debe tener al menos 5 caracteres')
    .max(500, 'La descripción no puede exceder 500 caracteres'),
  reference: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  lines: z.array(
    z.object({
      accountId: z.string().min(1, 'Debe seleccionar una cuenta'),
      debit: z.number().min(0, 'El debe no puede ser negativo'),
      credit: z.number().min(0, 'El haber no puede ser negativo'),
      description: z.string().optional().nullable(),
    })
  ).min(2, 'Un asiento debe tener al menos 2 líneas'),
}).refine(
  (data) => {
    // Validar partida doble: Debe = Haber
    const totalDebit = data.lines.reduce((sum, line) => sum + line.debit, 0)
    const totalCredit = data.lines.reduce((sum, line) => sum + line.credit, 0)
    return Math.abs(totalDebit - totalCredit) < 0.01 // Tolerancia de centavos
  },
  {
    message: 'El total del Debe debe ser igual al total del Haber (partida doble)',
    path: ['lines'],
  }
).refine(
  (data) => {
    // Validar que cada línea tenga solo debe o haber, no ambos
    return data.lines.every(line => {
      if (line.debit > 0 && line.credit > 0) return false
      if (line.debit === 0 && line.credit === 0) return false
      return true
    })
  },
  {
    message: 'Cada línea debe tener valor en Debe o Haber, no en ambos ni en ninguno',
    path: ['lines'],
  }
)

export type JournalEntryInput = z.infer<typeof journalEntrySchema>

// Utilidades para validar estructura jerárquica
export function calculateLevel(code: string): number {
  return code.split('.').length
}

export function getParentCode(code: string): string | null {
  const parts = code.split('.')
  if (parts.length === 1) return null
  parts.pop()
  return parts.join('.')
}

export function validateHierarchy(code: string, accountType: string, parentType?: string): boolean {
  // Si tiene padre, debe ser del mismo tipo de cuenta
  if (parentType && parentType !== accountType) {
    return false
  }
  return true
}

// Formatear código contable
export function formatAccountCode(code: string): string {
  const parts = code.split('.')
  return parts.map(p => p.padStart(2, '0')).join('.')
}

// Validar que una cuenta pueda aceptar asientos
export function canAcceptEntries(level: number): boolean {
  // Generalmente, solo las cuentas de nivel 3 o 4 aceptan asientos
  return level >= 3
}
