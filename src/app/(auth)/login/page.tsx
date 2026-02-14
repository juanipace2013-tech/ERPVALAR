'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema, type LoginInput } from '@/lib/validations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

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
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      })

      if (result?.error) {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-100 px-4">
      <div className="w-full max-w-md">
        {/* Logo y título */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 mb-4 shadow-lg">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Valarg CRM</h1>
          <p className="text-gray-600">Sistema de Gestión Empresarial</p>
        </div>

        <Card className="shadow-xl border-blue-100">
          <CardHeader className="space-y-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
            <CardTitle className="text-2xl font-bold text-center">
              Iniciar Sesión
            </CardTitle>
            <CardDescription className="text-center text-blue-100">
              Ingresa tus credenciales para acceder al sistema
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
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
                {isLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
              </Button>
            </form>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
              <p className="text-xs font-semibold text-blue-900 mb-2 text-center">Usuarios de prueba:</p>
              <div className="space-y-1 text-xs text-blue-700">
                <p><span className="font-medium">Admin:</span> admin@valarg.com / admin123</p>
                <p><span className="font-medium">Vendedor:</span> vendedor@valarg.com / vendedor123</p>
                <p><span className="font-medium">Gerente:</span> gerente@valarg.com / gerente123</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-600 mt-6">
          © 2024 Valarg CRM. Todos los derechos reservados.
        </p>
      </div>
    </div>
  )
}
