'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, FileBadge } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Diálogo para generar los certificados de calibración de las válvulas de una
 * cotización. Los campos técnicos se precargan parseando la descripción del
 * ítem elegido; los números de válvula (grabados en cada unidad) los ingresa
 * el usuario. Genera un PDF con una página por válvula, en el formato VALAR
 * moderno (src/lib/pdf/certificado-calibracion-generator.ts).
 */

export interface CertificableItem {
  id: string
  itemNumber: number
  description: string
  quantity: number
}

interface CertificadosDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  quoteId: string
  customerName: string
  items: CertificableItem[]
}

interface TechFields {
  tipo: string
  medida: string
  serie: string
  conexion: string
  materialCuerpo: string
  materialInternos: string
  resorte: string
  asiento: string
  timbre: string
  temperatura: string
  prueba: 'Neumática' | 'Hidráulica'
  capuchon: 'SI' | 'NO'
  palanca: 'SI' | 'NO'
  arandela: 'SI' | 'NO'
  contrapresion: 'SI' | 'NO'
  encargado: string
  rol: string
}

const DEFAULTS: TechFields = {
  tipo: 'Seguridad',
  medida: '',
  serie: '',
  conexion: '',
  materialCuerpo: '',
  materialInternos: '',
  resorte: '',
  asiento: 'PTFE',
  timbre: '',
  temperatura: '25 °C',
  prueba: 'Neumática',
  capuchon: 'NO',
  palanca: 'NO',
  arandela: 'NO',
  contrapresion: 'NO',
  encargado: 'ING Gabriel Krawczynski',
  rol: 'Encargado',
}

