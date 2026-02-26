'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  User,
  Wallet,
  FileText,
  BarChart3,
  ShieldCheck,
} from 'lucide-react'
import TabDatosGenerales from './TabDatosGenerales'
import TabCuentaCorriente from './TabCuentaCorriente'
import TabFacturasAdeudadas from './TabFacturasAdeudadas'
import TabComercial from './TabComercial'
import TabAnalisisBCRA from './TabAnalisisBCRA'

interface ColppyCustomer {
  id: string
  colppyId: string
  name: string
  businessName: string
  cuit: string
  taxCondition: string
  taxConditionDisplay: string
  address: string
  city: string
  province: string
  postalCode: string
  phone: string
  mobile: string
  email: string
  saldo: number
  priceMultiplier: number
  paymentTerms: string
  paymentTermsDays: number
}

interface Props {
  colppyCustomer: ColppyCustomer
  cuit: string
}

export default function ClienteDetailTabs({ colppyCustomer, cuit }: Props) {
  const [activeTab, setActiveTab] = useState('general')
  // Track which tabs have been activated (lazy loading)
  const [activatedTabs, setActivatedTabs] = useState<Set<string>>(new Set(['general']))

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    setActivatedTabs((prev) => new Set([...prev, value]))
  }

  const colppyId = colppyCustomer.colppyId || colppyCustomer.id

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="grid w-full grid-cols-5 h-auto">
        <TabsTrigger value="general" className="flex items-center gap-1.5 text-xs py-2">
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Datos Generales</span>
          <span className="sm:hidden">General</span>
        </TabsTrigger>
        <TabsTrigger value="facturas" className="flex items-center gap-1.5 text-xs py-2">
          <FileText className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Facturas Adeudadas</span>
          <span className="sm:hidden">Adeudadas</span>
        </TabsTrigger>
        <TabsTrigger value="cc" className="flex items-center gap-1.5 text-xs py-2">
          <Wallet className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Cuenta Corriente</span>
          <span className="sm:hidden">CC</span>
        </TabsTrigger>
        <TabsTrigger value="comercial" className="flex items-center gap-1.5 text-xs py-2">
          <BarChart3 className="h-3.5 w-3.5" />
          Comercial
        </TabsTrigger>
        <TabsTrigger value="bcra" className="flex items-center gap-1.5 text-xs py-2">
          <ShieldCheck className="h-3.5 w-3.5" />
          BCRA
        </TabsTrigger>
      </TabsList>

      <div className="mt-4">
        <TabsContent value="general" className="mt-0">
          <TabDatosGenerales customer={colppyCustomer} />
        </TabsContent>

        <TabsContent value="facturas" className="mt-0">
          {activatedTabs.has('facturas') && (
            <TabFacturasAdeudadas colppyId={colppyId} />
          )}
        </TabsContent>

        <TabsContent value="cc" className="mt-0">
          {activatedTabs.has('cc') && (
            <TabCuentaCorriente colppyId={colppyId} saldoInicial={colppyCustomer.saldo} />
          )}
        </TabsContent>

        <TabsContent value="comercial" className="mt-0">
          {activatedTabs.has('comercial') && (
            <TabComercial cuit={cuit} />
          )}
        </TabsContent>

        <TabsContent value="bcra" className="mt-0">
          {activatedTabs.has('bcra') && (
            <TabAnalisisBCRA cuit={cuit} />
          )}
        </TabsContent>
      </div>
    </Tabs>
  )
}
