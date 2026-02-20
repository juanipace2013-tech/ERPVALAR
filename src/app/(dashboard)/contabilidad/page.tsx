'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import {
  BookOpen,
  FileText,
  BarChart3,
  PieChart,
  FileSpreadsheet,
  Receipt,
} from 'lucide-react'

const modules = [
  {
    title: 'Plan de Cuentas',
    description: 'Gestiona el plan de cuentas contable',
    icon: BookOpen,
    href: '/contabilidad/plan-cuentas',
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  {
    title: 'Asientos Contables',
    description: 'Registra asientos de debe y haber',
    icon: FileText,
    href: '/contabilidad/asientos',
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  {
    title: 'Libro Diario',
    description: 'Consulta el libro diario',
    icon: BookOpen,
    href: '/contabilidad/libro-diario',
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  {
    title: 'Libro Mayor',
    description: 'Consulta el libro mayor por cuenta',
    icon: FileSpreadsheet,
    href: '/contabilidad/libro-mayor',
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
  },
  {
    title: 'Balance de Sumas y Saldos',
    description: 'Estado de sumas y saldos',
    icon: BarChart3,
    href: '/contabilidad/balance-sumas-saldos',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-100',
  },
  {
    title: 'Estado de Resultados',
    description: 'Resultado del ejercicio',
    icon: PieChart,
    href: '/contabilidad/estado-resultados',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-100',
  },
  {
    title: 'Balance General',
    description: 'Balance contable general',
    icon: BarChart3,
    href: '/contabilidad/balance-general',
    color: 'text-pink-600',
    bgColor: 'bg-pink-100',
  },
  {
    title: 'Libro IVA',
    description: 'Libros IVA compras y ventas',
    icon: Receipt,
    href: '/contabilidad/libro-iva',
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
]

export default function ContabilidadPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-6 text-white shadow-lg">
        <h1 className="text-3xl font-bold">Módulo de Contabilidad</h1>
        <p className="text-blue-100 mt-2">
          Sistema de contabilidad completo para Argentina
        </p>
      </div>

      {/* Módulos */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {modules.map((module) => {
          const Icon = module.icon
          return (
            <Link key={module.href} href={module.href}>
              <Card className="hover:shadow-lg transition-all duration-300 cursor-pointer h-full border-blue-100">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-lg ${module.bgColor}`}>
                      <Icon className={`h-6 w-6 ${module.color}`} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardTitle className="text-lg mb-2">{module.title}</CardTitle>
                  <CardDescription>{module.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Información */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">Información del Sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-1">Plan de Cuentas</h3>
              <p className="text-sm text-gray-600">
                Sistema de 4 niveles con clasificación estándar argentina
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-1">Partida Doble</h3>
              <p className="text-sm text-gray-600">
                Validación automática de debe = haber
              </p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="font-semibold text-gray-900 mb-1">Libros IVA</h3>
              <p className="text-sm text-gray-600">
                Registro de compras y ventas según normativa AFIP
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
