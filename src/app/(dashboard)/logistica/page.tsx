'use client'

import { Card, CardContent } from '@/components/ui/card'
import { BarChart3 } from 'lucide-react'

export default function LogisticaDashboardPage() {
  return (
    <div className="container mx-auto px-6 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Dashboard Logística</h1>
      <Card>
        <CardContent className="text-center py-16">
          <BarChart3 className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">Próximamente</p>
          <p className="text-gray-400 text-sm mt-2">
            Panel de control y métricas de logística
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
