import { describe, it, expect } from 'vitest'
import { parseValvulas } from '@/lib/certificados-form'
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
