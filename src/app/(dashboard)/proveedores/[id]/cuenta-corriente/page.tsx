'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  ArrowLeft,
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'

interface Movement {
  date: string
  type: string
  reference: string
  description: string
  debit: number
  credit: number
  balance: number
}

interface AccountStatement {
  supplier: {
    id: string
    name: string
    taxId: string | null
    balance: number
  }
  movements: Movement[]
  currentBalance: number
  totalInvoices: number
  totalPayments: number
}

export default function SupplierAccountStatementPage() {
  const router = useRouter()
  const params = useParams()
  const [statement, setStatement] = useState<AccountStatement | null>(null)
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    if (params.id) {
      fetchStatement()
    }
  }, [params.id])

  const fetchStatement = async () => {
    try {
      setLoading(true)
      const queryParams = new URLSearchParams()
      if (startDate) queryParams.append('startDate', startDate)
      if (endDate) queryParams.append('endDate', endDate)

      const response = await fetch(
        `/api/proveedores/${params.id}/account-statement?${queryParams.toString()}`
      )

      if (!response.ok) {
        throw new Error('Error al cargar estado de cuenta')
      }

      const data = await response.json()
      setStatement(data)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar estado de cuenta')
    } finally {
      setLoading(false)
    }
  }

  const handleFilter = () => {
    fetchStatement()
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const formatCurrency = (amount: number) => {
    return `$${Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!statement) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="text-center">
          <p className="text-gray-600">No se pudo cargar el estado de cuenta</p>
          <Button asChild className="mt-4">
            <Link href="/proveedores">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver al listado
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" asChild>
            <Link href={`/proveedores/${params.id}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cuenta Corriente</h1>
            <p className="text-gray-600 mt-1">
              {statement.supplier.name}
              {statement.supplier.taxId && ` - CUIT: ${statement.supplier.taxId}`}
            </p>
          </div>
        </div>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Desde</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Hasta</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleFilter} className="w-full">
                Aplicar Filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Compras</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatCurrency(statement.totalInvoices)}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Pagado</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(statement.totalPayments)}
                </p>
              </div>
              <TrendingDown className="h-8 w-8 text-green-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Saldo Actual</p>
                <p className="text-2xl font-bold text-orange-600">
                  {formatCurrency(statement.currentBalance)}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Movements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
        </CardHeader>
        <CardContent>
          {statement.movements.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600">No hay movimientos en el período seleccionado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Debe</TableHead>
                    <TableHead className="text-right">Haber</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.movements.map((movement, index) => (
                    <TableRow key={index}>
                      <TableCell>{formatDate(movement.date)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={movement.type === 'INVOICE' ? 'destructive' : 'default'}
                        >
                          {movement.type === 'INVOICE' ? 'Factura' : 'Pago'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {movement.reference}
                      </TableCell>
                      <TableCell>{movement.description}</TableCell>
                      <TableCell className="text-right font-semibold text-red-600">
                        {movement.debit > 0 ? formatCurrency(movement.debit) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-green-600">
                        {movement.credit > 0 ? formatCurrency(movement.credit) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-bold">
                        {formatCurrency(movement.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t-2">
                    <TableCell colSpan={4} className="text-right">
                      Totales:
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {formatCurrency(statement.totalInvoices)}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      {formatCurrency(statement.totalPayments)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">
                      {formatCurrency(statement.currentBalance)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
