'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ArrowLeft, CheckCircle2, Loader2, Mail, RotateCcw, Save, Search } from 'lucide-react'
import { toast } from 'sonner'

interface Item {
  id: string
  sku: string | null
  description: string
  quantity: string | number
  batchNumber: string | null
  product: { sku: string; brand: string | null } | null
}

interface Remito {
  id: string
  deliveryNumber: string
  date: string
  purchaseOrder: string | null
  certificadoPedidoAt: string | null
  certificadoPedidoA: string | null
  certificadoRecibidoAt: string | null
  customer: { id: string; name: string; businessName: string | null } | null
  quote: { id: string; quoteNumber: string; purchaseOrderNumber: string | null } | null
  items: Item[]
}

type Contactos = Record<string, { email: string; nombre?: string }>
type Estado = 'pendientes' | 'pedidos' | 'recibidos'

const marcaDe = (i: Item) => i.product?.brand?.trim().toUpperCase() || 'SIN MARCA'
const fmtFecha = (s: string) => new Date(s).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
const estadoDe = (r: Remito): Estado =>
  r.certificadoRecibidoAt ? 'recibidos' : r.certificadoPedidoAt ? 'pedidos' : 'pendientes'

export default function CertificadosRemitosPage() {
  const [remitos, setRemitos] = useState<Remito[]>([])
  const [contactos, setContactos] = useState<Contactos>({})
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Estado>('pendientes')
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    try {
      const r = await fetch('/api/delivery-notes/certificados')
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error al cargar')
      const j = await r.json()
      setRemitos(j.remitos)
      setContactos(j.contactos)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const conteo = useMemo(() => {
    const c = { pendientes: 0, pedidos: 0, recibidos: 0 }
    for (const r of remitos) c[estadoDe(r)]++
    return c
  }, [remitos])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return remitos.filter((r) => {
      if (estadoDe(r) !== tab) return false
      if (!q) return true
      return [r.deliveryNumber, r.customer?.name, r.customer?.businessName, r.purchaseOrder, r.quote?.quoteNumber]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q))
    })
  }, [remitos, tab, busqueda])

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/remitos" className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="h-4 w-4" /> Remitos
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Certificados de calidad</h1>
          <p className="text-gray-600 mt-1">
            Remitos de clientes que piden certificado: cargá los lotes y armá el pedido al proveedor
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Estado)}>
          <TabsList>
            <TabsTrigger value="pendientes">Pendientes ({conteo.pendientes})</TabsTrigger>
            <TabsTrigger value="pedidos">Pedidos al proveedor ({conteo.pedidos})</TabsTrigger>
            <TabsTrigger value="recibidos">Recibidos ({conteo.recibidos})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-72">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Cliente, remito, OC..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-500">No hay remitos en esta lista.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibles.map((r) => (
            <RemitoCard key={r.id} remito={r} contactos={contactos} onCambio={cargar} />
          ))}
        </div>
      )}
    </div>
  )
}

