'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AlertTriangle, ExternalLink, FileText, Loader2, RefreshCw, Upload } from 'lucide-react'
import { BorradorFacturaMlDialog } from '@/components/mercadolibre/BorradorFacturaMlDialog'

interface VentaItem {
  mlItemId: string
  title: string
  quantity: number
  unitPrice: number
  productId: string | null
  sku: string | null
  productName: string | null
}

interface Venta {
  packId: string
  orderIds: string[]
  fecha: string
  buyerNickname: string | null
  total: number
  items: VentaItem[]
  fiscal: { docType: string | null; docNumber: string | null; name: string | null; taxpayerType: string | null } | null
  fiscalError: string | null
  cuit: string | null
  facturaEnMl: boolean
  facturada: null | {
    invoiceId: string | null
    invoiceNumber: string | null
    status: string
    mlUploadStatus: string | null
    mlUploadError: string | null
    colppySyncStatus: string | null
  }
}

interface Listado {
  desde: string
  ventas: Venta[]
  sinPermisoFiscal: boolean
  excluidasNoRI: number
}

const ars = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })
const fechaCorta = (s: string) =>
  s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

export default function FacturacionMlPage() {
  const [data, setData] = useState<Listado | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<Venta | null>(null)

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

  const subir = async (v: Venta) => {
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

  const pendientes = data?.ventas.filter((v) => !v.facturada && !v.facturaEnMl) ?? []
  const resto = data?.ventas.filter((v) => v.facturada || v.facturaEnMl) ?? []

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Facturar ventas de Mercado Libre</h1>
          <p className="text-sm text-muted-foreground">
            Solo compradores Responsables Inscriptos (Factura A, punto de venta 0007). Los consumidores finales se siguen facturando por Colppy.
            {data && ` Ventas desde el ${new Date(data.desde).toLocaleDateString('es-AR')}.`}
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      {data?.sinPermisoFiscal && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex gap-3 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              Mercado Libre no está entregando los datos fiscales de los compradores (falta habilitar el permiso
              &quot;Facturación&quot; en la aplicación de ML). Mientras tanto se listan <b>todas</b> las ventas: cargá el CUIT
              en el borrador solo en las de Responsables Inscriptos. El ERP igual lo valida contra ARCA antes de emitir.
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
              {data && data.ventas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No hay ventas para facturar.
                  </TableCell>
                </TableRow>
              )}
              {[...pendientes, ...resto].map((v) => (
                <TableRow key={v.packId} className={v.facturada || v.facturaEnMl ? 'opacity-70' : ''}>
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
                    {v.fiscal?.taxpayerType && <div className="text-muted-foreground">{v.fiscal.taxpayerType}</div>}
                    {v.cuit && <div className="font-mono">{v.cuit}</div>}
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
                    ) : v.facturaEnMl ? (
                      <Badge variant="secondary">Ya tiene factura en ML (Colppy)</Badge>
                    ) : (
                      <Button size="sm" className="h-8" disabled={busy !== null} onClick={() => setBorrador(v)}>
                        Armar factura
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <BorradorFacturaMlDialog
        venta={borrador}
        onClose={() => setBorrador(null)}
        onEmitida={() => {
          setBorrador(null)
          load()
        }}
      />

      {data && data.excluidasNoRI > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.excluidasNoRI} venta(s) de consumidores finales / monotributistas no se muestran: se facturan por Colppy.
        </p>
      )}
    </div>
  )
}
