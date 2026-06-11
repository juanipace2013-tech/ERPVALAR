'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Landmark } from 'lucide-react'
import { toast } from 'sonner'

interface CuentaContable {
  id: string
  code: string
  name: string
  acceptsEntries: boolean
}

export default function NuevaCuentaTesoreriaPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [loadingCuentas, setLoadingCuentas] = useState(true)
  const [cuentasContables, setCuentasContables] = useState<CuentaContable[]>([])

  // Form fields
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('')
  const [banco, setBanco] = useState('')
  const [numeroCuenta, setNumeroCuenta] = useState('')
  const [cuentaContableId, setCuentaContableId] = useState('')

  useEffect(() => {
    fetchCuentasContables()
  }, [])

  const fetchCuentasContables = async () => {
    try {
      setLoadingCuentas(true)
      const response = await fetch('/api/contabilidad/plan-cuentas')

      if (!response.ok) {
        throw new Error('Error al cargar el plan de cuentas')
      }

      const data = await response.json()
      const todas: CuentaContable[] = data.cuentas || []
      setCuentasContables(todas.filter((c) => c.acceptsEntries))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar el plan de cuentas')
    } finally {
      setLoadingCuentas(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!nombre.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }

    if (!tipo) {
      toast.error('El tipo de cuenta es obligatorio')
      return
    }

    if (!cuentaContableId) {
      toast.error('La cuenta contable es obligatoria')
      return
    }

    try {
      setLoading(true)

      const body: Record<string, string> = {
        nombre: nombre.trim(),
        tipo,
        cuentaContableId,
      }

      if (banco.trim()) body.banco = banco.trim()
      if (numeroCuenta.trim()) body.numeroCuenta = numeroCuenta.trim()

      const response = await fetch('/api/tesoreria/cuentas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear la cuenta')
      }

      toast.success('Cuenta de tesorería creada exitosamente')
      router.push('/tesoreria/cuentas')
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/tesoreria/cuentas')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <Landmark className="h-7 w-7 text-muted-foreground" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Nueva Cuenta de Tesorería</h1>
            <p className="text-muted-foreground">
              Registra una nueva cuenta bancaria, caja o cuenta de valores
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Main Fields */}
          <Card>
            <CardHeader>
              <CardTitle>Datos de la Cuenta</CardTitle>
              <CardDescription>
                Información principal de la cuenta de tesorería
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nombre">
                  Nombre <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="nombre"
                  placeholder="Ej: Banco Nación Cta. Cte. Principal"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo">
                  Tipo <span className="text-destructive">*</span>
                </Label>
                <Select value={tipo} onValueChange={setTipo} required>
                  <SelectTrigger id="tipo" className="w-full">
                    <SelectValue placeholder="Selecciona un tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BANCO_CUENTA_CORRIENTE">Cuenta Corriente</SelectItem>
                    <SelectItem value="BANCO_CAJA_AHORRO">Caja de Ahorro</SelectItem>
                    <SelectItem value="CAJA">Caja</SelectItem>
                    <SelectItem value="VALORES_A_DEPOSITAR">Valores a Depositar</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="banco">Banco</Label>
                <Input
                  id="banco"
                  placeholder="Ej: Banco de la Nación Argentina (opcional)"
                  value={banco}
                  onChange={(e) => setBanco(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="numeroCuenta">Número de cuenta / CBU</Label>
                <Input
                  id="numeroCuenta"
                  placeholder="Ej: 0110999920000012345678 (opcional)"
                  value={numeroCuenta}
                  onChange={(e) => setNumeroCuenta(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Accounting Account */}
          <Card>
            <CardHeader>
              <CardTitle>Cuenta Contable</CardTitle>
              <CardDescription>
                Asocia esta cuenta a una cuenta del plan contable
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cuentaContable">
                  Cuenta Contable <span className="text-destructive">*</span>
                </Label>
                {loadingCuentas ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                    Cargando plan de cuentas...
                  </div>
                ) : (
                  <Select value={cuentaContableId} onValueChange={setCuentaContableId} required>
                    <SelectTrigger id="cuentaContable" className="w-full">
                      <SelectValue placeholder="Selecciona una cuenta contable" />
                    </SelectTrigger>
                    <SelectContent>
                      {cuentasContables.map((cuenta) => (
                        <SelectItem key={cuenta.id} value={cuenta.id}>
                          {cuenta.code} - {cuenta.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  Solo se muestran cuentas que aceptan imputaciones directas
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-6">
          <Button type="submit" disabled={loading}>
            {loading ? 'Guardando...' : 'Crear Cuenta'}
          </Button>
          <Link href="/tesoreria/cuentas">
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
