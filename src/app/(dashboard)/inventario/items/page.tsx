'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import {
  Plus, Upload, Package, Settings, DollarSign,
  ShoppingCart, RefreshCw, Link2, LayoutDashboard,
} from 'lucide-react'
import dynamic from 'next/dynamic'

// Lazy load heavy components
const InventoryDashboard = dynamic(() => import('@/components/inventario/InventoryDashboard'), {
  loading: () => <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>,
})
const InventoryItemsTab = dynamic(() => import('@/components/inventario/InventoryItemsTab'), {
  loading: () => <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>,
})
const PurchaseAnalysisTab = dynamic(() => import('@/components/inventario/PurchaseAnalysisTab'), {
  loading: () => <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>,
})
const RotationABCTab = dynamic(() => import('@/components/inventario/RotationABCTab'), {
  loading: () => <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>,
})
const UnlinkedItemsTab = dynamic(() => import('@/components/inventario/UnlinkedItemsTab'), {
  loading: () => <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>,
})

export default function ItemsInventarioPage() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [unlinkedCount, setUnlinkedCount] = useState<number | null>(null)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-blue-900">Inventario</h1>
          <p className="text-muted-foreground">
            Gestión completa de items de inventario
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/inventario/items/importar">
            <Button variant="outline">
              <Upload className="mr-2 h-4 w-4" />
              Importar items
            </Button>
          </Link>
          <Link href="/inventario/movimientos/nuevo">
            <Button variant="outline">
              <Package className="mr-2 h-4 w-4" />
              Nuevo Movimiento
            </Button>
          </Link>
          <Link href="/inventario/items/nuevo">
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="mr-2 h-4 w-4" />
              Agregar Item
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-blue-50 border-blue-200 flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="dashboard" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="items" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Package className="mr-2 h-4 w-4" />
            Items de inventario
          </TabsTrigger>
          <TabsTrigger value="purchases" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Análisis de Compras
          </TabsTrigger>
          <TabsTrigger value="rotation" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <RefreshCw className="mr-2 h-4 w-4" />
            Rotación y ABC
          </TabsTrigger>
          <TabsTrigger value="config" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Settings className="mr-2 h-4 w-4" />
            Configuración
          </TabsTrigger>
          <TabsTrigger value="prices" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <DollarSign className="mr-2 h-4 w-4" />
            Listas de precios
          </TabsTrigger>
          <TabsTrigger value="unlinked" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
            <Link2 className="mr-2 h-4 w-4" />
            Items sin vincular
            {unlinkedCount !== null && unlinkedCount > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                {unlinkedCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <InventoryDashboard />
        </TabsContent>

        <TabsContent value="items" className="mt-6">
          <InventoryItemsTab />
        </TabsContent>

        <TabsContent value="purchases" className="mt-6">
          <PurchaseAnalysisTab />
        </TabsContent>

        <TabsContent value="rotation" className="mt-6">
          <RotationABCTab />
        </TabsContent>

        <TabsContent value="config" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="text-center py-12">
                <Settings className="h-12 w-12 text-blue-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Configuración de Inventario</h3>
                <p className="text-muted-foreground">
                  Próximamente: Gestión de depósitos, configuración de costos y más.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prices" className="mt-6">
          <Card className="border-blue-200">
            <CardContent className="p-6">
              <div className="text-center py-12">
                <DollarSign className="h-12 w-12 text-blue-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Listas de Precios</h3>
                <p className="text-muted-foreground">
                  Próximamente: Gestión de múltiples listas de precios.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unlinked" className="mt-6">
          <UnlinkedItemsTab onCountUpdate={setUnlinkedCount} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
