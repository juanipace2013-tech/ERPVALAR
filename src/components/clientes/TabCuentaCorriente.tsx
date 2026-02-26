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
import { Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { formatNumber, formatDateAR } from '@/lib/utils'

interface CCMovimiento {
  fecha: string
  tipo: string
  comprobante: string
  descripcion: string
  debe: number
  haber: number
  saldo: number
}

interface Props {
  colppyId: string
  saldoInicial?: number
}

export default function TabCuentaCorriente({ colppyId, saldoInicial }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [movimientos, setMovimientos] = useState<CCMovimiento[]>([])
  const [saldo, setSaldo] = useState(saldoInicial ?? 0)
  const [totalFacturas, setTotalFacturas] = useState(0)
  const [totalPagos, setTotalPagos] = useState(0)

  const fetchCC = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/colppy/cuenta-corriente?idCliente=${colppyId}`)
      if (!res.ok) throw new Error('Error al cargar cuenta corriente')
      const data = await res.json()
      setMovimientos(data.movimientos || [])
      setSaldo(data.saldo ?? saldoInicial ?? 0)
      setTotalFacturas(data.totalFacturas || 0)
      setTotalPagos(data.totalPagos || 0)
    } catch (e: any) {
      setError(e.message || 'Error al cargar cuenta corriente')
    } finally {
      setLoading(false)
    }
  }, [colppyId, saldoInicial])

  useEffect(() => {
    fetchCC()
  }, [fetchCC])

  const saldoColor = saldo <= 0 ? 'text-green-600' : saldo > 100000 ? 'text-red-600' : 'text-yellow-600'
  const saldoBg = saldo <= 0 ? 'bg-green-50 border-green-200' : saldo > 100000 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'

  return (
    <div className="space-y-4">
      {/* Saldo grande */}
      <Card className={`border-2 ${saldoBg}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Saldo Cuenta Corriente</p>
              <p className={`text-3xl font-bold ${saldoColor}`}>
                $ {formatNumber(saldo)}
              </p>
            </div>
            <div className="text-right text-sm text-gray-500 space-y-1">
              <p>Facturas: <span className="font-semibold text-gray-700">{totalFacturas}</span></p>
              <p>Pagos: <span className="font-semibold text-gray-700">{totalPagos}</span></p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de movimientos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">Movimientos</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchCC}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loading && movimientos.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-600 text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchCC}>
                Reintentar
              </Button>
            </div>
          ) : movimientos.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Sin movimientos registrados</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="whitespace-nowrap">Nro. Comprobante</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Debe</TableHead>
                    <TableHead className="text-right">Haber</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimientos.map((mov, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {mov.fecha ? formatDateAR(mov.fecha) : '—'}
                      </TableCell>
                      <TableCell className="text-sm">{mov.tipo}</TableCell>
                      <TableCell className="font-mono text-sm">{mov.comprobante || '—'}</TableCell>
                      <TableCell className="text-sm text-gray-500 max-w-[200px] truncate">
                        {mov.descripcion || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {mov.debe > 0 ? `$ ${formatNumber(mov.debe)}` : ''}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm text-green-600">
                        {mov.haber > 0 ? `$ ${formatNumber(mov.haber)}` : ''}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-sm font-semibold ${mov.saldo > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        $ {formatNumber(mov.saldo)}
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
