'use client'

import { useState } from 'react'
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
  Truck,
  Wallet,
  PackageCheck,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react'

interface SubNavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
}

interface NavItem {
  title: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
  subItems?: SubNavItem[]
}

const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
  },
  {
    title: 'Cotizaciones',
    href: '/cotizaciones',
    icon: FileText,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Remitos',
    href: '/remitos',
    icon: Truck,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Facturación',
    href: '/facturacion',
    icon: Receipt,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
  },
  {
    title: 'Productos',
    href: '/productos',
    icon: Package,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
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
    title: 'Análisis BCRA',
    href: '/analisis-crediticio',
    icon: ShieldCheck,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [expandedItems, setExpandedItems] = useState<string[]>([])

  const userRole = session?.user?.role

  // Filtrar items del menú según el rol del usuario
  const visibleItems = navItems.filter((item) =>
    userRole ? item.roles.includes(userRole) : false
  )

  const toggleExpand = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title]
    )
  }

  return (
    <aside className="w-64 border-r border-blue-200 bg-white/80 backdrop-blur-sm shadow-sm">
      <nav className="space-y-1 p-4">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isExpanded = expandedItems.includes(item.title)
          const hasSubItems = item.subItems && item.subItems.length > 0
          const isActive = pathname === item.href
          const isParentActive = hasSubItems && item.subItems.some(sub => pathname.startsWith(sub.href))

          // Filtrar sub-items por rol
          const visibleSubItems = hasSubItems
            ? item.subItems!.filter(subItem =>
                userRole ? subItem.roles.includes(userRole) : false
              )
            : []

          return (
            <div key={item.title}>
              {hasSubItems && visibleSubItems.length > 0 ? (
                <>
                  <button
                    onClick={() => toggleExpand(item.title)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      isParentActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="flex-1 text-left">{item.title}</span>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="mt-1 space-y-1 pl-4">
                      {item.href && (
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                            isActive
                              ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                              : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                          )}
                        >
                          <Users className="h-4 w-4" />
                          Listado
                        </Link>
                      )}
                      {visibleSubItems.map((subItem) => {
                        const SubIcon = subItem.icon
                        const isSubActive = pathname === subItem.href

                        return (
                          <Link
                            key={subItem.href}
                            href={subItem.href}
                            className={cn(
                              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                              isSubActive
                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                                : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700'
                            )}
                          >
                            <SubIcon className="h-4 w-4" />
                            {subItem.title}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <Link
                  href={item.href!}
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
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
