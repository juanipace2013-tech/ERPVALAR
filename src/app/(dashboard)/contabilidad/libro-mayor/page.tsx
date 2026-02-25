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
import { Checkbox } from '@/components/ui/checkbox'
import { BookOpen, Download, Printer, Search } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'
import * as XLSX from 'xlsx'

interface Account {
  id: string
  code: string
  name: string
  acceptsEntries?: boolean
  accountType: string
  children?: Account[]
}

interface Movement {
  id: string
  description: string
  debit: number
  credit: number
  balance: number
  balanceNature: 'DEUDOR' | 'ACREEDOR'
  journalEntry: {
    id: string
    entryNumber: number
    date: string
    description: string
  }
  account?: {
    code: string
    name: string
  }
}

interface AccountData {
  account: Account
  movements: Movement[]
  totals: {
    debit: number
    credit: number
    balance: number
    balanceNature: 'DEUDOR' | 'ACREEDOR'
  }
}

interface LibroMayorData {
  showAll: boolean
  account?: Account
  movements?: Movement[]
  totals?: {
    debit: number
    credit: number
    balance: number
    balanceNature: 'DEUDOR' | 'ACREEDOR'
  }
  accounts?: AccountData[]
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
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/contabilidad/plan-cuentas?activeOnly=true')
      if (!response.ok) {
        throw new Error('Error al cargar cuentas')
      }
      const tree = await response.json()

      // Aplanar el árbol para obtener todas las cuentas
      const flattenAccounts = (nodes: Account[]): Account[] => {
        const result: Account[] = []
        for (const node of nodes) {
          result.push(node)
          if (node.children && node.children.length > 0) {
            result.push(...flattenAccounts(node.children))
          }
        }
        return result
      }

