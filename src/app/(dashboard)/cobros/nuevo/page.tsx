'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Banknote,
  FileText,
  ShieldCheck,
  CreditCard,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { IIBB_JURISDICTIONS } from '@/lib/cobros/withholding-account-mapping'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Customer {
  id: string
  name: string
  businessName: string
  cuit: string
  taxCondition: string
}

interface PendingInvoice {
  id: string
  invoiceNumber: string
  invoiceType: string
  issueDate: string
  dueDate: string
  total: number
  paidAmount: number
  remainingBalance: number
  currency: string
  status: string
}

interface InvoiceApplication {
  invoiceId: string
  invoiceNumber: string
  invoiceType: string
  invoiceTotal: number
  remainingBalance: number
  appliedAmount: number
}

interface IIBBLine {
  id: string
  withholdingType: string
  jurisdictionLabel?: string
  certificateNumber: string
  amount: number | string
}

interface OtherWithholding {
  certificateNumber: string
  amount: number | string
}

interface OtherWithholdings {
  IVA: OtherWithholding
  SUSS: OtherWithholding
  GANANCIAS: OtherWithholding
}

interface PaymentMethodLine {
  id: string
  treasuryAccountId: string
  paymentType: string
  amount: number | string
  checkNumber?: string
  checkDate?: string
  checkBank?: string
  reference?: string
}

