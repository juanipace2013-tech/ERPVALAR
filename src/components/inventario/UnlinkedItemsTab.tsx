'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Link2, AlertCircle, Check } from 'lucide-react'
import { toast } from 'sonner'

interface UnlinkedItem {
  id: string
  supplierProductCode: string | null
  description: string
  quantity: number
  unitPrice: number
  purchaseInvoice: {
    id: string
    invoiceNumber: string
    invoiceDate: string
    supplierName: string
  }
  suggestions: Array<{
    id: string; sku: string; name: string; brand: string | null; matchType: string
  }>
}

interface InvoiceGroup {
  invoiceId: string
  invoiceNumber: string
  invoiceDate: string
  supplierName: string
  items: UnlinkedItem[]
}

interface UnlinkedData {
  totalUnlinked: number
  invoices: InvoiceGroup[]
}

const formatCurrency = (amount: number) =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })

export default function UnlinkedItemsTab({ onCountUpdate }: { onCountUpdate?: (count: number) => void }) {
  const [data, setData] = useState<UnlinkedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedLinks, setSelectedLinks] = useState<Record<string, string>>({})
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/inventory/unlinked-items')
      if (!res.ok) throw new Error()
      const result: UnlinkedData = await res.json()
      setData(result)
      onCountUpdate?.(result.totalUnlinked)
    } catch {
      toast.error('Error al cargar items sin vincular')
    } finally {
      setLoading(false)
    }
  }

  const handleLinkSelected = async () => {
    const links = Object.entries(selectedLinks)
      .filter(([, productId]) => productId && productId !== 'none')
      .map(([purchaseInvoiceItemId, productId]) => ({ purchaseInvoiceItemId, productId }))

    if (links.length === 0) {
      toast.error('Seleccione al menos un producto para vincular')
      return
    }

    try {
      setLinking(true)
      const res = await fetch('/api/inventory/link-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links }),
      })

      if (!res.ok) throw new Error()
      const result = await res.json()
      toast.success(`${result.linked} items vinculados correctamente`)
      setSelectedLinks({})
      fetchData()
    } catch {
      toast.error('Error al vincular items')
    } finally {
      setLinking(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!data || data.totalUnlinked === 0) {
    return (
      <div className="text-center py-12">
        <Check className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <p className="text-gray-600 font-medium">Todos los items están vinculados</p>
        <p className="text-sm text-gray-500 mt-1">No hay items de facturas de compra pendientes de vincular a productos del catálogo.</p>
      </div>
    )
  }

  const selectedCount = Object.values(selectedLinks).filter(v => v && v !== 'none').length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-600" />
          <span className="font-medium">{data.totalUnlinked} items sin vincular</span>
          <span className="text-sm text-gray-500">en {data.invoices.length} facturas</span>
        </div>
        {selectedCount > 0 && (
          <Button onClick={handleLinkSelected} disabled={linking} className="bg-blue-600 hover:bg-blue-700">
            {linking ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Vinculando...</>
            ) : (
              <><Link2 className="h-4 w-4 mr-2" />Vincular {selectedCount} seleccionados</>
            )}
          </Button>
        )}
      </div>

      {/* Invoice Groups */}
      {data.invoices.map(inv => (
        <Card key={inv.invoiceId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <div>
                <span className="font-mono">{inv.invoiceNumber}</span>
                <span className="text-gray-500 ml-2">{inv.supplierName}</span>
              </div>
              <span className="text-xs text-gray-400">{formatDate(inv.invoiceDate)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cód. Proveedor</TableHead>
                  <TableHead className="text-xs">Descripción</TableHead>
                  <TableHead className="text-right text-xs">Cant.</TableHead>
                  <TableHead className="text-right text-xs">P. Unit.</TableHead>
                  <TableHead className="text-xs w-[250px]">Vincular con...</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      {item.supplierProductCode || '-'}
                    </TableCell>
                    <TableCell className="text-sm">{item.description}</TableCell>
                    <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                    <TableCell>
                      <Select
                        value={selectedLinks[item.id] || 'none'}
                        onValueChange={(v) => setSelectedLinks(prev => ({ ...prev, [item.id]: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Seleccionar producto..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin vincular</SelectItem>
                          {item.suggestions.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                <span className="font-mono">{s.sku}</span>
                                <span>{s.name.substring(0, 30)}</span>
                                <Badge variant="outline" className="text-[10px] ml-1">{s.matchType}</Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
