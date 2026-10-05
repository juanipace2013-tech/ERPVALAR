import { describe, it, expect } from 'vitest'

/**
 * Facturación ML: reglas de la pantalla de dos pestañas y del borrador
 * (src/lib/mercadolibre/facturacion-form.ts). Puras: sin red ni base.
 * La alineación con el servidor (409, POST real) está en ml-facturacion.test.ts.
 */
import {
  PESTANA_FACTURA_ML,
  PROVINCIAS_ERP,
  aplicarRespuestaFacturaEnMl,
  avisoFacturaEnMl,
  avisoOtraClase,
  claseDesdeTipo,
  cuerpoFacturaMl,
  cuitTrasConsulta,
  documentoListado,
  documentoReceptorTexto,
  estadoFacturaEnMlInicial,
  hrefPestanaMl,
  lineasDesdeVenta,
  lineasValidas,
  motivoNoEmitir,
  notaRedondeoFacturaA,
  opcionesCuilComprador,
  textoCondicionArca,
  totalesBorrador,
  validarCuitIngresado,
  ventaPendiente,
  ventasDePestana,
  type EstadoBorradorMl,
  type LineaBorradorMl,
} from '@/lib/mercadolibre/facturacion-form'
import { esCuitValido } from '@/lib/cuit-utils'
import { totalesFacturaADesdeFinal, totalesFacturaB } from '@/lib/facturacion/totales-factura'
import { DOC_TIPO } from '@/lib/arca/wsfe'
import { provincia } from '@/lib/arca/padron'

const CUIL_CF = '20-12345678-6'

describe('pestañas (?tipo=a|b)', () => {
  it('por defecto A; b/B → B', () => {
    expect(claseDesdeTipo(null)).toBe('A')
    expect(claseDesdeTipo('')).toBe('A')
    expect(claseDesdeTipo('a')).toBe('A')
    expect(claseDesdeTipo('x')).toBe('A')
    expect(claseDesdeTipo('b')).toBe('B')
    expect(claseDesdeTipo(' B ')).toBe('B')
  })

  it('link directo a cada pestaña (ida y vuelta)', () => {
    expect(hrefPestanaMl('A')).toBe('/mercadolibre/facturacion?tipo=a')
    expect(hrefPestanaMl('B')).toBe('/mercadolibre/facturacion?tipo=b')
    for (const c of ['A', 'B'] as const) {
      expect(claseDesdeTipo(new URLSearchParams(hrefPestanaMl(c).split('?')[1]).get('tipo'))).toBe(c)
    }
  })

  it('nombres de las pestañas', () => {
    expect(PESTANA_FACTURA_ML.A).toMatch(/Factura A .*Responsables Inscriptos y Monotributistas/)
    expect(PESTANA_FACTURA_ML.B).toMatch(/Factura B .*Consumidores Finales/)
  })
})

describe('listado por pestaña', () => {
  const facturada = { invoiceId: 'I', invoiceNumber: 'B-0007-00000001', status: 'EMITIDA', mlUploadStatus: 'OK', mlUploadError: null, colppySyncStatus: 'OK' }
  const v = (id: string, clase: 'A' | 'B' | null, extra: { facturada?: typeof facturada | null; facturaEnMl?: boolean } = {}) => ({
    id,
    clase,
    facturada: extra.facturada ?? null,
    facturaEnMl: extra.facturaEnMl ?? false,
  })

  it('pendiente = sin factura del ERP ni factura en ML', () => {
    expect(ventaPendiente(v('1', 'A'))).toBe(true)
    expect(ventaPendiente(v('1', 'A', { facturaEnMl: true }))).toBe(false)
    expect(ventaPendiente(v('1', 'A', { facturada }))).toBe(false)
  })

  it('cada pestaña: su letra + las "revisar" (clase null), pendientes primero y orden estable', () => {
    const ventas = [
      v('a-fact', 'A', { facturada }),
      v('b1', 'B'),
      v('a1', 'A'),
      v('revisar', null, { facturada: { ...facturada, invoiceId: null as unknown as string } }),
      v('b-ml', 'B', { facturaEnMl: true }),
      v('b2', 'B'),
      v('a2', 'A'),
    ]
    expect(ventasDePestana(ventas, 'A').map((x) => x.id)).toEqual(['a1', 'a2', 'a-fact', 'revisar'])
    expect(ventasDePestana(ventas, 'B').map((x) => x.id)).toEqual(['b1', 'b2', 'revisar', 'b-ml'])
  })

  it('documento: CUIT/CUIL o el DNI cuando ML solo dio el DNI', () => {
    expect(documentoListado({ cuit: CUIL_CF, documentoMl: { tipo: 'CUIT', numero: CUIL_CF } })).toEqual({ texto: CUIL_CF, esDni: false })
    expect(documentoListado({ cuit: null, documentoMl: { tipo: 'DNI', numero: '12345678' } })).toEqual({ texto: 'DNI 12345678', esDni: true })
    expect(documentoListado({ cuit: null, documentoMl: null })).toBeNull()
  })
})

