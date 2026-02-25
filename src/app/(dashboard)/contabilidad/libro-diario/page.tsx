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
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Calendar, FileText, Download, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/utils'

interface JournalEntryLine {
  id: string
  description: string
  debit: number
  credit: number
  account: {
    code: string
    name: string
    accountType: string
  }
}

interface JournalEntry {
  id: string
  entryNumber: number
  date: string
  description: string
  status: string
  lines: JournalEntryLine[]
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  POSTED: 'bg-green-100 text-green-700',
  VOIDED: 'bg-red-100 text-red-700',
}

export default function LibroDiarioPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showOnlyConfirmed, setShowOnlyConfirmed] = useState(true)

  useEffect(() => {
    fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()

      if (showOnlyConfirmed) {
        params.append('status', 'POSTED')
      }

      if (startDate) {
        params.append('startDate', startDate)
      }

      if (endDate) {
        params.append('endDate', endDate)
      }

      params.append('limit', '1000') // Cargar todos para el libro

      const response = await fetch(`/api/contabilidad/asientos?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar asientos')
      }

      const data = await response.json()
      setEntries(data.entries)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar libro diario')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const handleFilter = () => {
    fetchEntries()
  }

  const getTotalDebit = (lines: JournalEntryLine[]) => {
    return lines.reduce((sum, line) => sum + Number(line.debit), 0)
  }

  const getTotalCredit = (lines: JournalEntryLine[]) => {
    return lines.reduce((sum, line) => sum + Number(line.credit), 0)
  }

  const getGrandTotalDebit = () => {
    return entries.reduce((sum, entry) => sum + getTotalDebit(entry.lines), 0)
  }

  const getGrandTotalCredit = () => {
    return entries.reduce((sum, entry) => sum + getTotalCredit(entry.lines), 0)
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    toast.info('Función de exportación en desarrollo')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Libro Diario</h1>
          <p className="text-gray-600 mt-1">
            Registro cronológico de asientos contables
          </p>
        </div>
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
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>
            Selecciona el período a consultar
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
            <div className="space-y-2">
              <Label>Opciones</Label>
              <div className="flex items-center gap-2 h-10">
                <input
                  type="checkbox"
                  id="confirmed"
                  checked={showOnlyConfirmed}
                  onChange={(e) => setShowOnlyConfirmed(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="confirmed" className="text-sm">
                  Solo asientos confirmados
                </label>
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={handleFilter}>
              <Calendar className="mr-2 h-4 w-4" />
              Aplicar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Libro Diario */}
      <Card>
        <CardHeader className="print:text-center">
          <CardTitle className="print:text-2xl">Libro Diario</CardTitle>
          <CardDescription className="print:text-base print:text-gray-700">
            {entries.length} asientos registrados
            {startDate && endDate && (
              <> • Del {new Date(startDate).toLocaleDateString('es-AR')} al {new Date(endDate).toLocaleDateString('es-AR')}</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12">
              <p className="text-gray-500">Cargando libro diario...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No hay asientos en este período
              </h3>
              <p className="text-gray-600">
                Ajusta los filtros para ver más resultados
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {entries.map((entry) => (
                <div key={entry.id} className="border rounded-lg p-4 print:break-inside-avoid">
                  {/* Encabezado del Asiento */}
                  <div className="flex items-center justify-between mb-3 pb-3 border-b">
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Asiento N°</p>
                        <p className="text-xl font-bold text-gray-900">{entry.entryNumber}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Fecha</p>
                        <p className="font-medium">
                          {new Date(entry.date).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                      <div className="print:hidden">
                        <Badge className={STATUS_COLORS[entry.status]}>
                          {entry.status === 'POSTED' ? 'Confirmado' :
                           entry.status === 'DRAFT' ? 'Borrador' : 'Anulado'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Descripción */}
                  <div className="mb-3">
                    <p className="text-sm font-medium text-gray-900">{entry.description}</p>
                  </div>

                  {/* Líneas del Asiento */}
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[120px]">Código</TableHead>
                          <TableHead>Cuenta</TableHead>
                          <TableHead>Detalle</TableHead>
                          <TableHead className="text-right w-[130px]">Debe</TableHead>
                          <TableHead className="text-right w-[130px]">Haber</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entry.lines.map((line) => (
                          <TableRow key={line.id}>
                            <TableCell className="font-mono text-sm">
                              {line.account.code}
                            </TableCell>
                            <TableCell className="font-medium">
                              {line.account.name}
                            </TableCell>
                            <TableCell className="text-sm text-gray-600">
                              {line.description || '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {line.debit > 0 ? `$${formatNumber(Number(line.debit))}` : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {line.credit > 0 ? `$${formatNumber(Number(line.credit))}` : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totales del Asiento */}
                        <TableRow className="bg-gray-50 font-semibold">
                          <TableCell colSpan={3} className="text-right">
                            Totales del Asiento
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${formatNumber(getTotalDebit(entry.lines))}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            ${formatNumber(getTotalCredit(entry.lines))}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}

              {/* Totales Generales */}
              <Card className="bg-blue-50 border-blue-200 print:break-inside-avoid">
                <CardContent className="pt-6">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <Label className="text-sm text-gray-600">Total Asientos</Label>
                      <p className="text-2xl font-bold text-gray-900">
                        {entries.length}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-600">Total Debe</Label>
                      <p className="text-2xl font-bold text-blue-700">
                        ${formatNumber(getGrandTotalDebit())}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-600">Total Haber</Label>
                      <p className="text-2xl font-bold text-blue-700">
                        ${formatNumber(getGrandTotalCredit())}
                      </p>
                    </div>
                  </div>
                  {Math.abs(getGrandTotalDebit() - getGrandTotalCredit()) < 0.01 ? (
                    <p className="text-sm text-green-600 mt-4 text-center">
                      ✓ Libro balanceado - Debe = Haber
                    </p>
                  ) : (
                    <p className="text-sm text-red-600 mt-4 text-center">
                      ✗ Diferencia: ${formatNumber(Math.abs(getGrandTotalDebit() - getGrandTotalCredit()))}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
