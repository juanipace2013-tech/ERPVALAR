'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Label } from '@/components/ui/label'
import { BarChart3, Download, Printer, Calendar } from 'lucide-react'
import { toast } from 'sonner'

interface BalanceItem {
  account: {
    id: string
    code: string
    name: string
    accountType: string
    level: number
  }
  sums: {
    debit: number
    credit: number
  }
  balance: {
    debit: number
    credit: number
  }
}

interface BalanceData {
  data: BalanceItem[]
  totals: {
    sums: {
      debit: number
      credit: number
    }
    balance: {
      debit: number
      credit: number
    }
  }
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  ACTIVO: 'bg-blue-100 text-blue-700',
  PASIVO: 'bg-red-100 text-red-700',
  PATRIMONIO_NETO: 'bg-purple-100 text-purple-700',
  INGRESO: 'bg-green-100 text-green-700',
  EGRESO: 'bg-orange-100 text-orange-700',
}

export default function BalanceSumasSaldosPage() {
  const [data, setData] = useState<BalanceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const fetchBalance = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()

      if (startDate) {
        params.append('startDate', startDate)
      }

      if (endDate) {
        params.append('endDate', endDate)
      }

      const response = await fetch(`/api/contabilidad/balance-sumas-saldos?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar balance')
      }

      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar balance de sumas y saldos')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = () => {
    fetchBalance()
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    toast.info('Función de exportación en desarrollo')
  }

  const getLevelIndent = (level: number) => {
    return `${(level - 1) * 1.5}rem`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Balance de Sumas y Saldos</h1>
          <p className="text-gray-600 mt-1">
            Estado de sumas y saldos de todas las cuentas
          </p>
        </div>
        {data && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Exportar
            </Button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Período del Balance</CardTitle>
          <CardDescription>
            Selecciona el período para generar el balance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="startDate">Fecha Desde</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Fecha Hasta</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleGenerate} className="w-full">
                <Calendar className="mr-2 h-4 w-4" />
                Generar Balance
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance */}
      {data && (
        <Card>
          <CardHeader className="print:text-center">
            <CardTitle className="print:text-2xl">Balance de Sumas y Saldos</CardTitle>
            <CardDescription className="print:text-base print:text-gray-700">
              {data.data.length} cuentas con movimientos
              {startDate && endDate && (
                <> • Del {new Date(startDate).toLocaleDateString('es-AR')} al {new Date(endDate).toLocaleDateString('es-AR')}</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Cargando balance...</p>
              </div>
            ) : data.data.length === 0 ? (
              <div className="text-center py-12">
                <BarChart3 className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No hay movimientos
                </h3>
                <p className="text-gray-600">
                  No se encontraron movimientos en el período seleccionado
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Tabla de Balance */}
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[120px]">Código</TableHead>
                        <TableHead>Cuenta</TableHead>
                        <TableHead className="text-center w-[100px]">Tipo</TableHead>
                        <TableHead className="text-right w-[130px]">Debe</TableHead>
                        <TableHead className="text-right w-[130px]">Haber</TableHead>
                        <TableHead className="text-right w-[130px]">Saldo Deudor</TableHead>
                        <TableHead className="text-right w-[130px]">Saldo Acreedor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.data.map((item) => (
                        <TableRow key={item.account.id}>
                          <TableCell className="font-mono font-medium">
                            {item.account.code}
                          </TableCell>
                          <TableCell>
                            <span
                              style={{ marginLeft: getLevelIndent(item.account.level) }}
                              className={item.account.level === 1 ? 'font-bold' : item.account.level === 2 ? 'font-semibold' : ''}
                            >
                              {item.account.name}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className={`${ACCOUNT_TYPE_COLORS[item.account.accountType]} print:text-xs`} variant="outline">
                              {item.account.accountType === 'ACTIVO' ? 'A' :
                               item.account.accountType === 'PASIVO' ? 'P' :
                               item.account.accountType === 'PATRIMONIO_NETO' ? 'PN' :
                               item.account.accountType === 'INGRESO' ? 'I' : 'E'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${item.sums.debit.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${item.sums.credit.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-blue-700">
                            {item.balance.debit > 0 ? `$${item.balance.debit.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-green-700">
                            {item.balance.credit > 0 ? `$${item.balance.credit.toFixed(2)}` : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totales */}
                      <TableRow className="bg-blue-50 font-bold">
                        <TableCell colSpan={3} className="text-right text-lg">
                          TOTALES
                        </TableCell>
                        <TableCell className="text-right font-mono text-lg">
                          ${data.totals.sums.debit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-lg">
                          ${data.totals.sums.credit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-lg text-blue-700">
                          ${data.totals.balance.debit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-lg text-green-700">
                          ${data.totals.balance.credit.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Validaciones */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className={`${
                    Math.abs(data.totals.sums.debit - data.totals.sums.credit) < 0.01
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  } print:break-inside-avoid`}>
                    <CardContent className="pt-6">
                      <p className="text-sm font-medium text-gray-600 mb-2">Balance de Sumas</p>
                      {Math.abs(data.totals.sums.debit - data.totals.sums.credit) < 0.01 ? (
                        <p className="text-lg font-bold text-green-700">
                          ✓ Debe = Haber (Balanceado)
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-red-700">
                          ✗ Diferencia: ${Math.abs(data.totals.sums.debit - data.totals.sums.credit).toFixed(2)}
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className={`${
                    Math.abs(data.totals.balance.debit - data.totals.balance.credit) < 0.01
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  } print:break-inside-avoid`}>
                    <CardContent className="pt-6">
                      <p className="text-sm font-medium text-gray-600 mb-2">Balance de Saldos</p>
                      {Math.abs(data.totals.balance.debit - data.totals.balance.credit) < 0.01 ? (
                        <p className="text-lg font-bold text-green-700">
                          ✓ Saldo Deudor = Saldo Acreedor
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-red-700">
                          ✗ Diferencia: ${Math.abs(data.totals.balance.debit - data.totals.balance.credit).toFixed(2)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
