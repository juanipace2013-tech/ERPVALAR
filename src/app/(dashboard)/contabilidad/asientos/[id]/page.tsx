'use client'

import { useState, useEffect } from 'react'
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
import { ArrowLeft, CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface JournalEntryLine {
  id: string
  description: string
  debit: number
  credit: number
  account: {
    id: string
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
  createdAt: string
  updatedAt: string
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

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ACTIVO: 'Activo',
  PASIVO: 'Pasivo',
  PATRIMONIO_NETO: 'Patrimonio Neto',
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
}

export default function AsientoDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [entry, setEntry] = useState<JournalEntry | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (id) {
      fetchEntry()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const fetchEntry = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/contabilidad/asientos/${id}`)

      if (!response.ok) {
        throw new Error('Error al cargar asiento')
      }

      const data = await response.json()
      setEntry(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar asiento contable')
      router.push('/contabilidad/asientos')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
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
      await fetchEntry()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al confirmar asiento')
    }
  }

  const handleDelete = async () => {
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
      router.push('/contabilidad/asientos')
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al eliminar asiento')
    }
  }

  const getTotalDebit = () => {
    if (!entry) return 0
    return entry.lines.reduce((sum, line) => sum + Number(line.debit), 0)
  }

  const getTotalCredit = () => {
    if (!entry) return 0
    return entry.lines.reduce((sum, line) => sum + Number(line.credit), 0)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <p className="text-gray-500">Cargando asiento...</p>
        </div>
      </div>
    )
  }

  if (!entry) {
    return null
  }

  const StatusIcon = STATUS_ICONS[entry.status]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/contabilidad/asientos">
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-900">
                Asiento N° {entry.entryNumber}
              </h1>
              <Badge className={STATUS_COLORS[entry.status]}>
                <StatusIcon className="mr-1 h-3 w-3" />
                {STATUS_LABELS[entry.status]}
              </Badge>
            </div>
            <p className="text-gray-600 mt-1">
              {new Date(entry.date).toLocaleDateString('es-AR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
              })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {entry.status === 'DRAFT' && (
            <>
              <Button variant="outline" onClick={handleConfirm}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Confirmar
              </Button>
              <Button variant="outline" onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Eliminar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Información General */}
      <Card>
        <CardHeader>
          <CardTitle>Información General</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-gray-600">Descripción</p>
              <p className="text-lg font-medium">{entry.description}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Fecha</p>
              <p className="text-lg font-medium">
                {new Date(entry.date).toLocaleDateString('es-AR')}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Creado</p>
              <p className="text-sm">
                {new Date(entry.createdAt).toLocaleString('es-AR')}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Modificado</p>
              <p className="text-sm">
                {new Date(entry.updatedAt).toLocaleString('es-AR')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Líneas del Asiento */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle del Asiento</CardTitle>
          <CardDescription>
            {entry.lines.length} líneas registradas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Haber</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono font-medium">
                      {line.account.code}
                    </TableCell>
                    <TableCell className="font-medium">
                      {line.account.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {ACCOUNT_TYPE_LABELS[line.account.accountType]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {line.description || '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.debit > 0 ? `$${Number(line.debit).toFixed(2)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {line.credit > 0 ? `$${Number(line.credit).toFixed(2)}` : '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {/* Totales */}
                <TableRow className="bg-blue-50 font-bold">
                  <TableCell colSpan={4} className="text-right">
                    TOTALES
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${getTotalDebit().toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${getTotalCredit().toFixed(2)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Validación */}
          <div className="mt-4 p-4 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <p className="text-sm font-medium text-green-900">
                Asiento balanceado - Debe = Haber
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