/** Precarga los campos técnicos a partir de la descripción del ítem. */
function parseDescription(desc: string): TechFields {
  const f = { ...DEFAULTS }

  if (/alivio/i.test(desc)) f.tipo = 'Alivio'
  else if (/seguridad/i.test(desc)) f.tipo = 'Seguridad'

  const doble = desc.match(/(\d+(?:\/\d+)?)\s*["”]?\s*x\s*(\d+(?:\/\d+)?)\s*["”]/i)
  const simple = desc.match(/de\s+(\d+(?:\/\d+)?)\s*["”]/i)
  if (doble) f.medida = `${doble[1]}" x ${doble[2]}"`
  else if (simple) f.medida = `${simple[1]}" x ${simple[1]}"`

  const serie = desc.match(/(?:serie|clase|ansi)\s*(\d{2,4})/i)
  if (serie) f.serie = serie[1]
  if (/brid/i.test(desc)) f.conexion = serie ? `Bridada ANSI ${serie[1]} RF` : 'Bridada RF'
  else if (/rosc/i.test(desc)) f.conexion = 'Roscada BSPT'

  const aisi = desc.match(/AISI\s*(\d{3}L?)/i)
  const sae = desc.match(/SAE\s*(\d{4})/i)
  const material = aisi ? `AISI ${aisi[1].toUpperCase()}` : sae ? `SAE ${sae[1]}` : ''
  if (material) {
    f.materialCuerpo = material
    f.materialInternos = material
    f.resorte = material
  }

  const asiento = desc.match(/asiento\s+(?:en\s+)?([A-Za-zÁÉÍÓÚÑáéíóúñ]+)/i)
  if (asiento) f.asiento = asiento[1].toUpperCase()

  const timbre = desc.match(/calibrad\w*\s+a\s+([\d.,]+)\s*(bar|kg)/i)
  if (timbre) {
    const unidad = timbre[2].toLowerCase() === 'kg' ? 'Kg/cm²' : 'bar'
    let valor = timbre[1].replace('.', ',')
    if (!valor.includes(',')) valor += ',0'
    f.timbre = `${valor} ${unidad}`
  }

  if (/capuch/i.test(desc)) f.capuchon = 'SI'
  if (/palanca/i.test(desc)) f.palanca = 'SI'

  return f
}

/** "AISI 304" -> "acero inoxidable AISI 304", "SAE 1045" -> "acero SAE 1045" */
function expandMaterial(m: string): string {
  if (/^AISI/i.test(m)) return `acero inoxidable ${m}`
  if (/^SAE/i.test(m)) return `acero ${m}`
  return m
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "11983-11987" o "11983, 11984; 11985" -> lista de números */
function parseValvulas(input: string): string[] {
  const parts = input.split(/[,;\s]+/).filter(Boolean)
  const result: string[] = []
  for (const part of parts) {
    const range = part.match(/^(\d+)-(\d+)$/)
    if (range) {
      const from = parseInt(range[1], 10)
      const to = parseInt(range[2], 10)
      if (to < from || to - from > 200) return []
      for (let n = from; n <= to; n++) result.push(String(n))
    } else {
      result.push(part)
    }
  }
  return result
}

export function CertificadosDialog({
  open,
  onOpenChange,
  quoteId,
  customerName,
  items,
}: CertificadosDialogProps) {
  const [selectedItemId, setSelectedItemId] = useState('')
  const [valvulasInput, setValvulasInput] = useState('')
  const [fields, setFields] = useState<TechFields>(DEFAULTS)
  const [loading, setLoading] = useState(false)

  const set = (patch: Partial<TechFields>) => setFields((prev) => ({ ...prev, ...patch }))

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId)
    const item = items.find((i) => i.id === itemId)
    if (item) setFields(parseDescription(item.description))
  }

  const handleGenerate = async () => {
    const valvulas = parseValvulas(valvulasInput)
    if (valvulas.length === 0) {
      toast.error('Indicá los números de válvula (ej: 11983-11987)')
      return
    }

    const f = fields
    const tipoEn = f.tipo === 'Alivio' ? 'Relief Valve' : 'Safety Valve'
    const conexEn = /brid/i.test(f.conexion) ? 'Flanged' : /rosc/i.test(f.conexion) ? 'Threaded' : ''
    const subtitulo = [f.medida, f.serie && `SERIE ${f.serie}`, f.materialInternos]
      .filter(Boolean)
      .join('  -  ') + (conexEn ? `  (${conexEn} ${tipoEn})` : '')
    const specParts = [
      f.conexion,
      f.materialCuerpo && `Cuerpo e internos en ${expandMaterial(f.materialInternos)}`,
      f.asiento && `Asiento en ${f.asiento}`,
      f.capuchon === 'SI' ? 'Capuchón' : '',
      f.timbre && `Calibrada a ${f.timbre}`,
    ].filter(Boolean)
    const descripcion =
      `Válvula de ${f.tipo.toLowerCase()} a resorte de fabricación VALAR` +
      (f.conexion ? `, de conexión ${f.conexion}` : '') +
      (f.materialCuerpo ? `, cuerpo y bonete en ${expandMaterial(f.materialCuerpo)}` : '') +
      (f.materialInternos ? `, internos (tobera, obturador y guía) en ${expandMaterial(f.materialInternos)}` : '') +
      (f.resorte ? `, resorte en ${expandMaterial(f.resorte)}` : '') +
      (f.asiento ? ` y asiento en ${f.asiento}` : '') +
      `. El presente certificado documenta la identificación de la unidad, sus materiales y el ` +
      `resultado de la calibración a la presión de timbre, verificada mediante prueba ` +
      `${f.prueba.toLowerCase()} en banco VALAR.`

    const body = {
      valvulas,
      tituloPill: `CERTIFICADO DE CALIBRACIÓN Y PRUEBA ${f.prueba.toUpperCase()}`,
      titulo: `VÁLVULA DE ${f.tipo.toUpperCase()}`,
      subtitulo,
      specline: specParts.join(' · '),
      descripcion,
      marcaTipo: `VALAR · ${f.tipo}`,
      materiales: [
        ['Cuerpo', cap(expandMaterial(f.materialCuerpo))],
        ['Bonete', cap(expandMaterial(f.materialCuerpo))],
        ['Tobera', cap(expandMaterial(f.materialInternos))],
        ['Obturador', cap(expandMaterial(f.materialInternos))],
        ['Guía', cap(expandMaterial(f.materialInternos))],
        ['Resorte', cap(expandMaterial(f.resorte))],
        ['Asiento', f.asiento],
      ].filter(([, v]) => v),
      calibracion: [
        ['Presión de timbre', f.timbre || '-'],
        [`Prueba ${f.prueba.toLowerCase()}`, 'APROBADO'],
        ['Temperatura de ensayo', f.temperatura || '-'],
        ['Contrapresión', f.contrapresion],
      ],
      conexiones: [
        ['Medida entrada - salida', f.medida || '-'],
        ['Entrada / Salida', f.conexion || '-'],
        ['Capuchón · Palanca', `${f.capuchon} · ${f.palanca}`],
        ['Arandela de cobre', f.arandela],
      ],
      encargado: { nombre: f.encargado, rol: f.rol },
    }

    try {
      setLoading(true)
      const response = await fetch(`/api/cotizaciones/${quoteId}/certificados`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => null)
        throw new Error(err?.error || 'Error al generar certificados')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = customerName.replace(/[/\\:*?"<>|]/g, '-').trim()
      const rangeLabel =
        valvulas.length > 1 ? `${valvulas[0]}-${valvulas[valvulas.length - 1]}` : valvulas[0]
      a.download = `Certificados ${rangeLabel} ${safeName}.pdf`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast.success(`${valvulas.length} certificado${valvulas.length > 1 ? 's' : ''} generado${valvulas.length > 1 ? 's' : ''}`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al generar certificados')
    } finally {
      setLoading(false)
    }
  }

  const selectedItem = items.find((i) => i.id === selectedItemId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBadge className="h-5 w-5" />
            Generar certificados de calibración
          </DialogTitle>
          <DialogDescription>
            Un PDF con una página por válvula, en el formato VALAR. Los campos se
            precargan desde la descripción del ítem — revisalos antes de generar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Ítem de la cotización</Label>
            <Select value={selectedItemId} onValueChange={handleSelectItem}>
              <SelectTrigger>
                <SelectValue placeholder="Elegí el ítem a certificar" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    #{item.itemNumber} · {item.quantity} un. · {item.description.slice(0, 70)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Números de válvula (grabados en cada unidad)</Label>
            <Input
              value={valvulasInput}
              onChange={(e) => setValvulasInput(e.target.value)}
              placeholder="Ej: 11983-11987 o 11983, 11984, 11985"
            />
            {selectedItem && (
              <p className="text-muted-foreground text-xs">
                El ítem tiene {selectedItem.quantity} unidades — se genera una página por número.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo de válvula</Label>
              <Input value={fields.tipo} onChange={(e) => set({ tipo: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Medida entrada - salida</Label>
              <Input value={fields.medida} onChange={(e) => set({ medida: e.target.value })} placeholder={'2" x 3"'} />
            </div>
            <div className="space-y-1.5">
              <Label>Serie / Clase</Label>
              <Input value={fields.serie} onChange={(e) => set({ serie: e.target.value })} placeholder="150" />
            </div>
            <div className="space-y-1.5">
              <Label>Conexión</Label>
              <Input value={fields.conexion} onChange={(e) => set({ conexion: e.target.value })} placeholder="Bridada ANSI 150 RF" />
            </div>
            <div className="space-y-1.5">
              <Label>Material cuerpo y bonete</Label>
              <Input value={fields.materialCuerpo} onChange={(e) => set({ materialCuerpo: e.target.value })} placeholder="AISI 304" />
            </div>
            <div className="space-y-1.5">
              <Label>Material internos</Label>
              <Input value={fields.materialInternos} onChange={(e) => set({ materialInternos: e.target.value })} placeholder="AISI 304" />
            </div>
            <div className="space-y-1.5">
              <Label>Resorte</Label>
              <Input value={fields.resorte} onChange={(e) => set({ resorte: e.target.value })} placeholder="AISI 304" />
            </div>
            <div className="space-y-1.5">
              <Label>Asiento</Label>
              <Input value={fields.asiento} onChange={(e) => set({ asiento: e.target.value })} placeholder="PTFE" />
            </div>
            <div className="space-y-1.5">
              <Label>Presión de timbre</Label>
              <Input value={fields.timbre} onChange={(e) => set({ timbre: e.target.value })} placeholder="4,0 bar" />
            </div>
            <div className="space-y-1.5">
              <Label>Temperatura de ensayo</Label>
              <Input value={fields.temperatura} onChange={(e) => set({ temperatura: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Prueba</Label>
              <Select value={fields.prueba} onValueChange={(v) => set({ prueba: v as TechFields['prueba'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Neumática">Neumática</SelectItem>
                  <SelectItem value="Hidráulica">Hidráulica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Contrapresión</Label>
              <Select value={fields.contrapresion} onValueChange={(v) => set({ contrapresion: v as 'SI' | 'NO' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NO">NO</SelectItem>
                  <SelectItem value="SI">SI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Capuchón</Label>
              <Select value={fields.capuchon} onValueChange={(v) => set({ capuchon: v as 'SI' | 'NO' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SI">SI</SelectItem>
                  <SelectItem value="NO">NO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Palanca</Label>
              <Select value={fields.palanca} onValueChange={(v) => set({ palanca: v as 'SI' | 'NO' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SI">SI</SelectItem>
                  <SelectItem value="NO">NO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Arandela de cobre</Label>
              <Select value={fields.arandela} onValueChange={(v) => set({ arandela: v as 'SI' | 'NO' })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleGenerate} disabled={loading || !valvulasInput.trim()}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileBadge className="mr-2 h-4 w-4" />}
            Generar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
