'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Printer, X } from 'lucide-react'

export function PrintButton() {
  const router = useRouter()

  useEffect(() => {
    // Auto-abrir diálogo de impresión cuando la página carga (opcional)
    // window.print()
  }, [])

  const handlePrint = () => {
    window.print()
  }

  const handleClose = () => {
    router.back()
  }

  return (
    <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
      <Button
        onClick={handlePrint}
        className="bg-blue-600 hover:bg-blue-700"
      >
        <Printer className="mr-2 h-4 w-4" />
        Imprimir / Guardar PDF
      </Button>
      <Button onClick={handleClose} variant="outline">
        <X className="mr-2 h-4 w-4" />
        Cerrar
      </Button>
    </div>
  )
}