describe('CUIT/CUIL del borrador', () => {
  it('vacío: sin mensaje; largo o dígito mal: mensaje; bien: con guiones', () => {
    expect(validarCuitIngresado('')).toEqual({ ok: false, mensaje: null })
    expect(validarCuitIngresado('  ')).toEqual({ ok: false, mensaje: null })
    expect(validarCuitIngresado('2012345678')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/11 dígitos \(ingresaste 10\)/) })
    expect(validarCuitIngresado('20-12345678-9')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/dígito verificador/) })
    expect(validarCuitIngresado('20123456786')).toEqual({ ok: true, cuit: CUIL_CF })
    expect(validarCuitIngresado('20.12345678.6')).toEqual({ ok: true, cuit: CUIL_CF })
  })

  it('mismo criterio estricto que el servidor (esCuitValido): el resto 1 con 9 no pasa', () => {
    for (const c of ['20-20000009-9', '30-71111111-1', '27-12345678-0', '23-12345678-5', '33-69345023-9', '33-69345023-8']) {
      expect(validarCuitIngresado(c).ok).toBe(esCuitValido(c))
    }
  })

  it('documento del receptor ante ARCA (= DOC_TIPO de wsfe)', () => {
    expect(documentoReceptorTexto({ docTipo: DOC_TIPO.CUIT, docNro: '30711111111' })).toBe('CUIT 30-71111111-1')
    expect(documentoReceptorTexto({ docTipo: DOC_TIPO.CUIL, docNro: '20123456786' })).toBe(`CUIL ${CUIL_CF}`)
    expect(documentoReceptorTexto({ docTipo: DOC_TIPO.DNI, docNro: '12345678' })).toBe('DNI 12345678')
    expect(documentoReceptorTexto({ docTipo: DOC_TIPO.CONSUMIDOR_FINAL, docNro: '0' })).toBe('Sin identificar')
    expect(documentoReceptorTexto(null)).toBeNull()
  })
})

describe('va por la otra letra', () => {
  it('coincide o todavía no se sabe → sin aviso', () => {
    expect(avisoOtraClase({ clase: 'B', condicionIva: 'CONSUMIDOR_FINAL', padron: 'encontrado' }, 'B')).toBeNull()
    expect(avisoOtraClase({ clase: null, condicionIva: null, padron: null }, 'A')).toBeNull()
  })

  it('RI o Monotributo desde la B → Factura A, con el nombre de la pestaña', () => {
    const a = avisoOtraClase({ clase: 'A', condicionIva: 'MONOTRIBUTO', padron: 'encontrado' }, 'B')!
    expect(a).toMatch(/Responsable Monotributo: corresponde Factura A/)
    expect(a).toContain(PESTANA_FACTURA_ML.A)
  })

  it('consumidor final o exento desde la A → Factura B', () => {
    expect(avisoOtraClase({ clase: 'B', condicionIva: 'CONSUMIDOR_FINAL', padron: 'no-existe' }, 'A')).toMatch(
      /No está inscripto en ARCA .*Factura B/
    )
    const ex = avisoOtraClase({ clase: 'B', condicionIva: 'EXENTO', padron: 'encontrado' }, 'A')!
    expect(ex).toMatch(/no es Responsable Inscripto ni Monotributista \(IVA Exento\)/)
    expect(ex).toContain(PESTANA_FACTURA_ML.B)
  })
})

