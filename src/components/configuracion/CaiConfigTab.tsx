'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, Save, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

interface CaiConfig {
  id: string
  pointOfSale: number
  caiNumber: string
  caiExpirationDate: string
  startNumber: number
  endNumber: number
  lastUsedNumber: number
  active: boolean
  createdAt: string
}

const emptyForm = {
  pointOfSale: 6,
  caiNumber: '',
  caiExpirationDate: '',
  startNumber: 1,
  endNumber: 1000,
}

export function CaiConfigTab() {
  const [configs, setConfigs] = useState<CaiConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    loadConfigs()
  }, [])

  const loadConfigs = async () => {
    try {
      const res = await fetch('/api/cai-config')
      if (res.ok) {
        setConfigs(await res.json())
      }
    } catch (error) {
      console.error('Error loading CAI configs:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/cai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al guardar')
      }
      toast.success('CAI configurado correctamente')
      setShowForm(false)
      setForm(emptyForm)
      loadConfigs()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al guardar CAI')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta configuración de CAI?')) return
    try {
      const res = await fetch(`/api/cai-config/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Error al eliminar')
      toast.success('CAI eliminado')
      loadConfigs()
    } catch {
      toast.error('Error al eliminar CAI')
    }
  }

  const handleToggleActive = async (config: CaiConfig) => {
    try {
      const res = await fetch(`/api/cai-config/${config.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !config.active }),
      })
      if (!res.ok) throw new Error('Error al actualizar')
      toast.success(config.active ? 'CAI desactivado' : 'CAI activado')
      loadConfigs()
    } catch {
      toast.error('Error al actualizar CAI')
    }
  }

  const fmtDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('es-AR')
    } catch {
      return d
    }
  }

  const isExpired = (d: string) => new Date(d) < new Date()
  const isNearExpiry = (d: string) => {
    const diff = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    return diff > 0 && diff <= 30
  }
  const usagePercent = (c: CaiConfig) => {
    const total = c.endNumber - c.startNumber + 1
    const used = c.lastUsedNumber - c.startNumber + 1
    return total > 0 ? Math.max(0, (used / total) * 100) : 0
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Configuración de CAI (ARCA)</CardTitle>
            <CardDescription>
              Gestiona los CAI para autoimpresión de remitos clase R
            </CardDescription>
          </div>
          {!showForm && (
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Nuevo CAI
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showForm && (
            <form onSubmit={handleSubmit} className="border rounded-lg p-4 mb-6 bg-gray-50 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pointOfSale">Punto de Venta</Label>
                  <Input
                    id="pointOfSale"
                    type="number"
                    value={form.pointOfSale}
                    onChange={(e) => setForm({ ...form, pointOfSale: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="caiNumber">Número de CAI</Label>
                  <Input
                    id="caiNumber"
                    value={form.caiNumber}
                    onChange={(e) => setForm({ ...form, caiNumber: e.target.value })}
                    placeholder="Ej: 12345678901234"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="caiExpirationDate">Fecha de Vencimiento</Label>
                  <Input
                    id="caiExpirationDate"
                    type="date"
                    value={form.caiExpirationDate}
                    onChange={(e) => setForm({ ...form, caiExpirationDate: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startNumber">Desde N°</Label>
                  <Input
                    id="startNumber"
                    type="number"
                    value={form.startNumber}
                    onChange={(e) => setForm({ ...form, startNumber: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endNumber">Hasta N°</Label>
                  <Input
                    id="endNumber"
                    type="number"
                    value={form.endNumber}
                    onChange={(e) => setForm({ ...form, endNumber: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Guardar
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm(emptyForm) }}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {configs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No hay configuraciones de CAI. Crea una para empezar a emitir remitos con CAI.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PV</TableHead>
                  <TableHead>N° CAI</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Rango</TableHead>
                  <TableHead>Último usado</TableHead>
                  <TableHead>Uso</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configs.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono">{String(c.pointOfSale).padStart(4, '0')}</TableCell>
                    <TableCell className="font-mono text-sm">{c.caiNumber}</TableCell>
                    <TableCell>
                      <span className={isExpired(c.caiExpirationDate) ? 'text-red-600 font-semibold' : isNearExpiry(c.caiExpirationDate) ? 'text-amber-600 font-semibold' : ''}>
                        {fmtDate(c.caiExpirationDate)}
                      </span>
                      {isExpired(c.caiExpirationDate) && (
                        <AlertTriangle className="h-3 w-3 text-red-500 inline ml-1" />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.startNumber} - {c.endNumber}</TableCell>
                    <TableCell className="font-mono">{c.lastUsedNumber}</TableCell>
                    <TableCell>
                      <div className="w-20 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${usagePercent(c) >= 80 ? 'bg-red-500' : 'bg-blue-500'}`}
                          style={{ width: `${Math.min(100, usagePercent(c))}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{usagePercent(c).toFixed(0)}%</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.active ? 'default' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => handleToggleActive(c)}
                      >
                        {c.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
