'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Building2, Info, Loader2, MoreVertical } from 'lucide-react'
import { BankAccountCard } from '@/components/tesoreria/BankAccountCard'
import { AccountDetail } from '@/components/tesoreria/AccountDetail'
import { BankAccountDialog } from '@/components/tesoreria/BankAccountDialog'
import { CheckManagementDialog } from '@/components/tesoreria/CheckManagementDialog'

interface BankAccount {
  id: string
  name: string
  type: string
  bank: string | null
  accountNumber: string | null
  cbu: string | null
  alias: string | null
  currency: string
  balance: number
  reconciledBalance: number
  currencyBalance: number | null
  isActive: boolean
  isConnected: boolean
}

export default function TesoreriaPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null)
  const [checkDialogOpen, setCheckDialogOpen] = useState(false)

  useEffect(() => {
    loadAccounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/tesoreria/cuentas')
      if (response.ok) {
        const data = await response.json()
        setAccounts(data)
        if (data.length > 0 && !selectedAccount) {
          setSelectedAccount(data[0])
        }
      }
    } catch (error) {
      console.error('Error loading accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNewAccount = () => {
    setEditingAccount(null)
    setDialogOpen(true)
  }

  const handleEditAccount = (account: BankAccount) => {
    setEditingAccount(account)
    setDialogOpen(true)
  }

  const handleDialogSuccess = () => {
    loadAccounts()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Cargando cuentas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/30 via-white to-blue-50/30">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tesorería</h1>
            <p className="text-sm text-gray-600 mt-1">
              Gestión de cuentas bancarias y movimientos
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCheckDialogOpen(true)}>
              📋 Gestión de Cheques
            </Button>
            <Button variant="outline">
              📅 Calendario de vencimientos
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-140px)]">
        {/* Panel Izquierdo: Lista de Cuentas */}
        <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                Lista de Cajas/Bancos
                <Info className="h-4 w-4 text-gray-400" />
              </h2>
              <button className="text-gray-400 hover:text-gray-600">
                <MoreVertical className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-3">
            {accounts.map((account) => (
              <BankAccountCard
                key={account.id}
                account={account}
                isSelected={selectedAccount?.id === account.id}
                onClick={() => setSelectedAccount(account)}
                onEdit={() => handleEditAccount(account)}
              />
            ))}

            <Button
              variant="outline"
              className="w-full border-dashed border-2 border-blue-300 text-blue-600 hover:bg-blue-50"
              onClick={handleNewAccount}
            >
              <Building2 className="mr-2 h-4 w-4" />
              Agregar cuenta
            </Button>
          </div>
        </div>

        {/* Panel Derecho: Detalle de Cuenta */}
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {selectedAccount ? (
            <AccountDetail account={selectedAccount} onUpdate={loadAccounts} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-500">
                <Building2 className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg">Seleccione una cuenta para ver detalles</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dialog de Nueva/Editar Cuenta */}
      <BankAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editingAccount}
        onSuccess={handleDialogSuccess}
      />

      {/* Dialog de Gestión de Cheques */}
      <CheckManagementDialog
        open={checkDialogOpen}
        onOpenChange={setCheckDialogOpen}
      />
    </div>
  )
}