describe('líneas y totales', () => {
  const items = [
    { title: 'Válvula 1"', quantity: 2, unitPrice: 12100, productId: 'P1', sku: 'V1', productName: 'VALVULA ESFERICA 1"' },
    { title: 'Sin vincular', quantity: 1, unitPrice: 605, productId: null, sku: null, productName: null },
  ]

  it('desde la venta: descripción del ERP si está vinculada, si no el título de ML', () => {
    expect(lineasDesdeVenta(items)).toEqual([
      { productId: 'P1', sku: 'V1', descripcion: 'VALVULA ESFERICA 1"', cantidad: '2', precioFinal: '12100' },
      { productId: null, sku: null, descripcion: 'Sin vincular', cantidad: '1', precioFinal: '605' },
    ])
  })

  it('totales con precio final: neto + IVA (A) = IVA contenido (B)', () => {
    expect(totalesBorrador(lineasDesdeVenta(items))).toEqual({ total: 24805, neto: 20500, iva: 4305 })
    expect(totalesBorrador([{ cantidad: '1,5', precioFinal: '100,10' }])).toEqual({ total: 150.15, neto: 124.09, iva: 26.06 })
    expect(totalesBorrador([{ cantidad: 'x', precioFinal: '100' }])).toEqual({ total: 0, neto: 0, iva: 0 })
  })

  it('la B cobra exactamente el precio final: $100 → 82,64 + 17,36 = 100,00 (antes 99,99)', () => {
    const t = totalesBorrador([{ cantidad: '1', precioFinal: '100' }])
    expect(t).toEqual({ total: 100, neto: 82.64, iva: 17.36 })
    expect(Math.round((t.neto + t.iva) * 100) / 100).toBe(t.total)
  })

  it('mismos totales que el servidor (totalesFacturaB, el que va a Colppy/ARCA/ERP)', () => {
    const casos: Array<Array<{ cantidad: string; precioFinal: string }>> = [
      [{ cantidad: '1', precioFinal: '100' }],
      [{ cantidad: '3', precioFinal: '33,33' }, { cantidad: '2', precioFinal: '0,99' }],
      [{ cantidad: '1,5', precioFinal: '100,10' }],
      [{ cantidad: '7', precioFinal: '1234,57' }, { cantidad: '1', precioFinal: '0,01' }],
    ]
    for (const lineas of casos) {
      const servidor = totalesFacturaB(lineas.map((l) => ({ cantidad: Number(l.cantidad.replace(',', '.')), precioFinal: Number(l.precioFinal.replace(',', '.')) })))
      expect(totalesBorrador(lineas)).toEqual(servidor)
      expect(Math.round((servidor.neto + servidor.iva) * 100) / 100).toBe(servidor.total)
    }
  })

  it('líneas válidas: al menos una, con descripción, cantidad y precio > 0', () => {
    const ok = lineasDesdeVenta(items)
    expect(lineasValidas(ok)).toBe(true)
    expect(lineasValidas([])).toBe(false)
    expect(lineasValidas([{ ...ok[0], descripcion: '  ' }])).toBe(false)
    expect(lineasValidas([{ ...ok[0], cantidad: '0' }])).toBe(false)
    expect(lineasValidas([{ ...ok[0], precioFinal: '' }])).toBe(false)
  })
})

