'use client'

/**
 * Facturar ventas de Mercado Libre, en dos pestañas (?tipo=a|b):
 *   A: Responsables Inscriptos y Monotributistas (Factura A)
 *   B: Consumidores Finales y Exentos (Factura B, cliente con su CUIT/CUIL)
 * La pestaña sale de la condición que informa ML; la letra la confirma ARCA al
 * emitir. Una sola consulta trae las dos pestañas: cambiar de pestaña no
 * vuelve a pedirle nada a ML.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertTriangle, ExternalLink, FileText, Loader2, RefreshCw, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { BorradorFacturaMlDialog } from '@/components/mercadolibre/BorradorFacturaMlDialog'
import type { ClaseFacturaMl, ListadoVentasMl, VentaMl } from '@/lib/mercadolibre/facturacion'
import {
  PESTANA_FACTURA_ML,
  avisoFacturaEnMl,
  claseDesdeTipo,
  documentoListado,
  hrefPestanaMl,
  ventaPendiente,
  ventasDePestana,
} from '@/lib/mercadolibre/facturacion-form'

const ars = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
const fechaCorta = (s: string) =>
  s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
const dia = (s: string) => new Date(s).toLocaleDateString('es-AR')

export default function FacturacionMlPage() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<ClaseFacturaMl>(() => claseDesdeTipo(searchParams.get('tipo')))
  const [data, setData] = useState<ListadoVentasMl | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<VentaMl | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/mercadolibre/facturacion')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al cargar las ventas')
      setData(json)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Cambia de pestaña sin navegar (no vuelve a consultar ML): solo actualiza la URL
  const cambiarPestana = (c: ClaseFacturaMl) => {
    setTab(c)
    window.history.replaceState(null, '', hrefPestanaMl(c))
  }

  const subir = async (v: VentaMl) => {
    setBusy(v.packId)
    try {
      const res = await fetch(`/api/mercadolibre/facturacion/${v.packId}/subir`, { method: 'POST' })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'No se pudo subir')
      toast.success('Factura subida a Mercado Libre')
      await load()
    } catch (e) {
      toast.error((e as Error).message, { duration: 10000 })
    } finally {
      setBusy(null)
    }
  }

  const ventas = data ? ventasDePestana(data.ventas, tab) : []
  const desdeTab = data ? (tab === 'A' ? data.desdeA : data.desdeB) : null

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Facturar ventas de Mercado Libre</h1>
          <p className="text-sm text-muted-foreground">
            Factura electrónica por el punto de venta 0007 (ARCA): se registra en Colppy y el PDF se sube a la venta de ML.
            La pestaña sale de la condición que informa ML; la letra la confirma ARCA al emitir.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => cambiarPestana(claseDesdeTipo(v))}>
        <TabsList className="flex-wrap">
          {(['A', 'B'] as const).map((c) => {
            const pendientes = data?.conteos[c].pendientes ?? 0
            return (
              <TabsTrigger key={c} value={c}>
                {PESTANA_FACTURA_ML[c]}
                {data && (
                  <span
                    className={cn(
                      'ml-1 rounded-full px-1.5 text-[10px]',
                      pendientes > 0 ? 'bg-yellow-200 text-yellow-900' : 'bg-muted-foreground/15 text-muted-foreground'
                    )}
                    title={`${pendientes} sin facturar de ${data.conteos[c].total}`}
                  >
                    {pendientes}
                  </span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      <p className="text-sm text-muted-foreground">
        {tab === 'A' ? (
          <>
            Compradores <b>Responsables Inscriptos</b> y <b>Monotributistas</b> (RG 5003/2021): Factura A.
          </>
        ) : (
          <>
            <b>Consumidores finales</b> y <b>exentos</b>: Factura B. Cada comprador se da de alta en el ERP y en Colppy con su
            CUIT/CUIL (cuenta corriente propia, nunca un &quot;Consumidor Final&quot; genérico). Si ML solo informa el DNI, el
            CUIL se busca en ARCA al armar la factura; si no aparece, se carga a mano en el borrador.
          </>
        )}
        {desdeTab && ` Ventas desde el ${dia(desdeTab)}.`}
      </p>

      {data?.sinPermisoFiscal && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex gap-3 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              Mercado Libre no está entregando los datos fiscales de los compradores (falta habilitar el permiso
              &quot;Facturación&quot; en la aplicación de ML). Las ventas sin datos quedan en la pestaña Factura B: al armar la
              factura cargá el CUIT/CUIL y ARCA confirma la letra; si es Responsable Inscripto o Monotributista, el borrador
              te pasa a la Factura A.
            </div>
          </CardContent>
        </Card>
      )}

      {data?.truncado && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex gap-3 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              {data.avisoListado ? (
                // Una página del listado de ML falló: se muestran las ventas que sí llegaron
                <>
                  <b>{data.avisoListado}.</b> Se muestran las ventas que llegaron; las que faltan (las más viejas) no
                  aparecen en la lista ni en los conteos.
                </>
              ) : (
                <>
                  Mercado Libre tiene más ventas pagas desde el corte que las que se muestran (se traen las más recientes): las
                  más viejas sin facturar no aparecen en la lista.
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.conteos.revisar > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex gap-3 p-4 text-sm text-red-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              {data.conteos.revisar} venta(s) quedaron con la emisión sin terminar (aparecen en las dos pestañas): revisalas
              antes de volver a facturarlas.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Comprador</TableHead>
                <TableHead>Productos</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-[300px]">Factura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && !data && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </TableCell>
                </TableRow>
              )}
              {data && ventas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No hay ventas para facturar en esta pestaña.
                  </TableCell>
                </TableRow>
              )}
              {ventas.map((v) => {
                const doc = documentoListado(v)
                const avisoMl = avisoFacturaEnMl(v.facturaEnMl)
                return (
                  <TableRow key={v.packId} className={ventaPendiente(v) ? '' : 'opacity-70'}>
                    <TableCell className="whitespace-nowrap align-top text-xs">
                      {fechaCorta(v.fecha)}
                      <a
                        href={`https://www.mercadolibre.com.ar/ventas/${v.packId}/detalle`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex items-center gap-1 text-muted-foreground hover:underline"
                      >
                        #{v.packId} <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      <div className="font-medium">{v.fiscal?.name || v.buyerNickname}</div>
                      {v.fiscal?.name && <div className="text-muted-foreground">{v.buyerNickname}</div>}
                      {v.fiscal?.taxpayerType && <div className="text-muted-foreground">ML: {v.fiscal.taxpayerType}</div>}
                      {doc && (
                        <div className="font-mono">
                          {doc.texto}
                          {doc.esDni && !v.facturada && (
                            <span className="font-sans text-muted-foreground"> (el CUIL se busca en ARCA)</span>
                          )}
                        </div>
                      )}
                      {v.claseOrigen === 'sin-dato' && !v.facturada && (
                        <Badge variant="outline" className="mt-1 whitespace-normal border-amber-400 text-left text-[10px] text-amber-700">
                          ML no informó la condición: se verifica con ARCA al emitir
                        </Badge>
                      )}
                      {v.fiscalError && !data?.sinPermisoFiscal && !v.facturada && (
                        <div className="mt-1 line-clamp-2 text-[10px] text-red-600" title={v.fiscalError}>
                          Datos fiscales de ML: {v.fiscalError}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-xs">
                      {v.items.map((it, i) => (
                        <div key={i} className="mb-1">
                          {it.quantity} × {it.title}{' '}
                          <span className="text-muted-foreground">({ars(it.unitPrice)})</span>
                          <div>
                            {it.sku ? (
                              <Badge variant="outline" className="font-mono text-[10px]">{it.sku}</Badge>
                            ) : (
                              <Badge variant="outline" className="border-amber-400 text-[10px] text-amber-700">
                                Publicación sin vincular: no descuenta stock en Colppy
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right align-top font-medium">{ars(v.total)}</TableCell>
                    <TableCell className="align-top text-xs">
                      {v.facturada ? (
                        <div className="space-y-1">
                          {v.facturada.invoiceId ? (
                            <div className="flex items-center gap-2">
                              <Link href={`/facturas/${v.facturada.invoiceId}`} className="font-mono font-medium hover:underline">
                                {v.facturada.invoiceNumber}
                              </Link>
                              <a href={`/api/facturas/${v.facturada.invoiceId}/pdf`} target="_blank" rel="noreferrer" title="Ver PDF">
                                <FileText className="h-4 w-4" />
                              </a>
                            </div>
                          ) : (
                            <Badge variant="destructive">Emisión incompleta: revisar</Badge>
                          )}
                          {v.facturada.colppySyncStatus && v.facturada.colppySyncStatus !== 'OK' && (
                            <Badge variant={v.facturada.colppySyncStatus === 'BORRADOR_FCE' ? 'secondary' : 'destructive'}>
                              {v.facturada.colppySyncStatus === 'BORRADOR_FCE' ? 'Colppy: borrador FCE (tildar y aprobar)' : `Colppy: ${v.facturada.colppySyncStatus}`}
                            </Badge>
                          )}
                          {v.facturada.mlUploadStatus === 'OK' ? (
                            <Badge className="bg-green-100 text-green-800">Subida a ML</Badge>
                          ) : (
                            v.facturada.invoiceId && (
                              <div>
                                <Button size="sm" variant="outline" className="h-7" disabled={busy === v.packId} onClick={() => subir(v)}>
                                  {busy === v.packId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}
                                  Subir a ML
                                </Button>
                                {v.facturada.mlUploadError && (
                                  <div className="mt-1 line-clamp-2 text-[10px] text-red-600" title={v.facturada.mlUploadError}>
                                    {v.facturada.mlUploadError}
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {avisoMl && (
                            <Badge
                              variant="secondary"
                              className={v.facturaEnMl === null ? 'whitespace-normal border-amber-400 bg-amber-50 text-left text-amber-800' : undefined}
                              title={v.facturaEnMl === null ? avisoMl.texto : undefined}
                            >
                              {avisoMl.badge}
                            </Badge>
                          )}
                          {v.posibleDuplicado && (
                            <div className="text-[10px] text-amber-700">
                              <AlertTriangle className="mr-1 inline h-3 w-3" />
                              ¿Ya facturada a mano? El ERP tiene la{' '}
                              <Link href={`/facturas/${v.posibleDuplicado.invoiceId}`} className="font-mono underline" target="_blank">
                                {v.posibleDuplicado.invoiceNumber}
                              </Link>{' '}
                              del {dia(v.posibleDuplicado.issueDate)} por {ars(v.posibleDuplicado.total)}
                            </div>
                          )}
                          <div>
                            <Button
                              size="sm"
                              variant={v.facturaEnMl ? 'outline' : 'default'}
                              className="h-8"
                              disabled={busy !== null}
                              onClick={() => setBorrador(v)}
                              title={v.facturaEnMl ? 'La venta ya tiene una factura en ML: el borrador pide confirmarlo' : undefined}
                            >
                              {v.facturaEnMl ? 'Armar igual' : `Armar Factura ${tab}`}
                            </Button>
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BorradorFacturaMlDialog
        venta={borrador}
        clase={tab}
        onCambiarClase={cambiarPestana}
        onClose={() => setBorrador(null)}
        onEmitida={() => {
          setBorrador(null)
          load()
        }}
      />
    </div>
  )
}
