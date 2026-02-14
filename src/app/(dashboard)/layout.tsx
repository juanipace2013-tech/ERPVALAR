import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Navbar } from '@/components/layout/Navbar'
import { Sidebar } from '@/components/layout/Sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-blue-50 via-white to-blue-50">
      <Navbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-gradient-to-br from-blue-50/30 via-white to-blue-50/30 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