describe('botón Emitir', () => {
  const lineas: LineaBorradorMl[] = [{ productId: null, sku: null, descripcion: 'Válvula', cantidad: '1', precioFinal: '1210' }]
  const base: EstadoBorradorMl = {
    clase: 'B',
    comprador: { cuit: CUIL_CF, clase: 'B', motivo: null, padron: 'no-existe' },
    cuitIngresado: CUIL_CF,
    nombre: 'JUAN PEREZ',
    lineas,
    facturaEnMl: false,
    confirmaFacturaEnMl: false,
  }

  it('todo en orden → se puede', () => {
    expect(motivoNoEmitir(base)).toBeNull()
    expect(motivoNoEmitir({ ...base, cuitIngresado: '20123456786' })).toBeNull() // mismo número sin guiones
  })

  it('cada motivo, en orden', () => {
    expect(motivoNoEmitir({ ...base, comprador: null })).toMatch(/Faltan los datos/)
    expect(motivoNoEmitir({ ...base, cuitIngresado: '' })).toMatch(/Falta el CUIT\/CUIL/)
    expect(motivoNoEmitir({ ...base, cuitIngresado: '20-12345678-9' })).toMatch(/dígito verificador/)
    // tipeó otro número válido y no lo verificó en ARCA
    expect(motivoNoEmitir({ ...base, cuitIngresado: '27-12345678-0' })).toMatch(/Verificá el CUIT\/CUIL en ARCA/)
    // ARCA no permitió decidir (p. ej. CUIT inactivo, padrón caído)
    expect(motivoNoEmitir({ ...base, comprador: { ...base.comprador!, clase: null, motivo: 'El CUIT figura inactivo' } })).toBe('El CUIT figura inactivo')
    expect(motivoNoEmitir({ ...base, clase: 'A' })).toBe('Según ARCA va por Factura B')
    expect(motivoNoEmitir({ ...base, nombre: '  ' })).toMatch(/Falta el nombre/)
    expect(motivoNoEmitir({ ...base, lineas: [] })).toMatch(/Revisá las líneas/)
    expect(motivoNoEmitir({ ...base, facturaEnMl: true })).toMatch(/Emitir igual/)
    expect(motivoNoEmitir({ ...base, facturaEnMl: true, confirmaFacturaEnMl: true })).toBeNull()
  })

  it('ML no pudo confirmar si tiene factura (null): también pide la confirmación', () => {
    expect(motivoNoEmitir({ ...base, facturaEnMl: null })).toMatch(/No se pudo verificar en ML si la venta ya tiene factura/)
    expect(motivoNoEmitir({ ...base, facturaEnMl: null, confirmaFacturaEnMl: true })).toBeNull()
  })

  it('el nombre solo hace falta en la B cuando ARCA no tiene al comprador', () => {
    expect(motivoNoEmitir({ ...base, nombre: '', comprador: { ...base.comprador!, padron: 'encontrado' } })).toBeNull()
    const ri = { cuit: '30-71111111-1', clase: 'A' as const, motivo: null, padron: 'encontrado' as const }
    expect(motivoNoEmitir({ ...base, clase: 'A', comprador: ri, cuitIngresado: '30-71111111-1', nombre: '' })).toBeNull()
  })
})

describe('cuerpo del POST', () => {
  const lineas: LineaBorradorMl[] = [{ productId: 'P1', sku: 'V1', descripcion: '  Válvula  ', cantidad: '2', precioFinal: '1210,50' }]
  const domicilio = { direccion: ' Av. Siempreviva  742 ', localidad: 'Rosario', provincia: 'Santa Fe', codigoPostal: '' }
  const args = {
    packId: '2000009000000001',
    clase: 'B' as const,
    cuit: CUIL_CF,
    lineas,
    facturaEnMl: false,
    confirmaFacturaEnMl: false,
    padron: 'no-existe' as const,
    nombre: ' Juan  Perez ',
    domicilio,
  }

  it('B sin datos en ARCA: manda nombre y domicilio limpios; líneas numéricas', () => {
    expect(cuerpoFacturaMl(args)).toEqual({
      packId: '2000009000000001',
      clase: 'B',
      cuit: CUIL_CF,
      lineas: [{ productId: 'P1', descripcion: 'Válvula', cantidad: 2, precioFinal: 1210.5 }],
      nombre: 'Juan Perez',
      domicilio: { direccion: 'Av. Siempreviva 742', localidad: 'Rosario', provincia: 'Santa Fe', codigoPostal: null },
    })
  })

  it('ARCA tiene al comprador, o es Factura A: sin nombre ni domicilio (el alta usa ARCA)', () => {
    const b = cuerpoFacturaMl({ ...args, padron: 'encontrado' })
    expect(b).not.toHaveProperty('nombre')
    expect(b).not.toHaveProperty('domicilio')
    const a = cuerpoFacturaMl({ ...args, clase: 'A', padron: 'no-existe' })
    expect(a).not.toHaveProperty('nombre')
    expect(a.clase).toBe('A')
  })

  it('confirmarFacturaEnMl: solo si ML ya tiene factura (o no lo pudo confirmar) Y el usuario tildó la confirmación', () => {
    expect(cuerpoFacturaMl(args)).not.toHaveProperty('confirmarFacturaEnMl')
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: true })).not.toHaveProperty('confirmarFacturaEnMl')
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: null })).not.toHaveProperty('confirmarFacturaEnMl')
    expect(cuerpoFacturaMl({ ...args, confirmaFacturaEnMl: true })).not.toHaveProperty('confirmarFacturaEnMl')
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: true, confirmaFacturaEnMl: true }).confirmarFacturaEnMl).toBe(true)
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: null, confirmaFacturaEnMl: true }).confirmarFacturaEnMl).toBe(true)
  })
})

