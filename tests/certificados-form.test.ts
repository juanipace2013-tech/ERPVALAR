import { describe, it, expect } from 'vitest'
import {
  parseValvulas,
  payloadToTechFields,
  buildCertificadoPayload,
  TECH_DEFAULTS,
  type CertificadoGuardado,
} from '@/lib/certificados-form'
import { generateCertificadoCalibracionPDF } from '@/lib/pdf/certificado-calibracion-generator'

describe('parseValvulas', () => {
  it('rango con un guion', () => {
    expect(parseValvulas('12005-12008')).toEqual(['12005', '12006', '12007', '12008'])
  })
  it('lista con varios guiones (una página por número)', () => {
    const r = parseValvulas('12005-12006-12007-12008-12009-12010-12011-12012-12013-12014-12015-12016')
    expect(r).toHaveLength(12)
    expect(r[0]).toBe('12005')
    expect(r[11]).toBe('12016')
  })
  it('lista con comas y espacios', () => {
    expect(parseValvulas('11983, 11984; 11985')).toEqual(['11983', '11984', '11985'])
  })
})

describe('generateCertificadoCalibracionPDF', () => {
  it('una página por válvula', () => {
    const doc = generateCertificadoCalibracionPDF({
      cliente: 'CONUAR S.A.',
      referencia: 'VAL-2026-3112',
      oc: '10079307',
      fecha: new Date(2026, 9, 15),
      valvulas: parseValvulas('12005-12006-12007'),
      tituloPill: 'CERTIFICADO DE CALIBRACIÓN Y PRUEBA HIDRÁULICA',
      titulo: 'VÁLVULA DE SEGURIDAD',
      subtitulo: '1/2" x 1/2"',
      specline: 'Roscada BSPT',
      descripcion: 'Válvula de seguridad',
      marcaTipo: 'VALAR · Seguridad',
      materiales: [['Cuerpo', 'AISI 304']],
      calibracion: [['Presión de timbre', '20 Bar.']],
      conexiones: [['Entrada', '1/2" BSPT']],
      encargado: { nombre: 'X', rol: 'Y' },
      logoBase64: '',
    })
    expect(doc.getNumberOfPages()).toBe(3)
  })
})

describe('payloadToTechFields', () => {
  const campos = {
    ...TECH_DEFAULTS,
    tipo: 'Seguridad',
    medida: '2" x 3"',
    serie: '150',
    conexion: 'Bridada ANSI 150 RF',
    materialCuerpo: 'AISI 304',
    materialInternos: 'AISI 316',
    resorte: 'SAE 1045',
    asiento: 'PTFE',
    timbre: '4,0 bar',
    temperatura: '25 °C',
    prueba: 'Hidráulica' as const,
    capuchon: 'SI' as const,
    palanca: 'NO' as const,
    arandela: 'SI' as const,
    contrapresion: 'NO' as const,
  }

  it('usa los campos guardados si están', () => {
    const payload = buildCertificadoPayload(campos, ['1'])
    expect(payloadToTechFields(payload)).toEqual(campos)
  })

  it('reconstruye los campos de un certificado viejo (sin campos guardados)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { techFields: _omit, ...viejo } = buildCertificadoPayload(campos, ['1'])
    expect(payloadToTechFields(viejo as CertificadoGuardado)).toEqual(campos)
  })

  it('payload vacío devuelve los valores por defecto', () => {
    expect(payloadToTechFields({})).toEqual(TECH_DEFAULTS)
  })
})
