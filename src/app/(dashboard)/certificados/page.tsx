'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, FileBadge, Wand2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { getLocalDateString } from '@/lib/utils'
import {
  TECH_DEFAULTS,
  parseDescription,
  parseValvulas,
  buildCertificadoPayload,
  type TechFields,
} from '@/lib/certificados-form'

/**
 * Generación de certificados de calibración de válvulas, independiente de las
 * cotizaciones: se cargan cliente, OC/referencia y datos técnicos a mano, con
 * la opción de precargar los campos pegando la descripción del producto.
 * Descarga un PDF con una página por válvula en el formato VALAR.
 */
interface CertificadoEmitido {
  id: string
  fecha: string
  cliente: string
  oc: string | null
  referencia: string | null
  valvulas: string[]
  titulo: string
  subtitulo: string | null
  emitidoPor: string | null
  createdAt: string
}

function formatValvulas(valvulas: string[]): string {
  if (valvulas.length <= 2) return valvulas.join(', ')
  return `${valvulas[0]}-${valvulas[valvulas.length - 1]} (${valvulas.length})`
}

export default function CertificadosPage() {
  const [cliente, setCliente] = useState('')
  const [oc, setOc] = useState('')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(getLocalDateString())
  const [descripcion, setDescripcion] = useState('')
  const [valvulasInput, setValvulasInput] = useState('')
  const [fields, setFields] = useState<TechFields>(TECH_DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [historial, setHistorial] = useState<CertificadoEmitido[]>([])
  const [historialLoading, setHistorialLoading] = useState(true)

  const set = (patch: Partial<TechFields>) => setFields((prev) => ({ ...prev, ...patch }))

  const loadHistorial = useCallback(async () => {
    try {
      const response = await fetch('/api/certificados')
      if (!response.ok) return
      const data = await response.json()
      setHistorial(data.certificados || [])
    } catch {
      // silencioso: el historial no bloquea la generación
    } finally {
      setHistorialLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistorial()
  }, [loadHistorial])

  const handlePrefill = () => {
    if (!descripcion.trim()) {
      toast.error('Pegá la descripción del producto para precargar')
      return
    }
    setFields(parseDescription(descripcion))
    toast.success('Campos precargados desde la descripción — revisalos')
  }

  const handleGenerate = async () => {
    if (!cliente.trim()) {
      toast.error('Indicá el cliente')
      return
    }
    const valvulas = parseValvulas(valvulasInput)
    if (valvulas.length === 0) {
      toast.error('Indicá los números de válvula (ej: 11983-11987)')
      return
    }

    try {
      setLoading(true)
      const response = await fetch('/api/certificados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: cliente.trim(),
          oc: oc.trim() || undefined,
          referencia: referencia.trim() || undefined,
          fecha,
          ...buildCertificadoPayload(fields, valvulas),
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.error || 'Error al generar certificados')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = cliente.trim().replace(/[/\\:*?"<>|]/g, '-')
      const rangeLabel =
        valvulas.length > 1 ? `${valvulas[0]}-${valvulas[valvulas.length - 1]}` : valvulas[0]
      a.download = `Certificados ${rangeLabel} ${safeName}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success(
        `${valvulas.length} certificado${valvulas.length > 1 ? 's' : ''} generado${valvulas.length > 1 ? 's' : ''}`
      )
      loadHistorial()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar certificados')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileBadge className="h-6 w-6" />
            Certificados de Calibración
          </h1>
          <p className="text-muted-foreground text-sm">
            Genera un PDF con una página por válvula, en el formato VALAR.
          </p>
        </div>
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileBadge className="mr-2 h-4 w-4" />
          )}
          Generar PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del certificado</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Input
              value={cliente}
              onChange={(e) => setCliente(e.target.value)}
              placeholder="VELO ARGENTINA SA"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fecha de emisión</Label>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>OC N°</Label>
            <Input value={oc} onChange={(e) => setOc(e.target.value)} placeholder="P00138" />
          </div>
          <div className="space-y-1.5">
            <Label>Referencia</Label>
            <Input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Cot. VAL-2026-2373"
            />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Números de válvula (grabados en cada unidad) *</Label>
            <Input
              value={valvulasInput}
              onChange={(e) => setValvulasInput(e.target.value)}
              placeholder="Ej: 11983-11987 o 11983, 11984, 11985"
            />
            <p className="text-muted-foreground text-xs">
              Acepta rangos y listas — se genera una página por número.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Precarga desde descripción (opcional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder={
              'Pegá la descripción del producto, ej: Válvula de seguridad bridada serie 150 de 2" x 3" Cuerpo e internos en AISI 304 con asiento en PTFE y capuchón. Calibrada a 4 bar.'
            }
          />
          <Button variant="outline" onClick={handlePrefill}>
            <Wand2 className="mr-2 h-4 w-4" />
            Precargar campos técnicos
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos técnicos de la válvula</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Tipo de válvula</Label>
            <Input value={fields.tipo} onChange={(e) => set({ tipo: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Medida entrada - salida</Label>
            <Input
              value={fields.medida}
              onChange={(e) => set({ medida: e.target.value })}
              placeholder={'2" x 3"'}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Serie / Clase</Label>
            <Input
              value={fields.serie}
              onChange={(e) => set({ serie: e.target.value })}
              placeholder="150"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Conexión</Label>
            <Input
              value={fields.conexion}
              onChange={(e) => set({ conexion: e.target.value })}
              placeholder="Bridada ANSI 150 RF"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Material cuerpo y bonete</Label>
            <Input
              value={fields.materialCuerpo}
              onChange={(e) => set({ materialCuerpo: e.target.value })}
              placeholder="AISI 304"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Material internos</Label>
            <Input
              value={fields.materialInternos}
              onChange={(e) => set({ materialInternos: e.target.value })}
              placeholder="AISI 304"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Resorte</Label>
            <Input
              value={fields.resorte}
              onChange={(e) => set({ resorte: e.target.value })}
              placeholder="AISI 304"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Asiento</Label>
            <Input
              value={fields.asiento}
              onChange={(e) => set({ asiento: e.target.value })}
              placeholder="PTFE"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Presión de timbre</Label>
            <Input
              value={fields.timbre}
              onChange={(e) => set({ timbre: e.target.value })}
              placeholder="4,0 bar"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Temperatura de ensayo</Label>
            <Input
              value={fields.temperatura}
              onChange={(e) => set({ temperatura: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Prueba</Label>
            <Select
              value={fields.prueba}
              onValueChange={(v) => set({ prueba: v as TechFields['prueba'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Neumática">Neumática</SelectItem>
                <SelectItem value="Hidráulica">Hidráulica</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Contrapresión</Label>
            <Select
              value={fields.contrapresion}
              onValueChange={(v) => set({ contrapresion: v as 'SI' | 'NO' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NO">NO</SelectItem>
                <SelectItem value="SI">SI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Capuchón</Label>
            <Select
              value={fields.capuchon}
              onValueChange={(v) => set({ capuchon: v as 'SI' | 'NO' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SI">SI</SelectItem>
                <SelectItem value="NO">NO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Palanca</Label>
            <Select
              value={fields.palanca}
              onValueChange={(v) => set({ palanca: v as 'SI' | 'NO' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SI">SI</SelectItem>
                <SelectItem value="NO">NO</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Arandela de cobre</Label>
            <Select
              value={fields.arandela}
              onValueChange={(v) => set({ arandela: v as 'SI' | 'NO' })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NO">NO</SelectItem>
                <SelectItem value="SI">SI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Encargado</Label>
            <Input value={fields.encargado} onChange={(e) => set({ encargado: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleGenerate} disabled={loading} size="lg">
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileBadge className="mr-2 h-4 w-4" />
          )}
          Generar PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial de certificados emitidos</CardTitle>
        </CardHeader>
        <CardContent>
          {historialLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando historial...
            </div>
          ) : historial.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              Todavía no hay certificados emitidos.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>OC / Referencia</TableHead>
                  <TableHead>Válvulas</TableHead>
                  <TableHead>Detalle</TableHead>
                  <TableHead>Emitido por</TableHead>
                  <TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historial.map((cert) => (
                  <TableRow key={cert.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(cert.fecha).toLocaleDateString('es-AR', { timeZone: 'UTC' })}
                    </TableCell>
                    <TableCell>{cert.cliente}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {[cert.oc, cert.referencia].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-sm">
                      {formatValvulas(cert.valvulas)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-64 truncate text-sm">
                      {[cert.titulo, cert.subtitulo].filter(Boolean).join(' · ')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {cert.emitidoPor || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Descargar PDF"
                        onClick={() => window.open(`/api/certificados/${cert.id}/pdf`, '_blank')}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
