'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, CheckCircle, XCircle, Clock, Ban } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface CheckManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Check {
  id: string
  checkNumber: string
  date: string
  amount: number
  entityName: string | null
  description: string | null
  voucherType: string
  status: 'PENDING' | 'CLEARED' | 'REJECTED' | 'CANCELLED'
  bankAccountName: string
}

const CHECK_STATUS_LABELS = {
  PENDING: { label: 'En cartera', color: 'text-yellow-700 bg-yellow-50', icon: Clock },
  CLEARED: { label: 'Cobrado', color: 'text-green-700 bg-green-50', icon: CheckCircle },
  REJECTED: { label: 'Rechazado', color: 'text-red-700 bg-red-50', icon: XCircle },
  CANCELLED: { label: 'Anulado', color: 'text-gray-700 bg-gray-50', icon: Ban },
}

export function CheckManagementDialog({ open, onOpenChange }: CheckManagementDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<Check[]>([])
  const [filter, setFilter] = useState<'ALL' | 'RECEIVED' | 'ISSUED'>('ALL')

  useEffect(() => {
    if (open) {
      loadChecks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, filter])

  const loadChecks = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/tesoreria/cheques?filter=${filter}`)
      if (response.ok) {
        const data = await response.json()
        setChecks(data.checks || [])
      }
    } catch (_error) {
      console.error('Error loading checks:', error)
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los cheques',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const updateCheckStatus = async (checkId: string, newStatus: string) => {
    try {
      const response = await fetch(`/api/tesoreria/cheques/${checkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        throw new Error('Error al actualizar estado')
      }

      toast({
        title: 'Estado actualizado',
        description: 'El estado del cheque se actualizó correctamente',
      })

      loadChecks()
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado del cheque',
        variant: 'destructive',
      })
    }
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('es-AR')
  }

  const receivedChecks = checks.filter(c => c.voucherType === 'REC' || c.voucherType === 'CHQ')
  const issuedChecks = checks.filter(c => c.voucherType === 'PAG')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>📋 Gestión de Cheques</DialogTitle>
          <DialogDescription>
            Administre los cheques recibidos y emitidos
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button
            variant={filter === 'ALL' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('ALL')}
          >
            Todos ({checks.length})
          </Button>
          <Button
            variant={filter === 'RECEIVED' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('RECEIVED')}
          >
            Recibidos ({receivedChecks.length})
          </Button>
          <Button
            variant={filter === 'ISSUED' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('ISSUED')}
          >
            Emitidos ({issuedChecks.length})
          </Button>
        </div>

        <div className="flex-1 overflow-auto border rounded-lg">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-gray-50 z-10">
                <TableRow>
                  <TableHead className="font-semibold">Tipo</TableHead>
                  <TableHead className="font-semibold">Nro. Cheque</TableHead>
                  <TableHead className="font-semibold">Fecha</TableHead>
                  <TableHead className="font-semibold">Cliente/Proveedor</TableHead>
                  <TableHead className="font-semibold">Cuenta</TableHead>
                  <TableHead className="font-semibold text-right">Monto</TableHead>
                  <TableHead className="font-semibold">Estado</TableHead>
                  <TableHead className="font-semibold">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                      No hay cheques registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  checks.map((check) => {
                    const StatusIcon = CHECK_STATUS_LABELS[check.status].icon
                    const isReceived = check.voucherType === 'REC' || check.voucherType === 'CHQ'

                    return (
                      <TableRow key={check.id} className="hover:bg-gray-50">
                        <TableCell>
                          <span
                            className={`text-xs font-semibold px-2 py-1 rounded ${
                              isReceived
                                ? 'bg-green-100 text-green-800'
                                : 'bg-orange-100 text-orange-800'
                            }`}
                          >
                            {isReceived ? '↓ Recibido' : '↑ Emitido'}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {check.checkNumber}
                        </TableCell>
                        <TableCell>{formatDate(check.date)}</TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {check.entityName || '-'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-600">
                          {check.bankAccountName}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(check.amount)}
                        </TableCell>
                        <TableCell>
                          <div
                            className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded w-fit ${
                              CHECK_STATUS_LABELS[check.status].color
                            }`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {CHECK_STATUS_LABELS[check.status].label}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {check.status === 'PENDING' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateCheckStatus(check.id, 'CLEARED')}
                                  className="text-green-600 hover:text-green-700"
                                >
                                  ✓ Cobrar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => updateCheckStatus(check.id, 'REJECTED')}
                                  className="text-red-600 hover:text-red-700"
                                >
                                  ✗ Rechazar
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
