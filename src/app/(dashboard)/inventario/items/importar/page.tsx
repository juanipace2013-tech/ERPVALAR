'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertCircle,
  Download,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

interface ImportRow {
  sku: string
  name: string
  description?: string
  type?: string
  unit?: string
  categoryId?: string
  brand?: string
  stockQuantity?: string | number
  minStock?: string | number
  salePrice?: string | number
  cost?: string | number
  isTaxable?: string | boolean
  taxRate?: string | number
}

interface ParsedProduct {
  rowNumber: number
  data: ImportRow
  isValid: boolean
  errors: string[]
}

export default function ImportarItemsPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<ParsedProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stats, setStats] = useState({ valid: 0, invalid: 0, total: 0 })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    const fileType = selectedFile.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(fileType || '')) {
      toast.error('Formato de archivo no soportado. Use CSV o Excel (.xlsx, .xls)')
      return
    }

    setFile(selectedFile)
    parseFile(selectedFile)
  }

  const parseFile = async (file: File) => {
    setLoading(true)
    try {
      const fileType = file.name.split('.').pop()?.toLowerCase()

      if (fileType === 'csv') {
        // Parse CSV
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            processData(results.data as ImportRow[])
          },
          error: (error) => {
            console.error('Error parsing CSV:', error)
            toast.error('Error al leer el archivo CSV')
            setLoading(false)
          },
        })
      } else {
        // Parse Excel
        const reader = new FileReader()
        reader.onload = (e) => {
          const data = e.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
          const jsonData = XLSX.utils.sheet_to_json(firstSheet) as ImportRow[]
          processData(jsonData)
        }
        reader.readAsBinaryString(file)
      }
    } catch (error) {
      console.error('Error parsing file:', error)
      toast.error('Error al procesar el archivo')
      setLoading(false)
    }
  }

  const processData = (data: ImportRow[]) => {
    const processed: ParsedProduct[] = data.map((row, index) => {
      const errors: string[] = []

      // Validaciones
      if (!row.sku || row.sku.trim() === '') {
        errors.push('SKU es obligatorio')
      } else if (!/^[A-Z0-9-]+$/.test(row.sku)) {
        errors.push('SKU debe contener solo mayúsculas, números y guiones')
      }

      if (!row.name || row.name.trim() === '') {
        errors.push('Nombre es obligatorio')
      }

      if (!row.salePrice || Number(row.salePrice) <= 0) {
        errors.push('Precio de venta debe ser mayor a 0')
      }

      if (row.type && !['PRODUCT', 'SERVICE', 'COMBO'].includes(row.type)) {
        errors.push('Tipo debe ser PRODUCT, SERVICE o COMBO')
      }

      return {
        rowNumber: index + 2, // +2 porque el índice empieza en 0 y hay una fila de encabezados
        data: row,
        isValid: errors.length === 0,
        errors,
      }
    })

    setParsedData(processed)

    const valid = processed.filter(p => p.isValid).length
    const invalid = processed.filter(p => !p.isValid).length

    setStats({
      valid,
      invalid,
      total: processed.length,
    })

    setLoading(false)
    toast.success(`Archivo procesado: ${valid} válidos, ${invalid} con errores`)
  }

  const handleImport = async () => {
    const validProducts = parsedData.filter(p => p.isValid)

    if (validProducts.length === 0) {
      toast.error('No hay productos válidos para importar')
      return
    }

    try {
      setImporting(true)

      // Preparar datos para la API
      const productsToImport = validProducts.map(p => ({
        sku: p.data.sku.toUpperCase(),
        name: p.data.name,
        description: p.data.description || null,
        type: p.data.type || 'PRODUCT',
        unit: p.data.unit || 'UN',
        categoryId: p.data.categoryId || null,
        brand: p.data.brand || null,
        stockQuantity: Number(p.data.stockQuantity) || 0,
        minStock: Number(p.data.minStock) || 0,
        maxStock: null,
        isTaxable: p.data.isTaxable === 'true' || p.data.isTaxable === true,
        taxRate: Number(p.data.taxRate) || 21,
        trackInventory: true,
        allowNegative: false,
        status: 'ACTIVE',
        lastCost: Number(p.data.cost) || null,
        averageCost: Number(p.data.cost) || null,
        prices: [
          {
            currency: 'ARS',
            priceType: 'SALE',
            amount: Number(p.data.salePrice),
            validFrom: new Date().toISOString(),
          },
          ...(p.data.cost && Number(p.data.cost) > 0 ? [{
            currency: 'ARS',
            priceType: 'COST',
            amount: Number(p.data.cost),
            validFrom: new Date().toISOString(),
          }] : []),
        ],
      }))

      const response = await fetch('/api/inventario/importar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ products: productsToImport }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Error al importar productos')
      }

      toast.success(
        `Importación exitosa: ${result.success} productos creados, ${result.failed} fallidos`
      )

      if (result.failed === 0) {
        router.push('/inventario/items')
      } else {
        // Mostrar cuáles fallaron
        console.log('Productos fallidos:', result.errors)
      }
    } catch (error) {
      console.error('Error:', error)
      toast.error(error instanceof Error ? error.message : 'Error al importar productos')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const template = [
      {
        sku: 'PROD-001',
        name: 'Producto Ejemplo',
        description: 'Descripción del producto',
        type: 'PRODUCT',
        unit: 'UN',
        brand: 'Marca',
        stockQuantity: 10,
        minStock: 5,
        salePrice: 1000,
        cost: 500,
        isTaxable: 'true',
        taxRate: 21,
      },
    ]

    const ws = XLSX.utils.json_to_sheet(template)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Productos')
    XLSX.writeFile(wb, 'plantilla_productos.xlsx')
    toast.success('Plantilla descargada')
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/inventario/items')}
            className="text-blue-600 hover:text-blue-700"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              Importar Items
            </h1>
            <p className="text-muted-foreground">
              Cargar múltiples productos desde Excel o CSV
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
          <Download className="mr-2 h-4 w-4" />
          Descargar Plantilla
        </Button>
      </div>

      {/* Upload Section */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-blue-900">1. Seleccionar Archivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-blue-200 bg-blue-50">
            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-sm">
              <strong>Formatos soportados:</strong> CSV, Excel (.xlsx, .xls)
              <br />
              <strong>Columnas requeridas:</strong> sku, name, salePrice
              <br />
              <strong>Columnas opcionales:</strong> description, type, unit, brand, stockQuantity, minStock, cost, isTaxable, taxRate
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 hover:bg-blue-700"
              disabled={loading}
            >
              <Upload className="mr-2 h-4 w-4" />
              Seleccionar Archivo
            </Button>
            {file && (
              <span className="text-sm text-muted-foreground">
                Archivo: <strong>{file.name}</strong>
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview Section */}
      {parsedData.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-blue-200">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total</p>
                    <p className="text-2xl font-bold text-blue-900">{stats.total}</p>
                  </div>
                  <FileSpreadsheet className="h-8 w-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-700">Válidos</p>
                    <p className="text-2xl font-bold text-green-900">{stats.valid}</p>
                  </div>
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-red-700">Con Errores</p>
                    <p className="text-2xl font-bold text-red-900">{stats.invalid}</p>
                  </div>
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data Preview */}
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="text-blue-900">2. Revisar Datos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-blue-100 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="font-semibold text-blue-900">Fila</TableHead>
                      <TableHead className="font-semibold text-blue-900">Estado</TableHead>
                      <TableHead className="font-semibold text-blue-900">SKU</TableHead>
                      <TableHead className="font-semibold text-blue-900">Nombre</TableHead>
                      <TableHead className="font-semibold text-blue-900">Tipo</TableHead>
                      <TableHead className="font-semibold text-blue-900">Precio</TableHead>
                      <TableHead className="font-semibold text-blue-900">Stock</TableHead>
                      <TableHead className="font-semibold text-blue-900">Errores</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedData.slice(0, 50).map((product) => (
                      <TableRow key={product.rowNumber} className={!product.isValid ? 'bg-red-50' : ''}>
                        <TableCell className="font-mono text-sm">{product.rowNumber}</TableCell>
                        <TableCell>
                          {product.isValid ? (
                            <Badge className="bg-green-100 text-green-800">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Válido
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <XCircle className="h-3 w-3 mr-1" />
                              Error
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{product.data.sku}</TableCell>
                        <TableCell>{product.data.name}</TableCell>
                        <TableCell>{product.data.type || 'PRODUCT'}</TableCell>
                        <TableCell>${Number(product.data.salePrice || 0).toLocaleString('es-AR')}</TableCell>
                        <TableCell>{product.data.stockQuantity || 0}</TableCell>
                        <TableCell>
                          {product.errors.length > 0 && (
                            <div className="flex items-start gap-1 text-xs text-red-600">
                              <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                              <div>{product.errors.join(', ')}</div>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {parsedData.length > 50 && (
                <p className="text-sm text-muted-foreground mt-4 text-center">
                  Mostrando primeros 50 de {parsedData.length} productos
                </p>
              )}
            </CardContent>
          </Card>

          {/* Import Button */}
          <div className="flex justify-end gap-4">
            <Button
              variant="outline"
              onClick={() => {
                setFile(null)
                setParsedData([])
                setStats({ valid: 0, invalid: 0, total: 0 })
              }}
              disabled={importing}
            >
              Cancelar
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleImport}
              disabled={importing || stats.valid === 0}
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Importar {stats.valid} Productos
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