describe('provincias del alta', () => {
  it('son las del ERP: el servidor las reconoce tal cual (provincia() del padrón)', () => {
    for (const p of PROVINCIAS_ERP) expect(provincia(p)).toBe(p)
    expect(PROVINCIAS_ERP).toHaveLength(24)
  })
})

describe('factura adjunta en ML (listado y borrador)', () => {
  it('tiene factura / ML no lo confirmó / no tiene', () => {
    expect(avisoFacturaEnMl(true)).toMatchObject({ badge: 'Ya tiene factura en ML (p. ej. de Colppy)', casilla: expect.stringMatching(/Emitir igual$/) })
    const desconocido = avisoFacturaEnMl(null)!
    expect(desconocido.badge).toBe('ML no confirmó si tiene factura')
    expect(desconocido.texto).toBe('No se pudo verificar en Mercado Libre si la venta ya tiene factura; confirmalo en el borrador.')
    expect(desconocido.casilla).toBeTruthy()
    expect(avisoFacturaEnMl(false)).toBeNull()
    expect(avisoFacturaEnMl(undefined)).toBeNull()
  })

  it('"ML no confirmó" sigue contando como pendiente', () => {
    expect(ventaPendiente({ facturada: null, facturaEnMl: null })).toBe(true)
  })
})

describe('condición según ARCA (texto del borrador)', () => {
  it('sin condición IVA en ARCA: consumidor final; no existe: sin inscripción; A: nada', () => {
    expect(textoCondicionArca({ clase: 'B', padron: 'encontrado', condicionIva: 'CONSUMIDOR_FINAL' })).toBe('ARCA no informa inscripción en IVA: consumidor final.')
    expect(textoCondicionArca({ clase: 'B', padron: 'no-existe', condicionIva: 'CONSUMIDOR_FINAL' })).toBe('Sin inscripción impositiva en ARCA: va como Consumidor Final.')
    expect(textoCondicionArca({ clase: 'B', padron: 'encontrado', condicionIva: 'EXENTO' })).toBeNull()
    expect(textoCondicionArca({ clase: 'A', padron: 'encontrado', condicionIva: 'RESPONSABLE_INSCRIPTO' })).toBeNull()
    expect(textoCondicionArca({ clase: null, padron: null, condicionIva: null })).toBeNull()
  })
})

describe('CUIT/CUIL del campo tras una consulta (carrera del borrador)', () => {
  it('sin ediciones en el medio: toma el de la consulta (ML / derivado del DNI)', () => {
    expect(cuitTrasConsulta({ campo: '', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: false })).toBe(CUIL_CF)
  })

  it('el usuario tipeó mientras tanto: queda lo tipeado y no se da por verificado', () => {
    const campo = cuitTrasConsulta({ campo: '27-12345678-0', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: true })
    expect(campo).toBe('27-12345678-0')
    // El botón sigue bloqueado: el número verificado (el de la consulta) no es el del campo
    expect(
      motivoNoEmitir({
        clase: 'B',
        comprador: { cuit: CUIL_CF, clase: 'B', motivo: null, padron: 'encontrado' },
        cuitIngresado: campo,
        nombre: 'X',
        lineas: [{ productId: null, sku: null, descripcion: 'V', cantidad: '1', precioFinal: '100' }],
        facturaEnMl: false,
        confirmaFacturaEnMl: false,
      })
    ).toBe('Verificá el CUIT/CUIL en ARCA')
  })

  it('la consulta no trajo número: queda el campo', () => {
    expect(cuitTrasConsulta({ campo: '20', deLaConsulta: null, editadoDuranteLaConsulta: false })).toBe('20')
  })

  it('Reintentar (soloSiVacio): lo tipeado, válido o no, no se pisa; un campo vacío sí se completa', () => {
    // CUIT a medio tipear (inválido) que el Reintentar mandó como null
    expect(cuitTrasConsulta({ campo: '20-1234', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: false, soloSiVacio: true })).toBe('20-1234')
    // Válido pero distinto del de ML
    expect(cuitTrasConsulta({ campo: '27-12345678-0', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: false, soloSiVacio: true })).toBe('27-12345678-0')
    // Vacío (o solo espacios): se completa con el de ML / el CUIL del DNI
    expect(cuitTrasConsulta({ campo: '', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: false, soloSiVacio: true })).toBe(CUIL_CF)
    expect(cuitTrasConsulta({ campo: '  ', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: false, soloSiVacio: true })).toBe(CUIL_CF)
    // Sin soloSiVacio (al abrir el borrador) sigue como antes
    expect(cuitTrasConsulta({ campo: '20-1234', deLaConsulta: CUIL_CF, editadoDuranteLaConsulta: false })).toBe(CUIL_CF)
  })
})

