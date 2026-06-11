'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  BookOpen,
  Loader2,
  Banknote,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WithholdingLine {
  id: string
  withholdingType: string
  jurisdictionLabel: string | null
  certificateNumber: string | null
  amount: number
}

interface WithholdingGroup {
  id: string
  groupType: 'IIBB' | 'IVA' | 'SUSS' | 'GANANCIAS'
  lines: WithholdingLine[]
}

interface InvoiceApplication {
  id: string
  appliedAmount: number
  invoice: {
    id: string
    invoiceNumber: string
    invoiceType: string
    total: number
    paidAmount: number
    currency: string
    issueDate: string
    dueDate: string | null
  }
}

interface PaymentMethod {
  id: string
  paymentType: string
  amount: number
  checkNumber: string | null
  checkDate: string | null
  checkBank: string | null
  reference: string | null
  notes: string | null
  treasuryAccount: {
    id: string
    name: string
    chartOfAccount: {
      id: string
      code: string
      name: string
    }
  }
}

interface Receipt {
  id: string
  receiptNumber: string
  status: string
  date: string
  description: string | null
  totalApplied: number
  totalWithholdings: number
  totalCobrado: number
  customer: {
    id: string
    name: string
    cuit: string
    taxCondition: string
  }
  user: {
    id: string
    name: string
  }
  invoiceApplications: InvoiceApplication[]
  withholdingGroups: WithholdingGroup[]
  paymentMethods: PaymentMethod[]
  journalEntry: {
    id: string
    entryNumber: number
    status: string
  } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  BORRADOR: 'Borrador',
  APROBADO: 'Aprobado',
  ANULADO: 'Anulado',
}

const STATUS_COLORS: Record<string, string> = {
  BORRADOR: 'bg-gray-100 text-gray-800',
  APROBADO: 'bg-green-100 text-green-800',
  ANULADO: 'bg-red-100 text-red-800',
}

const STATUS_ICONS: Record<string, LucideIcon> = {
  BORRADOR: Clock,
  APROBADO: CheckCircle2,
  ANULADO: XCircle,
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  TRANSFERENCIA: 'Transferencia',
  CHEQUE: 'Cheque',
  EFECTIVO: 'Efectivo',
  DEPOSITO: 'Depósito',
  OTROS: 'Otros',
}

const WITHHOLDING_GROUP_LABELS: Record<string, string> = {
  IIBB: 'Ingresos Brutos (IIBB)',
  IVA: 'IVA',
  SUSS: 'SUSS',
  GANANCIAS: 'Ganancias',
}

