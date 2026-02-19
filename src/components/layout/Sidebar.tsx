'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  FileText,
  Receipt,
  Settings,
  TrendingUp,
  DollarSign,
  Banknote,
  Landmark,
} from 'lucide-react'

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
  },
  {
    title: 'Clientes',
    href: '/clientes',
    icon: Users,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Productos',
    href: '/productos',
    icon: Package,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Oportunidades',
    href: '/oportunidades',
    icon: TrendingUp,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Cotizaciones',
    href: '/cotizaciones',
    icon: FileText,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Facturas',
    href: '/facturas',
    icon: Receipt,
    roles: ['ADMIN', 'GERENTE', 'CONTADOR'],
  },
  {
    title: 'Cobros',
    href: '/cobros',
    icon: Banknote,
    roles: ['ADMIN', 'GERENTE', 'CONTADOR'],
  },
  {
    title: 'Tesorería',
    href: '/tesoreria/cuentas',
    icon: Landmark,
    roles: ['ADMIN', 'CONTADOR'],
  },
  {
    title: 'Inventario',
    href: '/inventario/items',
    icon: ShoppingCart,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    title: 'Tipo de Cambio',
    href: '/tipo-cambio',
    icon: DollarSign,
    roles: ['ADMIN', 'GERENTE', 'CONTADOR'],
  },
  {
    title: 'Contabilidad',
    href: '/contabilidad',
    icon: DollarSign,
    roles: ['ADMIN', 'GERENTE', 'CONTADOR'],
  },
  {
    title: 'Configuración',
    href: '/configuracion',
    icon: Settings,
    roles: ['ADMIN'],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()

  const userRole = session?.user?.role

  // Filtrar items del menú según el rol del usuario
  const visibleItems = navItems.filter((item) =>
    userRole ? item.roles.includes(userRole) : false
  )

  return (
    <aside className="w-64 border-r border-blue-200 bg-white/80 backdrop-blur-sm shadow-sm">
      <nav className="space-y-1 p-4">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                  : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
              )}
            >
              <Icon className="h-5 w-5" />
              {item.title}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
