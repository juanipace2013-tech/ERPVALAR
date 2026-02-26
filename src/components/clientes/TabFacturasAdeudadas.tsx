'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { Loader2, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react'
import { formatNumber, formatDateAR } from '@/lib/utils'

/**
 * Replica la vista "Facturas adeudadas por el cliente" de Colppy.
 * Columnas: Nro. Comprobante | Tipo | Fecha pago | Descripción | Valor ME | Total | Cobrado | Saldo | Saldo acumulado
 * Solo muestra facturas con saldo pendiente (no pagadas completamente).
 */

interface ColppyFactura {
  idFactura: string
  numero: string
  tipo: string
  tipoComprobante: string
  tipoLabel: string
  fecha: string
  fechaVto: string
  total: number
  cobrado: number
  saldo: number
  estado: string
  moneda: string
  monedaLabel: string
  tipoCambio: number
  valorME: number
  condicionPago: string
  descripcion: string
}

interface Props {
  colppyId: string
}

export default function TabFacturasAdeudadas({ colppyId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [facturas, setFacturas] = useState<ColppyFactura[]>([])

  const fetchFacturas = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/colppy/facturas?idCliente=${colppyId}`)
      if (!res.ok) throw new Error('Error al cargar facturas')
      const data = await res.json()
      setFacturas(data.facturas || [])
    } catch (e: any) {
      setError(e.message || 'Error al cargar facturas')
    } finally {
      setLoading(false)
    }
  }, [colppyId])

  useEffect(() => {
    fetchFacturas()
  }, [fetchFacturas])

  // Solo facturas con saldo pendiente, ordenadas por fecha asc para saldo acumulado
  const facturasAdeudadas = useMemo(() => {
    const pendientes = facturas
      .filter((f) => f.saldo > 0.01) // Excluir pagadas (margen redondeo)
      .sort((a, b) => (a.fechaVto || a.fecha || '').localeCompare(b.fechaVto || b.fecha || ''))

    // Calcular saldo acumulado
    let acumulado = 0
    return pendientes.map((f) => {
      acumulado += f.saldo
      return { ...f, saldoAcumulado: acumulado }
    })
  }, [facturas])

  // Facturas vencidas
  const vencidas = useMemo(() => {
    const hoy = new Date()
    return facturasAdeudadas.filter((f) => {
      if (!f.fechaVto) return false
      return new Date(f.fechaVto) < hoy
    })
  }, [facturasAdeudadas])

  const totalPendiente = useMemo(
    () => facturasAdeudadas.reduce((sum, f) => sum + f.saldo, 0),
    [facturasAdeudadas]
  )

  return (
    <div className="space-y-4">
      {/* Alerta vencidas */}
      {vencidas.length > 0 && (
        <Card className="border-2 border-red-200 bg-red-50">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">
                  {vencidas.length} factura{vencidas.length > 1 ? 's' : ''} vencida{vencidas.length > 1 ? 's' : ''}
                </p>
                <p className="text-xs text-red-600">
                  Total vencido: $ {formatNumber(vencidas.reduce((s, f) => s + f.saldo, 0))}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Facturas Adeudadas</p>
            <p className="text-xl font-bold text-gray-800">{facturasAdeudadas.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Total Adeudado</p>
            <p className="text-xl font-bold text-red-600">$ {formatNumber(totalPendiente)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Vencidas</p>
            <p className={`text-xl font-bold ${vencidas.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {vencidas.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla replicando Colppy */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">Facturas adeudadas por el cliente</CardTitle>
          <Button variant="outline" size="sm" onClick={fetchFacturas} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loading && facturas.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-red-600 text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={fetchFacturas}>
                Reintentar
              </Button>
            </div>
          ) : facturasAdeudadas.length === 0 ? (
            <p className="text-center text-gray-400 py-8">
              {facturas.length === 0 ? 'Sin facturas registradas' : 'Sin facturas adeudadas'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="whitespace-nowrap">Nro. Comprobante</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="whitespace-nowrap">Fecha pago</TableHead>
                    <TableHead>Descripci&oacute;n</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Valor ME</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Cobrado</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Saldo acum.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facturasAdeudadas.map((f, i) => {
                    const isVencida = f.fechaVto ? new Date(f.fechaVto) < new Date() : false
                    return (
                      <TableRow key={f.idFactura || i} className={isVencida ? 'bg-red-50' : ''}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {f.numero || '\u2014'}
                        </TableCell>
                        <TableCell className="text-xs font-medium whitespace-nowrap">
                          {f.tipoLabel}
                        </TableCell>
                        <TableCell className={`text-xs whitespace-nowrap ${isVencida ? 'text-red-600 font-semibold' : ''}`}>
                          {f.fechaVto ? formatDateAR(f.fechaVto) : '\u2014'}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500 max-w-[150px] truncate">
                          {f.descripcion || '\u2014'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-gray-400">
                          {f.valorME > 0 ? `$ ${formatNumber(f.valorME)}` : '\u2014'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          $ {formatNumber(f.total)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-green-600">
                          {f.cobrado > 0 ? `$ ${formatNumber(f.cobrado)}` : '\u2014'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-red-600 font-semibold">
                          $ {formatNumber(f.saldo)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-red-700">
                          $ {formatNumber(f.saldoAcumulado)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
                {/* Totals row */}
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td colSpan={5} className="px-4 py-2 text-xs text-right text-gray-600">
                      TOTALES
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      $ {formatNumber(facturasAdeudadas.reduce((s, f) => s + f.total, 0))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-green-600">
                      $ {formatNumber(facturasAdeudadas.reduce((s, f) => s + f.cobrado, 0))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-red-600">
                      $ {formatNumber(totalPendiente)}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}
          {facturas.length > 0 && (
            <p className="text-xs text-gray-400 mt-3 text-right">
              {facturasAdeudadas.length} adeudada{facturasAdeudadas.length !== 1 ? 's' : ''} de {facturas.length} total
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
