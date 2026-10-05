'use client'

/**
 * Factura directa con resultado que NO se reintenta: ARCA no confirmó el CAE
 * (ARCA_INCIERTO) o la factura salió en ARCA y el ERP no la registró
 * (ERP_HUERFANA). Bloqueante: no se cierra clickeando afuera ni con ESC; se
 * resuelve con scripts/factura-directa-reconciliar.ts.
 */
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { BloqueoEmisionDirecta } from '@/lib/facturacion/factura-directa-ui'

export function EmisionBloqueadaDialog({ bloqueo, onEntendido }: { bloqueo: BloqueoEmisionDirecta | null; onEntendido: () => void }) {
  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${que} copiado`)
    } catch {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  return (
    <AlertDialog open={!!bloqueo}>
      <AlertDialogContent className="sm:max-w-lg border-2 border-red-500" onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-6 w-6" />
            {bloqueo?.tipo === 'HUERFANA' ? 'Factura emitida en ARCA pero no registrada en el ERP' : 'ARCA no confirmó la factura'}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-gray-900 pt-2">{bloqueo?.mensaje}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 py-1">
          {(bloqueo?.numero || bloqueo?.cae) && (
            <div className="rounded-md border-2 border-red-300 bg-red-50 p-3">
              {bloqueo.numero && (
                <>
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Número del comprobante</p>
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <code className="text-lg font-mono font-bold text-red-900 select-all break-all">{bloqueo.numero}</code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copiar(bloqueo.numero!, 'Número')}
                      className="flex-shrink-0 border-red-300 text-red-700 hover:bg-red-100"
                    >
                      Copiar
                    </Button>
                  </div>
                </>
              )}
              {bloqueo.cae && <p className="mt-1 text-sm text-red-900">CAE <span className="font-mono select-all">{bloqueo.cae}</span></p>}
            </div>
          )}
          {bloqueo?.facturaDirectaId && (
            <p className="text-xs text-gray-600">
              Id en el diario de facturas directas: <code className="font-mono select-all">{bloqueo.facturaDirectaId}</code>
            </p>
          )}
          <p className="text-sm font-semibold text-red-800">
            NO reintentes ni la vuelvas a cargar: un nuevo intento podría facturar dos veces. Avisá a soporte con estos datos; se resuelve
            con scripts/factura-directa-reconciliar.ts{bloqueo?.facturaDirectaId ? ` --id ${bloqueo.facturaDirectaId}` : ''}.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={onEntendido} className="bg-red-600 hover:bg-red-700 text-white w-full">
            Entendido
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
