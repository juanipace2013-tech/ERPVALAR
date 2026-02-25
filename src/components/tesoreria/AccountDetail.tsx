'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw, Loader2, Info } from 'lucide-react'
import { CashFlowChart } from './CashFlowChart'
import { PaymentDialog } from './PaymentDialog'
import { ReceiptDialog } from './ReceiptDialog'
import { BankOperationDialog } from './BankOperationDialog'
import { ReconciliationDialog } from './ReconciliationDialog'

interface BankAccount {
  id: string
  name: string
  type: string
  bank: string | null
  currency: string
  balance: number
  reconciledBalance: number
  currencyBalance: number | null
  isActive: boolean
}

interface Transaction {
  id: string
  date: string
  entityName: string | null
  voucherType: string | null
  voucherNumber: string | null
  checkNumber: string | null
  description: string | null
  debit: number
  credit: number
  balance: number
}

interface AccountDetailProps {
  account: BankAccount
  onUpdate: () => void
}

export function AccountDetail({ account, onUpdate }: AccountDetailProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalItems, setTotalItems] = useState(0)
  const pageSize = 20
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [operationDialogOpen, setOperationDialogOpen] = useState(false)
  const [reconciliationDialogOpen, setReconciliationDialogOpen] = useState(false)

  useEffect(() => {
    loadTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, page, dateFrom, dateTo])

  const loadTransactions = async () => {
    try {
      setLoading(true)
      let url = `/api/tesoreria/cuentas/${account.id}/movimientos?page=${page}&pageSize=${pageSize}`
      if (dateFrom) url += `&dateFrom=${dateFrom}`
      if (dateTo) url += `&dateTo=${dateTo}`

      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data.transactions)
        setTotalPages(data.totalPages)
        setTotalItems(data.total)
      }
    } catch (error) {
      console.error('Error loading transactions:', error)
    } finally {
      setLoading(false)
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
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  }

  const handlePaymentSuccess = () => {
    loadTransactions()
    onUpdate() // Actualiza saldo de la cuenta
  }

  const handleReceiptSuccess = () => {
    loadTransactions()
    onUpdate() // Actualiza saldo de la cuenta
  }

  const handleOperationSuccess = () => {
    loadTransactions()
    onUpdate() // Actualiza saldo de la cuenta
  }

  return (
    <div className="p-6 space-y-6">
      {/* Gráfico de Flujo */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                Saldo / Ingresos / Egresos {account.name}
                <Info className="h-4 w-4 text-gray-400" />
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReconciliationDialogOpen(true)}
            >
              🔄 Conciliación Bancaria
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <CashFlowChart accountId={account.id} />
        </CardContent>
      </Card>

      {/* Tabla de Movimientos */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Movimientos {account.name}
              <Info className="h-4 w-4 text-gray-400" />
            </CardTitle>
            <div className="flex gap-2 items-center">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Desde:</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value)
                    setPage(1)
                  }}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Hasta:</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value)
                    setPage(1)
                  }}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
              {(dateFrom || dateTo) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDateFrom('')
                    setDateTo('')
                    setPage(1)
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="font-semibold">Fecha</TableHead>
                      <TableHead className="font-semibold">Cliente/Proveedor</TableHead>
                      <TableHead className="font-semibold">Tipo</TableHead>
                      <TableHead className="font-semibold">Nro</TableHead>
                      <TableHead className="font-semibold">Nro Cheque</TableHead>
                      <TableHead className="font-semibold">Descripción</TableHead>
                      <TableHead className="font-semibold text-right text-green-700">Ingresos</TableHead>
                      <TableHead className="font-semibold text-right text-red-700">Egresos</TableHead>
                      <TableHead className="font-semibold text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-12 text-gray-500">
                          No hay movimientos registrados
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((transaction) => (
                        <TableRow key={transaction.id} className="hover:bg-gray-50">
                          <TableCell>{formatDate(transaction.date)}</TableCell>
                          <TableCell className="max-w-[150px] truncate">
                            {transaction.entityName || '-'}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              {transaction.voucherType || '-'}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {transaction.voucherNumber || '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {transaction.checkNumber || '-'}
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
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Paginación */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-gray-600 mx-2">
                    Página {page} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadTransactions}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <div className="text-sm text-gray-600">
                  Mostrando {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, totalItems)} de {totalItems}
                </div>
              </div>
            </>
          )}

          {/* Botones de Acción */}
          <div className="flex gap-2 mt-6">
            <Button variant="outline" onClick={() => setPaymentDialogOpen(true)}>
              💰 Registrar Pago a Proveedor
            </Button>
            <Button variant="outline" onClick={() => setReceiptDialogOpen(true)}>
              💵 Registrar Cobranza de Cliente
            </Button>
            <Button variant="outline" onClick={() => setOperationDialogOpen(true)}>
              💳 Operaciones Bancarias
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Diálogos */}
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        bankAccountId={account.id}
        onSuccess={handlePaymentSuccess}
      />

      <ReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        bankAccountId={account.id}
        onSuccess={handleReceiptSuccess}
      />

      <BankOperationDialog
        open={operationDialogOpen}
        onOpenChange={setOperationDialogOpen}
        bankAccountId={account.id}
        onSuccess={handleOperationSuccess}
      />

      <ReconciliationDialog
        open={reconciliationDialogOpen}
        onOpenChange={setReconciliationDialogOpen}
        bankAccountId={account.id}
        accountName={account.name}
      />
    </div>
  )
}
