'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Sparkles, Search, ChevronLeft, ChevronRight } from 'lucide-react'

interface LeadRow {
  id: string
  fullName: string | null
  email: string | null
  phone: string | null
  companyName: string | null
  campaignId: string | null
  status: string
  createdAt: string
  customer: { id: string; name: string } | null
}

const STATUS_LABEL: Record<string, string> = {
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  COTIZADO: 'Cotizado',
  CONVERTIDO: 'Convertido',
  DESCARTADO: 'Descartado',
}

const STATUS_COLOR: Record<string, string> = {
  NUEVO: 'bg-blue-100 text-blue-800',
  CONTACTADO: 'bg-yellow-100 text-yellow-800',
  COTIZADO: 'bg-purple-100 text-purple-800',
  CONVERTIDO: 'bg-green-100 text-green-800',
  DESCARTADO: 'bg-gray-200 text-gray-700',
}

export default function LeadsPage() {
  const [items, setItems] = useState<LeadRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('ALL')
  const [loading, setLoading] = useState(false)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '25' })
    if (q) params.set('q', q)
    if (status && status !== 'ALL') params.set('status', status)
    try {
      const r = await fetch(`/api/leads?${params}`)
      const data = await r.json()
      setItems(data.items || [])
      setTotal(data.total || 0)
      setPageCount(data.pageCount || 1)
    } finally {
      setLoading(false)
    }
  }, [page, q, status])

  // Debounce de búsqueda
  useEffect(() => {
    const t = setTimeout(fetchLeads, 250)
    return () => clearTimeout(t)
  }, [fetchLeads])

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-blue-600" />
            Leads
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Leads recibidos desde Google Ads — {total} en total
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-6 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre, email, teléfono o empresa…"
              className="pl-9"
              value={q}
              onChange={(e) => {
                setPage(1)
                setQ(e.target.value)
              }}
            />
          </div>
          <Select
            value={status}
            onValueChange={(v) => {
              setPage(1)
              setStatus(v)
            }}
          >
            <SelectTrigger className="w-full md:w-56">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los estados</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Listado</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50 dark:bg-gray-800">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Campaña</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      Cargando…
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      No hay leads que coincidan con los filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((lead) => (
                    <TableRow
                      key={lead.id}
                      className="hover:bg-blue-50/50 dark:hover:bg-gray-800/50 cursor-pointer"
                      onClick={() => {
                        window.location.href = `/leads/${lead.id}`
                      }}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(lead.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/leads/${lead.id}`} className="hover:underline">
                          {lead.fullName || '—'}
                        </Link>
                      </TableCell>
                      <TableCell>{lead.email || '—'}</TableCell>
                      <TableCell>{lead.phone || '—'}</TableCell>
                      <TableCell>{lead.companyName || '—'}</TableCell>
                      <TableCell className="text-sm text-gray-600">
                        {lead.campaignId || '—'}
                      </TableCell>
                      <TableCell>
                        {lead.customer ? (
                          <Link
                            href={`/clientes/${lead.customer.id}`}
                            className="text-blue-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {lead.customer.name}
                          </Link>
                        ) : (
                          <span className="text-gray-400">Sin vincular</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={STATUS_COLOR[lead.status] || ''}>
                          {STATUS_LABEL[lead.status] || lead.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-600">
                Página {page} de {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
