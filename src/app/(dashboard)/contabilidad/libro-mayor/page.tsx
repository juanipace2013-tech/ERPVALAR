'use client'

import { useState, useEffect } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { BookOpen, Download, Printer, Search } from 'lucide-react'
import { toast } from 'sonner'

interface Account {
  id: string
  code: string
  name: string
  acceptsEntries?: boolean
  accountType: string
}

interface Movement {
  id: string
  description: string
  debit: number
  credit: number
  balance: number
  journalEntry: {
    id: string
    entryNumber: number
    date: string
    description: string
  }
}

interface LibroMayorData {
  account: Account
  movements: Movement[]
  totals: {
    debit: number
    credit: number
    balance: number
  }
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ACTIVO: 'Activo',
  PASIVO: 'Pasivo',
  PATRIMONIO_NETO: 'Patrimonio Neto',
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
}

export default function LibroMayorPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [data, setData] = useState<LibroMayorData | null>(null)
  const [loading, setLoading] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/contabilidad/plan-cuentas?activeOnly=true')
      if (!response.ok) {
        throw new Error('Error al cargar cuentas')
      }
      const data = await response.json()
      // Solo cuentas que aceptan asientos
      setAccounts(data.filter((acc: Account) => acc.acceptsEntries))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar plan de cuentas')
    }
  }

  const fetchLibroMayor = async () => {
    if (!selectedAccountId) {
      toast.error('Selecciona una cuenta')
      return
    }

    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append('accountId', selectedAccountId)

      if (startDate) {
        params.append('startDate', startDate)
      }

      if (endDate) {
        params.append('endDate', endDate)
      }

      const response = await fetch(`/api/contabilidad/libro-mayor?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar libro mayor')
      }

      const result = await response.json()
      setData(result)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar libro mayor')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    fetchLibroMayor()
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    toast.info('Función de exportación en desarrollo')
  }

  const filteredAccounts = accounts.filter(account =>
    account.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    account.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Libro Mayor</h1>
          <p className="text-gray-600 mt-1">
            Movimientos por cuenta contable
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
          <CardTitle>Selección de Cuenta</CardTitle>
          <CardDescription>
            Elige una cuenta para ver sus movimientos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="account">Cuenta</Label>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Buscar cuenta..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.code} - {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
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
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleSearch} disabled={!selectedAccountId}>
              <BookOpen className="mr-2 h-4 w-4" />
              Consultar Libro Mayor
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Libro Mayor */}
      {data && (
        <Card>
          <CardHeader className="print:text-center">
            <div className="flex items-center justify-between print:block">
              <div>
                <CardTitle className="print:text-2xl">Libro Mayor</CardTitle>
                <CardDescription className="print:text-base print:text-gray-700 print:mt-2">
                  Cuenta: {data.account.code} - {data.account.name}
                  {startDate && endDate && (
                    <> • Del {new Date(startDate).toLocaleDateString('es-AR')} al {new Date(endDate).toLocaleDateString('es-AR')}</>
                  )}
                </CardDescription>
              </div>
              <Badge variant="outline" className="print:hidden">
                {ACCOUNT_TYPE_LABELS[data.account.accountType]}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <p className="text-gray-500">Cargando movimientos...</p>
              </div>
            ) : data.movements.length === 0 ? (
              <div className="text-center py-12">
                <BookOpen className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No hay movimientos
                </h3>
                <p className="text-gray-600">
                  Esta cuenta no tiene movimientos en el período seleccionado
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Tabla de Movimientos */}
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Fecha</TableHead>
                        <TableHead className="w-[100px]">Asiento N°</TableHead>
                        <TableHead>Descripción</TableHead>
                        <TableHead className="text-right w-[130px]">Debe</TableHead>
                        <TableHead className="text-right w-[130px]">Haber</TableHead>
                        <TableHead className="text-right w-[130px]">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.movements.map((movement) => (
                        <TableRow key={movement.id}>
                          <TableCell className="font-mono text-sm">
                            {new Date(movement.journalEntry.date).toLocaleDateString('es-AR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: '2-digit'
                            })}
                          </TableCell>
                          <TableCell className="font-mono">
                            {movement.journalEntry.entryNumber}
                          </TableCell>
                          <TableCell className="text-sm">
                            <p className="font-medium">{movement.journalEntry.description}</p>
                            {movement.description && movement.description !== movement.journalEntry.description && (
                              <p className="text-gray-600">{movement.description}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.debit > 0 ? `$${Number(movement.debit).toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.credit > 0 ? `$${Number(movement.credit).toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-semibold ${
                            movement.balance >= 0 ? 'text-green-700' : 'text-red-700'
                          }`}>
                            ${movement.balance.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totales */}
                      <TableRow className="bg-blue-50 font-bold">
                        <TableCell colSpan={3} className="text-right">
                          TOTALES
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${data.totals.debit.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${data.totals.credit.toFixed(2)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${
                          data.totals.balance >= 0 ? 'text-green-700' : 'text-red-700'
                        }`}>
                          ${data.totals.balance.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Resumen */}
                <Card className="bg-blue-50 border-blue-200 print:break-inside-avoid">
                  <CardContent className="pt-6">
                    <div className="grid gap-4 md:grid-cols-4">
                      <div>
                        <Label className="text-sm text-gray-600">Movimientos</Label>
                        <p className="text-2xl font-bold text-gray-900">
                          {data.movements.length}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-600">Total Debe</Label>
                        <p className="text-2xl font-bold text-blue-700">
                          ${data.totals.debit.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-600">Total Haber</Label>
                        <p className="text-2xl font-bold text-blue-700">
                          ${data.totals.credit.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-600">Saldo Final</Label>
                        <p className={`text-2xl font-bold ${
                          data.totals.balance >= 0 ? 'text-green-700' : 'text-red-700'
                        }`}>
                          ${data.totals.balance.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
