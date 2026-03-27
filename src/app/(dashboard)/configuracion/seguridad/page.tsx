'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
  Shield,
  ShieldCheck,
  ShieldX,
  Smartphone,
  QrCode,
  KeyRound,
  ArrowLeft,
  Loader2,
  Copy,
  Eye,
  EyeOff,
} from 'lucide-react'
import Link from 'next/link'

type MfaStep = 'idle' | 'qr' | 'verify' | 'disable'

export default function SeguridadPage() {
  const { data: session, update: updateSession } = useSession()
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<MfaStep>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    loadMfaStatus()
  }, [])

  const loadMfaStatus = async () => {
    try {
      const res = await fetch('/api/auth/mfa/status')
      if (res.ok) {
        const data = await res.json()
        setMfaEnabled(data.mfaEnabled)
      }
    } catch (error) {
      console.error('Error loading MFA status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSetup = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/mfa/setup', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error)
        return
      }

      setQrCode(data.qrCode)
      setSecret(data.secret)
      setStep('qr')
    } catch (error) {
      toast.error('Error al generar QR code')
    } finally {
      setSubmitting(false)
    }
  }

  const handleVerify = async () => {
    if (code.length !== 6) {
      toast.error('El código debe ser de 6 dígitos')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error)
        return
      }

      toast.success('2FA activado correctamente')
      setMfaEnabled(true)
      setStep('idle')
      setCode('')
      setQrCode('')
      setSecret('')

      // Actualizar sesión para reflejar mfaEnabled
      await updateSession()
    } catch (error) {
      toast.error('Error al verificar código')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDisable = async () => {
    if (!password) {
      toast.error('Ingresá tu contraseña para confirmar')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error)
        return
      }

      toast.success('2FA desactivado')
      setMfaEnabled(false)
      setStep('idle')
      setPassword('')

      // Actualizar sesión
      await updateSession()
    } catch (error) {
      toast.error('Error al desactivar 2FA')
    } finally {
      setSubmitting(false)
    }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(secret)
    toast.success('Clave copiada al portapapeles')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/configuracion">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Seguridad</h1>
          <p className="text-gray-600 mt-1">
            Configurá la autenticación de dos factores para tu cuenta
          </p>
        </div>
      </div>

      {/* Estado actual */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-full ${mfaEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                {mfaEnabled ? (
                  <ShieldCheck className="h-6 w-6 text-green-600" />
                ) : (
                  <ShieldX className="h-6 w-6 text-gray-400" />
                )}
              </div>
              <div>
                <CardTitle className="text-xl">Autenticación de dos factores (2FA)</CardTitle>
                <CardDescription>
                  Agregá una capa extra de seguridad a tu cuenta usando Google Authenticator
                </CardDescription>
              </div>
            </div>
            <Badge variant={mfaEnabled ? 'default' : 'secondary'} className={mfaEnabled ? 'bg-green-600' : ''}>
              {mfaEnabled ? 'Activado' : 'Desactivado'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {step === 'idle' && (
            <div>
              {!mfaEnabled ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
                    <Smartphone className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                    <div className="text-sm text-blue-800">
                      <p className="font-medium mb-1">¿Cómo funciona?</p>
                      <ol className="list-decimal list-inside space-y-1 text-blue-700">
                        <li>Descargá Google Authenticator en tu celular</li>
                        <li>Escaneá el código QR que te vamos a mostrar</li>
                        <li>Ingresá el código de 6 dígitos para confirmar</li>
                        <li>Cada vez que inicies sesión, te vamos a pedir el código</li>
                      </ol>
                    </div>
                  </div>
                  <Button
                    onClick={handleSetup}
                    disabled={submitting}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Shield className="h-4 w-4 mr-2" />
                    )}
                    Activar 2FA
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                    <ShieldCheck className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-green-800">
                      Tu cuenta está protegida con autenticación de dos factores.
                      Cada vez que inicies sesión se te pedirá un código de Google Authenticator.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setStep('disable')}
                  >
                    <ShieldX className="h-4 w-4 mr-2" />
                    Desactivar 2FA
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Paso: Mostrar QR */}
          {step === 'qr' && (
            <div className="space-y-6">
              <div className="text-center space-y-4">
                <div className="flex items-center justify-center gap-2 text-blue-700">
                  <QrCode className="h-5 w-5" />
                  <p className="font-medium">Escaneá este código QR con Google Authenticator</p>
                </div>
                {qrCode && (
                  <div className="inline-block p-4 bg-white rounded-xl border-2 border-blue-200 shadow-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrCode} alt="QR Code para 2FA" className="w-64 h-64" />
                  </div>
                )}
              </div>

              {/* Clave manual */}
              <div className="space-y-2">
                <Label className="text-sm text-gray-600">
                  <KeyRound className="h-4 w-4 inline mr-1" />
                  ¿No podés escanear? Ingresá esta clave manualmente:
                </Label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      value={showSecret ? secret : '••••••••••••••••••••'}
                      readOnly
                      className="font-mono text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button variant="outline" size="icon" onClick={copySecret}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Verificación */}
              <div className="space-y-3 pt-4 border-t">
                <Label htmlFor="mfa-code">
                  Ingresá el código de 6 dígitos de tu app:
                </Label>
                <div className="flex gap-3">
                  <Input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="font-mono text-center text-2xl tracking-[0.5em] max-w-[200px]"
                    autoFocus
                  />
                  <Button
                    onClick={handleVerify}
                    disabled={submitting || code.length !== 6}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 mr-2" />
                    )}
                    Confirmar
                  </Button>
                </div>
              </div>

              <Button
                variant="ghost"
                onClick={() => {
                  setStep('idle')
                  setQrCode('')
                  setSecret('')
                  setCode('')
                }}
              >
                Cancelar
              </Button>
            </div>
          )}

          {/* Paso: Desactivar */}
          {step === 'disable' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-lg border border-amber-200">
                <ShieldX className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-800">
                  Estás por desactivar la autenticación de dos factores.
                  Tu cuenta quedará menos protegida. Ingresá tu contraseña para confirmar.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="disable-password">Contraseña</Label>
                <Input
                  id="disable-password"
                  type="password"
                  placeholder="Ingresá tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  onClick={handleDisable}
                  disabled={submitting || !password}
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldX className="h-4 w-4 mr-2" />
                  )}
                  Confirmar desactivación
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep('idle')
                    setPassword('')
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info adicional */}
      <Card className="border-gray-200">
        <CardHeader>
          <CardTitle className="text-base text-gray-700">Información de seguridad</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 space-y-2">
          <p><strong>Usuario:</strong> {session?.user?.email}</p>
          <p><strong>Rol:</strong> {session?.user?.role}</p>
          <p>
            <strong>2FA:</strong>{' '}
            <span className={mfaEnabled ? 'text-green-600 font-medium' : 'text-gray-400'}>
              {mfaEnabled ? 'Activado' : 'Desactivado'}
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
