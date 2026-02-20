'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Target, Plus, DollarSign, Calendar, User } from 'lucide-react'

interface Opportunity {
  id: string
  title: string
  stage: string
  value: number
  probability: number
  expectedCloseDate: string
  customer: {
    name: string
  }
  user: {
    name: string
  }
  status: string
}

const stageLabels: Record<string, string> = {
  LEAD: 'Lead',
  QUALIFIED: 'Cualificado',
  PROPOSAL: 'Propuesta',
  NEGOTIATION: 'Negociación',
  CLOSED_WON: 'Ganado',
  CLOSED_LOST: 'Perdido',
}

const stageColors: Record<string, string> = {
  LEAD: 'bg-gray-100 text-gray-800',
  QUALIFIED: 'bg-blue-100 text-blue-800',
  PROPOSAL: 'bg-purple-100 text-purple-800',
  NEGOTIATION: 'bg-orange-100 text-orange-800',
  CLOSED_WON: 'bg-green-100 text-green-800',
  CLOSED_LOST: 'bg-red-100 text-red-800',
}

export default function OportunidadesPage() {
  useEffect(() => {
    // Módulo en construcción
  }, [])

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  // Datos de ejemplo para mostrar la estructura
  const exampleOpportunities: Opportunity[] = [
    {
      id: '1',
      title: 'Proyecto YPF - Sistema de válvulas',
      stage: 'NEGOTIATION',
      value: 250000,
      probability: 75,
      expectedCloseDate: '2024-03-15',
      customer: { name: 'YPF S.A.' },
      user: { name: 'Juan Pérez' },
      status: 'ACTIVE',
    },
    {
      id: '2',
      title: 'Pampa Energía - Mantenimiento anual',
      stage: 'PROPOSAL',
      value: 180000,
      probability: 60,
      expectedCloseDate: '2024-03-20',
      customer: { name: 'Pampa Energía' },
      user: { name: 'María González' },
      status: 'ACTIVE',
    },
    {
      id: '3',
      title: 'TGS - Equipamiento nuevo',
      stage: 'QUALIFIED',
      value: 320000,
      probability: 40,
      expectedCloseDate: '2024-04-10',
      customer: { name: 'TGS' },
      user: { name: 'Carlos López' },
      status: 'ACTIVE',
    },
  ]

  return (
    <div className="container mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Target className="h-8 w-8 text-blue-600" />
            Oportunidades de Venta
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Gestión del pipeline de ventas y seguimiento de oportunidades
          </p>
        </div>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          Nueva Oportunidad
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Oportunidades Activas</p>
                <p className="text-2xl font-bold">12</p>
              </div>
              <Target className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Valor Total Pipeline</p>
                <p className="text-2xl font-bold">$1.8M</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Tasa de Conversión</p>
                <p className="text-2xl font-bold">68%</p>
              </div>
              <Target className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Cierre Esperado</p>
                <p className="text-2xl font-bold">Mar 2024</p>
              </div>
              <Calendar className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mensaje de módulo en construcción */}
      <Card className="mb-6">
        <CardContent className="py-12">
          <div className="text-center">
            <Target className="h-16 w-16 text-blue-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Módulo en Construcción</h3>
            <p className="text-gray-600 mb-6">
              El módulo de Oportunidades está en desarrollo. Aquí podrás gestionar:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
              <div className="bg-blue-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">✅ Pipeline de Ventas</h4>
                <p className="text-sm text-gray-600">
                  Visualiza todas tus oportunidades en diferentes etapas del proceso de venta
                </p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">✅ Seguimiento de Probabilidades</h4>
                <p className="text-sm text-gray-600">
                  Asigna probabilidades de cierre y estima ingresos futuros
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">✅ Gestión de Etapas</h4>
                <p className="text-sm text-gray-600">
                  Mueve oportunidades por las etapas: Lead, Cualificado, Propuesta, Negociación
                </p>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">✅ Reportes y Métricas</h4>
                <p className="text-sm text-gray-600">
                  Analiza tasas de conversión, tiempos de cierre y valor del pipeline
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de Ejemplo */}
      <Card>
        <CardHeader>
          <CardTitle>Vista Previa (Datos de Ejemplo)</CardTitle>
          <CardDescription>
            Así se verá la tabla de oportunidades cuando el módulo esté completo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead>Oportunidad</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-center">Probabilidad</TableHead>
                  <TableHead>Cierre Estimado</TableHead>
                  <TableHead>Responsable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exampleOpportunities.map((opp) => (
                  <TableRow key={opp.id} className="hover:bg-gray-50">
                    <TableCell className="font-semibold">{opp.title}</TableCell>
                    <TableCell>{opp.customer.name}</TableCell>
                    <TableCell>
                      <Badge className={stageColors[opp.stage]}>
                        {stageLabels[opp.stage]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatCurrency(opp.value)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-blue-600">{opp.probability}%</span>
                    </TableCell>
                    <TableCell>{formatDate(opp.expectedCloseDate)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-gray-400" />
                        {opp.user.name}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
