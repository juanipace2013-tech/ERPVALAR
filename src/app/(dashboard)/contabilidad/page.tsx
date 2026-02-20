'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  PlusCircle,
  Upload,
  Lock,
  Search,
  BookOpen,
  BarChart3,
  FileText,
  FileSpreadsheet,
} from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

interface Account {
  id: string
  code: string
  name: string
  accountType: string
  level: number
  isActive: boolean
  acceptsEntries: boolean
  _count: {
    children: number
    journalEntryLines: number
  }
}

interface BalanceItem {
  account: {
    id: string
    code: string
    name: string
    accountType: string
    level: number
  }
  sums: {
    debit: number
    credit: number
  }
  balance: {
    debit: number
    credit: number
  }
}

interface MayorMovement {
  id: string
  description: string
  debit: number
  credit: number
  balance: number
  journalEntry: {
    id: string
    entryNumber: number
    date: string
    description: string
  }
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ACTIVO: 'Activo',
  PASIVO: 'Pasivo',
  PATRIMONIO_NETO: 'Patrimonio Neto',
  INGRESO: 'Ingreso',
  EGRESO: 'Egreso',
}

const getNormalBalance = (accountType: string) =>
  ['ACTIVO', 'EGRESO'].includes(accountType) ? 'Deudor' : 'Acreedor'

