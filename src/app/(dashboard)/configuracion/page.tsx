'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2, FileText, Users, BookOpen, Globe, Wallet, Plug, Target } from 'lucide-react'
import { DatosGeneralesTab } from '@/components/configuracion/DatosGeneralesTab'
import { DatosImpositivosTab } from '@/components/configuracion/DatosImpositivosTab'
import { ClientesProveedoresTab } from '@/components/configuracion/ClientesProveedoresTab'
import { TalonariosTab } from '@/components/configuracion/TalonariosTab'
import { TesoreriaTab } from '@/components/configuracion/TesoreriaTab'

interface CompanySettings {
  id: string
  // Datos generales
  name: string
  legalName: string
  address: string
  city: string
  province: string
  postalCode: string
  country: string
  phone: string
  email: string
  cbu: string | null
  taxId: string
  iibbNumber: string | null

  // Logo
  logoUrl: string | null
  logoWidth: number | null
  logoHeight: number | null

  // Datos impositivos
  taxCondition: string
  fiscalDebitAccount: string | null
  fiscalCreditAccount: string | null

  // Agentes de retención
  isWithholdingAgent: boolean
  withholdingGananciasAccount: string | null
  withholdingIIBB: boolean
  withholdingIIBBAccount: string | null
  withholdingIVA: boolean
  withholdingIVAAccount: string | null
  withholdingARBA: boolean
  autoCalculateAGIP: boolean

  // Retenciones sufridas
  retentionGananciasAccount: string | null
  retentionIVAAccount: string | null
  retentionSUSSAccount: string | null

  // Percepciones sufridas
  perceptionIVAAccount: string | null

  // Clientes/Proveedores
  customerDefaultAccount: string | null
  customerAdvanceAccount: string | null
  customerInterestAccount: string | null
  customerDiscountAccount: string | null
  customerExchangeAccount: string | null

  supplierDefaultAccount: string | null
  supplierAdvanceAccount: string | null
  supplierInterestAccount: string | null
  supplierDiscountAccount: string | null
  supplierExchangeAccount: string | null

  // Avisos
  invoiceReminder1Enabled: boolean
  invoiceReminder1Days: number
  invoiceReminder1Before: boolean
  invoiceReminder2Enabled: boolean
  invoiceReminder2Days: number
  invoiceReminder2Before: boolean
  invoiceReminder3Enabled: boolean
  invoiceReminder3Days: number
  invoiceReminder3Before: boolean

  autoSendReceipts: boolean
  autoSendPaymentOrders: boolean

  // Index signature to allow Record<string, unknown> compatibility
  [key: string]: string | number | boolean | null | undefined
}

export default function ConfiguracionPage() {
  const [settings, setSettings] = useState<CompanySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('datos-generales')

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/configuracion')
      if (response.ok) {
        const data = await response.json()
        setSettings(data)
      }
    } catch (error) {
      console.error('Error loading settings:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-900">No se pudo cargar la configuración de la empresa.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Configuración de Empresa</h1>
        <p className="text-lg text-gray-600 mt-1">
          Gestiona los datos y configuración de VAL ARG S.R.L.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-4 lg:grid-cols-8 gap-2 h-auto bg-transparent">
          <TabsTrigger
            value="datos-generales"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Building2 className="h-4 w-4" />
            <span className="text-xs">Datos generales</span>
          </TabsTrigger>

          <TabsTrigger
            value="datos-impositivos"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <FileText className="h-4 w-4" />
            <span className="text-xs">Datos Impositivos</span>
          </TabsTrigger>

          <TabsTrigger
            value="clientes-proveedores"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Users className="h-4 w-4" />
            <span className="text-xs">Clientes/Proveedores</span>
          </TabsTrigger>

          <TabsTrigger
            value="talonarios"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <BookOpen className="h-4 w-4" />
            <span className="text-xs">Talonarios</span>
          </TabsTrigger>

          <TabsTrigger
            value="portal-clientes"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
            disabled
          >
            <Globe className="h-4 w-4" />
            <span className="text-xs">Portal Clientes</span>
          </TabsTrigger>

          <TabsTrigger
            value="tesoreria"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
          >
            <Wallet className="h-4 w-4" />
            <span className="text-xs">Tesorería</span>
          </TabsTrigger>

          <TabsTrigger
            value="integraciones"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
            disabled
          >
            <Plug className="h-4 w-4" />
            <span className="text-xs">Integraciones</span>
          </TabsTrigger>

          <TabsTrigger
            value="centros-costos"
            className="flex flex-col items-center gap-1 p-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"
            disabled
          >
            <Target className="h-4 w-4" />
            <span className="text-xs">Centros de Costos</span>
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="datos-generales" className="mt-0">
            <DatosGeneralesTab settings={settings} onUpdate={loadSettings} />
          </TabsContent>

          <TabsContent value="datos-impositivos" className="mt-0">
            <DatosImpositivosTab settings={settings} onUpdate={loadSettings} />
          </TabsContent>

          <TabsContent value="clientes-proveedores" className="mt-0">
            <ClientesProveedoresTab settings={settings} onUpdate={loadSettings} />
          </TabsContent>

          <TabsContent value="talonarios" className="mt-0">
            <TalonariosTab />
          </TabsContent>

          <TabsContent value="portal-clientes" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Portal Clientes</CardTitle>
                <CardDescription>Próximamente disponible</CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>

          <TabsContent value="tesoreria" className="mt-0">
            <TesoreriaTab settings={settings} onUpdate={loadSettings} />
          </TabsContent>

          <TabsContent value="integraciones" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Integraciones</CardTitle>
                <CardDescription>Próximamente disponible</CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>

          <TabsContent value="centros-costos" className="mt-0">
            <Card>
              <CardHeader>
                <CardTitle>Centros de Costos</CardTitle>
                <CardDescription>Próximamente disponible</CardDescription>
              </CardHeader>
            </Card>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
