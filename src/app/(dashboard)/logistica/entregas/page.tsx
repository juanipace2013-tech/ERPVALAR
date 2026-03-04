'use client'

import { Card, CardContent } from '@/components/ui/card'
import { PackageCheck } from 'lucide-react'

export default function EntregasPage() {
  return (
    <div className="container mx-auto px-6 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Entregas</h1>
      <Card>
        <CardContent className="text-center py-16">
          <PackageCheck className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 text-lg">Próximamente</p>
          <p className="text-gray-400 text-sm mt-2">
            Tablero Kanban de gestión de entregas
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