describe('CDI (DocTipo 87)', () => {
  it('etiqueta CDI con guiones como el CUIT', () => {
    expect(DOC_TIPO.CDI).toBe(87)
    expect(documentoReceptorTexto({ docTipo: DOC_TIPO.CDI, docNro: '20123456786' })).toBe('CDI 20-12345678-6')
  })
})

describe('"factura en ML" en el borrador: gana la respuesta más nueva y la casilla vale para lo que se vio', () => {
  it('estado inicial: el del listado (sin dato = no tiene), sin confirmar', () => {
    expect(estadoFacturaEnMlInicial(undefined)).toEqual({ valor: false, turno: 0, confirmado: false })
    expect(estadoFacturaEnMlInicial(null)).toEqual({ valor: null, turno: 0, confirmado: false })
  })

  it('si el estado cambia, la casilla se destilda; si no cambia, queda', () => {
    const tildado = { valor: null, turno: 1, confirmado: true }
    expect(aplicarRespuestaFacturaEnMl(tildado, { valor: true, turno: 2 })).toEqual({ valor: true, turno: 2, confirmado: false })
    expect(aplicarRespuestaFacturaEnMl(tildado, { valor: null, turno: 2 })).toEqual({ valor: null, turno: 2, confirmado: true })
  })

  it('un 409 FACTURA_EN_ML siempre destilda', () => {
    expect(aplicarRespuestaFacturaEnMl({ valor: true, turno: 1, confirmado: true }, { valor: true, turno: 2, destildar: true })).toMatchObject({ confirmado: false })
  })

  it('una respuesta de un pedido más viejo que la ya aplicada se descarta (409 nuevo vs /comprador viejo)', () => {
    // Orden de pedidos: /comprador (turno 1), POST (turno 2). El 409 llega primero.
    const tras409 = aplicarRespuestaFacturaEnMl(estadoFacturaEnMlInicial(null), { valor: true, turno: 2, destildar: true })
    // La respuesta vieja de /comprador ("no se pudo verificar") no pisa el "tiene factura"
    expect(aplicarRespuestaFacturaEnMl(tras409, { valor: null, turno: 1 })).toBe(tras409)
    // Un /comprador nuevo (turno 3) sí
    expect(aplicarRespuestaFacturaEnMl(tras409, { valor: false, turno: 3 })).toEqual({ valor: false, turno: 3, confirmado: false })
  })

  it('el POST manda el estado confirmado (true | null) solo con la confirmación', () => {
    const args = {
      packId: '1',
      clase: 'B' as const,
      cuit: CUIL_CF,
      lineas: [{ productId: null, sku: null, descripcion: 'V', cantidad: '1', precioFinal: '100' }],
      padron: 'encontrado' as const,
      nombre: '',
      domicilio: { direccion: null, localidad: null, provincia: null, codigoPostal: null },
    }
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: null, confirmaFacturaEnMl: true })).toMatchObject({ confirmarFacturaEnMl: true, estadoFacturaEnMlConfirmado: null })
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: true, confirmaFacturaEnMl: true })).toMatchObject({ confirmarFacturaEnMl: true, estadoFacturaEnMlConfirmado: true })
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: true, confirmaFacturaEnMl: false })).not.toHaveProperty('estadoFacturaEnMlConfirmado')
    expect(cuerpoFacturaMl({ ...args, facturaEnMl: false, confirmaFacturaEnMl: true })).not.toHaveProperty('estadoFacturaEnMlConfirmado')
  })

  it('venta con el candado del ERP (yaFacturada): no se puede emitir aunque se tilde "Emitir igual"', () => {
    const comprador = { cuit: CUIL_CF, clase: 'B' as const, motivo: 'Esta venta ya fue facturada desde el ERP (B-0007-00000009).', padron: 'encontrado' as const, yaFacturada: { invoiceId: 'I', invoiceNumber: 'B-0007-00000009', status: 'EMITIDA' } }
    const e: EstadoBorradorMl = {
      clase: 'B',
      comprador,
      cuitIngresado: CUIL_CF,
      nombre: 'X',
      lineas: [{ productId: null, sku: null, descripcion: 'V', cantidad: '1', precioFinal: '100' }],
      facturaEnMl: true,
      confirmaFacturaEnMl: true,
    }
    expect(motivoNoEmitir(e)).toBe('Esta venta ya fue facturada desde el ERP (B-0007-00000009).')
  })
})

