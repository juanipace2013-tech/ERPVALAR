'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { Loader2, RefreshCw, AlertCircle, Wallet } from 'lucide-react'
import { formatNumber, formatDateAR } from '@/lib/utils'

interface ColppyPago {
  idRecibo: string
  numero: string
  fecha: string
  monto: number
  moneda: string
  medioPago: string
  facturaAsociada: string
  descripcion: string
}

interface Props {
  colppyId: string
}

export default function TabPagos({ colppyId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pagos, setPagos] = useState<ColppyPago[]>([])

  const fetchPagos = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/colppy/pagos?idCliente=${colppyId}`)
      if (!res.ok) throw new Error('Error al cargar pagos')
      const data = await res.json()
      setPagos(data.pagos || [])
    } catch (e: any) {
      setError(e.message || 'Error al cargar pagos')
    } finally {
      setLoading(false)
    }
  }, [colppyId])

  useEffect(() => {
    fetchPagos()
  }, [fetchPagos])

  const totalPagos = pagos.reduce((sum, p) => sum + p.monto, 0)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Total Pagos/Recibos</p>
            <p className="text-xl font-bold text-gray-800">{pagos.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Total Cobrado</p>
            <p className="text-xl font-bold text-green-600">$ {formatNumber(totalPagos)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">Historial de Pagos</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchPagos} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loading && pagos.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-600 text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchPagos}>
                Reintentar
              </Button>
            </div>
          ) : pagos.length === 0 ? (
            <div className="text-center py-8">
              <Wallet className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-400">Sin pagos registrados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead>Medio de Pago</TableHead>
                    <TableHead>Factura Asociada</TableHead>
                    <TableHead>Descripción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagos.map((p, i) => (
                    <TableRow key={p.idRecibo || i}>
                      <TableCell className="text-sm whitespace-nowrap">
                        {p.fecha ? formatDateAR(p.fecha) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{p.numero || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold text-green-600">
                        $ {formatNumber(p.monto)}
                      </TableCell>
                      <TableCell className="text-sm">{p.medioPago || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{p.facturaAsociada || '—'}</TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-[200px] truncate">
                        {p.descripcion || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
