/**
 * Lógica compartida del formulario de certificados de calibración:
 * precarga de campos técnicos parseando una descripción de producto,
 * expansión de rangos de números de válvula y armado del payload.
 */

export interface TechFields {
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

export const TECH_DEFAULTS: TechFields = {
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

/** Precarga los campos técnicos a partir de la descripción del producto. */
export function parseDescription(desc: string): TechFields {
  const f = { ...TECH_DEFAULTS }

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
export function expandMaterial(m: string): string {
  if (/^AISI/i.test(m)) return `acero inoxidable ${m}`
  if (/^SAE/i.test(m)) return `acero ${m}`
  return m
}

export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "11983-11987" o "11983, 11984; 11985" -> lista de números */
export function parseValvulas(input: string): string[] {
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

/** Arma las secciones del certificado a partir de los campos técnicos. */
export function buildCertificadoPayload(f: TechFields, valvulas: string[]) {
  const tipoEn = f.tipo === 'Alivio' ? 'Relief Valve' : 'Safety Valve'
  const conexEn = /brid/i.test(f.conexion) ? 'Flanged' : /rosc/i.test(f.conexion) ? 'Threaded' : ''
  const subtitulo =
    [f.medida, f.serie && `SERIE ${f.serie}`, f.materialInternos].filter(Boolean).join('  -  ') +
    (conexEn ? `  (${conexEn} ${tipoEn})` : '')
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
    (f.materialInternos
      ? `, internos (tobera, obturador y guía) en ${expandMaterial(f.materialInternos)}`
      : '') +
    (f.resorte ? `, resorte en ${expandMaterial(f.resorte)}` : '') +
    (f.asiento ? ` y asiento en ${f.asiento}` : '') +
    `. El presente certificado documenta la identificación de la unidad, sus materiales y el ` +
    `resultado de la calibración a la presión de timbre, verificada mediante prueba ` +
    `${f.prueba.toLowerCase()} en banco VALAR.`

  return {
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
}
