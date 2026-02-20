'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  ArrowLeft,
  Upload,
  Download,
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

interface SupplierData {
  name?: string
  taxId?: string
  discount?: string
  [key: string]: string | undefined
}

interface ValidationResult {
  row: number
  status: 'valid' | 'error'
  supplier: SupplierData
  error?: string
}

interface ImportResults {
  success: number
  errors: number
}

export default function ImportSuppliersPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [validating, setValidating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [parsedData, setParsedData] = useState<SupplierData[]>([])
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([])
  const [importResults, setImportResults] = useState<ImportResults | null>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        toast.error('Por favor selecciona un archivo CSV')
        return
      }
      setFile(selectedFile)
      setParsedData([])
      setValidationResults([])
      setImportResults(null)
    }
  }

  const parseCSV = async () => {
    if (!file) return

    setParsing(true)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter((line) => line.trim())

      if (lines.length < 2) {
        toast.error('El archivo CSV está vacío o solo tiene headers')
        setParsing(false)
        return
      }

      // Parsear headers
      const headers = lines[0].split(',').map((h) => h.trim())

      // Parsear datos
      const data: SupplierData[] = []
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
        const row: SupplierData = {}
        headers.forEach((header, index) => {
          row[header] = values[index] || ''
        })
        data.push(row)
      }

      setParsedData(data)
      toast.success(`${data.length} registros cargados del CSV`)
    } catch (error) {
      console.error('Error parsing CSV:', error)
      toast.error('Error al parsear el archivo CSV')
    } finally {
      setParsing(false)
    }
  }

  const validateData = async () => {
    if (parsedData.length === 0) return

    setValidating(true)
    try {
      const response = await fetch('/api/proveedores/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suppliers: parsedData,
          validateOnly: true,
        }),
      })

      if (!response.ok) {
        throw new Error('Error al validar datos')
      }

      const result = await response.json()
      setValidationResults(result.results)

      if (result.errors === 0) {
        toast.success(`✓ Todos los ${result.valid} registros son válidos`)
      } else {
        toast.warning(
          `${result.valid} registros válidos, ${result.errors} con errores`
        )
      }
    } catch (error) {
      console.error('Error validating data:', error)
      toast.error('Error al validar datos')
    } finally {
      setValidating(false)
    }
  }

  const importData = async () => {
    if (parsedData.length === 0) return

    const validCount = validationResults.filter((r) => r.status === 'valid').length
    if (validCount === 0) {
      toast.error('No hay registros válidos para importar')
      return
    }

    if (!confirm(`¿Confirmas la importación de ${validCount} proveedores?`)) {
      return
    }

    setImporting(true)
    try {
      const response = await fetch('/api/proveedores/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suppliers: parsedData,
          validateOnly: false,
        }),
      })

      if (!response.ok) {
        throw new Error('Error al importar proveedores')
      }

      const result = await response.json()
      setImportResults(result)

      if (result.success > 0) {
        toast.success(`✓ ${result.success} proveedores importados exitosamente`)
      }

      if (result.errors > 0) {
        toast.warning(`${result.errors} registros no pudieron importarse`)
      }
    } catch (error) {
      console.error('Error importing data:', error)
      toast.error('Error al importar proveedores')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = async () => {
    try {
      const response = await fetch('/api/proveedores/import')
      if (!response.ok) {
        throw new Error('Error al descargar plantilla')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla-proveedores.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast.success('Plantilla descargada')
    } catch (error) {
      console.error('Error downloading template:', error)
      toast.error('Error al descargar plantilla')
    }
  }

  const validCount = validationResults.filter((r) => r.status === 'valid').length
  const errorCount = validationResults.filter((r) => r.status === 'error').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/proveedores')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-blue-900">
              Importar Proveedores
            </h1>
            <p className="text-muted-foreground">
              Importa proveedores desde un archivo CSV
            </p>
          </div>
        </div>
      </div>

      {/* Instructions */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-lg text-blue-900">Instrucciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 font-semibold text-sm">
              1
            </div>
            <div>
              <p className="font-medium">Descarga la plantilla CSV</p>
              <p className="text-sm text-muted-foreground">
                Utiliza la plantilla como referencia para formatear tus datos
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 font-semibold text-sm">
              2
            </div>
            <div>
              <p className="font-medium">Completa el archivo con tus proveedores</p>
              <p className="text-sm text-muted-foreground">
                El campo nombre es obligatorio. CUIT debe ser único si lo incluyes.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 font-semibold text-sm">
              3
            </div>
            <div>
              <p className="font-medium">Sube el archivo y valida los datos</p>
              <p className="text-sm text-muted-foreground">
                Revisa los errores de validación antes de importar
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-900 font-semibold text-sm">
              4
            </div>
            <div>
              <p className="font-medium">Confirma la importación</p>
              <p className="text-sm text-muted-foreground">
                Solo se importarán los registros válidos
              </p>
            </div>
          </div>

          <div className="pt-4">
            <Button onClick={downloadTemplate} variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Descargar Plantilla CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* File Upload */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle className="text-lg text-blue-900">Subir Archivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              id="csv-upload"
            />
            <label htmlFor="csv-upload">
              <Button variant="outline" asChild>
                <span>
                  <FileText className="h-4 w-4 mr-2" />
                  Seleccionar Archivo CSV
                </span>
              </Button>
            </label>

            {file && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{file.name}</span>
                <Button
                  size="sm"
                  onClick={parseCSV}
                  disabled={parsing}
                >
                  {parsing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Parseando...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Cargar Datos
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>

          {parsedData.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {parsedData.length} registros cargados. Haz clic en &quot;Validar Datos&quot; para continuar.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Validation & Import */}
      {parsedData.length > 0 && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg text-blue-900 flex items-center justify-between">
              <span>Vista Previa y Validación</span>
              <div className="flex gap-2">
                {validationResults.length === 0 ? (
                  <Button
                    onClick={validateData}
                    disabled={validating}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {validating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Validar Datos
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={importData}
                    disabled={importing || validCount === 0 || importResults !== null}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Importar {validCount} Proveedores
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Summary */}
            {validationResults.length > 0 && (
              <div className="grid grid-cols-3 gap-4 mb-6">
                <Card className="border-blue-200">
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="text-2xl font-bold">{validationResults.length}</div>
                  </CardContent>
                </Card>
                <Card className="border-green-200">
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Válidos</div>
                    <div className="text-2xl font-bold text-green-600">{validCount}</div>
                  </CardContent>
                </Card>
                <Card className="border-red-200">
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground">Con Errores</div>
                    <div className="text-2xl font-bold text-red-600">{errorCount}</div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Results Table */}
            {validationResults.length > 0 && (
              <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-50">
                      <TableHead className="w-12">Fila</TableHead>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>CUIT</TableHead>
                      <TableHead>Descuento</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validationResults.map((result) => (
                      <TableRow key={result.row}>
                        <TableCell className="font-mono text-sm">{result.row}</TableCell>
                        <TableCell>
                          {result.status === 'valid' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{result.supplier?.name || '-'}</TableCell>
                        <TableCell className="font-mono text-sm">{result.supplier?.taxId || '-'}</TableCell>
                        <TableCell>{result.supplier?.discount}%</TableCell>
                        <TableCell className="text-sm text-red-600">
                          {result.error || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Import Results */}
            {importResults && (
              <Alert className="mt-6">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  <strong>Importación completada:</strong>{' '}
                  {importResults.success} proveedores importados exitosamente.
                  {importResults.errors > 0 && ` ${importResults.errors} errores.`}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Return Button */}
      {importResults && (
        <div className="flex justify-end">
          <Button onClick={() => router.push('/proveedores')}>
            Volver a Proveedores
          </Button>
        </div>
      )}
    </div>
  )
}