describe('CUIL para elegir (DNI con más de un CUIL en ARCA)', () => {
  const cand = (cuit: string, resultado: 'encontrado' | 'no-existe', nombreArca?: string) => ({ cuit, resultado, ...(nombreArca ? { nombreArca } : {}) })
  it('solo con origen manual-requerido y más de uno encontrado', () => {
    const candidatos = [cand('20-12345678-6', 'encontrado', 'GOMEZ CARLOS'), cand('27-12345678-0', 'encontrado', 'PEREZ ANA'), cand('23-12345678-5', 'no-existe')]
    expect(opcionesCuilComprador({ origen: 'manual-requerido', candidatos })).toEqual([
      { cuit: '20-12345678-6', nombre: 'GOMEZ CARLOS' },
      { cuit: '27-12345678-0', nombre: 'PEREZ ANA' },
    ])
    expect(opcionesCuilComprador({ origen: 'padron', candidatos })).toEqual([])
    expect(opcionesCuilComprador({ origen: 'manual-requerido', candidatos: candidatos.slice(1) })).toEqual([])
    expect(opcionesCuilComprador(null)).toEqual([])
  })
})

describe('totales de la Factura A en el borrador = lo que se emite', () => {
  it('$100 en la A: 82,64 + 17,35 = 99,99 (neto primero, como sendQuoteToColppy); en la B 100,00', () => {
    expect(totalesBorrador([{ cantidad: '1', precioFinal: '100' }], 'A')).toEqual({ total: 99.99, neto: 82.64, iva: 17.35 })
    expect(totalesBorrador([{ cantidad: '1', precioFinal: '100' }], 'B')).toEqual({ total: 100, neto: 82.64, iva: 17.36 })
    expect(totalesBorrador([{ cantidad: '1', precioFinal: '100' }])).toEqual({ total: 100, neto: 82.64, iva: 17.36 })
  })

  it('A: mismos números que totalesFacturaADesdeFinal con el precio a 2 decimales (como armarLineas del servidor)', () => {
    const lineas = [{ cantidad: '3', precioFinal: '33,333' }, { cantidad: '2', precioFinal: '1210' }]
    expect(totalesBorrador(lineas, 'A')).toEqual(totalesFacturaADesdeFinal([{ cantidad: 3, precioFinal: 33.33 }, { cantidad: 2, precioFinal: 1210 }]))
  })

  it('nota cuando la A redondea unos centavos debajo de lo que cobró ML', () => {
    expect(notaRedondeoFacturaA('A', 99.99, 100)).toBe(`ML cobró ${(100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}: la Factura A discrimina IVA y redondea a ${(99.99).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}`)
    expect(notaRedondeoFacturaA('A', 99.99, 100)).toMatch(/^ML cobró \$\s?100,00: la Factura A discrimina IVA y redondea a \$\s?99,99$/)
    expect(notaRedondeoFacturaA('A', 2420, 2420)).toBeNull() // coincide
    expect(notaRedondeoFacturaA('B', 99.99, 100)).toBeNull() // la B cobra exacto
    expect(notaRedondeoFacturaA('A', 90, 100)).toBeNull() // diferencia grande: ya lo avisa "no coincide con lo cobrado"
    expect(notaRedondeoFacturaA('A', 99.99, null)).toBeNull()
  })
})
