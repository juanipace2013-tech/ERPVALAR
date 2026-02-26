'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Loader2, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react'
import { formatNumber, formatDateAR } from '@/lib/utils'

interface ColppyFactura {
  idFactura: string
  numero: string
  tipo: string
  tipoComprobante: string
  fecha: string
  fechaVto: string
  total: number
  saldo: number
  estado: string
  moneda: string
  tipoCambio: number
  condicionPago: string
  descripcion: string
}

interface Props {
  colppyId: string
}

function estadoBadge(factura: ColppyFactura): { label: string; className: string } {
  const saldo = factura.saldo ?? factura.total
  if (saldo <= 0) return { label: 'Pagada', className: 'bg-green-100 text-green-800' }

  // Verificar vencimiento
  if (factura.fechaVto) {
    const vto = new Date(factura.fechaVto)
    const hoy = new Date()
    if (vto < hoy) {
      const diasAtraso = Math.floor((hoy.getTime() - vto.getTime()) / (1000 * 60 * 60 * 24))
      return { label: `Vencida (${diasAtraso}d)`, className: 'bg-red-100 text-red-800' }
    }
  }

  return { label: 'Pendiente', className: 'bg-yellow-100 text-yellow-800' }
}

function tipoLabel(factura: ColppyFactura): string {
  const tipo = factura.tipo || ''
  const comp = factura.tipoComprobante || ''
  // Notas de crédito
  if (['6', '8', '13'].includes(comp)) return `NC ${tipo}`
  return `FC ${tipo}`
}

export default function TabFacturas({ colppyId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [facturas, setFacturas] = useState<ColppyFactura[]>([])
  const [filtroEstado, setFiltroEstado] = useState('todas')

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

  // Filtrar por estado
  const facturasFiltradas = useMemo(() => {
    if (filtroEstado === 'todas') return facturas
    return facturas.filter((f) => {
      const badge = estadoBadge(f)
      if (filtroEstado === 'pendientes') return badge.label === 'Pendiente'
      if (filtroEstado === 'pagadas') return badge.label === 'Pagada'
      if (filtroEstado === 'vencidas') return badge.label.startsWith('Vencida')
      return true
    })
  }, [facturas, filtroEstado])

  // Facturas vencidas destacadas
  const vencidas = useMemo(
    () => facturas.filter((f) => estadoBadge(f).label.startsWith('Vencida')),
    [facturas]
  )

  const totalPendiente = useMemo(
    () => facturas.reduce((sum, f) => sum + (f.saldo > 0 ? f.saldo : 0), 0),
    [facturas]
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
                  Total pendiente vencido: $ {formatNumber(vencidas.reduce((s, f) => s + f.saldo, 0))}
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
            <p className="text-xs text-gray-500">Total Facturas</p>
            <p className="text-xl font-bold text-gray-800">{facturas.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500">Total Pendiente</p>
            <p className="text-xl font-bold text-yellow-600">$ {formatNumber(totalPendiente)}</p>
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

      {/* Tabla */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg">Historial de Facturas</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filtroEstado} onValueChange={setFiltroEstado}>
              <SelectTrigger className="h-8 w-[140px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="pendientes">Pendientes</SelectItem>
                <SelectItem value="pagadas">Pagadas</SelectItem>
                <SelectItem value="vencidas">Vencidas</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchFacturas} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
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
          ) : facturasFiltradas.length === 0 ? (
            <p className="text-center text-gray-400 py-8">
              {facturas.length === 0 ? 'Sin facturas registradas' : 'Sin facturas para el filtro seleccionado'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facturasFiltradas.map((f, i) => {
                    const badge = estadoBadge(f)
                    return (
                      <TableRow key={f.idFactura || i}>
                        <TableCell className="text-sm font-medium">{tipoLabel(f)}</TableCell>
                        <TableCell className="font-mono text-sm">{f.numero || '—'}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {f.fecha ? formatDateAR(f.fecha) : '—'}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {f.fechaVto ? formatDateAR(f.fechaVto) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          $ {formatNumber(f.total)}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm ${f.saldo > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}`}>
                          $ {formatNumber(f.saldo)}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${badge.className} text-xs`}>{badge.label}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {facturas.length > 0 && (
            <p className="text-xs text-gray-400 mt-3 text-right">
              Mostrando {facturasFiltradas.length} de {facturas.length} facturas
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
