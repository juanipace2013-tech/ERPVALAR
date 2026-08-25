import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Navbar } from '@/components/layout/Navbar'
import { Sidebar } from '@/components/layout/Sidebar'
import { Toaster } from '@/components/ui/toast'
import { ActivityTracker } from '@/components/activity-tracker'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-blue-50 via-white to-blue-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <Navbar />
      <ActivityTracker />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto bg-gradient-to-br from-blue-50/30 via-white to-blue-50/30 dark:from-gray-900/30 dark:via-gray-900 dark:to-gray-900/30 p-6">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  )
}
