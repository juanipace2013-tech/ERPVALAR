'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema, type LoginInput } from '@/lib/validations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { signIn } from '@/lib/auth-actions'
import { ShieldCheck, ArrowLeft, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginInput) => {
    setIsLoading(true)

    try {
      const result = await signIn(data.email, data.password)

      if (result?.mfaRequired) {
        setMfaRequired(true)
        setCredentials({ email: data.email, password: data.password })
        if (result?.error) {
          toast.error(result.error)
        }
      } else if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success('Inicio de sesión exitoso')
        router.push('/')
        router.refresh()
      }
    } catch (error) {
      toast.error('Ocurrió un error al iniciar sesión')
    } finally {
      setIsLoading(false)
    }
  }

  const handleMfaSubmit = async () => {
    if (!credentials || mfaCode.length !== 6) return

    setIsLoading(true)
    try {
      const result = await signIn(credentials.email, credentials.password, mfaCode)

      if (result?.mfaRequired && result?.error) {
        toast.error(result.error)
        setMfaCode('')
      } else if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success('Inicio de sesión exitoso')
        router.push('/')
        router.refresh()
      }
    } catch (error) {
      toast.error('Ocurrió un error al verificar el código')
    } finally {
      setIsLoading(false)
    }
  }

  const handleBackToLogin = () => {
    setMfaRequired(false)
    setMfaCode('')
    setCredentials(null)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-100 px-4">
      <div className="w-full max-w-md">
        {/* Logo y título */}
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-valarg.png"
            alt="VAL ARG"
            className="h-16 mx-auto mb-4 object-contain"
          />
          <h1 className="text-3xl font-bold text-gray-900 mb-2">ERP VAL ARG</h1>
          <p className="text-gray-600">Sistema de Gestión Empresarial</p>
        </div>

        <Card className="shadow-xl border-blue-100">
          <CardHeader className="space-y-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
            <CardTitle className="text-2xl font-bold text-center">
              {mfaRequired ? 'Verificación 2FA' : 'Iniciar Sesión'}
            </CardTitle>
            <CardDescription className="text-center text-blue-100">
              {mfaRequired
                ? 'Ingresá el código de Google Authenticator'
                : 'Ingresa tus credenciales para acceder al sistema'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {!mfaRequired ? (
              /* Formulario de login normal */
              <>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-gray-700">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="usuario@ejemplo.com"
                      {...register('email')}
                      disabled={isLoading}
                      className="border-blue-200 focus:border-blue-500 focus:ring-blue-500"
                    />
                    {errors.email && (
                      <p className="text-sm text-red-500">{errors.email.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-gray-700">Contraseña</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      {...register('password')}
                      disabled={isLoading}
                      className="border-blue-200 focus:border-blue-500 focus:ring-blue-500"
                    />
                    {errors.password && (
                      <p className="text-sm text-red-500">{errors.password.message}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Iniciando sesión...
                      </>
                    ) : (
                      'Iniciar sesión'
                    )}
                  </Button>
                </form>
              </>
            ) : (
              /* Formulario de verificación 2FA */
              <div className="space-y-6">
                <div className="flex justify-center">
                  <div className="p-4 bg-blue-50 rounded-full">
                    <ShieldCheck className="h-12 w-12 text-blue-600" />
                  </div>
                </div>

                <p className="text-center text-sm text-gray-600">
                  Tu cuenta tiene autenticación de dos factores activada.
                  Abrí Google Authenticator e ingresá el código de 6 dígitos.
                </p>

                <div className="space-y-2">
                  <Label htmlFor="mfa-code" className="text-gray-700">Código de verificación</Label>
                  <Input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    disabled={isLoading}
                    className="font-mono text-center text-3xl tracking-[0.5em] border-blue-200 focus:border-blue-500"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && mfaCode.length === 6) {
                        handleMfaSubmit()
                      }
                    }}
                  />
                </div>

                <Button
                  onClick={handleMfaSubmit}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg"
                  disabled={isLoading || mfaCode.length !== 6}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    'Verificar código'
                  )}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleBackToLogin}
                  className="w-full text-gray-500"
                  disabled={isLoading}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver al login
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-600 mt-6">
          © 2024 ERP VAL ARG. Todos los derechos reservados.
        </p>
      </div>
    </div>
  )
}