function RemitoCard({ remito, contactos, onCambio }: { remito: Remito; contactos: Contactos; onCambio: () => void }) {
  const [lotes, setLotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(remito.items.map((i) => [i.id, i.batchNumber ?? '']))
  )
  const [guardando, setGuardando] = useState(false)
  const [armando, setArmando] = useState<string | null>(null)
  const marcas = useMemo(() => [...new Set(remito.items.map(marcaDe))], [remito.items])
  const [mails, setMails] = useState<Record<string, string>>(() =>
    Object.fromEntries(marcas.map((m) => [m, contactos[m]?.email ?? '']))
  )

  const sucios = remito.items.some((i) => (i.batchNumber ?? '') !== (lotes[i.id] ?? '').trim())
  const cliente = remito.customer?.businessName || remito.customer?.name || '—'
  const oc = remito.purchaseOrder || remito.quote?.purchaseOrderNumber
  const estado = estadoDe(remito)

  async function put(body: object) {
    const r = await fetch(`/api/delivery-notes/${remito.id}/certificado`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error al guardar')
  }

  async function guardarLotes(silencioso = false) {
    setGuardando(true)
    try {
      await put({ lotes })
      if (!silencioso) toast.success('Lotes guardados')
      if (!silencioso) onCambio()
    } catch (e) {
      toast.error((e as Error).message)
      throw e
    } finally {
      setGuardando(false)
    }
  }

  async function armarMail(marca: string) {
    setArmando(marca)
    try {
      if (sucios) await guardarLotes(true)
      const r = await fetch(`/api/delivery-notes/${remito.id}/certificado/borrador`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marca, para: mails[marca] }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo armar el mail')
      toast.success(`Borrador listo en Outlook para ${j.para}`, {
        description: j.asunto,
        action: j.webLink ? { label: 'Abrir', onClick: () => window.open(j.webLink, '_blank') } : undefined,
        duration: 15000,
      })
      onCambio()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setArmando(null)
    }
  }

  async function marcar(body: object, msg: string) {
    try {
      await put(body)
      toast.success(msg)
      onCambio()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/remitos/${remito.id}`} className="font-semibold text-blue-700 hover:underline">
                {remito.deliveryNumber}
              </Link>
              <span className="text-gray-400">·</span>
              <span className="font-semibold text-gray-900">{cliente}</span>
            </div>
            <div className="text-sm text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
              <span>{fmtFecha(remito.date)}</span>
              {oc && <span>OC {oc}</span>}
              {remito.quote && <span>{remito.quote.quoteNumber}</span>}
            </div>
          </div>
          <div className="text-right text-sm">
            {estado === 'pedidos' && remito.certificadoPedidoAt && (
              <Badge className="bg-purple-100 text-purple-800">
                Pedido {fmtFecha(remito.certificadoPedidoAt)}
                {remito.certificadoPedidoA ? ` a ${remito.certificadoPedidoA}` : ''}
              </Badge>
            )}
            {estado === 'recibidos' && remito.certificadoRecibidoAt && (
              <Badge className="bg-green-100 text-green-800">Recibido {fmtFecha(remito.certificadoRecibidoAt)}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36 whitespace-nowrap">Código</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-20 text-right">Cant.</TableHead>
              <TableHead className="w-28">Marca</TableHead>
              <TableHead className="w-52 min-w-52">N° de lote</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {remito.items.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-sm whitespace-nowrap">{i.product?.sku || i.sku || '—'}</TableCell>
                <TableCell className="text-sm max-w-0 w-full truncate" title={i.description}>{i.description}</TableCell>
                <TableCell className="text-right">{Number(i.quantity)}</TableCell>
                <TableCell className="text-sm text-gray-600">{marcaDe(i)}</TableCell>
                <TableCell>
                  <Input
                    value={lotes[i.id] ?? ''}
                    placeholder="Lote"
                    className="h-8 w-48"
                    onChange={(e) => setLotes((l) => ({ ...l, [i.id]: e.target.value }))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-end justify-between gap-3 mt-4">
          <div className="flex flex-wrap gap-3">
            {marcas.map((m) => (
              <div key={m} className="flex items-end gap-2">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Pedido a {m}</div>
                  <Input
                    className="h-9 w-60"
                    placeholder="mail del proveedor"
                    value={mails[m] ?? ''}
                    onChange={(e) => setMails((x) => ({ ...x, [m]: e.target.value }))}
                  />
                </div>
                <Button size="sm" className="h-9" disabled={!!armando} onClick={() => armarMail(m)}>
                  {armando === m ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                  Armar mail
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!sucios || guardando} onClick={() => guardarLotes().catch(() => {})}>
              {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar lotes
            </Button>
            {estado === 'pendientes' && (
              <Button variant="ghost" size="sm" onClick={() => marcar({ pedido: true }, 'Marcado como pedido')}>
                Ya lo pedí
              </Button>
            )}
            {estado !== 'recibidos' ? (
              <Button
                variant="outline"
                size="sm"
                className="text-green-700"
                onClick={() => marcar({ recibido: true }, 'Certificado marcado como recibido')}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" /> Recibido
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => marcar({ recibido: false }, 'Vuelve a pedidos')}>
                <RotateCcw className="h-4 w-4 mr-2" /> Deshacer
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
