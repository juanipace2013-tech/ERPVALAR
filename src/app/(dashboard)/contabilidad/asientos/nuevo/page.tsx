'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, ArrowLeft, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Account {
  id: string
  code: string
  name: string
  accountType: string
  acceptsEntries: boolean
}

interface EntryLine {
  accountId: string
  description: string
  debit: number
  credit: number
}

export default function NuevoAsientoPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<EntryLine[]>([
    { accountId: '', description: '', debit: 0, credit: 0 },
    { accountId: '', description: '', debit: 0, credit: 0 },
  ])

  useEffect(() => {
    fetchAccounts()
  }, [])

  const fetchAccounts = async () => {
    try {
      const response = await fetch('/api/contabilidad/plan-cuentas?activeOnly=true')
      if (!response.ok) {
        throw new Error('Error al cargar cuentas')
      }
      const data = await response.json()
      // Filtrar solo cuentas que aceptan asientos
      setAccounts(data.filter((acc: Account) => acc.acceptsEntries))
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar plan de cuentas')
    }
  }

  const addLine = () => {
    setLines([...lines, { accountId: '', description: '', debit: 0, credit: 0 }])
  }

  const removeLine = (index: number) => {
    if (lines.length > 2) {
      setLines(lines.filter((_, i) => i !== index))
    } else {
      toast.error('Debe haber al menos 2 líneas')
    }
  }

  const updateLine = (index: number, field: keyof EntryLine, value: string | number) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    setLines(newLines)
  }

  const getTotalDebit = () => {
    return lines.reduce((sum, line) => sum + Number(line.debit), 0)
  }

  const getTotalCredit = () => {
    return lines.reduce((sum, line) => sum + Number(line.credit), 0)
  }

  const getDifference = () => {
    return getTotalDebit() - getTotalCredit()
  }

  const isBalanced = () => {
    return Math.abs(getDifference()) < 0.01
  }

  const handleSave = async (status: 'DRAFT' | 'POSTED') => {
    // Validaciones
    if (!description.trim()) {
      toast.error('Ingresa una descripción para el asiento')
      return
    }

    if (lines.some(line => !line.accountId)) {
      toast.error('Todas las líneas deben tener una cuenta seleccionada')
      return
    }

    if (lines.every(line => line.debit === 0 && line.credit === 0)) {
      toast.error('Debe haber al menos un valor de debe o haber')
      return
    }

    if (!isBalanced()) {
      toast.error('El asiento no está balanceado (Debe = Haber)')
      return
    }

    if (status === 'POSTED' && !confirm('¿Confirmar este asiento? No podrá ser modificado después.')) {
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/contabilidad/asientos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date,
          description,
          status,
          lines: lines.map(line => ({
            accountId: line.accountId,
            description: line.description || description,
            debit: Number(line.debit),
            credit: Number(line.credit),
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Error al crear asiento')
      }

      const entry = await response.json()
      toast.success(
        status === 'POSTED'
          ? 'Asiento creado y confirmado exitosamente'
          : 'Asiento guardado como borrador'
      )
      router.push(`/contabilidad/asientos/${entry.id}`)
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al crear asiento')
    } finally {
      setLoading(false)
    }
  }

  const getAccountLabel = (account: Account) => {
    return `${account.code} - ${account.name}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/contabilidad/asientos">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Nuevo Asiento Contable</h1>
          <p className="text-gray-600 mt-1">
            Registra un asiento con partida doble
          </p>
        </div>
      </div>

      {/* Formulario */}
      <Card>
        <CardHeader>
          <CardTitle>Información del Asiento</CardTitle>
          <CardDescription>
            Complete los datos del asiento contable
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Fecha y Descripción */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="date">Fecha</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descripción General</Label>
                <Input
                  id="description"
                  placeholder="Ej: Compra de mercadería"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            {/* Líneas del asiento */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Líneas del Asiento</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addLine}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar Línea
                </Button>
              </div>

              <div className="space-y-4">
                {lines.map((line, index) => (
                  <Card key={index} className="border-blue-100">
                    <CardContent className="pt-6">
                      <div className="grid gap-4 md:grid-cols-12 items-start">
                        <div className="md:col-span-4 space-y-2">
                          <Label>Cuenta</Label>
                          <Select
                            value={line.accountId}
                            onValueChange={(value) => updateLine(index, 'accountId', value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Seleccionar cuenta" />
                            </SelectTrigger>
                            <SelectContent>
                              {accounts.map((account) => (
                                <SelectItem key={account.id} value={account.id}>
                                  {getAccountLabel(account)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-3 space-y-2">
                          <Label>Detalle (opcional)</Label>
                          <Input
                            placeholder="Detalle específico"
                            value={line.description}
                            onChange={(e) => updateLine(index, 'description', e.target.value)}
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <Label>Debe</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.debit || ''}
                            onChange={(e) => updateLine(index, 'debit', e.target.value)}
                            onFocus={(e) => {
                              if (e.target.value === '0') updateLine(index, 'debit', '')
                            }}
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <Label>Haber</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.credit || ''}
                            onChange={(e) => updateLine(index, 'credit', e.target.value)}
                            onFocus={(e) => {
                              if (e.target.value === '0') updateLine(index, 'credit', '')
                            }}
                          />
                        </div>
                        <div className="md:col-span-1 flex items-end space-y-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => removeLine(index)}
                            disabled={lines.length <= 2}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Totales */}
              <Card className={isBalanced() ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <CardContent className="pt-6">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <Label className="text-sm text-gray-600">Total Debe</Label>
                      <p className="text-2xl font-bold text-gray-900">
                        ${getTotalDebit().toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-600">Total Haber</Label>
                      <p className="text-2xl font-bold text-gray-900">
                        ${getTotalCredit().toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm text-gray-600">Diferencia</Label>
                      <p className={`text-2xl font-bold ${isBalanced() ? 'text-green-700' : 'text-red-700'}`}>
                        ${Math.abs(getDifference()).toFixed(2)}
                      </p>
                      {isBalanced() ? (
                        <p className="text-sm text-green-600 mt-1">✓ Asiento balanceado</p>
                      ) : (
                        <p className="text-sm text-red-600 mt-1">✗ Debe = Haber</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Acciones */}
            <div className="flex gap-3 justify-end">
              <Link href="/contabilidad/asientos">
                <Button variant="outline">Cancelar</Button>
              </Link>
              <Button
                variant="outline"
                onClick={() => handleSave('DRAFT')}
                disabled={loading}
              >
                <Save className="mr-2 h-4 w-4" />
                Guardar Borrador
              </Button>
              <Button
                onClick={() => handleSave('POSTED')}
                disabled={loading || !isBalanced()}
              >
                Confirmar Asiento
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
