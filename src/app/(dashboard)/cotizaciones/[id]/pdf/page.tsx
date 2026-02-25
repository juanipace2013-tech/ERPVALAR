import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PDFRedirectPage({ params }: PageProps) {
  const { id } = await params
  redirect(`/cotizaciones/${id}/ver`)
}