      const allAccounts = flattenAccounts(tree)
      // Solo cuentas que aceptan asientos
      setAccounts(allAccounts.filter((acc: Account) => acc.acceptsEntries))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar plan de cuentas')
    }
  }

  const fetchLibroMayor = async () => {
    if (!showAll && !selectedAccountId) {
      toast.error('Selecciona una cuenta o marca "Ver todas las cuentas"')
      return
    }

    try {
      setLoading(true)
      const params = new URLSearchParams()

      if (showAll) {
        params.append('showAll', 'true')
      } else {
        params.append('accountId', selectedAccountId)
      }

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
    if (!data) {
      toast.error('No hay datos para exportar')
      return
    }

    try {
      const workbook = XLSX.utils.book_new()

      if (data.showAll && data.accounts) {
        // Exportar todas las cuentas
        data.accounts.forEach((accountData) => {
          const sheetData = [
            [`Libro Mayor - ${accountData.account.code}`],
            [`Cuenta: ${accountData.account.code} - ${accountData.account.name}`],
            [`Tipo: ${ACCOUNT_TYPE_LABELS[accountData.account.accountType]}`],
            [`Período: ${startDate || 'Inicio'} - ${endDate || 'Hoy'}`],
            [],
            ['Fecha', 'Asiento N°', 'Descripción', 'Debe', 'Haber', 'Saldo', 'D/A'],
          ]

          accountData.movements.forEach((movement) => {
            sheetData.push([
              new Date(movement.journalEntry.date).toLocaleDateString('es-AR'),
              movement.journalEntry.entryNumber.toString(),
              movement.journalEntry.description,
              movement.debit > 0 ? movement.debit.toString() : '',
              movement.credit > 0 ? movement.credit.toString() : '',
              movement.balance.toString(),
              movement.balanceNature === 'DEUDOR' ? 'D' : 'A',
            ])
          })

          sheetData.push([])
          sheetData.push([
            '',
            '',
            'TOTALES',
            accountData.totals.debit.toString(),
            accountData.totals.credit.toString(),
            accountData.totals.balance.toString(),
            accountData.totals.balanceNature === 'DEUDOR' ? 'D' : 'A',
          ])

          const worksheet = XLSX.utils.aoa_to_sheet(sheetData)

          // Ajustar anchos de columna
          worksheet['!cols'] = [
            { wch: 12 }, // Fecha
            { wch: 10 }, // Asiento
            { wch: 40 }, // Descripción
            { wch: 12 }, // Debe
            { wch: 12 }, // Haber
            { wch: 12 }, // Saldo
            { wch: 6 },  // D/A
          ]

          // Usar solo los primeros 31 caracteres del código de cuenta para el nombre de la hoja
          const sheetName = accountData.account.code.substring(0, 31)
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
        })

        // Crear hoja resumen
        const summaryData = [
          ['LIBRO MAYOR - RESUMEN'],
          [`Período: ${startDate || 'Inicio'} - ${endDate || 'Hoy'}`],
          [],
          ['Código', 'Cuenta', 'Tipo', 'Movimientos', 'Total Debe', 'Total Haber', 'Saldo', 'D/A'],
        ]

        data.accounts.forEach((accountData) => {
          summaryData.push([
            accountData.account.code,
            accountData.account.name,
            ACCOUNT_TYPE_LABELS[accountData.account.accountType],
            accountData.movements.length.toString(),
            accountData.totals.debit.toString(),
            accountData.totals.credit.toString(),
            accountData.totals.balance.toString(),
            accountData.totals.balanceNature === 'DEUDOR' ? 'D' : 'A',
          ])
        })

        const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
        summarySheet['!cols'] = [
          { wch: 12 }, // Código
          { wch: 40 }, // Cuenta
          { wch: 18 }, // Tipo
          { wch: 12 }, // Movimientos
          { wch: 12 }, // Debe
          { wch: 12 }, // Haber
          { wch: 12 }, // Saldo
          { wch: 6 },  // D/A
        ]
        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen', true)
      } else if (data.account && data.movements) {
        // Exportar una sola cuenta
        const sheetData = [
          [`Libro Mayor - ${data.account.code}`],
          [`Cuenta: ${data.account.code} - ${data.account.name}`],
          [`Tipo: ${ACCOUNT_TYPE_LABELS[data.account.accountType]}`],
          [`Período: ${startDate || 'Inicio'} - ${endDate || 'Hoy'}`],
          [],
          ['Fecha', 'Asiento N°', 'Descripción', 'Debe', 'Haber', 'Saldo', 'D/A'],
        ]

        data.movements.forEach((movement) => {
          sheetData.push([
            new Date(movement.journalEntry.date).toLocaleDateString('es-AR'),
            movement.journalEntry.entryNumber.toString(),
            movement.journalEntry.description,
            movement.debit > 0 ? movement.debit.toString() : '',
            movement.credit > 0 ? movement.credit.toString() : '',
            movement.balance.toString(),
            movement.balanceNature === 'DEUDOR' ? 'D' : 'A',
          ])
        })

        sheetData.push([])
        sheetData.push([
          '',
          '',
          'TOTALES',
          data.totals!.debit.toString(),
          data.totals!.credit.toString(),
          data.totals!.balance.toString(),
          data.totals!.balanceNature === 'DEUDOR' ? 'D' : 'A',
        ])

        const worksheet = XLSX.utils.aoa_to_sheet(sheetData)
        worksheet['!cols'] = [
          { wch: 12 },
          { wch: 10 },
          { wch: 40 },
          { wch: 12 },
          { wch: 12 },
          { wch: 12 },
          { wch: 6 },
        ]

        XLSX.utils.book_append_sheet(workbook, worksheet, 'Libro Mayor')
      }

      const fileName = showAll
        ? `libro-mayor-completo-${new Date().toISOString().split('T')[0]}.xlsx`
        : `libro-mayor-${data.account?.code}-${new Date().toISOString().split('T')[0]}.xlsx`

      XLSX.writeFile(workbook, fileName)
      toast.success('Archivo Excel exportado correctamente')
    } catch (error) {
      console.error('Error exporting:', error)
      toast.error('Error al exportar a Excel')
    }
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
              Exportar Excel
            </Button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Consulta</CardTitle>
          <CardDescription>
            Selecciona una cuenta específica o consulta todas las cuentas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="showAll"
                checked={showAll}
                onCheckedChange={(checked) => {
                  setShowAll(checked as boolean)
                  if (checked) {
                    setSelectedAccountId('')
                  }
                }}
              />
              <Label htmlFor="showAll" className="font-normal cursor-pointer">
                Ver todas las cuentas (Libro Mayor completo)
              </Label>
            </div>

            {!showAll && (
              <div className="space-y-2">
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
            )}

            <div className="grid md:grid-cols-2 gap-4">
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
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleSearch} disabled={!showAll && !selectedAccountId}>
              <BookOpen className="mr-2 h-4 w-4" />
              Consultar Libro Mayor
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resultados */}
      {loading && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-gray-500">Cargando movimientos...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && data && data.showAll && data.accounts && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="print:text-center">
              <CardTitle className="print:text-2xl">Libro Mayor Completo</CardTitle>
              <CardDescription className="print:text-base print:text-gray-700 print:mt-2">
                Todas las cuentas con movimientos
                {startDate && endDate && (
                  <> • Del {new Date(startDate).toLocaleDateString('es-AR')} al {new Date(endDate).toLocaleDateString('es-AR')}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label className="text-sm text-gray-600">Total de Cuentas</Label>
                    <p className="text-2xl font-bold text-gray-900">
                      {data.accounts.length}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-600">Total Movimientos</Label>
                    <p className="text-2xl font-bold text-gray-900">
                      {data.accounts.reduce((sum, acc) => sum + acc.movements.length, 0)}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm text-gray-600">Total Debe = Haber</Label>
                    <p className="text-2xl font-bold text-blue-700">
                      ${formatNumber(data.accounts.reduce((sum, acc) => sum + acc.totals.debit, 0))}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {data.accounts.map((accountData) => (
            <Card key={accountData.account.id} className="break-inside-avoid">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {accountData.account.code} - {accountData.account.name}
                    </CardTitle>
                    <CardDescription>
                      {accountData.movements.length} movimientos
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    {ACCOUNT_TYPE_LABELS[accountData.account.accountType]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
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
                      {accountData.movements.map((movement) => (
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
                            {movement.journalEntry.description}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.debit > 0 ? `$${formatNumber(Number(movement.debit))}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.credit > 0 ? `$${formatNumber(Number(movement.credit))}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-gray-900">
                            ${formatNumber(movement.balance)} <span className="text-xs text-gray-600">({movement.balanceNature === 'DEUDOR' ? 'D' : 'A'})</span>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-blue-50 font-bold">
                        <TableCell colSpan={3} className="text-right">
                          TOTALES
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(accountData.totals.debit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(accountData.totals.credit)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-900">
                          ${formatNumber(accountData.totals.balance)} <span className="text-xs">({accountData.totals.balanceNature === 'DEUDOR' ? 'D' : 'A'})</span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && data && !data.showAll && data.account && data.movements && (
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
            {data.movements.length === 0 ? (
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
                            {movement.debit > 0 ? `$${formatNumber(Number(movement.debit))}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {movement.credit > 0 ? `$${formatNumber(Number(movement.credit))}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold text-gray-900">
                            ${formatNumber(movement.balance)} <span className="text-xs text-gray-600">({movement.balanceNature === 'DEUDOR' ? 'D' : 'A'})</span>
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-blue-50 font-bold">
                        <TableCell colSpan={3} className="text-right">
                          TOTALES
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(data.totals!.debit)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${formatNumber(data.totals!.credit)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-900">
                          ${formatNumber(data.totals!.balance)} <span className="text-xs">({data.totals!.balanceNature === 'DEUDOR' ? 'D' : 'A'})</span>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

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
                          ${formatNumber(data.totals!.debit)}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-600">Total Haber</Label>
                        <p className="text-2xl font-bold text-blue-700">
                          ${formatNumber(data.totals!.credit)}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-600">Saldo Final</Label>
                        <p className="text-2xl font-bold text-gray-900">
                          ${formatNumber(data.totals!.balance)} <span className="text-base text-gray-600">({data.totals!.balanceNature === 'DEUDOR' ? 'D' : 'A'})</span>
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
