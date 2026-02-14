'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Receipt, Download, Printer, Calendar, ShoppingCart, Store } from 'lucide-react'
import { toast } from 'sonner'

export default function LibroIVAPage() {
  const [period, setPeriod] = useState('')
  const [activeTab, setActiveTab] = useState('compras')

  const handleGenerate = () => {
    if (!period) {
      toast.error('Debes seleccionar un período')
      return
    }
    toast.info('Módulo de Libro IVA en desarrollo')
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExport = () => {
    toast.info('Función de exportación en desarrollo')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Libro IVA</h1>
          <p className="text-gray-600 mt-1">
            Libros IVA de compras y ventas según normativa AFIP
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Período del Libro IVA</CardTitle>
          <CardDescription>
            Selecciona el período para generar los libros IVA
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="period">Período (MM/AAAA)</Label>
              <Input
                id="period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="MM/AAAA"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleGenerate} className="w-full">
                <Calendar className="mr-2 h-4 w-4" />
                Generar Libros IVA
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs de Compras y Ventas */}
      <Card>
        <CardHeader>
          <CardTitle>Libros IVA</CardTitle>
          <CardDescription>
            Registros de IVA compras y ventas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="compras">
                <ShoppingCart className="mr-2 h-4 w-4" />
                IVA Compras
              </TabsTrigger>
              <TabsTrigger value="ventas">
                <Store className="mr-2 h-4 w-4" />
                IVA Ventas
              </TabsTrigger>
            </TabsList>

            {/* IVA Compras */}
            <TabsContent value="compras" className="space-y-4">
              <Card className="bg-blue-50 border-blue-200">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <ShoppingCart className="h-16 w-16 text-blue-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Libro IVA Compras
                    </h3>
                    <p className="text-gray-600 mb-4">
                      Este módulo registrará las compras realizadas con el detalle de IVA según normativa AFIP
                    </p>
                    <div className="space-y-2 text-sm text-gray-700 max-w-md mx-auto">
                      <p>✓ Registro de facturas de compra</p>
                      <p>✓ Detalle de IVA 10.5%, 21%, 27%</p>
                      <p>✓ Percepciones y retenciones</p>
                      <p>✓ Crédito fiscal disponible</p>
                    </div>
                    <div className="mt-6">
                      <Button disabled variant="outline">
                        En Desarrollo
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ejemplo de tabla IVA Compras */}
              <div className="rounded-md border opacity-50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>N° Comprobante</TableHead>
                      <TableHead>Proveedor</TableHead>
                      <TableHead>CUIT</TableHead>
                      <TableHead className="text-right">Neto</TableHead>
                      <TableHead className="text-right">IVA 21%</TableHead>
                      <TableHead className="text-right">IVA 10.5%</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                        No hay registros para mostrar
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* IVA Ventas */}
            <TabsContent value="ventas" className="space-y-4">
              <Card className="bg-green-50 border-green-200">
                <CardContent className="pt-6">
                  <div className="text-center">
                    <Store className="h-16 w-16 text-green-600 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">
                      Libro IVA Ventas
                    </h3>
                    <p className="text-gray-600 mb-4">
                      Este módulo registrará las ventas realizadas con el detalle de IVA según normativa AFIP
                    </p>
                    <div className="space-y-2 text-sm text-gray-700 max-w-md mx-auto">
                      <p>✓ Registro de facturas de venta</p>
                      <p>✓ Detalle de IVA 10.5%, 21%, 27%</p>
                      <p>✓ Percepciones aplicadas</p>
                      <p>✓ Débito fiscal generado</p>
                    </div>
                    <div className="mt-6">
                      <Button disabled variant="outline">
                        En Desarrollo
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Ejemplo de tabla IVA Ventas */}
              <div className="rounded-md border opacity-50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>N° Comprobante</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>CUIT</TableHead>
                      <TableHead className="text-right">Neto</TableHead>
                      <TableHead className="text-right">IVA 21%</TableHead>
                      <TableHead className="text-right">IVA 10.5%</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-gray-500 py-8">
                        No hay registros para mostrar
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>

          {/* Información adicional */}
          <Card className="mt-6 bg-gray-50">
            <CardContent className="pt-6">
              <h4 className="font-semibold text-gray-900 mb-3">Información AFIP</h4>
              <div className="grid gap-3 md:grid-cols-2 text-sm text-gray-600">
                <div>
                  <p className="font-medium text-gray-900">Alícuotas de IVA vigentes:</p>
                  <ul className="mt-1 space-y-1">
                    <li>• IVA General: 21%</li>
                    <li>• IVA Reducido: 10.5%</li>
                    <li>• IVA Incrementado: 27%</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Tipos de comprobantes:</p>
                  <ul className="mt-1 space-y-1">
                    <li>• Factura A, B, C</li>
                    <li>• Nota de Crédito</li>
                    <li>• Nota de Débito</li>
                    <li>• Recibo</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
