'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Loader2, Link2, AlertCircle, Check } from 'lucide-react'
import { ProductSearchCombobox, type ProductSuggestion } from './ProductSearchCombobox'
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
  suggestions: ProductSuggestion[]
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

const formatDate = (date: string | null | undefined) =>
  date ? new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

// ---- Main Component ----
export default function UnlinkedItemsTab({ onCountUpdate }: { onCountUpdate?: (count: number) => void }) {
  const [data, setData] = useState<UnlinkedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedLinks, setSelectedLinks] = useState<Record<string, { id: string; sku: string; name: string }>>({})
  const [linking, setLinking] = useState(false)
  const [linkedItems, setLinkedItems] = useState<Set<string>>(new Set())

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

  const handleLinkSingle = async (itemId: string, productId: string) => {
    try {
      const res = await fetch('/api/inventory/link-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ links: [{ purchaseInvoiceItemId: itemId, productId }] }),
      })
      if (!res.ok) throw new Error()
      toast.success('Item vinculado correctamente')
      setLinkedItems(prev => new Set([...prev, itemId]))
      // Update count
      if (data) {
        onCountUpdate?.(data.totalUnlinked - linkedItems.size - 1)
      }
    } catch {
      toast.error('Error al vincular item')
    }
  }

  const handleLinkSelected = async () => {
    const links = Object.entries(selectedLinks)
      .filter(([itemId]) => !linkedItems.has(itemId))
      .map(([purchaseInvoiceItemId, product]) => ({ purchaseInvoiceItemId, productId: product.id }))

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
      setLinkedItems(new Set())
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

  const selectedCount = Object.keys(selectedLinks).filter(id => !linkedItems.has(id)).length

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-yellow-600" />
          <span className="font-medium">{data.totalUnlinked - linkedItems.size} items sin vincular</span>
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
      {data.invoices.map(inv => {
        // Check if all items in this invoice are linked
        const allLinked = inv.items.every(item => linkedItems.has(item.id))
        if (allLinked) return null

        return (
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
                    <TableHead className="text-xs w-[300px]">Vincular con...</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.items.map(item => {
                    if (linkedItems.has(item.id)) {
                      return (
                        <TableRow key={item.id} className="bg-green-50/50">
                          <TableCell className="font-mono text-xs text-green-700">
                            {item.supplierProductCode || '-'}
                          </TableCell>
                          <TableCell className="text-sm text-green-700">{item.description}</TableCell>
                          <TableCell className="text-right text-sm text-green-700">{item.quantity}</TableCell>
                          <TableCell className="text-right text-sm text-green-700">{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-green-600 text-xs">
                              <Check className="h-4 w-4" />
                              <span>Vinculado</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    }

                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">
                          {item.supplierProductCode || '-'}
                        </TableCell>
                        <TableCell className="text-sm">{item.description}</TableCell>
                        <TableCell className="text-right text-sm">{item.quantity}</TableCell>
                        <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                        <TableCell>
                          <ProductSearchCombobox
                            suggestions={item.suggestions}
                            selectedProduct={selectedLinks[item.id] || null}
                            onSelect={(product) => {
                              setSelectedLinks(prev => ({ ...prev, [item.id]: product }))
                              // Auto-link immediately
                              handleLinkSingle(item.id, product.id)
                            }}
                            onClear={() => {
                              setSelectedLinks(prev => {
                                const next = { ...prev }
                                delete next[item.id]
                                return next
                              })
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
