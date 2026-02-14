'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Plus, Search, Download, Upload } from 'lucide-react'
import { toast } from 'sonner'

interface Account {
  id: string
  code: string
  name: string
  accountType: string
  level: number
  isActive: boolean
  acceptsEntries: boolean
  parent?: {
    id: string
    code: string
    name: string
  }
  _count: {
    children: number
    journalEntryLines: number
  }
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ACTIVO: 'Activo',
  PASIVO: 'Pasivo',
  PATRIMONIO_NETO: 'Patrimonio Neto',
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
}

const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  ACTIVO: 'bg-blue-100 text-blue-700',
  PASIVO: 'bg-red-100 text-red-700',
  PATRIMONIO_NETO: 'bg-purple-100 text-purple-700',
  INGRESO: 'bg-green-100 text-green-700',
  EGRESO: 'bg-orange-100 text-orange-700',
}

export default function PlanCuentasPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [levelFilter, setLevelFilter] = useState('all')
  const [hasInitialized, setHasInitialized] = useState(false)

  useEffect(() => {
    fetchAccounts()
  }, [typeFilter, levelFilter])

  const fetchAccounts = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()

      if (typeFilter !== 'all') {
        params.append('accountType', typeFilter)
      }

      if (levelFilter !== 'all') {
        params.append('level', levelFilter)
      }

      params.append('activeOnly', 'true')

      const response = await fetch(`/api/contabilidad/plan-cuentas?${params}`)

      if (!response.ok) {
        throw new Error('Error al cargar cuentas')
      }

      const data = await response.json()
      setAccounts(data)
      setHasInitialized(data.length > 0)
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al cargar plan de cuentas')
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }

  const initializePlan = async () => {
    if (!confirm('¿Deseas inicializar el plan de cuentas argentino estándar?')) {
      return
    }

    try {
      setLoading(true)
      toast.info('Inicializando plan de cuentas...')

      const response = await fetch('/api/contabilidad/plan-cuentas/initialize', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Error al inicializar')
      }

      const result = await response.json()
      toast.success(`Plan de cuentas creado: ${result.count} cuentas`)
      fetchAccounts()
    } catch (error) {
      console.error('Error:', error)
      toast.error('Error al inicializar plan de cuentas')
    } finally {
      setLoading(false)
    }
  }

  const filteredAccounts = accounts.filter(account =>
    account.name.toLowerCase().includes(search.toLowerCase()) ||
    account.code.includes(search)
  )

  const getLevelIndent = (level: number) => {
    return `${(level - 1) * 2}rem`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Plan de Cuentas</h1>
          <p className="text-gray-600 mt-1">
            Gestiona el plan de cuentas contable
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={initializePlan}>
            <Upload className="mr-2 h-4 w-4" />
            Inicializar Plan
          </Button>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cuenta
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Plan de Cuentas Contable</CardTitle>
          <CardDescription>
            {hasInitialized
              ? `${accounts.length} cuentas registradas`
              : 'Inicializa el plan de cuentas para comenzar'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-6 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar por código o nombre..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Tipo de cuenta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="ACTIVO">Activo</SelectItem>
                <SelectItem value="PASIVO">Pasivo</SelectItem>
                <SelectItem value="PATRIMONIO_NETO">Patrimonio Neto</SelectItem>
                <SelectItem value="INGRESO">Ingreso</SelectItem>
                <SelectItem value="EGRESO">Egreso</SelectItem>
              </SelectContent>
            </Select>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="Nivel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los niveles</SelectItem>
                <SelectItem value="1">Nivel 1</SelectItem>
                <SelectItem value="2">Nivel 2</SelectItem>
                <SelectItem value="3">Nivel 3</SelectItem>
                <SelectItem value="4">Nivel 4</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Cargando...</p>
            </div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-12">
              {!hasInitialized ? (
                <>
                  <BookOpen className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Plan de Cuentas No Inicializado
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Inicializa el plan de cuentas argentino estándar para comenzar
                  </p>
                  <Button onClick={initializePlan}>
                    <Upload className="mr-2 h-4 w-4" />
                    Inicializar Plan de Cuentas
                  </Button>
                </>
              ) : (
                <p className="text-gray-500">No se encontraron cuentas</p>
              )}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Nivel</TableHead>
                    <TableHead className="text-center">Subcuentas</TableHead>
                    <TableHead className="text-center">Asientos</TableHead>
                    <TableHead className="text-center">Acepta Asientos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((account) => (
                    <TableRow
                      key={account.id}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <TableCell className="font-mono font-medium">
                        {account.code}
                      </TableCell>
                      <TableCell>
                        <span
                          style={{ marginLeft: getLevelIndent(account.level) }}
                          className={account.level === 1 ? 'font-bold' : account.level === 2 ? 'font-semibold' : ''}
                        >
                          {account.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={ACCOUNT_TYPE_COLORS[account.accountType]}>
                          {ACCOUNT_TYPE_LABELS[account.accountType]}
                        </Badge>
                      </TableCell>
                      <TableCell>{account.level}</TableCell>
                      <TableCell className="text-center">
                        {account._count.children > 0 && (
                          <Badge variant="outline">{account._count.children}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {account._count.journalEntryLines > 0 && (
                          <Badge variant="outline">{account._count.journalEntryLines}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {account.acceptsEntries ? (
                          <Badge className="bg-green-100 text-green-700">Sí</Badge>
                        ) : (
                          <Badge variant="outline">No</Badge>
                        )}
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

function BookOpen({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
      />
    </svg>
  )
}