export default function ContabilidadPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [balanceData, setBalanceData] = useState<BalanceItem[]>([])
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [mayorData, setMayorData] = useState<MayorMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [accountsRes, balanceRes] = await Promise.all([
        fetch('/api/contabilidad/plan-cuentas?activeOnly=true'),
        fetch('/api/contabilidad/balance-sumas-saldos'),
      ])

      if (accountsRes.ok) {
        const data = await accountsRes.json()
        setAccounts(data)
      }

      if (balanceRes.ok) {
        const data = await balanceRes.json()
        setBalanceData(data.data || [])
      }
    } catch {
      toast.error('Error al cargar datos contables')
    } finally {
      setLoading(false)
    }
  }

  const fetchMayor = async (accountId: string) => {
    try {
      const res = await fetch(`/api/contabilidad/libro-mayor?accountId=${accountId}`)
      if (res.ok) {
        const data = await res.json()
        setMayorData(data.movements || [])
      }
    } catch {
      setMayorData([])
    }
  }

  const handleSelectAccount = (account: Account) => {
    setSelectedAccount(account)
    fetchMayor(account.id)
  }

  const accountsWithBalance = accounts
    .filter(
      (a) =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.code.includes(search)
    )
    .map((account) => {
      const bal = balanceData.find((b) => b.account.id === account.id)
      const debit = bal?.sums.debit ?? 0
      const credit = bal?.sums.credit ?? 0
      const finalBalance = bal
        ? bal.balance.debit - bal.balance.credit
        : 0
      return { ...account, debit, credit, finalBalance }
    })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white">
        <h1 className="text-xl font-bold text-gray-900">Contabilidad general</h1>
        <div className="flex gap-2">
          <Link href="/contabilidad/asientos/nuevo">
            <Button size="sm">
              <PlusCircle className="mr-2 h-4 w-4" />
              Nuevo asiento a diario
            </Button>
          </Link>
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />
            Importar asientos
          </Button>
          <Button variant="outline" size="sm">
            <Lock className="mr-2 h-4 w-4" />
            Cierres contables
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="panel-cuentas" className="flex flex-col flex-1 overflow-hidden">
        <div className="px-6 border-b bg-white">
          <TabsList variant="line" className="h-10">
            <TabsTrigger value="panel-cuentas">Panel de cuentas</TabsTrigger>
            <TabsTrigger value="asientos">Asientos</TabsTrigger>
            <TabsTrigger value="reportes">Reportes</TabsTrigger>
          </TabsList>
        </div>

        {/* Panel de cuentas */}
        <TabsContent value="panel-cuentas" className="flex-1 flex flex-col overflow-hidden mt-0">
          <div className="flex flex-1 divide-x overflow-hidden">

            {/* Left: Sumas y Saldos table */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Sub-header */}
              <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
                <span className="text-sm font-semibold text-gray-700">Sumas y saldos</span>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    placeholder="Buscar cuenta..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-7 h-7 text-xs w-48"
                  />
                </div>
              </div>

              {/* Sumas y Saldos table */}
              <div className="overflow-auto flex-1">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 text-xs">
                      <TableHead className="text-xs font-semibold py-2">Cuenta</TableHead>
                      <TableHead className="text-xs font-semibold py-2 w-[110px]">Nro. cu...</TableHead>
                      <TableHead className="text-right text-xs font-semibold py-2 w-[110px]">Saldo inicio</TableHead>
                      <TableHead className="text-right text-xs font-semibold py-2 w-[110px]">Débito</TableHead>
                      <TableHead className="text-right text-xs font-semibold py-2 w-[110px]">Crédito</TableHead>
                      <TableHead className="text-right text-xs font-semibold py-2 w-[110px]">Saldo final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-gray-500 text-sm">
                          Cargando cuentas...
                        </TableCell>
                      </TableRow>
                    ) : accountsWithBalance.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-gray-500 text-sm">
                          No se encontraron cuentas. Inicializa el plan de cuentas primero.
                        </TableCell>
                      </TableRow>
                    ) : (
                      accountsWithBalance.map((account) => (
                        <TableRow
                          key={account.id}
                          className={`cursor-pointer text-xs ${
                            selectedAccount?.id === account.id
                              ? 'bg-blue-50 hover:bg-blue-100'
                              : 'hover:bg-gray-50'
                          }`}
                          onClick={() => handleSelectAccount(account)}
                        >
                          <TableCell
                            className="py-1.5"
                            style={{ paddingLeft: `${(account.level - 1) * 16 + 12}px` }}
                          >
                            <span
                              className={
                                account.level === 1
                                  ? 'font-bold'
                                  : account.level === 2
                                  ? 'font-semibold'
                                  : ''
                              }
                            >
                              {account.name}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono py-1.5">{account.code}</TableCell>
                          <TableCell className="text-right font-mono py-1.5 text-gray-400">
                            $0.00
                          </TableCell>
                          <TableCell className="text-right font-mono py-1.5">
                            {account.debit > 0 ? `$${account.debit.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono py-1.5">
                            {account.credit > 0 ? `$${account.credit.toFixed(2)}` : '-'}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono py-1.5 font-semibold ${
                              account.finalBalance > 0
                                ? 'text-blue-700'
                                : account.finalBalance < 0
                                ? 'text-red-700'
                                : ''
                            }`}
                          >
                            {account.finalBalance !== 0
                              ? `$${Math.abs(account.finalBalance).toFixed(2)}`
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Mayor section (bottom of left panel) */}
              {selectedAccount && (
                <div className="flex flex-col border-t" style={{ maxHeight: '220px' }}>
                  <div className="flex items-center px-4 py-2 border-b bg-gray-50">
                    <BookOpen className="h-3.5 w-3.5 text-gray-500 mr-1.5" />
                    <span className="text-sm font-semibold text-gray-700">Mayor</span>
                    <span className="ml-2 text-xs text-gray-500">
                      — {selectedAccount.code} {selectedAccount.name}
                    </span>
                  </div>
                  <div className="overflow-auto flex-1">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50 text-xs">
                          <TableHead className="text-xs font-semibold py-1.5 w-[80px]">Fecha</TableHead>
                          <TableHead className="text-xs font-semibold py-1.5 w-[80px]">N° Asiento</TableHead>
                          <TableHead className="text-xs font-semibold py-1.5">Descripción</TableHead>
                          <TableHead className="text-right text-xs font-semibold py-1.5 w-[100px]">Debe</TableHead>
                          <TableHead className="text-right text-xs font-semibold py-1.5 w-[100px]">Haber</TableHead>
                          <TableHead className="text-right text-xs font-semibold py-1.5 w-[100px]">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mayorData.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-4 text-gray-500 text-xs">
                              Sin movimientos en esta cuenta
                            </TableCell>
                          </TableRow>
                        ) : (
                          mayorData.map((movement) => (
                            <TableRow key={movement.id} className="text-xs hover:bg-gray-50">
                              <TableCell className="font-mono py-1">
                                {new Date(movement.journalEntry.date).toLocaleDateString('es-AR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: '2-digit',
                                })}
                              </TableCell>
                              <TableCell className="font-mono py-1">
                                {movement.journalEntry.entryNumber}
                              </TableCell>
                              <TableCell className="py-1 max-w-[200px] truncate">
                                {movement.journalEntry.description}
                              </TableCell>
                              <TableCell className="text-right font-mono py-1">
                                {movement.debit > 0
                                  ? `$${Number(movement.debit).toFixed(2)}`
                                  : '-'}
                              </TableCell>
                              <TableCell className="text-right font-mono py-1">
                                {movement.credit > 0
                                  ? `$${Number(movement.credit).toFixed(2)}`
                                  : '-'}
                              </TableCell>
                              <TableCell
                                className={`text-right font-mono py-1 font-semibold ${
                                  movement.balance >= 0 ? 'text-green-700' : 'text-red-700'
                                }`}
                              >
                                ${movement.balance.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Account detail panel */}
            {selectedAccount && (
              <div className="w-72 flex-shrink-0 flex flex-col overflow-auto bg-white">
                <div className="px-4 py-2 border-b bg-gray-50">
                  <span className="text-sm font-semibold text-gray-700">Detalles de cuenta</span>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">Código cuenta</Label>
                    <p className="mt-1 text-sm font-mono font-semibold">{selectedAccount.code}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">Descripción</Label>
                    <p className="mt-1 text-sm">{selectedAccount.name}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">Admite asiento manual</Label>
                    <div className="mt-1">
                      {selectedAccount.acceptsEntries ? (
                        <Badge className="bg-green-100 text-green-700 text-xs">Sí</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">No</Badge>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">Saldo habitual</Label>
                    <p className="mt-1 text-sm">{getNormalBalance(selectedAccount.accountType)}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">Tipo de cuenta</Label>
                    <p className="mt-1 text-sm">{ACCOUNT_TYPE_LABELS[selectedAccount.accountType]}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-gray-500 uppercase tracking-wide">Título sumas y saldos</Label>
                    <p className="mt-1 text-sm">{selectedAccount.name}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Asientos tab */}
        <TabsContent value="asientos" className="flex-1 p-6 mt-0">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-w-2xl">
            <Link href="/contabilidad/asientos">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <FileText className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-semibold">Asientos Contables</p>
                  <p className="text-xs text-gray-500">Ver todos los asientos</p>
                </div>
              </div>
            </Link>
            <Link href="/contabilidad/asientos/nuevo">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <PlusCircle className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="text-sm font-semibold">Nuevo Asiento</p>
                  <p className="text-xs text-gray-500">Crear asiento de diario</p>
                </div>
              </div>
            </Link>
            <Link href="/contabilidad/libro-diario">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <BookOpen className="h-5 w-5 text-purple-600" />
                <div>
                  <p className="text-sm font-semibold">Libro Diario</p>
                  <p className="text-xs text-gray-500">Consultar libro diario</p>
                </div>
              </div>
            </Link>
          </div>
        </TabsContent>

        {/* Reportes tab */}
        <TabsContent value="reportes" className="flex-1 p-6 mt-0">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 max-w-3xl">
            <Link href="/contabilidad/balance-sumas-saldos">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <BarChart3 className="h-5 w-5 text-cyan-600" />
                <div>
                  <p className="text-sm font-semibold">Balance Sumas y Saldos</p>
                  <p className="text-xs text-gray-500">Estado de sumas y saldos</p>
                </div>
              </div>
            </Link>
            <Link href="/contabilidad/libro-mayor">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <FileSpreadsheet className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="text-sm font-semibold">Libro Mayor</p>
                  <p className="text-xs text-gray-500">Movimientos por cuenta</p>
                </div>
              </div>
            </Link>
            <Link href="/contabilidad/estado-resultados">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <BarChart3 className="h-5 w-5 text-indigo-600" />
                <div>
                  <p className="text-sm font-semibold">Estado de Resultados</p>
                  <p className="text-xs text-gray-500">Resultado del ejercicio</p>
                </div>
              </div>
            </Link>
            <Link href="/contabilidad/balance-general">
              <div className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                <BarChart3 className="h-5 w-5 text-pink-600" />
                <div>
                  <p className="text-sm font-semibold">Balance General</p>
                  <p className="text-xs text-gray-500">Balance contable general</p>
                </div>
              </div>
            </Link>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