const INVOICE_TYPE_LABELS: Record<string, string> = {
  A: 'Factura A',
  B: 'Factura B',
  C: 'Factura C',
  E: 'Factura E',
  CREDIT_NOTE_A: 'NC A',
  CREDIT_NOTE_B: 'NC B',
  CREDIT_NOTE_C: 'NC C',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatARS = (amount: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(amount)

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

// ─── Component ────────────────────────────────────────────────────────────────

export default function CobroDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)

  useEffect(() => {
    if (id) {
      fetchReceipt()
    }
  }, [id])

  const fetchReceipt = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/cobros/${id}`)

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Error al cargar recibo')
      }

      const data = await response.json()
      setReceipt(data.receipt)
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al cargar recibo')
      router.push('/cobros')
    } finally {
      setLoading(false)
    }
  }

  const handleAprobar = async () => {
    if (!confirm('¿Aprobar este recibo? Se generará un asiento contable y no podrá modificarse.')) {
      return
    }

    try {
      setApproving(true)
      const response = await fetch(`/api/cobros/${id}/aprobar`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al aprobar recibo')
      }

      toast.success(
        `Recibo aprobado. Asiento contable #${data.journalEntry.entryNumber} generado.`
      )
      router.push('/cobros')
    } catch (error: any) {
      console.error('Error:', error)
      toast.error(error.message || 'Error al aprobar recibo')
    } finally {
      setApproving(false)
    }
  }

  // ─── Loading / not found states ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!receipt) {
    return null
  }

  const StatusIcon = STATUS_ICONS[receipt.status] ?? Banknote

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/cobros">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                Recibo {receipt.receiptNumber}
              </h1>
              <Badge className={STATUS_COLORS[receipt.status]}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {STATUS_LABELS[receipt.status] ?? receipt.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              {formatDate(receipt.date)}
              {receipt.user?.name && (
                <span className="ml-2 text-xs">· Registrado por {receipt.user.name}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {receipt.status === 'APROBADO' && receipt.journalEntry && (
            <Link href={`/contabilidad/asientos/${receipt.journalEntry.id}`}>
              <Button variant="outline">
                <BookOpen className="mr-2 h-4 w-4" />
                Ver Asiento #{receipt.journalEntry.entryNumber}
              </Button>
            </Link>
          )}
          {receipt.status === 'BORRADOR' && (
            <Button onClick={handleAprobar} disabled={approving}>
              {approving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aprobando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Aprobar Recibo
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* ── Info row ───────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">Cliente</p>
              <p className="font-semibold">{receipt.customer.name}</p>
              <p className="text-xs text-muted-foreground font-mono">{receipt.customer.cuit}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Fecha</p>
              <p className="font-semibold">{formatDate(receipt.date)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Descripción</p>
              <p className="font-semibold">{receipt.description || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Facturas Aplicadas ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Facturas Aplicadas</CardTitle>
          <CardDescription>
            {receipt.invoiceApplications.length}{' '}
            {receipt.invoiceApplications.length === 1 ? 'factura' : 'facturas'} incluidas en este recibo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nro. Factura</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Importe Total</TableHead>
                  <TableHead className="text-right">Monto Aplicado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.invoiceApplications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      Sin facturas aplicadas
                    </TableCell>
                  </TableRow>
                ) : (
                  receipt.invoiceApplications.map((app) => (
                    <TableRow key={app.id}>
                      <TableCell className="font-mono font-semibold">
                        {app.invoice.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {INVOICE_TYPE_LABELS[app.invoice.invoiceType] ?? app.invoice.invoiceType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatARS(Number(app.invoice.total))}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatARS(Number(app.appliedAmount))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Retenciones ────────────────────────────────────────────────────── */}
      {receipt.withholdingGroups.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Retenciones</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {receipt.withholdingGroups.map((group) => {
              const groupTotal = group.lines.reduce(
                (sum, line) => sum + Number(line.amount),
                0
              )
              return (
                <Card key={group.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {WITHHOLDING_GROUP_LABELS[group.groupType] ?? group.groupType}
                      </CardTitle>
                      <span className="text-sm font-semibold text-muted-foreground">
                        {formatARS(groupTotal)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {group.lines.map((line) => (
                        <div
                          key={line.id}
                          className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0"
                        >
                          <div>
                            <span className="font-medium">{line.withholdingType}</span>
                            {line.jurisdictionLabel && (
                              <span className="text-muted-foreground ml-1">
                                — {line.jurisdictionLabel}
                              </span>
                            )}
                            {line.certificateNumber && (
                              <div className="text-xs text-muted-foreground font-mono">
                                Cert. {line.certificateNumber}
                              </div>
                            )}
                          </div>
                          <span className="font-semibold tabular-nums">
                            {formatARS(Number(line.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Medios de Cobro ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Medios de Cobro</CardTitle>
          <CardDescription>
            {receipt.paymentMethods.length}{' '}
            {receipt.paymentMethods.length === 1 ? 'medio de cobro' : 'medios de cobro'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuenta Tesorería</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Importe</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.paymentMethods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      Sin medios de cobro registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  receipt.paymentMethods.map((pm) => (
                    <TableRow key={pm.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{pm.treasuryAccount.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {pm.treasuryAccount.chartOfAccount.code}{' '}
                            {pm.treasuryAccount.chartOfAccount.name}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {PAYMENT_TYPE_LABELS[pm.paymentType] ?? pm.paymentType}
                        </Badge>
                        {pm.paymentType === 'CHEQUE' && pm.checkNumber && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Ch. {pm.checkNumber}
                            {pm.checkBank && ` · ${pm.checkBank}`}
                            {pm.checkDate && ` · ${formatDate(pm.checkDate)}`}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatARS(Number(pm.amount))}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {pm.reference || pm.notes || '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Totales ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Totales</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-w-sm ml-auto">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Aplicado</span>
              <span className="font-medium tabular-nums">
                {formatARS(Number(receipt.totalApplied))}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total Retenciones</span>
              <span className="font-medium tabular-nums">
                {formatARS(Number(receipt.totalWithholdings))}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total a Cobrar</span>
              <span className="font-medium tabular-nums">
                {formatARS(Number(receipt.totalApplied) - Number(receipt.totalWithholdings))}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total Cobrado</span>
              <span className="text-xl font-bold tabular-nums">
                {formatARS(Number(receipt.totalCobrado))}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
