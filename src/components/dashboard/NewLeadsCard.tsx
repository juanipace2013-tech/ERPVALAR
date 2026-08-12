import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
import { Sparkles, ArrowRight } from 'lucide-react'

export interface NewLeadsData {
  last7Days: number
  nuevos: number
}

/**
 * Cuenta leads de los últimos 7 días y sin contactar. Se llama desde el
 * Promise.all del dashboard para que corra junto al resto de las queries
 * (antes la card las disparaba sola DESPUÉS de esa tanda, sumando una
 * ronda secuencial extra contra la DB).
 */
export async function getNewLeadsData(): Promise<NewLeadsData> {
  const since = new Date()
  since.setDate(since.getDate() - 7)

  const [last7Days, nuevos] = await Promise.all([
    prisma.googleAdsLead.count({ where: { createdAt: { gte: since } } }),
    prisma.googleAdsLead.count({ where: { status: 'NUEVO' } }),
  ])

  return { last7Days, nuevos }
}

/**
 * Card del dashboard con la cantidad de leads recibidos en los últimos 7 días.
 */
export function NewLeadsCard({ data }: { data: NewLeadsData }) {
  const { last7Days, nuevos } = data

  return (
    <Link href="/leads" className="block">
      <Card className="hover:shadow-md transition-shadow border-blue-200 dark:border-blue-900">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Sparkles className="h-4 w-4 text-blue-600" />
                Leads de Google Ads
              </div>
              <p className="text-3xl font-bold mt-2">{last7Days}</p>
              <p className="text-xs text-gray-500 mt-1">
                Últimos 7 días · {nuevos} sin contactar
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-blue-600" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
