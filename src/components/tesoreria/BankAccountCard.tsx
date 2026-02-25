'use client'

import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BankAccount {
  id: string
  name: string
  type: string
  bank: string | null
  currency: string
  balance: number
  reconciledBalance: number
  currencyBalance: number | null
  isActive: boolean
  isConnected: boolean
}

interface BankAccountCardProps {
  account: BankAccount
  isSelected: boolean
  onClick: () => void
  onEdit?: () => void
}

export function BankAccountCard({ account, isSelected, onClick, onEdit }: BankAccountCardProps) {
  const formatCurrency = (amount: number, currency: string = 'ARS') => {
    if (currency === 'USD') {
      return `USD ${amount.toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`
    }
    return `$${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'p-4 rounded-lg border-2 cursor-pointer transition-all',
        isSelected
          ? 'bg-blue-50 border-blue-500 shadow-md'
          : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
      )}
    >
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-gray-900">{account.name}</h3>
          {account.bank && (
            <p className="text-xs text-gray-500">{account.bank}</p>
          )}
        </div>

        <div className="space-y-1">
          {account.currency !== 'ARS' && account.currencyBalance !== null && (
            <div className="text-sm">
              <span className="text-gray-600">Saldo ME: </span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(account.currencyBalance, account.currency)}
              </span>
            </div>
          )}

          <div className="text-sm">
            <span className="text-gray-600">Saldo: </span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(account.balance)}
            </span>
          </div>

          <div className="text-sm">
            <span className="text-gray-600">Saldo conciliado: </span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(account.reconciledBalance)}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs flex-1"
            onClick={(e) => {
              e.stopPropagation()
              onEdit?.()
            }}
          >
            Editar
          </Button>
          <Button size="sm" variant="outline" className="text-xs flex-1">
            Conciliar
          </Button>
        </div>

        {account.type === 'CHECKING_ACCOUNT' && (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs"
            disabled={account.isConnected}
          >
            {account.isConnected ? 'Conectado' : 'Conectar'}
            <Info className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
