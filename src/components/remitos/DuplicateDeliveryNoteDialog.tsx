'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Loader2, Copy, Users, Search } from 'lucide-react'

interface Entity {
  id: string
  name: string
  legalName: string | null
  taxId: string | null
  type: 'CUSTOMER' | 'SUPPLIER'
}

interface DuplicateDeliveryNoteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deliveryNoteId: string
  recipientName: string
  onDuplicated: (newId: string) => void
}

export function DuplicateDeliveryNoteDialog({
  open,
  onOpenChange,
  deliveryNoteId,
  recipientName,
  onDuplicated,
}: DuplicateDeliveryNoteDialogProps) {
  const [mode, setMode] = useState<'same' | 'other'>('same')
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)
  const [loading, setLoading] = useState(false)

  // Search state
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<Entity[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // Search with debounce
  useEffect(() => {
    if (mode !== 'other' || searchTerm.length < 2) {
      setSearchResults([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true)
        const res = await fetch(`/api/search/entities?q=${encodeURIComponent(searchTerm)}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data)
        }
      } catch (error) {
        console.error('Error searching:', error)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm, mode])

  const handleDuplicate = async () => {
    if (mode === 'other' && !selectedEntity) return

    try {
      setLoading(true)

      const body: Record<string, unknown> = {}
      if (mode === 'other' && selectedEntity) {
        body.recipientId = selectedEntity.id
        body.recipientType = selectedEntity.type
      }

      const response = await fetch(`/api/delivery-notes/${deliveryNoteId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Error al duplicar remito')
      }

      const data = await response.json()
      onDuplicated(data.id)
    } catch (error) {
      console.error('Error:', error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setMode('same')
      setSelectedEntity(null)
      setSearchTerm('')
      setSearchResults([])
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-blue-600" />
            Duplicar Remito
          </DialogTitle>
          <DialogDescription>
            Se copiarán todos los items, cantidades y observaciones.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <RadioGroup
            value={mode}
            onValueChange={(v) => {
              setMode(v as 'same' | 'other')
              if (v === 'same') {
                setSelectedEntity(null)
                setSearchTerm('')
                setSearchResults([])
              }
            }}
            className="space-y-3"
          >
            <div
              className={`flex items-center space-x-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                mode === 'same' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => { setMode('same'); setSelectedEntity(null); setSearchTerm(''); setSearchResults([]) }}
            >
              <RadioGroupItem value="same" id="same" />
              <Label htmlFor="same" className="flex-1 cursor-pointer">
                <div className="font-medium">Mismo destinatario</div>
                <div className="text-sm text-muted-foreground">{recipientName}</div>
              </Label>
            </div>

            <div
              className={`flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                mode === 'other' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
              onClick={() => setMode('other')}
            >
              <RadioGroupItem value="other" id="other" className="mt-1" />
              <Label htmlFor="other" className="flex-1 cursor-pointer">
                <div className="font-medium flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  Otro destinatario
                </div>
                <div className="text-sm text-muted-foreground">Buscar cliente o proveedor</div>
              </Label>
            </div>
          </RadioGroup>

          {mode === 'other' && (
            <div className="space-y-2 pt-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    setSelectedEntity(null)
                  }}
                  placeholder="Buscar por nombre, razón social o CUIT..."
                  className="pl-9"
                  disabled={loading}
                  autoFocus
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                )}
              </div>

              {/* Selected entity */}
              {selectedEntity && (
                <div className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 p-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{selectedEntity.name}</div>
                    {selectedEntity.taxId && (
                      <div className="text-xs text-muted-foreground">{selectedEntity.taxId}</div>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      selectedEntity.type === 'CUSTOMER'
                        ? 'border-blue-300 bg-blue-100 text-blue-800'
                        : 'border-orange-300 bg-orange-100 text-orange-800'
                    }
                  >
                    {selectedEntity.type === 'CUSTOMER' ? 'Cliente' : 'Proveedor'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600"
                    onClick={() => {
                      setSelectedEntity(null)
                      setSearchTerm('')
                    }}
                  >
                    ×
                  </Button>
                </div>
              )}

              {/* Search results */}
              {!selectedEntity && searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border divide-y">
                  {searchResults.map((entity) => (
                    <button
                      key={`${entity.type}-${entity.id}`}
                      className="w-full flex items-center gap-2 p-2.5 hover:bg-gray-50 transition-colors text-left"
                      onClick={() => {
                        setSelectedEntity(entity)
                        setSearchResults([])
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{entity.name}</div>
                        {entity.legalName && entity.legalName !== entity.name && (
                          <div className="text-xs text-muted-foreground truncate">{entity.legalName}</div>
                        )}
                      </div>
                      {entity.taxId && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{entity.taxId}</span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-xs shrink-0 ${
                          entity.type === 'CUSTOMER'
                            ? 'border-blue-300 bg-blue-100 text-blue-800'
                            : 'border-orange-300 bg-orange-100 text-orange-800'
                        }`}
                      >
                        {entity.type === 'CUSTOMER' ? 'Cliente' : 'Proveedor'}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}

              {/* No results */}
              {!selectedEntity && searchTerm.length >= 2 && !searching && searchResults.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-3">
                  No se encontraron resultados para &quot;{searchTerm}&quot;
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleDuplicate}
            disabled={loading || (mode === 'other' && !selectedEntity)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Duplicando...
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Duplicar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
