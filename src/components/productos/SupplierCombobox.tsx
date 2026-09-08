'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Check, ChevronsUpDown } from 'lucide-react'

interface SupplierOption {
  id: string
  name: string
}

interface SupplierComboboxProps {
  suppliers: SupplierOption[]
  value: string
  onChange: (supplierId: string) => void
  /** Proveedor ya seleccionado (para mostrar su nombre aunque no esté en `suppliers`) */
  selected?: SupplierOption | null
  placeholder?: string
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// La lista inicial viene capeada por la API (MAX_PAGE_LIMIT), así que con 2+
// caracteres buscamos en el servidor; mostramos de a 50 para no inflar el popover
const MAX_VISIBLE = 50

export function SupplierCombobox({
  suppliers,
  value,
  onChange,
  selected = null,
  placeholder = 'Seleccionar proveedor',
}: SupplierComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [remoteResults, setRemoteResults] = useState<SupplierOption[]>([])
  const [searching, setSearching] = useState(false)
  // Guarda las opciones elegidas desde resultados remotos para poder mostrar su nombre
  const [picked, setPicked] = useState<SupplierOption[]>([])

  const query = search.trim()

  useEffect(() => {
    if (query.length < 2) {
      setRemoteResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/proveedores?search=${encodeURIComponent(query)}&status=ACTIVE&limit=${MAX_VISIBLE}&sortBy=name&sortOrder=asc`
        )
        if (res.ok) {
          const data = await res.json()
          setRemoteResults(
            (data.suppliers || []).map((s: SupplierOption) => ({ id: s.id, name: s.name }))
          )
        }
      } catch (err) {
        console.error('Error searching suppliers:', err)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const selectedOption = useMemo(() => {
    if (!value) return null
    return (
      suppliers.find((s) => s.id === value) ||
      picked.find((s) => s.id === value) ||
      (selected && selected.id === value ? selected : null)
    )
  }, [value, suppliers, picked, selected])

  const options = useMemo(() => {
    if (query.length < 2) return suppliers.slice(0, MAX_VISIBLE)
    // Matches locales instantáneos + resultados del servidor, sin duplicados
    const q = normalize(query)
    const local = suppliers.filter((s) => normalize(s.name).includes(q))
    const seen = new Set(local.map((s) => s.id))
    const merged = [...local, ...remoteResults.filter((s) => !seen.has(s.id))]
    merged.sort((a, b) => a.name.localeCompare(b.name))
    return merged.slice(0, MAX_VISIBLE)
  }, [query, suppliers, remoteResults])

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selectedOption ? selectedOption.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar proveedor..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {searching ? 'Buscando...' : 'No se encontraron proveedores'}
            </CommandEmpty>
            <CommandGroup>
              {options.map((supplier) => (
                <CommandItem
                  key={supplier.id}
                  value={supplier.id}
                  onSelect={(val) => {
                    onChange(val === value ? '' : val)
                    setPicked((prev) =>
                      prev.some((s) => s.id === supplier.id) ? prev : [...prev, supplier]
                    )
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <Check
                    className={`mr-2 h-4 w-4 ${value === supplier.id ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {supplier.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
