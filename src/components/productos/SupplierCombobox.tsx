'use client'

import { useMemo, useState } from 'react'
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
  placeholder?: string
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Con ~miles de proveedores cargados, filtramos a mano y mostramos de a 50
// para no renderizar la lista completa dentro del popover
const MAX_VISIBLE = 50

export function SupplierCombobox({
  suppliers,
  value,
  onChange,
  placeholder = 'Seleccionar proveedor',
}: SupplierComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const selected = suppliers.find((s) => s.id === value)

  const filtered = useMemo(() => {
    const q = normalize(search.trim())
    const matches = q
      ? suppliers.filter((s) => normalize(s.name).includes(q))
      : suppliers
    return matches.slice(0, MAX_VISIBLE)
  }, [suppliers, search])

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
          <span className="truncate">{selected ? selected.name : placeholder}</span>
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
            <CommandEmpty>No se encontraron proveedores</CommandEmpty>
            <CommandGroup>
              {filtered.map((supplier) => (
                <CommandItem
                  key={supplier.id}
                  value={supplier.id}
                  onSelect={(val) => {
                    onChange(val === value ? '' : val)
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
