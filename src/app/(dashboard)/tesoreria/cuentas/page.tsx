'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Landmark, Plus, Pencil, PowerOff } from 'lucide-react'
import { toast } from 'sonner'

interface CuentaTesoreria {
  id: string
  nombre: string
  tipo: string
  banco: string | null
  numeroCuenta: string | null
  cuentaContable: {
    code: string
    name: string
  } | null
  activa: boolean
}

const tipoLabels: Record<string, string> = {
  BANCO_CUENTA_CORRIENTE: 'Cta. Cte.',
  BANCO_CAJA_AHORRO: 'Caja Ahorro',
  CAJA: 'Caja',
  VALORES_A_DEPOSITAR: 'Val. a Depositar',
}

export default function CuentasTesoreriaPage() {
  const [cuentas, setCuentas] = useState<CuentaTesoreria[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCuentas()
  }, [])

  const fetchCuentas = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/tesoreria/cuentas')

      if (!response.ok) {
        throw new Error('Error al cargar cuentas de tesorería')
      }

      const data = await response.json()
      setCuentas(data.cuentas || [])
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar cuentas de tesorería')
    } finally {
      setLoading(false)
    }
  }

  const handleDesactivar = async (id: string, nombre: string) => {
    const confirmed = window.confirm(
      `¿Estás seguro de que deseas desactivar la cuenta "${nombre}"?`
    )
    if (!confirmed) return

    try {
      const response = await fetch(`/api/tesoreria/cuentas/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al desactivar la cuenta')
      }

      toast.success('Cuenta desactivada exitosamente')
      fetchCuentas()
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al desactivar la cuenta')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Landmark className="h-8 w-8 text-muted-foreground" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Cuentas de Tesorería</h1>
            <p className="text-muted-foreground">
              Gestión de cuentas bancarias, cajas y valores
            </p>
          </div>
        </div>
        <Link href="/tesoreria/cuentas/nueva">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cuenta
          </Button>
        </Link>
      </div>

      {/* Table Card */}
      <Card>
        <CardHeader>
          <CardTitle>Listado de Cuentas</CardTitle>
          <CardDescription>
            Todas las cuentas de tesorería registradas
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : cuentas.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Landmark className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No hay cuentas de tesorería registradas</p>
              <Link href="/tesoreria/cuentas/nueva">
                <Button className="mt-4" variant="outline">
                  <Plus className="mr-2 h-4 w-4" />
                  Crear primera cuenta
                </Button>
              </Link>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead>Nro. Cuenta</TableHead>
                    <TableHead>Cuenta Contable</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cuentas.map((cuenta) => (
                    <TableRow key={cuenta.id}>
                      <TableCell className="font-medium">{cuenta.nombre}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {tipoLabels[cuenta.tipo] ?? cuenta.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {cuenta.banco ? (
                          cuenta.banco
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {cuenta.numeroCuenta ? (
                          <span className="font-mono text-sm">{cuenta.numeroCuenta}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {cuenta.cuentaContable ? (
                          <span className="text-sm">
                            {cuenta.cuentaContable.code} - {cuenta.cuentaContable.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {cuenta.activa ? (
                          <Badge className="bg-green-100 text-green-800">Activo</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-800">Inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/tesoreria/cuentas/${cuenta.id}`}>
                            <Button variant="ghost" size="icon">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          {cuenta.activa && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDesactivar(cuenta.id, cuenta.nombre)}
                            >
                              <PowerOff className="h-4 w-4 text-red-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
