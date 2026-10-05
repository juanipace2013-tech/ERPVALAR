'use client'

/**
 * Cliente de la factura directa: busca en el ERP (/api/clientes, no en
 * Colppy) y trae la ficha completa (/api/clientes/[id]) para la letra, la
 * condición IVA, la FCE y el plazo de pago. "Nuevo cliente desde CUIT" lo da
 * de alta con los datos de ARCA (AltaClienteArcaDialog).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Loader2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { formatCUIT } from '@/lib/utils'
import { letraFacturaColppy } from '@/lib/facturacion/letra-factura'
import { bloqueoClienteFacturaDirecta } from '@/lib/facturacion/factura-directa-form'
import { etiquetaCondicionIva, type ClienteFacturaDirecta } from '@/lib/facturacion/factura-directa-ui'
import { AltaClienteArcaDialog } from './AltaClienteArcaDialog'
import { cargarClienteFactura } from './cliente-api'

interface OpcionCliente {
  id: string
  name: string
  businessName: string | null
  cuit: string
  taxCondition: string
}

export function ClienteFacturaPicker({
  cliente,
  onChange,
  disabled = false,
}: {
  cliente: ClienteFacturaDirecta | null
  onChange: (c: ClienteFacturaDirecta | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [opciones, setOpciones] = useState<OpcionCliente[]>([])
  const [buscando, setBuscando] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [altaOpen, setAltaOpen] = useState(false)

  const query = search.trim()

  useEffect(() => {
    if (query.length < 2) {
      setOpciones([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clientes?search=${encodeURIComponent(query)}&status=ACTIVE&limit=20&sortBy=name&sortOrder=asc`, { signal: ctrl.signal })
        if (!r.ok) throw new Error('No se pudieron buscar los clientes')
        const d = await r.json()
        setOpciones(
          ((d.customers ?? []) as OpcionCliente[]).map((c) => ({
            id: c.id,
            name: c.name,
            businessName: c.businessName ?? null,
            cuit: c.cuit,
            taxCondition: c.taxCondition,
          }))
        )
      } catch (e) {
        if ((e as Error).name !== 'AbortError') toast.error((e as Error).message)
      } finally {
        if (!ctrl.signal.aborted) setBuscando(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  const elegir = async (id: string) => {
    setOpen(false)
    setSearch('')
    setCargando(true)
    try {
      onChange(await cargarClienteFactura(id))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  const letra = cliente ? letraFacturaColppy(cliente.taxCondition) : null
  const bloqueo = cliente ? bloqueoClienteFacturaDirecta(cliente) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) setSearch('')
          }}
        >
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={open} className="flex-1 justify-between font-normal" disabled={disabled || cargando}>
              <span className="truncate">
                {cargando ? 'Cargando cliente…' : cliente ? `${cliente.name} · ${formatCUIT(cliente.cuit)}` : 'Buscar cliente por nombre, razón social o CUIT…'}
              </span>
              {cargando ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) min-w-[320px] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="Nombre, razón social o CUIT…" value={search} onValueChange={setSearch} />
              <CommandList>
                <CommandEmpty>{query.length < 2 ? 'Escribí al menos 2 letras' : buscando ? 'Buscando…' : 'No se encontraron clientes activos'}</CommandEmpty>
                <CommandGroup>
                  {opciones.map((c) => (
                    <CommandItem key={c.id} value={c.id} onSelect={() => elegir(c.id)}>
                      <Check className={`mr-2 h-4 w-4 ${cliente?.id === c.id ? 'opacity-100' : 'opacity-0'}`} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatCUIT(c.cuit)} · {etiquetaCondicionIva(c.taxCondition)}
                          {c.businessName && c.businessName !== c.name ? ` · ${c.businessName}` : ''}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {cliente && (
          <Button type="button" variant="ghost" onClick={() => onChange(null)} disabled={disabled} title="Quitar el cliente">
            <X className="h-4 w-4" />
          </Button>
        )}
        <Button type="button" variant="outline" onClick={() => setAltaOpen(true)} disabled={disabled}>
          <UserPlus className="mr-2 h-4 w-4" />
          Nuevo cliente desde CUIT
        </Button>
      </div>

      {cliente && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {letra && !bloqueo && <Badge className="bg-blue-600 text-white hover:bg-blue-600">Factura {letra}</Badge>}
          <Badge variant="outline">{etiquetaCondicionIva(cliente.taxCondition)}</Badge>
          {cliente.fceObligado && letra === 'A' && (
            <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100" title="Obligado a FCE MiPyME: sale como FCE A si el total supera el umbral">
              FCE MiPyME
            </Badge>
          )}
          {cliente.businessName && cliente.businessName !== cliente.name && <span className="text-muted-foreground">{cliente.businessName}</span>}
          <Link href={`/clientes/${cliente.id}`} target="_blank" className="text-xs text-blue-600 hover:underline">
            Ver ficha
          </Link>
        </div>
      )}

      {bloqueo && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Este cliente no se factura desde acá</p>
          <p className="mt-1">{bloqueo.mensaje}</p>
          {bloqueo.codigo === 'CLIENTE_EXTERIOR' ? (
            <Link href="/cotizaciones" className="mt-1 inline-block text-blue-700 hover:underline">
              Ir a cotizaciones
            </Link>
          ) : (
            <Link href={`/clientes/${cliente!.id}`} className="mt-1 inline-block text-blue-700 hover:underline">
              Corregir el cliente
            </Link>
          )}
        </div>
      )}

      <AltaClienteArcaDialog
        open={altaOpen}
        onOpenChange={setAltaOpen}
        onCliente={(c) => {
          setAltaOpen(false)
          onChange(c)
        }}
      />
    </div>
  )
}
