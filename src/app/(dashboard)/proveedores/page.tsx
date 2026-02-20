'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Truck, ClipboardList, Receipt } from 'lucide-react'

// Lazy imports for better performance
import dynamic from 'next/dynamic'

const ProveedoresListado = dynamic(() => import('./listado/page'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-12">Cargando...</div>
})

const OrdenesCompra = dynamic(() => import('./ordenes-compra/page'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-12">Cargando...</div>
})

const FacturasCompra = dynamic(() => import('./facturas-compra/page'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center p-12">Cargando...</div>
})

export default function ProveedoresMainPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultTab = searchParams.get('tab') || 'proveedores'
  const [activeTab, setActiveTab] = useState(defaultTab)

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    router.push(`/proveedores?tab=${value}`, { scroll: false })
  }

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Módulo de Proveedores</h1>
        <p className="text-gray-600 mt-1">
          Gestión completa de proveedores, órdenes de compra y facturas
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b bg-gray-50/50 px-6 pt-6">
              <TabsList className="grid w-full max-w-3xl grid-cols-3 bg-white">
                <TabsTrigger value="proveedores" className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Proveedores
                </TabsTrigger>
                <TabsTrigger value="ordenes" className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" />
                  Órdenes de Compra
                </TabsTrigger>
                <TabsTrigger value="facturas" className="flex items-center gap-2">
                  <Receipt className="h-4 w-4" />
                  Facturas de Compra
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="proveedores" className="m-0 border-0 p-0">
              <ProveedoresListado />
            </TabsContent>

            <TabsContent value="ordenes" className="m-0 border-0 p-0">
              <OrdenesCompra />
            </TabsContent>

            <TabsContent value="facturas" className="m-0 border-0 p-0">
              <FacturasCompra />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
