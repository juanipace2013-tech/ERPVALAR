'use client'

import { useState, useEffect } from 'react'
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
  Route,
  Map,
  ArrowDownToLine,
  Building2,
  Sparkles,
  Inbox,
  Gavel,
  Percent,
  Wrench,
  Gauge,
  MessageCircleQuestion,
  Store,
  UtensilsCrossed,
  TreePalm,
  FileBadge,
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
    title: 'Clientes',
    href: '/clientes',
    icon: Users,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
  },
  {
    title: 'Bandeja',
    href: '/bandeja',
    icon: Inbox,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Mercado Libre',
    icon: Store,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
    subItems: [
      {
        title: 'Preguntas',
        href: '/mercadolibre/preguntas',
        icon: MessageCircleQuestion,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
      },
      {
        title: 'Publicaciones y stock',
        href: '/mercadolibre/publicaciones',
        icon: Store,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
      },
    ],
  },
  {
    title: 'Licitaciones',
    href: '/exiros',
    icon: Gavel,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
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
    title: 'Logística',
    icon: Route,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
    subItems: [
      {
        title: 'Hojas de Ruta',
        href: '/logistica/rutas',
        icon: Map,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
      },
      {
        title: 'Entregas',
        href: '/logistica/entregas',
        icon: PackageCheck,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
      },
      {
        title: 'Retiros',
        href: '/logistica/retiros',
        icon: ArrowDownToLine,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
      },
    ],
  },
  {
    title: 'Facturación',
    href: '/facturacion',
    icon: Receipt,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
    subItems: [
      {
        title: 'Análisis',
        href: '/facturacion/analisis',
        icon: TrendingUp,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
      },
    ],
  },
  {
    title: 'Comisiones',
    href: '/comisiones',
    icon: Percent,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    title: 'Productos',
    href: '/productos',
    icon: Package,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Proveedores',
    href: '/proveedores',
    icon: Building2,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
    subItems: [
      {
        title: 'Facturas Compra',
        href: '/proveedores/facturas-compra',
        icon: Receipt,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
      },
      {
        title: 'Órdenes de Compra',
        href: '/proveedores/ordenes-compra',
        icon: ShoppingCart,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
      },
    ],
  },
  {
    title: 'Inventario',
    href: '/inventario/items',
    icon: ShoppingCart,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    title: 'Viandas',
    href: '/viandas',
    icon: UtensilsCrossed,
    roles: ['ADMIN', 'GERENTE'],
  },
  {
    title: 'Vacaciones',
    href: '/vacaciones',
    icon: TreePalm,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR', 'CONTADOR'],
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
  {
    title: 'Leads',
    href: '/leads',
    icon: Sparkles,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Certificados',
    href: '/certificados',
    icon: FileBadge,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
  },
  {
    title: 'Herramientas',
    icon: Wrench,
    roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
    subItems: [
      {
        title: 'Calculadora de Vapor',
        href: '/herramientas/calculadora-vapor',
        icon: Gauge,
        roles: ['ADMIN', 'GERENTE', 'VENDEDOR'],
      },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const [exirosNuevas, setExirosNuevas] = useState(0)
  const [mlPendientes, setMlPendientes] = useState(0)

  // Badges del sidebar. Se refrescan al navegar (las queries son counts livianos).
  useEffect(() => {
    fetch('/api/exiros/licitaciones?countOnly=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (typeof data?.nuevasCount === 'number') setExirosNuevas(data.nuevasCount)
      })
      .catch(() => {})
    fetch('/api/mercadolibre/preguntas?countOnly=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (typeof data?.pendingCount === 'number') setMlPendientes(data.pendingCount)
      })
      .catch(() => {})
  }, [pathname])

  const userRole = session?.user?.role

  // TODO: Re-habilitar filtro por roles cuando se definan permisos
  // const visibleItems = navItems.filter((item) =>
  //   userRole ? item.roles.includes(userRole) : false
  // )
  const visibleItems = navItems

  const toggleExpand = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title)
        ? prev.filter((item) => item !== title)
        : [...prev, title]
    )
  }

  return (
    <aside className="w-64 shrink-0 border-r border-blue-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm shadow-sm overflow-y-auto">
      <nav className="space-y-1 p-4">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const isExpanded = expandedItems.includes(item.title)
          const hasSubItems = item.subItems && item.subItems.length > 0
          const isActive = pathname === item.href
          const isParentActive = hasSubItems && item.subItems!.some(sub => pathname.startsWith(sub.href))

          // TODO: Re-habilitar filtro por roles cuando se definan permisos
          // const visibleSubItems = hasSubItems
          //   ? item.subItems!.filter(subItem =>
          //       userRole ? subItem.roles.includes(userRole) : false
          //     )
          //   : []
          const visibleSubItems = hasSubItems ? (item.subItems ?? []) : []

          return (
            <div key={item.title}>
              {hasSubItems && visibleSubItems.length > 0 ? (
                <>
                  <button
                    onClick={() => toggleExpand(item.title)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                      isParentActive
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-blue-300'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="flex-1 text-left">{item.title}</span>
                    {item.title === 'Mercado Libre' && mlPendientes > 0 && (
                      <span className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold min-w-[1.25rem] bg-blue-600 text-white">
                        {mlPendientes}
                      </span>
                    )}
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
                              ? 'bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 text-white shadow-md'
                              : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-300'
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
                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 text-white shadow-md'
                                : 'text-gray-600 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-blue-300'
                            )}
                          >
                            <SubIcon className="h-4 w-4" />
                            <span className="flex-1">{subItem.title}</span>
                            {subItem.href === '/mercadolibre/preguntas' && mlPendientes > 0 && (
                              <span
                                className={cn(
                                  'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold min-w-[1.25rem]',
                                  isSubActive ? 'bg-white/20 text-white' : 'bg-blue-600 text-white'
                                )}
                              >
                                {mlPendientes}
                              </span>
                            )}
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
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 dark:from-blue-700 dark:to-blue-800 text-white shadow-md'
                      : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-blue-300'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="flex-1">{item.title}</span>
                  {item.href === '/exiros' && exirosNuevas > 0 && (
                    <span
                      className={cn(
                        'ml-auto inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold min-w-[1.25rem]',
                        isActive ? 'bg-white/20 text-white' : 'bg-blue-600 text-white'
                      )}
                    >
                      {exirosNuevas}
                    </span>
                  )}
                </Link>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
