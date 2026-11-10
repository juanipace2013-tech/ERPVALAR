import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { cronSecretFromRequest, isCronSecretValid } from '@/lib/cron-auth'

describe('cron-auth', () => {
  const original = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = 'secreto-de-prueba'
  })
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })

  it('lee el secreto del encabezado Authorization: Bearer', () => {
    const req = new NextRequest('http://localhost/api/cron/x', {
      headers: { authorization: 'Bearer abc' },
    })
    expect(cronSecretFromRequest(req)).toBe('abc')
  })

  it('sigue aceptando ?secret= y el encabezado tiene prioridad', () => {
    expect(cronSecretFromRequest(new NextRequest('http://localhost/api/cron/x?secret=q'))).toBe('q')
    const ambos = new NextRequest('http://localhost/api/cron/x?secret=q', {
      headers: { authorization: 'Bearer h' },
    })
    expect(cronSecretFromRequest(ambos)).toBe('h')
  })

  it('sin secreto devuelve null (los endpoints muestran el estado)', () => {
    expect(cronSecretFromRequest(new NextRequest('http://localhost/api/cron/x'))).toBeNull()
  })

  it('valida solo el secreto exacto', () => {
    expect(isCronSecretValid('secreto-de-prueba')).toBe(true)
    expect(isCronSecretValid('secreto-de-prueb')).toBe(false)
    expect(isCronSecretValid('otro')).toBe(false)
    expect(isCronSecretValid('')).toBe(false)
    expect(isCronSecretValid(null)).toBe(false)
  })

  it('sin CRON_SECRET configurado nunca es válido', () => {
    delete process.env.CRON_SECRET
    expect(isCronSecretValid('cualquiera')).toBe(false)
    expect(isCronSecretValid(undefined)).toBe(false)
  })
})
