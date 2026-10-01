import { describe, it, expect } from 'vitest'
import {
  claveClienteExterior,
  esClienteExterior,
  etiquetaIdFiscal,
  idFiscalParaMostrar,
  parametroBusquedaCliente,
} from '@/lib/cliente-exterior'
import { customerSchema, normalizarClienteBody } from '@/lib/validations'

const base = { name: 'Cliente', type: 'BUSINESS' as const, priceMultiplier: 1 }

describe('clientes del exterior: helpers', () => {
  it('clave única por país + ID sin separadores (conserva la K del RUT)', () => {
    expect(claveClienteExterior('Chile', '76.123.456-7')).toBe('CL-761234567')
    expect(claveClienteExterior('Chile', '7.654.321-k')).toBe('CL-7654321K')
    expect(claveClienteExterior('Paraguay', '80012345-6')).toBe('PY-800123456')
    expect(claveClienteExterior('Paraguay', '', 'ab12cd34')).toBe('PY-SN-AB12CD34')
  })

  it('detecta exterior por condición o país', () => {
    expect(esClienteExterior({ taxCondition: 'CLIENTE_EXTERIOR', country: 'Chile' })).toBe(true)
    expect(esClienteExterior({ taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Argentina' })).toBe(false)
    expect(esClienteExterior({ taxCondition: 'RESPONSABLE_INSCRIPTO', country: null })).toBe(false)
  })

  it('nombre del ID fiscal según el país', () => {
    expect(etiquetaIdFiscal('Chile')).toBe('RUT')
    expect(etiquetaIdFiscal('Paraguay')).toBe('RUC')
    expect(etiquetaIdFiscal('Argentina')).toBe('CUIT')
    expect(etiquetaIdFiscal('Narnia')).toBe('ID fiscal')
  })

  it('muestra el ID como se cargó, o "Sin ID fiscal"', () => {
    expect(idFiscalParaMostrar({ cuit: 'CL-761234567', taxIdExterior: '76.123.456-7', taxCondition: 'CLIENTE_EXTERIOR', country: 'Chile' })).toBe('76.123.456-7')
    expect(idFiscalParaMostrar({ cuit: 'PY-SN-AB12CD34', taxIdExterior: null, taxCondition: 'CLIENTE_EXTERIOR', country: 'Paraguay' })).toBe('Sin ID fiscal')
    expect(idFiscalParaMostrar({ cuit: '30-71537357-9', taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Argentina' })).toBe('30-71537357-9')
  })

  it('búsqueda: clave exacta para el exterior, dígitos para CUIT', () => {
    expect(parametroBusquedaCliente('CL-761234567')).toBe('CL-761234567')
    expect(parametroBusquedaCliente('30-71537357-9')).toBe('30715373579')
    expect(parametroBusquedaCliente('123')).toBeNull()
  })
})

describe('validación de alta', () => {
  it('Argentina: CUIT obligatorio y válido', () => {
    expect(customerSchema.safeParse({ ...base, cuit: '', taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Argentina' }).success).toBe(false)
    expect(customerSchema.safeParse({ ...base, cuit: '30-71537357-9', taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Argentina' }).success).toBe(true)
  })

  it('Exterior: ID opcional, país no Argentina, condición Cliente del Exterior', () => {
    expect(customerSchema.safeParse({ ...base, cuit: '76.123.456-7', taxCondition: 'CLIENTE_EXTERIOR', country: 'Chile' }).success).toBe(true)
    expect(customerSchema.safeParse({ ...base, cuit: '', taxCondition: 'CLIENTE_EXTERIOR', country: 'Paraguay' }).success).toBe(true)
    // condición argentina con país extranjero → rechazado
    expect(customerSchema.safeParse({ ...base, cuit: '76.123.456-7', taxCondition: 'RESPONSABLE_INSCRIPTO', country: 'Chile' }).success).toBe(false)
    // exterior con país Argentina → rechazado
    expect(customerSchema.safeParse({ ...base, cuit: '', taxCondition: 'CLIENTE_EXTERIOR', country: 'Argentina' }).success).toBe(false)
  })
})

describe('normalizarClienteBody', () => {
  const base = { name: 'Cliente Chile', type: 'BUSINESS' }
  it('país distinto de Argentina: condición Cliente del Exterior aunque venga vacía (autocompletado del navegador)', () => {
    const r = customerSchema.safeParse(normalizarClienteBody({ ...base, cuit: '76.123.456-7', taxCondition: '', country: 'Chile' }))
    expect(r.success).toBe(true)
    expect(r.success && r.data.taxCondition).toBe('CLIENTE_EXTERIOR')
  })
  it('Argentina sin condición: error claro', () => {
    const r = customerSchema.safeParse(normalizarClienteBody({ ...base, cuit: '30-71652080-9', taxCondition: '', country: 'Argentina' }))
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues[0].message).toBe('Elegí la condición fiscal del cliente')
  })
  it('no toca bodies sin país o que no son objetos', () => {
    expect(normalizarClienteBody({ taxCondition: 'MONOTRIBUTO' })).toEqual({ taxCondition: 'MONOTRIBUTO' })
    expect(normalizarClienteBody(null)).toBeNull()
  })
})
