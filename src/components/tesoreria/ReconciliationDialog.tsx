'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Loader2, CheckCircle2, Circle } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface ReconciliationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bankAccountId: string
  accountName: string
}

interface Transaction {
  id: string
  date: string
  entityName: string | null
  voucherType: string | null
  voucherNumber: string | null
  description: string | null
  debit: number
  credit: number
  balance: number
  reconciled: boolean
}

export function ReconciliationDialog({
  open,
  onOpenChange,
  bankAccountId,
  accountName,
}: ReconciliationDialogProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bankStatementBalance, setBankStatementBalance] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    if (open) {
      loadTransactions()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bankAccountId, dateFrom, dateTo])

  const loadTransactions = async () => {
    try {
      setLoading(true)
      let url = `/api/tesoreria/cuentas/${bankAccountId}/movimientos?pageSize=100`
      if (dateFrom) url += `&dateFrom=${dateFrom}`
      if (dateTo) url += `&dateTo=${dateTo}`

      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        // Filtrar movimientos no conciliados (usamos la descripción para simular)
        const txs = (data.transactions || []).map((tx: { id: string; date: string; description?: string; amount: number; type: string; balance: number }) => ({
          ...tx,
          reconciled: tx.description?.includes('[CONCILIADO]') || false,
        }))
        setTransactions(txs)
      }
    } catch (error) {
      console.error('Error loading transactions:', error)
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los movimientos',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const toggleTransaction = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const handleReconcile = async () => {
    if (selectedIds.size === 0) {
      toast({
        title: 'Error',
        description: 'Debe seleccionar al menos un movimiento',
        variant: 'destructive',
      })
      return
    }

    try {
      const response = await fetch('/api/tesoreria/conciliacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionIds: Array.from(selectedIds),
          bankStatementBalance,
        }),
      })

      if (!response.ok) {
        throw new Error('Error al conciliar movimientos')
      }

      toast({
        title: 'Conciliación exitosa',
        description: `${selectedIds.size} movimiento(s) marcado(s) como conciliado(s)`,
      })

      setSelectedIds(new Set())
      loadTransactions()
    } catch (_error) {
      toast({
        title: 'Error',
        description: 'No se pudo realizar la conciliación',
        variant: 'destructive',
      })
    }
  }

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('es-AR')
  }

  const unreconciledTransactions = transactions.filter(tx => !tx.reconciled)
  const totalDebit = unreconciledTransactions
    .filter(tx => selectedIds.has(tx.id))
    .reduce((sum, tx) => sum + tx.debit, 0)
  const totalCredit = unreconciledTransactions
    .filter(tx => selectedIds.has(tx.id))
    .reduce((sum, tx) => sum + tx.credit, 0)
  const netAmount = totalDebit - totalCredit

  const systemBalance = transactions.length > 0 ? transactions[0].balance : 0
  const difference = bankStatementBalance - systemBalance

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>🔄 Conciliación Bancaria - {accountName}</DialogTitle>
          <DialogDescription>
            Marque los movimientos que aparecen en su extracto bancario
          </DialogDescription>
        </DialogHeader>

        {/* Filtros y Balance */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
          <div className="space-y-2">
            <Label>Fecha desde</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Fecha hasta</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Saldo según extracto</Label>
            <Input
              type="number"
              step="0.01"
              value={bankStatementBalance || ''}
              onChange={(e) => setBankStatementBalance(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-2">
            <Label>Diferencia</Label>
            <div
              className={`px-3 py-2 rounded border text-sm font-semibold ${
                Math.abs(difference) < 0.01
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {formatCurrency(difference)}
            </div>
          </div>
        </div>

        {/* Resumen de Selección */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Seleccionados:</span>
                <span className="font-semibold ml-2">{selectedIds.size}</span>
              </div>
              <div>
                <span className="text-gray-600">Ingresos:</span>
                <span className="font-semibold ml-2 text-green-700">
                  {formatCurrency(totalDebit)}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Egresos:</span>
                <span className="font-semibold ml-2 text-red-700">
                  {formatCurrency(totalCredit)}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Neto:</span>
                <span className="font-semibold ml-2">{formatCurrency(netAmount)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tabla de Movimientos */}
        <div className="flex-1 overflow-auto border rounded-lg">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-gray-50 z-10">
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-semibold">Fecha</TableHead>
                  <TableHead className="font-semibold">Tipo</TableHead>
                  <TableHead className="font-semibold">Nro</TableHead>
                  <TableHead className="font-semibold">Descripción</TableHead>
                  <TableHead className="font-semibold text-right">Ingresos</TableHead>
                  <TableHead className="font-semibold text-right">Egresos</TableHead>
                  <TableHead className="font-semibold text-right">Saldo</TableHead>
                  <TableHead className="font-semibold">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unreconciledTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-gray-500">
                      No hay movimientos sin conciliar
                    </TableCell>
                  </TableRow>
                ) : (
                  unreconciledTransactions.map((transaction) => (
                    <TableRow
                      key={transaction.id}
                      className={`cursor-pointer hover:bg-gray-50 ${
                        selectedIds.has(transaction.id) ? 'bg-blue-50' : ''
                      }`}
                      onClick={() => toggleTransaction(transaction.id)}
                    >
                      <TableCell>
                        {selectedIds.has(transaction.id) ? (
                          <CheckCircle2 className="h-5 w-5 text-blue-600" />
                        ) : (
                          <Circle className="h-5 w-5 text-gray-300" />
                        )}
                      </TableCell>
                      <TableCell>{formatDate(transaction.date)}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          {transaction.voucherType || '-'}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {transaction.voucherNumber || '-'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm">
                        {transaction.description || '-'}
                      </TableCell>
                      <TableCell className="text-right text-green-700 font-semibold">
                        {transaction.debit > 0 ? formatCurrency(transaction.debit) : '-'}
                      </TableCell>
                      <TableCell className="text-right text-red-700 font-semibold">
                        {transaction.credit > 0 ? formatCurrency(transaction.credit) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(transaction.balance)}
                      </TableCell>
                      <TableCell>
                        {transaction.reconciled && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            Conciliado
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Botones */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleReconcile} disabled={selectedIds.size === 0}>
            Marcar como Conciliados ({selectedIds.size})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
