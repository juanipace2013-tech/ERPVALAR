'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
  Plus,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDateAR, formatNumber, parseDecimalAR } from '@/lib/utils'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

interface Linea {
  id: string
  clienteNombre: string
  presupuesto: string
  numeroFactura: string | null
  fecha: string | null // fecha propia de la NC manual
  facturaParcialId: string | null
  importeFacturadoUsd: string | null
  tipoOperacion: 'BILLETE' | 'DIVISA'
  tipoCambio: string | null
  tasaAplicada: string | null
  comisionUsd: string | null
  comisionArs: string | null
  estado: string
  facturaParcial: { fecha: string } | null
}

type OrdenCampo = 'fecha' | 'cliente' | 'importe'

interface Ajuste {
  id: string
  concepto: string
  montoArs: string
}

interface Liquidacion {
  id: string
  anio: number
  mes: number
  estado: 'ABIERTA' | 'CERRADA'
  totalFacturadoUsd: string
  tasaMes: string | null
  basicoArs: string
  comisionesArs: string
  netoArs: string
  efectivoArs: string | null
  mlArs: string | null
  notas: string | null
  cerradaEn: string | null
  vendedor?: { id: string; name: string }
  lineas: Linea[]
  ajustes: Ajuste[]
}

export default function LiquidacionPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [liq, setLiq] = useState<Liquidacion | null>(null)
  const [loading, setLoading] = useState(true)
  const [accionando, setAccionando] = useState(false)
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [ncCliente, setNcCliente] = useState('')
  const [ncNumero, setNcNumero] = useState('')
  const [ncFecha, setNcFecha] = useState('')
  const [ncMonto, setNcMonto] = useState('')
  const [vsfCliente, setVsfCliente] = useState('')
  const [vsfRef, setVsfRef] = useState('')
  const [vsfFecha, setVsfFecha] = useState('')
  const [vsfMonto, setVsfMonto] = useState('')
  const [basico, setBasico] = useState('')
  const [efectivo, setEfectivo] = useState('')
  const [ml, setMl] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [ordenCampo, setOrdenCampo] = useState<OrdenCampo | null>(null)
  const [ordenAsc, setOrdenAsc] = useState(true)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/comisiones/liquidaciones/${params.id}`)
      if (!res.ok) throw new Error()
      const json = await res.json()
      setLiq(json.liquidacion)
      setBasico(formatNumber(Number(json.liquidacion.basicoArs)))
      setEfectivo(json.liquidacion.efectivoArs ? formatNumber(Number(json.liquidacion.efectivoArs)) : '')
      setMl(json.liquidacion.mlArs ? formatNumber(Number(json.liquidacion.mlArs)) : '')
    } catch {
      toast.error('No se pudo cargar la liquidación')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    cargar()
  }, [cargar])

  const accion = async (fn: () => Promise<Response>, okMsg: string) => {
    setAccionando(true)
    try {
      const res = await fn()
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error')
      toast.success(okMsg)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error')
    } finally {
      setAccionando(false)
    }
  }

  const refrescar = () =>
    accion(
      () => fetch(`/api/comisiones/liquidaciones/${params.id}/refrescar`, { method: 'POST' }),
      'Líneas sincronizadas con las facturas del mes'
    )

  const cerrar = () =>
    accion(
      () => fetch(`/api/comisiones/liquidaciones/${params.id}/cerrar`, { method: 'POST' }),
      'Liquidación cerrada: tasa y montos congelados'
    )

  const reabrir = () =>
    accion(
      () => fetch(`/api/comisiones/liquidaciones/${params.id}/reabrir`, { method: 'POST' }),
      'Liquidación reabierta'
    )

  const guardarCampos = (payload: Record<string, unknown>, okMsg: string) =>
    accion(
      () =>
        fetch(`/api/comisiones/liquidaciones/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }),
      okMsg
    )

  const agregarAjuste = () => {
    const montoNum = parseDecimalAR(monto)
    if (!concepto.trim() || montoNum === 0) {
      toast.error('Concepto y monto (con signo: negativo resta)')
      return
    }
    setConcepto('')
    setMonto('')
    accion(
      () =>
        fetch(`/api/comisiones/liquidaciones/${params.id}/ajustes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concepto: concepto.trim(), montoArs: montoNum }),
        }),
      'Ajuste agregado'
    )
  }

  const eliminarAjuste = (id: string) =>
    accion(
      () => fetch(`/api/comisiones/ajustes/${id}`, { method: 'DELETE' }),
      'Ajuste eliminado'
    )

  const agregarNC = () => {
    const montoNum = parseDecimalAR(ncMonto)
    if (!ncCliente.trim() || montoNum <= 0) {
      toast.error('Cliente y monto USD de la NC (positivo: se resta solo)')
      return
    }
    setNcCliente('')
    setNcNumero('')
    setNcFecha('')
    setNcMonto('')
    accion(
      () =>
        fetch(`/api/comisiones/liquidaciones/${params.id}/lineas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clienteNombre: ncCliente.trim(),
            numeroNota: ncNumero.trim() || undefined,
            fecha: ncFecha || undefined,
            montoUsd: montoNum,
          }),
        }),
      'NC agregada: resta de la comisión del mes'
    )
  }

  const agregarVentaSF = () => {
    const montoNum = parseDecimalAR(vsfMonto)
    if (!vsfCliente.trim() || montoNum <= 0) {
      toast.error('Cliente y monto USD de la venta (positivo: suma solo)')
      return
    }
    setVsfCliente('')
    setVsfRef('')
    setVsfFecha('')
    setVsfMonto('')
    accion(
      () =>
        fetch(`/api/comisiones/liquidaciones/${params.id}/lineas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo: 'VENTA_SIN_FACTURA',
            clienteNombre: vsfCliente.trim(),
            numeroNota: vsfRef.trim() || undefined,
            fecha: vsfFecha || undefined,
            montoUsd: montoNum,
          }),
        }),
      'Venta S/F agregada: suma al facturado del mes'
    )
  }

  const eliminarLineaManual = (lineaId: string) =>
    accion(
      () => fetch(`/api/comisiones/lineas/${lineaId}`, { method: 'DELETE' }),
      'Línea eliminada'
    )

  const cambiarTipoOperacion = (lineaId: string, tipo: string) =>
    accion(
      () =>
        fetch(`/api/comisiones/lineas/${lineaId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipoOperacion: tipo }),
        }),
      'Tipo de operación actualizado'
    )

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!liq) {
    return <div className="p-6 text-muted-foreground">Liquidación no encontrada.</div>
  }

  const abierta = liq.estado === 'ABIERTA'
  const ajustesTotal = liq.ajustes.reduce((s, a) => s + Number(a.montoArs), 0)
  const tcFaltante = abierta && liq.lineas.some((l) => l.tipoCambio === null)

  const ordenarPor = (campo: OrdenCampo) => {
    if (ordenCampo === campo) {
      setOrdenAsc(!ordenAsc)
    } else {
      setOrdenCampo(campo)
      setOrdenAsc(campo === 'cliente') // cliente arranca A-Z; fecha e importe, descendente
    }
  }

  const iconoOrden = (campo: OrdenCampo) => {
    if (ordenCampo !== campo) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />
    return ordenAsc ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
  }

  const filtro = filtroCliente.trim().toLowerCase()
  const lineasVisibles = liq.lineas.filter(
    (l) => !filtro || l.clienteNombre.toLowerCase().includes(filtro)
  )
  if (ordenCampo) {
    lineasVisibles.sort((a, b) => {
      let cmp = 0
      if (ordenCampo === 'cliente') {
        cmp = a.clienteNombre.localeCompare(b.clienteNombre, 'es')
      } else if (ordenCampo === 'importe') {
        cmp = Number(a.importeFacturadoUsd ?? 0) - Number(b.importeFacturadoUsd ?? 0)
      } else {
        const fechaDe = (l: Linea) => l.facturaParcial?.fecha ?? l.fecha
        const fa = fechaDe(a) ? new Date(fechaDe(a)!).getTime() : 0
        const fb = fechaDe(b) ? new Date(fechaDe(b)!).getTime() : 0
        cmp = fa - fb
      }
      return ordenAsc ? cmp : -cmp
    })
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/comisiones')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              Liquidación {MESES[liq.mes - 1]} {liq.anio}
              {liq.vendedor ? ` — ${liq.vendedor.name}` : ''}
            </h1>
            <p className="text-sm text-muted-foreground">
              {liq.lineas.length} facturas ·{' '}
              <Badge
                variant="outline"
                className={
                  abierta
                    ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                    : 'bg-green-100 text-green-800 border-green-300'
                }
              >
                {liq.estado}
              </Badge>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => window.open(`/api/comisiones/liquidaciones/${params.id}/export`, '_blank')}
          >
            <Download className="h-4 w-4 mr-2" /> Excel
          </Button>
          {abierta ? (
            <>
              <Button variant="outline" onClick={refrescar} disabled={accionando}>
                <RefreshCw className="h-4 w-4 mr-2" /> Refrescar facturas
              </Button>
              <Button onClick={cerrar} disabled={accionando}>
                <Lock className="h-4 w-4 mr-2" /> Cerrar liquidación
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={reabrir} disabled={accionando}>
              <LockOpen className="h-4 w-4 mr-2" /> Reabrir
            </Button>
          )}
        </div>
      </div>

      {tcFaltante && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          Falta cargar el tipo de cambio de {MESES[liq.mes - 1]} {liq.anio} (se carga desde el
          dashboard de Comisiones). Sin TC no se puede cerrar.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Facturado (USD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(liq.totalFacturadoUsd, 'USD')}</div>
            <p className="text-xs text-muted-foreground">
              Tasa {liq.tasaMes != null ? `${formatNumber(Number(liq.tasaMes) * 100)}%` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Básico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={basico}
              onChange={(e) => setBasico(e.target.value)}
              disabled={!abierta}
              onBlur={() => {
                const val = parseDecimalAR(basico)
                if (val !== Number(liq.basicoArs)) {
                  guardarCampos({ basicoArs: val }, 'Básico actualizado')
                }
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Comisiones (ARS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(liq.comisionesArs, 'ARS')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ajustes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-xl font-bold ${ajustesTotal < 0 ? 'text-red-600' : ''}`}>
              {formatCurrency(ajustesTotal, 'ARS')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Neto</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold">{formatCurrency(liq.netoArs, 'ARS')}</div>
            <p className="text-xs text-muted-foreground">básico + comisiones + ajustes</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Ventas facturadas del mes</CardTitle>
            <Input
              placeholder="Buscar cliente..."
              className="h-8 w-56"
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
            />
          </CardHeader>
          <CardContent>
            {liq.lineas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                Sin facturas en el mes. Usá &quot;Refrescar facturas&quot; si facturaste hace poco.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        type="button"
                        className="flex items-center hover:text-foreground"
                        onClick={() => ordenarPor('fecha')}
                      >
                        Fecha {iconoOrden('fecha')}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        className="flex items-center hover:text-foreground"
                        onClick={() => ordenarPor('cliente')}
                      >
                        Cliente {iconoOrden('cliente')}
                      </button>
                    </TableHead>
                    <TableHead>Presupuesto</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead className="text-right">
                      <button
                        type="button"
                        className="ml-auto flex items-center hover:text-foreground"
                        onClick={() => ordenarPor('importe')}
                      >
                        Importe USD {iconoOrden('importe')}
                      </button>
                    </TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">TC</TableHead>
                    <TableHead className="text-right">Com. USD</TableHead>
                    <TableHead className="text-right">Com. ARS</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineasVisibles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                        Sin resultados para &quot;{filtroCliente}&quot;
                      </TableCell>
                    </TableRow>
                  )}
                  {lineasVisibles.map((l) => {
                    const esNC = Number(l.importeFacturadoUsd ?? 0) < 0
                    const esVentaSF = l.presupuesto === 'VENTA S/F'
                    const esManual = l.facturaParcialId === null && (esNC || esVentaSF)
                    const rojo = esNC ? 'text-red-600' : ''
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDateAR(l.facturaParcial?.fecha ?? l.fecha)}
                        </TableCell>
                        <TableCell className="max-w-52 truncate">{l.clienteNombre}</TableCell>
                        <TableCell>
                          {esVentaSF ? (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 text-amber-800 border-amber-300 whitespace-nowrap"
                            >
                              Venta S/F
                            </Badge>
                          ) : (
                            l.presupuesto
                          )}
                        </TableCell>
                        <TableCell>{l.numeroFactura || 'S/F'}</TableCell>
                        <TableCell className={`text-right ${rojo}`}>
                          {formatCurrency(l.importeFacturadoUsd ?? 0, 'USD')}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={l.tipoOperacion}
                            onValueChange={(v) => cambiarTipoOperacion(l.id, v)}
                            disabled={!abierta || accionando}
                          >
                            <SelectTrigger className="w-28 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="BILLETE">Billete</SelectItem>
                              <SelectItem value="DIVISA">Divisa</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          {l.tipoCambio != null ? formatNumber(Number(l.tipoCambio)) : '—'}
                        </TableCell>
                        <TableCell className={`text-right ${rojo}`}>
                          {l.comisionUsd != null ? formatCurrency(l.comisionUsd, 'USD') : '—'}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${rojo}`}>
                          {l.comisionArs != null ? formatCurrency(l.comisionArs, 'ARS') : '—'}
                        </TableCell>
                        <TableCell>
                          {abierta && esManual && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => eliminarLineaManual(l.id)}
                              disabled={accionando}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
            {abierta && (
              <div className="mt-4 space-y-1 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Nota de crédito (NC): resta del facturado del mes. Las NC totales hechas en
                  Colppy se detectan solas al refrescar (si el sync de facturación está al día);
                  esto es para NC parciales o que no matchean.
                </p>
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Cliente"
                    value={ncCliente}
                    onChange={(e) => setNcCliente(e.target.value)}
                  />
                  <Input
                    placeholder="N° NC"
                    className="w-36"
                    value={ncNumero}
                    onChange={(e) => setNcNumero(e.target.value)}
                  />
                  <Input
                    type="date"
                    title="Fecha de la NC"
                    className="w-40"
                    value={ncFecha}
                    onChange={(e) => setNcFecha(e.target.value)}
                  />
                  <Input
                    placeholder="Monto USD"
                    className="w-28"
                    value={ncMonto}
                    onChange={(e) => setNcMonto(e.target.value)}
                  />
                  <Button variant="outline" onClick={agregarNC} disabled={accionando}>
                    <Plus className="h-4 w-4 mr-2" /> Agregar NC
                  </Button>
                </div>
              </div>
            )}
            {abierta && (
              <div className="mt-4 space-y-1 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  Venta sin factura (S/F): suma al facturado del mes y comisiona como una venta
                  más. Queda marcada aparte en la planilla.
                </p>
                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Cliente"
                    value={vsfCliente}
                    onChange={(e) => setVsfCliente(e.target.value)}
                  />
                  <Input
                    placeholder="Referencia"
                    className="w-36"
                    value={vsfRef}
                    onChange={(e) => setVsfRef(e.target.value)}
                  />
                  <Input
                    type="date"
                    title="Fecha de la venta"
                    className="w-40"
                    value={vsfFecha}
                    onChange={(e) => setVsfFecha(e.target.value)}
                  />
                  <Input
                    placeholder="Monto USD"
                    className="w-28"
                    value={vsfMonto}
                    onChange={(e) => setVsfMonto(e.target.value)}
                  />
                  <Button variant="outline" onClick={agregarVentaSF} disabled={accionando}>
                    <Plus className="h-4 w-4 mr-2" /> Agregar venta S/F
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ajustes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {liq.ajustes.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{a.concepto}</span>
                  <span
                    className={`whitespace-nowrap font-medium ${Number(a.montoArs) < 0 ? 'text-red-600' : ''}`}
                  >
                    {formatCurrency(a.montoArs, 'ARS')}
                  </span>
                  {abierta && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => eliminarAjuste(a.id)}
                      disabled={accionando}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              ))}
              {liq.ajustes.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin ajustes.</p>
              )}
              {abierta && (
                <div className="flex gap-2 pt-2">
                  <Input
                    placeholder="Concepto (ej: Deuda)"
                    value={concepto}
                    onChange={(e) => setConcepto(e.target.value)}
                  />
                  <Input
                    placeholder="-100.611"
                    className="w-28"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                  />
                  <Button variant="outline" size="icon" onClick={agregarAjuste} disabled={accionando}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Split del pago</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Efectivo (ARS)</label>
                <Input
                  value={efectivo}
                  onChange={(e) => setEfectivo(e.target.value)}
                  onBlur={() =>
                    guardarCampos(
                      { efectivoArs: efectivo.trim() === '' ? null : parseDecimalAR(efectivo) },
                      'Split actualizado'
                    )
                  }
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">ML (ARS)</label>
                <Input
                  value={ml}
                  onChange={(e) => setMl(e.target.value)}
                  onBlur={() =>
                    guardarCampos(
                      { mlArs: ml.trim() === '' ? null : parseDecimalAR(ml) },
                      'Split actualizado'
                    )
                  }
                />
              </div>
              {(() => {
                const suma = parseDecimalAR(efectivo) + parseDecimalAR(ml)
                const neto = Number(liq.netoArs)
                if (suma !== 0 && Math.abs(suma - neto) > 1) {
                  return (
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      El split ({formatCurrency(suma, 'ARS')}) no coincide con el neto (
                      {formatCurrency(neto, 'ARS')})
                    </p>
                  )
                }
                return null
              })()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
