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
import { Plus, Search, FileText, CheckCircle, XCircle, Clock } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface JournalEntryLine {
  id: string
  accountId: string
  description: string
  debit: number
  credit: number
  account: {
    code: string
    name: string
  }
}

interface JournalEntry {
  id: string
  entryNumber: number
  date: string
  description: string
  status: string
  lines: JournalEntryLine[]
  _count: {
    lines: number
  }
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  POSTED: 'Confirmado',
  VOIDED: 'Anulado',
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  POSTED: 'bg-green-100 text-green-700',
  VOIDED: 'bg-red-100 text-red-700',
}

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  DRAFT: Clock,
  POSTED: CheckCircle,
  VOIDED: XCircle,
}

export default function AsientosPage() {
  const router = useRouter()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetchEntries()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, page])

  const fetchEntries = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()

      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }

      params.append('page', page.toString())
      params.append('limit', '20')

      const response = await fetch(`/api/contabilidad/asientos?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar asientos')
      }

      const data = await response.json()
      setEntries(data.entries)
      setTotal(data.pagination.total)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar asientos contables')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async (id: string) => {
    if (!confirm('¿Confirmar este asiento? No podrá ser modificado después.')) {
      return
    }

    try {
      const response = await fetch(`/api/contabilidad/asientos/${id}/confirm`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al confirmar asiento')
      }

      toast.success('Asiento confirmado exitosamente')
      fetchEntries()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al confirmar asiento')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este asiento? Esta acción no se puede deshacer.')) {
      return
    }

    try {
      const response = await fetch(`/api/contabilidad/asientos/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al eliminar asiento')
      }

      toast.success('Asiento eliminado exitosamente')
      fetchEntries()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al eliminar asiento')
    }
  }

  const filteredEntries = entries.filter(entry =>
    entry.description.toLowerCase().includes(search.toLowerCase()) ||
    entry.entryNumber.toString().includes(search)
  )

  const getTotalDebit = (lines: JournalEntryLine[]) => {
    return lines.reduce((sum, line) => sum + Number(line.debit), 0)
  }

  const getTotalCredit = (lines: JournalEntryLine[]) => {
    return lines.reduce((sum, line) => sum + Number(line.credit), 0)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Asientos Contables</h1>
          <p className="text-gray-600 mt-1">
            Registra y gestiona asientos de debe y haber
          </p>
        </div>
        <Link href="/contabilidad/asientos/nuevo">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Asiento
          </Button>
        </Link>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Asientos Contables</CardTitle>
          <CardDescription>
            {total} asientos registrados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-6 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por número o descripción..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="DRAFT">Borrador</SelectItem>
                <SelectItem value="POSTED">Confirmado</SelectItem>
                <SelectItem value="VOIDED">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Cargando...</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No hay asientos registrados
              </h3>
              <p className="text-gray-600 mb-4">
                Comienza creando tu primer asiento contable
              </p>
              <Link href="/contabilidad/asientos/nuevo">
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Crear Asiento
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N°</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Debe</TableHead>
                    <TableHead className="text-right">Haber</TableHead>
                    <TableHead className="text-center">Líneas</TableHead>
                    <TableHead className="text-center">Estado</TableHead>
                    <TableHead className="text-center">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => {
                    const StatusIcon = STATUS_ICONS[entry.status]
                    return (
                      <TableRow
                        key={entry.id}
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => router.push(`/contabilidad/asientos/${entry.id}`)}
                      >
                        <TableCell className="font-mono font-medium">
                          {entry.entryNumber}
                        </TableCell>
                        <TableCell>
                          {new Date(entry.date).toLocaleDateString('es-AR')}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {entry.description}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${getTotalDebit(entry.lines).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${getTotalCredit(entry.lines).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{entry._count.lines}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={STATUS_COLORS[entry.status]}>
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {STATUS_LABELS[entry.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex gap-2 justify-center" onClick={(e) => e.stopPropagation()}>
                            {entry.status === 'DRAFT' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleConfirm(entry.id)}
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDelete(entry.id)}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