interface TreasuryAccount {
  id: string
  name: string
  type: string
  bankName: string | null
  accountNumber: string | null
  isActive: boolean
  chartOfAccount: {
    id: string
    code: string
    name: string
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatAmount = (amount: number) =>
  new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)

const formatARS = (amount: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(amount)

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('es-AR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

const generateId = () => Math.random().toString(36).slice(2, 10)

const today = new Date().toISOString().split('T')[0]

const statusColors: Record<string, string> = {
  AUTHORIZED: 'bg-green-100 text-green-800',
  SENT: 'bg-blue-100 text-blue-800',
  OVERDUE: 'bg-red-100 text-red-800',
}

const statusLabels: Record<string, string> = {
  AUTHORIZED: 'Autorizada',
  SENT: 'Enviada',
  OVERDUE: 'Vencida',
}

const PAYMENT_TYPES = [
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'EFECTIVO',      label: 'Efectivo' },
  { value: 'DEPOSITO',      label: 'Depósito' },
  { value: 'OTROS',         label: 'Otros' },
] as const

// ─── Component ───────────────────────────────────────────────────────────────

export default function NuevoCobrosPage() {
  const router = useRouter()

  // ── Loading / saving states ──────────────────────────────────────────────
  const [savingDraft,    setSavingDraft]    = useState(false)
  const [savingApprove,  setSavingApprove]  = useState(false)
  const [loadingCustomers,   setLoadingCustomers]   = useState(true)
  const [loadingInvoices,    setLoadingInvoices]    = useState(false)
  const [loadingAccounts,    setLoadingAccounts]    = useState(true)

  // ── Master data ──────────────────────────────────────────────────────────
  const [allCustomers,     setAllCustomers]     = useState<Customer[]>([])
  const [customerSearch,   setCustomerSearch]   = useState('')
  const [pendingInvoices,  setPendingInvoices]  = useState<PendingInvoice[]>([])
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([])

  // ── Section 1 – Header ───────────────────────────────────────────────────
  const [customerId,   setCustomerId]   = useState('')
  const [date,         setDate]         = useState(today)
  const [description,  setDescription]  = useState('')

  // ── Section 2 – Invoice applications ────────────────────────────────────
  const [invoiceApplications, setInvoiceApplications] = useState<InvoiceApplication[]>([])

  // ── Section 3 – IIBB withholdings ───────────────────────────────────────
  const [iibbLines, setIibbLines] = useState<IIBBLine[]>([])

  // ── Section 3 – Other withholdings ──────────────────────────────────────
  const [otherWithholdings, setOtherWithholdings] = useState<OtherWithholdings>({
    IVA:       { certificateNumber: '', amount: '' },
    SUSS:      { certificateNumber: '', amount: '' },
    GANANCIAS: { certificateNumber: '', amount: '' },
  })

  // ── Section 4 – Payment methods ─────────────────────────────────────────
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodLine[]>([])

  // ── Computed totals ──────────────────────────────────────────────────────
  const totalApplied = invoiceApplications.reduce(
    (sum, a) => sum + Number(a.appliedAmount),
    0,
  )

  const totalIIBB = iibbLines.reduce(
    (sum, l) => sum + (Number(l.amount) || 0),
    0,
  )

  const totalOther =
    (Number(otherWithholdings.IVA.amount)       || 0) +
    (Number(otherWithholdings.SUSS.amount)      || 0) +
    (Number(otherWithholdings.GANANCIAS.amount) || 0)

  const totalWithholdings = totalIIBB + totalOther

  const totalToCobrar = totalApplied - totalWithholdings

  const totalCobrado = paymentMethods.reduce(
    (sum, pm) => sum + (Number(pm.amount) || 0),
    0,
  )

  const diferencia = totalToCobrar - totalCobrado

  const diferenciaOk = Math.abs(diferencia) < 0.01

  // ── Filtered customer list for the combobox ──────────────────────────────
  const filteredCustomers = customerSearch.trim().length === 0
    ? allCustomers
    : allCustomers.filter((c) => {
        const q = customerSearch.toLowerCase()
        return (
          c.name.toLowerCase().includes(q) ||
          (c.businessName ?? '').toLowerCase().includes(q) ||
          (c.cuit ?? '').includes(q)
        )
      })

  const selectedCustomer = allCustomers.find((c) => c.id === customerId) ?? null

  // ── Fetch master data on mount ───────────────────────────────────────────
  useEffect(() => {
    const fetchCustomers = async () => {
      try {
        setLoadingCustomers(true)
        const res = await fetch('/api/clientes?limit=100&status=ACTIVE')
        if (!res.ok) throw new Error('Error al cargar clientes')
        const data = await res.json()
        setAllCustomers(data.customers ?? [])
      } catch (err) {
        console.error(err)
        toast.error('No se pudo cargar la lista de clientes')
      } finally {
        setLoadingCustomers(false)
      }
    }

    const fetchAccounts = async () => {
      try {
        setLoadingAccounts(true)
        const res = await fetch('/api/tesoreria/cuentas?active=true')
        if (!res.ok) throw new Error('Error al cargar cuentas')
        const data = await res.json()
        setTreasuryAccounts(data.accounts ?? [])
      } catch (err) {
        console.error(err)
        toast.error('No se pudo cargar las cuentas de tesorería')
      } finally {
        setLoadingAccounts(false)
      }
    }

    fetchCustomers()
    fetchAccounts()
  }, [])

  // ── Fetch pending invoices when customer changes ─────────────────────────
  const fetchPendingInvoices = useCallback(async (cId: string) => {
    if (!cId) {
      setPendingInvoices([])
      return
    }
    try {
      setLoadingInvoices(true)
      const res = await fetch(`/api/cobros/facturas-pendientes?customerId=${cId}`)
      if (!res.ok) throw new Error('Error al cargar facturas pendientes')
      const data = await res.json()
      setPendingInvoices(data.invoices ?? [])
    } catch (err) {
      console.error(err)
      toast.error('No se pudieron cargar las facturas pendientes')
      setPendingInvoices([])
    } finally {
      setLoadingInvoices(false)
    }
  }, [])

  const handleCustomerChange = (newCustomerId: string) => {
    setCustomerId(newCustomerId)
    setInvoiceApplications([])
    fetchPendingInvoices(newCustomerId)
  }

  // ── Invoice application handlers ─────────────────────────────────────────
  const isInvoiceChecked = (invoiceId: string) =>
    invoiceApplications.some((a) => a.invoiceId === invoiceId)

  const handleInvoiceCheck = (invoice: PendingInvoice, checked: boolean) => {
    if (checked) {
      setInvoiceApplications((prev) => [
        ...prev,
        {
          invoiceId:        invoice.id,
          invoiceNumber:    invoice.invoiceNumber,
          invoiceType:      invoice.invoiceType,
          invoiceTotal:     invoice.total,
          remainingBalance: invoice.remainingBalance,
          appliedAmount:    invoice.remainingBalance,
        },
      ])
    } else {
      setInvoiceApplications((prev) =>
        prev.filter((a) => a.invoiceId !== invoice.id),
      )
    }
  }

  const handleAppliedAmountChange = (invoiceId: string, value: string) => {
    const invoice = pendingInvoices.find((i) => i.id === invoiceId)
    if (!invoice) return
    const num = parseFloat(value) || 0
    const clamped = Math.min(Math.max(num, 0.01), invoice.remainingBalance)
    setInvoiceApplications((prev) =>
      prev.map((a) =>
        a.invoiceId === invoiceId ? { ...a, appliedAmount: clamped } : a,
      ),
    )
  }

  // ── IIBB line handlers ───────────────────────────────────────────────────
  const addIIBBLine = () => {
    setIibbLines((prev) => [
      ...prev,
      {
        id:                generateId(),
        withholdingType:   IIBB_JURISDICTIONS[0].value,
        jurisdictionLabel: IIBB_JURISDICTIONS[0].label,
        certificateNumber: '',
        amount:            '',
      },
    ])
  }

  const updateIIBBLine = <K extends keyof IIBBLine>(
    id: string,
    field: K,
    value: IIBBLine[K],
  ) => {
    setIibbLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        if (field === 'withholdingType') {
          const jur = IIBB_JURISDICTIONS.find((j) => j.value === value)
          return { ...l, withholdingType: value as string, jurisdictionLabel: jur?.label ?? '' }
        }
        return { ...l, [field]: value }
      }),
    )
  }

  const removeIIBBLine = (id: string) => {
    setIibbLines((prev) => prev.filter((l) => l.id !== id))
  }

  // ── Other withholding handlers ───────────────────────────────────────────
  const updateOtherWithholding = (
    type: keyof OtherWithholdings,
    field: keyof OtherWithholding,
    value: string,
  ) => {
    setOtherWithholdings((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }))
  }

  // ── Payment method handlers ──────────────────────────────────────────────
  const addPaymentMethod = () => {
    setPaymentMethods((prev) => [
      ...prev,
      {
        id:                generateId(),
        treasuryAccountId: '',
        paymentType:       'TRANSFERENCIA',
        amount:            '',
      },
    ])
  }

  const updatePaymentMethod = <K extends keyof PaymentMethodLine>(
    id: string,
    field: K,
    value: PaymentMethodLine[K],
  ) => {
    setPaymentMethods((prev) =>
      prev.map((pm) => (pm.id === id ? { ...pm, [field]: value } : pm)),
    )
  }

  const removePaymentMethod = (id: string) => {
    setPaymentMethods((prev) => prev.filter((pm) => pm.id !== id))
  }

  // ── Build payload ────────────────────────────────────────────────────────
  const buildPayload = () => {
    const iibbValid = iibbLines.filter((l) => Number(l.amount) > 0)

    return {
      customerId,
      date:        new Date(date),
      description: description || undefined,
      invoiceApplications: invoiceApplications.map((a) => ({
        invoiceId:     a.invoiceId,
        appliedAmount: Number(a.appliedAmount),
      })),
      withholdingGroups: [
        ...(iibbValid.length > 0
          ? [
              {
                groupType: 'IIBB' as const,
                lines: iibbValid.map((l) => ({
                  withholdingType:   l.withholdingType,
                  jurisdictionLabel: l.jurisdictionLabel,
                  certificateNumber: l.certificateNumber || undefined,
                  amount:            Number(l.amount),
                })),
              },
            ]
          : []),
        ...(['IVA', 'SUSS', 'GANANCIAS'] as const)
          .filter((type) => Number(otherWithholdings[type].amount) > 0)
          .map((type) => ({
            groupType: type,
            lines: [
              {
                withholdingType:   type,
                certificateNumber: otherWithholdings[type].certificateNumber || undefined,
                amount:            Number(otherWithholdings[type].amount),
              },
            ],
          })),
      ],
      paymentMethods: paymentMethods
        .filter((pm) => pm.treasuryAccountId && Number(pm.amount) > 0)
        .map((pm) => ({
          treasuryAccountId: pm.treasuryAccountId,
          paymentType:       pm.paymentType,
          amount:            Number(pm.amount),
          checkNumber:       pm.checkNumber || undefined,
          checkDate:         pm.checkDate   || undefined,
          checkBank:         pm.checkBank   || undefined,
          reference:         pm.reference   || undefined,
        })),
    }
  }

  // ── Validation ───────────────────────────────────────────────────────────
  const validateForm = (): string | null => {
    if (!customerId)                   return 'Debes seleccionar un cliente'
    if (!date)                         return 'La fecha es requerida'
    if (invoiceApplications.length === 0)
                                       return 'Debes aplicar al menos una factura'
    if (paymentMethods.filter((pm) => pm.treasuryAccountId && Number(pm.amount) > 0).length === 0)
                                       return 'Debes agregar al menos un medio de cobro'
    return null
  }

  // ── Save as draft ────────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    const error = validateForm()
    if (error) { toast.error(error); return }

    try {
      setSavingDraft(true)
      const res = await fetch('/api/cobros', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildPayload()),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Error al guardar borrador')
      }

      const data = await res.json()
      toast.success('Recibo guardado como borrador')
      router.push(`/cobros/${data.receipt.id}`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Error al guardar borrador')
    } finally {
      setSavingDraft(false)
    }
  }

  // ── Save and approve ─────────────────────────────────────────────────────
  const handleSaveAndApprove = async () => {
    if (!diferenciaOk) {
      toast.error('La diferencia debe ser $0.00 para aprobar el recibo')
      return
    }

    const error = validateForm()
    if (error) { toast.error(error); return }

    try {
      setSavingApprove(true)

      // Step 1: create draft
      const createRes = await fetch('/api/cobros', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildPayload()),
      })

      if (!createRes.ok) {
        const body = await createRes.json()
        throw new Error(body.error ?? 'Error al crear recibo')
      }

      const createData = await createRes.json()
      const receiptId  = createData.receipt.id

      // Step 2: approve
      const approveRes = await fetch(`/api/cobros/${receiptId}/aprobar`, {
        method: 'POST',
      })

      if (!approveRes.ok) {
        const body = await approveRes.json()
        // Redirect to the draft even if approval fails
        toast.error(body.error ?? 'El recibo se creó pero no pudo aprobarse')
        router.push(`/cobros/${receiptId}`)
        return
      }

      const approveData = await approveRes.json()
      toast.success(approveData.message ?? 'Recibo aprobado correctamente')
      router.push(`/cobros/${receiptId}`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Error al aprobar recibo')
    } finally {
      setSavingApprove(false)
    }
  }

  const isSaving = savingDraft || savingApprove

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-32">

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/cobros')}
          disabled={isSaving}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Receipt className="h-8 w-8 text-primary" />
            Nuevo Recibo de Cobro
          </h1>
          <p className="text-muted-foreground">
            Completá todos los campos para registrar el cobro
          </p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1 — Encabezado
      ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Encabezado del Recibo
          </CardTitle>
          <CardDescription>Datos generales del comprobante</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">

            {/* Cliente */}
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="customer-search">
                Cliente <span className="text-destructive">*</span>
              </Label>
              {loadingCustomers ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground h-10">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando clientes…
                </div>
              ) : (
                <>
                  <Input
                    id="customer-search"
                    placeholder="Buscar por nombre o CUIT…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    disabled={isSaving}
                  />
                  <Select
                    value={customerId}
                    onValueChange={handleCustomerChange}
                    disabled={isSaving}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccioná un cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredCustomers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Sin resultados
                        </div>
                      ) : (
                        filteredCustomers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <span className="font-medium">{c.name}</span>
                            <span className="text-muted-foreground ml-2 text-xs">
                              {c.cuit}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {selectedCustomer && (
                    <p className="text-xs text-muted-foreground">
                      {selectedCustomer.businessName} — {selectedCustomer.taxCondition}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Fecha */}
            <div className="space-y-2">
              <Label htmlFor="date">
                Fecha <span className="text-destructive">*</span>
              </Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isSaving}
              />
            </div>

            {/* Descripción */}
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                placeholder="Descripción u observaciones (opcional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isSaving}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2 — Facturas Impagas
      ══════════════════════════════════════════════════════════════════ */}
      {customerId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Facturas Pendientes de Cobro
            </CardTitle>
            <CardDescription>
              Seleccioná las facturas que incluye este recibo y el importe a aplicar
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingInvoices ? (
              <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Cargando facturas pendientes…
              </div>
            ) : pendingInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
                <p className="text-sm">Este cliente no tiene facturas pendientes de cobro.</p>
              </div>
            ) : (
              <>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Nro. Factura</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Vencimiento</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead className="text-right w-36">A Aplicar</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingInvoices.map((invoice) => {
                        const checked = isInvoiceChecked(invoice.id)
                        const application = invoiceApplications.find(
                          (a) => a.invoiceId === invoice.id,
                        )
                        return (
                          <TableRow
                            key={invoice.id}
                            className={checked ? 'bg-primary/5' : ''}
                          >
                            <TableCell>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(val) =>
                                  handleInvoiceCheck(invoice, val === true)
                                }
                                disabled={isSaving}
                              />
                            </TableCell>
                            <TableCell className="font-mono font-semibold">
                              {invoice.invoiceNumber}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                Factura {invoice.invoiceType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <span>{formatDate(invoice.dueDate)}</span>
                                <Badge
                                  className={`text-xs ${statusColors[invoice.status] ?? ''}`}
                                >
                                  {statusLabels[invoice.status] ?? invoice.status}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              {formatARS(invoice.total)}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-orange-600">
                              {formatARS(invoice.remainingBalance)}
                            </TableCell>
                            <TableCell className="text-right">
                              {checked ? (
                                <Input
                                  type="number"
                                  min="0.01"
                                  max={invoice.remainingBalance}
                                  step="0.01"
                                  value={application?.appliedAmount ?? invoice.remainingBalance}
                                  onChange={(e) =>
                                    handleAppliedAmountChange(invoice.id, e.target.value)
                                  }
                                  className="w-32 text-right font-semibold"
                                  disabled={isSaving}
                                />
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>

                {invoiceApplications.length > 0 && (
                  <div className="flex justify-end mt-3">
                    <span className="text-sm font-semibold text-muted-foreground">
                      Total aplicado:&nbsp;
                      <span className="text-foreground text-base">
                        {formatARS(totalApplied)}
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 3 — Retenciones
      ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Retenciones
          </CardTitle>
          <CardDescription>
            Ingresá las retenciones sufridas en el cobro
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* ── Sub-section: IIBB ─────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Retenciones IIBB
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addIIBBLine}
                disabled={isSaving}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Agregar IIBB
              </Button>
            </div>

            {iibbLines.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Sin retenciones IIBB. Usá el botón para agregar.
              </p>
            ) : (
              <div className="space-y-2">
                {iibbLines.map((line) => (
                  <div
                    key={line.id}
                    className="grid grid-cols-12 gap-2 items-center rounded-lg border bg-muted/30 p-3"
                  >
                    {/* Jurisdicción */}
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs text-muted-foreground">Jurisdicción</Label>
                      <Select
                        value={line.withholdingType}
                        onValueChange={(v) =>
                          updateIIBBLine(line.id, 'withholdingType', v)
                        }
                        disabled={isSaving}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {IIBB_JURISDICTIONS.map((j) => (
                            <SelectItem key={j.value} value={j.value}>
                              {j.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Nro. Certificado */}
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Nro. Certificado
                      </Label>
                      <Input
                        placeholder="Opcional"
                        value={line.certificateNumber}
                        onChange={(e) =>
                          updateIIBBLine(line.id, 'certificateNumber', e.target.value)
                        }
                        className="h-8"
                        disabled={isSaving}
                      />
                    </div>

                    {/* Importe */}
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs text-muted-foreground">Importe</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={line.amount}
                        onChange={(e) =>
                          updateIIBBLine(line.id, 'amount', e.target.value)
                        }
                        className="h-8 text-right"
                        disabled={isSaving}
                      />
                    </div>

                    {/* Remove */}
                    <div className="col-span-1 flex items-end justify-center pb-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => removeIIBBLine(line.id)}
                        disabled={isSaving}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end">
                  <span className="text-sm text-muted-foreground font-semibold">
                    Total IIBB:&nbsp;
                    <span className="text-foreground">{formatARS(totalIIBB)}</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* ── Sub-section: Otras Retenciones ────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Otras Retenciones
            </h3>

            <div className="space-y-2">
              {(
                [
                  { key: 'IVA'       as const, label: 'IVA' },
                  { key: 'SUSS'      as const, label: 'SUSS' },
                  { key: 'GANANCIAS' as const, label: 'Ganancias' },
                ] as const
              ).map(({ key, label }) => (
                <div
                  key={key}
                  className="grid grid-cols-12 gap-2 items-center rounded-lg border bg-muted/30 p-3"
                >
                  {/* Label */}
                  <div className="col-span-2 flex items-center">
                    <span className="text-sm font-semibold">{label}</span>
                  </div>

                  {/* Nro. Certificado */}
                  <div className="col-span-6 space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Nro. Certificado
                    </Label>
                    <Input
                      placeholder="Opcional"
                      value={otherWithholdings[key].certificateNumber}
                      onChange={(e) =>
                        updateOtherWithholding(key, 'certificateNumber', e.target.value)
                      }
                      className="h-8"
                      disabled={isSaving}
                    />
                  </div>

                  {/* Importe */}
                  <div className="col-span-4 space-y-1">
                    <Label className="text-xs text-muted-foreground">Importe</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={otherWithholdings[key].amount}
                      onChange={(e) =>
                        updateOtherWithholding(key, 'amount', e.target.value)
                      }
                      className="h-8 text-right"
                      disabled={isSaving}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <span className="text-sm text-muted-foreground font-semibold">
                Total Otras Retenciones:&nbsp;
                <span className="text-foreground">{formatARS(totalOther)}</span>
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 4 — Medios de Cobro
      ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Medios de Cobro
          </CardTitle>
          <CardDescription>
            Indicá cómo se recibió el dinero (puede ser más de uno)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPaymentMethod}
              disabled={isSaving || loadingAccounts}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Agregar Medio de Cobro
            </Button>
          </div>

          {loadingAccounts ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando cuentas de tesorería…
            </div>
          ) : paymentMethods.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-4">
              Sin medios de cobro. Usá el botón para agregar.
            </p>
          ) : (
            <div className="space-y-3">
              {paymentMethods.map((pm) => {
                const isCheck = pm.paymentType === 'CHEQUE'
                return (
                  <div
                    key={pm.id}
                    className="rounded-lg border bg-muted/30 p-4 space-y-3"
                  >
                    {/* Row 1: cuenta / tipo / importe / eliminar */}
                    <div className="grid grid-cols-12 gap-2 items-end">

                      {/* Cuenta Tesorería */}
                      <div className="col-span-5 space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Cuenta Tesorería
                        </Label>
                        <Select
                          value={pm.treasuryAccountId}
                          onValueChange={(v) =>
                            updatePaymentMethod(pm.id, 'treasuryAccountId', v)
                          }
                          disabled={isSaving}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Seleccioná cuenta…" />
                          </SelectTrigger>
                          <SelectContent>
                            {treasuryAccounts.map((acc) => (
                              <SelectItem key={acc.id} value={acc.id}>
                                <span>{acc.name}</span>
                                {acc.bankName && (
                                  <span className="text-muted-foreground ml-1 text-xs">
                                    — {acc.bankName}
                                  </span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Tipo de Pago */}
                      <div className="col-span-3 space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Tipo de Pago
                        </Label>
                        <Select
                          value={pm.paymentType}
                          onValueChange={(v) =>
                            updatePaymentMethod(pm.id, 'paymentType', v)
                          }
                          disabled={isSaving}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Importe */}
                      <div className="col-span-3 space-y-1">
                        <Label className="text-xs text-muted-foreground">
                          Importe
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={pm.amount}
                          onChange={(e) =>
                            updatePaymentMethod(pm.id, 'amount', e.target.value)
                          }
                          className="h-8 text-right"
                          disabled={isSaving}
                        />
                      </div>

                      {/* Remove */}
                      <div className="col-span-1 flex justify-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removePaymentMethod(pm.id)}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Row 2: Cheque fields (conditional) */}
                    {isCheck && (
                      <div className="grid grid-cols-12 gap-2 items-end border-t pt-3 mt-1">
                        <div className="col-span-12">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Datos del Cheque
                          </p>
                        </div>

                        {/* Nro. Cheque */}
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Nro. Cheque
                          </Label>
                          <Input
                            placeholder="Ej: 00012345"
                            value={pm.checkNumber ?? ''}
                            onChange={(e) =>
                              updatePaymentMethod(pm.id, 'checkNumber', e.target.value)
                            }
                            className="h-8"
                            disabled={isSaving}
                          />
                        </div>

                        {/* Fecha Cheque */}
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Fecha Cheque
                          </Label>
                          <Input
                            type="date"
                            value={pm.checkDate ?? ''}
                            onChange={(e) =>
                              updatePaymentMethod(pm.id, 'checkDate', e.target.value)
                            }
                            className="h-8"
                            disabled={isSaving}
                          />
                        </div>

                        {/* Banco */}
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Banco Emisor
                          </Label>
                          <Input
                            placeholder="Ej: Banco Nación"
                            value={pm.checkBank ?? ''}
                            onChange={(e) =>
                              updatePaymentMethod(pm.id, 'checkBank', e.target.value)
                            }
                            className="h-8"
                            disabled={isSaving}
                          />
                        </div>
                      </div>
                    )}

                    {/* Reference (always optional) */}
                    <div className="space-y-1 border-t pt-3">
                      <Label className="text-xs text-muted-foreground">
                        Referencia / Comprobante (opcional)
                      </Label>
                      <Input
                        placeholder="Nro. de transferencia, depósito, etc."
                        value={pm.reference ?? ''}
                        onChange={(e) =>
                          updatePaymentMethod(pm.id, 'reference', e.target.value)
                        }
                        className="h-8"
                        disabled={isSaving}
                      />
                    </div>
                  </div>
                )
              })}

              <div className="flex justify-end">
                <span className="text-sm text-muted-foreground font-semibold">
                  Total Cobrado:&nbsp;
                  <span className="text-foreground text-base">
                    {formatARS(totalCobrado)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 5 — Sticky bottom bar
      ══════════════════════════════════════════════════════════════════ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-gray-900 text-white shadow-2xl">
        <div className="mx-auto max-w-screen-xl px-4 md:px-8">
          {/* Totals row */}
          <div className="flex items-center justify-between gap-6 py-2 border-b border-gray-700 flex-wrap">
            <div className="flex items-center gap-6 flex-wrap text-sm">
              <div className="text-center">
                <div className="text-gray-400 text-xs uppercase tracking-wide">
                  Total Aplicado
                </div>
                <div className="font-bold text-base text-white">
                  {formatARS(totalApplied)}
                </div>
              </div>

              <div className="text-gray-600 hidden md:block">−</div>

              <div className="text-center">
                <div className="text-gray-400 text-xs uppercase tracking-wide">
                  Retenciones
                </div>
                <div className="font-bold text-base text-yellow-400">
                  {formatARS(totalWithholdings)}
                </div>
              </div>

              <div className="text-gray-600 hidden md:block">=</div>

              <div className="text-center">
                <div className="text-gray-400 text-xs uppercase tracking-wide">
                  A Cobrar
                </div>
                <div className="font-bold text-base text-blue-400">
                  {formatARS(totalToCobrar)}
                </div>
              </div>

              <div className="text-gray-600 hidden md:block">vs</div>

              <div className="text-center">
                <div className="text-gray-400 text-xs uppercase tracking-wide">
                  Cobrado
                </div>
                <div className="font-bold text-base text-green-400">
                  {formatARS(totalCobrado)}
                </div>
              </div>

              <div className="text-gray-600 hidden md:block">=</div>

              <div className="text-center">
                <div className="text-gray-400 text-xs uppercase tracking-wide">
                  Diferencia
                </div>
                <div
                  className={`font-bold text-base flex items-center gap-1 ${
                    diferenciaOk ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {diferenciaOk ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertTriangle className="h-4 w-4" />
                  )}
                  {formatARS(diferencia)}
                </div>
              </div>
            </div>

            {/* Breakdown tooltip-like for withholdings */}
            {totalWithholdings > 0 && (
              <div className="text-xs text-gray-400 hidden lg:flex flex-col items-end">
                {totalIIBB > 0 && (
                  <span>IIBB: {formatAmount(totalIIBB)}</span>
                )}
                {Number(otherWithholdings.IVA.amount) > 0 && (
                  <span>IVA: {formatAmount(Number(otherWithholdings.IVA.amount))}</span>
                )}
                {Number(otherWithholdings.SUSS.amount) > 0 && (
                  <span>SUSS: {formatAmount(Number(otherWithholdings.SUSS.amount))}</span>
                )}
                {Number(otherWithholdings.GANANCIAS.amount) > 0 && (
                  <span>Ganancias: {formatAmount(Number(otherWithholdings.GANANCIAS.amount))}</span>
                )}
              </div>
            )}
          </div>

          {/* Action buttons row */}
          <div className="flex items-center justify-end gap-3 py-3">
            <Button
              type="button"
              variant="outline"
              className="bg-transparent border-gray-600 text-gray-200 hover:bg-gray-800 hover:text-white gap-2"
              onClick={() => router.push('/cobros')}
              disabled={isSaving}
            >
              <ArrowLeft className="h-4 w-4" />
              Cancelar
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              onClick={handleSaveDraft}
              disabled={isSaving}
            >
              {savingDraft ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {savingDraft ? 'Guardando…' : 'Guardar Borrador'}
            </Button>

            <Button
              type="button"
              className="gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-40"
              onClick={handleSaveAndApprove}
              disabled={isSaving || !diferenciaOk}
              title={
                !diferenciaOk
                  ? 'La diferencia debe ser $0.00 para aprobar'
                  : 'Guardar y aprobar el recibo'
              }
            >
              {savingApprove ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Banknote className="h-4 w-4" />
              )}
              {savingApprove ? 'Aprobando…' : 'Guardar y Aprobar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
