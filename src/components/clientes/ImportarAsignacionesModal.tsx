'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface ParsedRow {
  rowNumber: number
  cuit: string
  vendedorEmail: string
  isValid: boolean
  error?: string
}

// Normalizar nombres de columnas
function normalizeHeader(header: string): string {
  const h = header.toLowerCase().trim().replace(/[_\s]+/g, '')
  if (h === 'cuit') return 'cuit'
  if (h.includes('email') || h.includes('vendedor') || h.includes('seller')) return 'vendedorEmail'
  return header
}

export default function ImportarAsignacionesModal({ open, onOpenChange, onSuccess }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<ParsedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stats, setStats] = useState({ valid: 0, invalid: 0, total: 0 })
  const [result, setResult] = useState<{
    total: number
    asignados: number
    yaAsignados: number
    cuitNoEncontrado: string[]
    cuitInvalidos: string[]
    errores: { cuit: string; error: string }[]
    vendedorNoEncontrado: string[]
  } | null>(null)

  const reset = () => {
    setFile(null)
    setParsedData([])
    setStats({ valid: 0, invalid: 0, total: 0 })
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = (openState: boolean) => {
    if (!openState) reset()
    onOpenChange(openState)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    const fileType = selectedFile.name.split('.').pop()?.toLowerCase()
    if (!['csv', 'xlsx', 'xls'].includes(fileType || '')) {
      toast.error('Formato no soportado. Use CSV o Excel (.xlsx, .xls)')
      return
    }

    setFile(selectedFile)
    setResult(null)
    parseFile(selectedFile)
  }

  const parseFile = async (file: File) => {
    setLoading(true)
    try {
      const fileType = file.name.split('.').pop()?.toLowerCase()
      let rawData: Record<string, string>[] = []

      if (fileType === 'csv') {
        rawData = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => resolve(results.data as Record<string, string>[]),
            error: (error: Error) => reject(error),
          })
        })
      } else {
        const data = await file.arrayBuffer()
        const workbook = XLSX.read(data, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        rawData = XLSX.utils.sheet_to_json(firstSheet, { raw: false })
      }

      // Normalizar headers y validar
      const parsed: ParsedRow[] = rawData.map((row, index) => {
        // Normalizar las keys del row
        const normalized: Record<string, string> = {}
        for (const [key, value] of Object.entries(row)) {
          normalized[normalizeHeader(key)] = String(value || '').trim()
        }

        const cuit = normalized['cuit'] || ''
        const vendedorEmail = normalized['vendedorEmail'] || ''
        const cleanCuit = cuit.replace(/\D/g, '')

        const errors: string[] = []
        if (!cleanCuit || cleanCuit.length !== 11) {
          errors.push('CUIT inválido')
        }
        if (!vendedorEmail || !vendedorEmail.includes('@')) {
          errors.push('Email inválido')
        }

        return {
          rowNumber: index + 2, // +2 porque fila 1 es header, index es 0-based
          cuit: cuit,
          vendedorEmail: vendedorEmail,
          isValid: errors.length === 0,
          error: errors.join(', '),
        }
      })

      const valid = parsed.filter((r) => r.isValid).length
      const invalid = parsed.filter((r) => !r.isValid).length

      setParsedData(parsed)
      setStats({ valid, invalid, total: parsed.length })
    } catch (error) {
      console.error('Error parsing file:', error)
      toast.error('Error al leer el archivo')
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    const validRows = parsedData.filter((r) => r.isValid)
    if (validRows.length === 0) {
      toast.error('No hay filas válidas para importar')
      return
    }

    setImporting(true)
    try {
      const res = await fetch('/api/clientes/asignar-vendedores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: validRows.map((r) => ({
            cuit: r.cuit,
            vendedorEmail: r.vendedorEmail,
          })),
        }),
      })

      if (!res.ok) throw new Error('Error al importar')

      const data = await res.json()
      setResult(data)

      if (data.asignados > 0) {
        toast.success(`${data.asignados} vendedores asignados exitosamente`)
        onSuccess()
      }
      if (data.errores.length > 0) {
        toast.error(`${data.errores.length} errores durante la importación`)
      }
    } catch {
      toast.error('Error al importar asignaciones')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = () => {
    const template = [
      { CUIT: '30-12345678-9', 'Email Vendedor': 'vendedor@empresa.com' },
      { CUIT: '20-87654321-0', 'Email Vendedor': 'otro@empresa.com' },
    ]
    const ws = XLSX.utils.json_to_sheet(template)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Asignaciones')
    XLSX.writeFile(wb, 'plantilla_asignaciones_vendedores.xlsx')
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-blue-900">Importar Asignaciones de Vendedores</DialogTitle>
          <DialogDescription>
            Asigna vendedores a clientes de forma masiva usando un archivo Excel o CSV.
          </DialogDescription>
        </DialogHeader>

        {/* Resultado final */}
        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <p className="text-2xl font-bold text-blue-700">{result.total}</p>
                <p className="text-xs text-blue-600">Total procesados</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <p className="text-2xl font-bold text-green-700">{result.asignados}</p>
                <p className="text-xs text-green-600">✅ Asignados</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-2xl font-bold text-gray-500">{result.yaAsignados || 0}</p>
                <p className="text-xs text-gray-500">Sin cambios</p>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <p className="text-2xl font-bold text-red-700">
                  {(result.cuitNoEncontrado?.length || 0) + (result.cuitInvalidos?.length || 0) + result.errores.length}
                </p>
                <p className="text-xs text-red-600">⚠️ Con problemas</p>
              </div>
            </div>

            {result.vendedorNoEncontrado.length > 0 && (
              <Alert className="border-yellow-200 bg-yellow-50">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  <strong>⚠️ Emails de vendedor no encontrados:</strong>{' '}
                  {result.vendedorNoEncontrado.join(', ')}
                </AlertDescription>
              </Alert>
            )}

            {result.cuitNoEncontrado && result.cuitNoEncontrado.length > 0 && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-800">
                  <strong>⚠️ {result.cuitNoEncontrado.length} CUITs no encontrados en la base:</strong>
                  <div className="mt-1 max-h-[100px] overflow-y-auto text-xs font-mono">
                    {result.cuitNoEncontrado.join(', ')}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {result.cuitInvalidos && result.cuitInvalidos.length > 0 && (
              <Alert className="border-red-200 bg-red-50">
                <XCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">
                  <strong>⚠️ {result.cuitInvalidos.length} CUITs inválidos (no tienen 11 dígitos):</strong>
                  <div className="mt-1 max-h-[100px] overflow-y-auto text-xs font-mono">
                    {result.cuitInvalidos.join(', ')}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {result.errores.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">CUIT</TableHead>
                      <TableHead className="text-xs">Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.errores.map((err, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm font-mono">{err.cuit}</TableCell>
                        <TableCell className="text-sm text-red-600">{err.error}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cerrar
              </Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                onClick={reset}
              >
                Importar Otro Archivo
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            {/* Instrucciones + upload */}
            {parsedData.length === 0 && (
              <div className="space-y-4">
                <Alert className="border-blue-200 bg-blue-50">
                  <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-800">
                    El archivo debe tener 2 columnas: <strong>CUIT</strong> y{' '}
                    <strong>Email Vendedor</strong>. La primera fila debe ser el encabezado.
                  </AlertDescription>
                </Alert>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={downloadTemplate}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Descargar Plantilla
                  </Button>
                </div>

                <div
                  className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center hover:border-blue-300 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    Click para seleccionar archivo CSV o Excel
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    .csv, .xlsx, .xls
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600 mr-2" />
                <span className="text-gray-500">Leyendo archivo...</span>
              </div>
            )}

            {/* Preview */}
            {parsedData.length > 0 && !loading && (
              <div className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-2xl font-bold text-blue-700">{stats.total}</p>
                    <p className="text-xs text-blue-600">Total filas</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <p className="text-2xl font-bold text-green-700">{stats.valid}</p>
                    <p className="text-xs text-green-600">Válidas</p>
                  </div>
                  <div className="text-center p-3 bg-red-50 rounded-lg">
                    <p className="text-2xl font-bold text-red-700">{stats.invalid}</p>
                    <p className="text-xs text-red-600">Con errores</p>
                  </div>
                </div>

                {file && (
                  <p className="text-xs text-gray-500">
                    Archivo: <span className="font-medium">{file.name}</span>
                  </p>
                )}

                {/* Preview table */}
                <div className="max-h-[300px] overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs w-[60px]">Fila</TableHead>
                        <TableHead className="text-xs w-[60px]">Estado</TableHead>
                        <TableHead className="text-xs">CUIT</TableHead>
                        <TableHead className="text-xs">Email Vendedor</TableHead>
                        <TableHead className="text-xs">Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedData.slice(0, 50).map((row) => (
                        <TableRow key={row.rowNumber}>
                          <TableCell className="text-xs text-gray-400">{row.rowNumber}</TableCell>
                          <TableCell>
                            {row.isValid ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                          </TableCell>
                          <TableCell className="text-sm font-mono">{row.cuit}</TableCell>
                          <TableCell className="text-sm">{row.vendedorEmail}</TableCell>
                          <TableCell>
                            {row.error && (
                              <Badge variant="outline" className="text-xs text-red-600 border-red-200">
                                {row.error}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {parsedData.length > 50 && (
                    <p className="text-xs text-gray-400 text-center py-2">
                      Mostrando primeras 50 de {parsedData.length} filas
                    </p>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={reset}>
                    Cambiar Archivo
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
                        <Upload className="mr-2 h-4 w-4" />
                        Importar {stats.valid} Asignaciones
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
