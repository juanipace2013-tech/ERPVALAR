/**
 * Componente: SendToColppyDialog
 * Dialog para enviar cotizaciones a Colppy (remitos y facturas)
 * Con tabla editable de items y configuración pre-envío
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Send, Package, FileSpreadsheet, CheckCircle2, Loader2, AlertTriangle, Edit } from 'lucide-react';

// ============================================================================
// TIPOS
// ============================================================================

interface QuoteItem {
  id: string;
  productSku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  iva: number;
}

interface SendToColppyDialogProps {
  quote: {
    id: string;
    quoteNumber: string;
    customer: {
      name: string;
      cuit: string;
      taxCondition: string;
      idCondicionPago?: string;
    };
    items: QuoteItem[];
    total: number;
    currency: string;
    exchangeRate: number | null;
    notes?: string;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

type Action = 'remito-factura' | 'remito' | 'factura-cuenta-corriente' | 'factura-contado';

interface EditableItem {
  id: string;
  sku: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  iva: number;
  comentario: string;
}

// ============================================================================
// COMPONENTE
// ============================================================================

export function SendToColppyDialog({
  quote,
  open,
  onOpenChange,
  onSent,
}: SendToColppyDialogProps) {
  const [selectedAction, setSelectedAction] = useState<Action>('remito-factura');
  const [sending, setSending] = useState(false);

  // Estados editables
  const [items, setItems] = useState<EditableItem[]>([]);
  const [condicionPago, setCondicionPago] = useState('Contado');
  const [puntoVenta, setPuntoVenta] = useState('0003');
  const [descripcionFactura, setDescripcionFactura] = useState('');

  // Inicializar datos cuando se abre el dialog
  useEffect(() => {
    if (open) {
      // Inicializar items
      const comentarioBase = `Cotización ${quote.quoteNumber}${quote.notes ? ' / ' + quote.notes : ''}`;
      setItems(
        quote.items.map((item) => ({
          id: item.id,
          sku: item.productSku,
          descripcion: item.description,
          cantidad: item.quantity,
          precioUnitario: item.unitPrice,
          iva: item.iva || 21,
          comentario: comentarioBase,
        }))
      );

      // Inicializar condición de pago
      const condicionMap: Record<string, string> = {
        '0': 'Contado',
        '7': 'a 7 Dias',
        '15': 'a 15 Dias',
        '30': 'a 30 Dias',
        '45': 'a 45 Dias',
        '60': 'a 60 Dias',
        '90': 'a 90 Dias',
        '120': 'a 120 Dias',
      };
      setCondicionPago(condicionMap[quote.customer.idCondicionPago || '0'] || 'Contado');

      // Inicializar descripción
      setDescripcionFactura(`Cotización ${quote.quoteNumber}`);
    }
  }, [open, quote]);

  // Determinar tipo de factura según condición IVA
  const invoiceType = quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B';

  // Calcular totales en tiempo real
  const totales = useMemo(() => {
    const netoGravado = items.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0);
    const totalIVA = items.reduce((sum, item) => {
      const subtotal = item.cantidad * item.precioUnitario;
      return sum + subtotal * (item.iva / 100);
    }, 0);
    const total = netoGravado + totalIVA;

    return { netoGravado, totalIVA, total };
  }, [items]);

  // Formatear moneda
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Handler para enviar a Colppy
  const handleSend = async () => {
    setSending(true);

    try {
      const response = await fetch(`/api/quotes/${quote.id}/send-to-colppy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: selectedAction,
          editedData: {
            items,
            condicionPago,
            puntoVenta,
            descripcion: descripcionFactura,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al enviar a Colppy');
      }

      // Construir mensaje de éxito
      const successParts: string[] = [];
      if (data.remitoNumber) {
        successParts.push(`Remito: ${data.remitoNumber}`);
      }
      if (data.facturaNumber) {
        successParts.push(`Factura: ${data.facturaNumber}`);
      }

      toast.success('Enviado a Colppy', {
        description: successParts.join(' | '),
      });

      // Cerrar dialog y notificar
      onOpenChange(false);
      onSent();
    } catch (error: any) {
      console.error('Error al enviar a Colppy:', error);
      toast.error('Error al enviar a Colppy', {
        description: error.message,
      });
    } finally {
      setSending(false);
    }
  };

  // Handler para actualizar un item
  const updateItem = (index: number, field: keyof EditableItem, value: any) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-blue-600" />
            Enviar a Colppy
          </DialogTitle>
          <DialogDescription>
            Revisa y ajusta los datos antes de crear el borrador en Colppy
          </DialogDescription>
        </DialogHeader>

        {/* Información de la cotización */}
        <div className="my-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="font-medium text-blue-900">Cotización:</span>
                <span className="text-blue-700">{quote.quoteNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-blue-900">Cliente:</span>
                <span className="text-blue-700">{quote.customer.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-blue-900">CUIT:</span>
                <span className="text-blue-700">{quote.customer.cuit}</span>
              </div>
            </div>
            <div className="space-y-2">
              {quote.currency === 'USD' && quote.exchangeRate && (
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900">Tipo de cambio:</span>
                  <span className="text-blue-700">
                    $ {quote.exchangeRate.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="font-medium text-blue-900">Tipo de factura:</span>
                <span className="text-blue-700 font-semibold">Factura {invoiceType}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Campos editables de configuración */}
        <div className="grid grid-cols-3 gap-4 p-4 border rounded-lg bg-gray-50">
          <div className="space-y-2">
            <Label htmlFor="condicion-pago">Condición de pago</Label>
            <Select value={condicionPago} onValueChange={setCondicionPago}>
              <SelectTrigger id="condicion-pago">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Contado">Contado</SelectItem>
                <SelectItem value="a 7 Dias">a 7 Días</SelectItem>
                <SelectItem value="a 15 Dias">a 15 Días</SelectItem>
                <SelectItem value="a 30 Dias">a 30 Días</SelectItem>
                <SelectItem value="a 45 Dias">a 45 Días</SelectItem>
                <SelectItem value="a 60 Dias">a 60 Días</SelectItem>
                <SelectItem value="a 90 Dias">a 90 Días</SelectItem>
                <SelectItem value="a 120 Dias">a 120 Días</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="punto-venta">Punto de venta</Label>
            <Input
              id="punto-venta"
              value={puntoVenta}
              onChange={(e) => setPuntoVenta(e.target.value)}
              placeholder="0003"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descripcion-factura">Descripción factura</Label>
            <Input
              id="descripcion-factura"
              value={descripcionFactura}
              onChange={(e) => setDescripcionFactura(e.target.value)}
              placeholder="Cotización VAL-2026-XXX"
            />
          </div>
        </div>

        {/* Tabla editable de items */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="text-left p-2 font-medium">SKU</th>
                  <th className="text-left p-2 font-medium">Descripción</th>
                  <th className="text-right p-2 font-medium">Cant.</th>
                  <th className="text-right p-2 font-medium">Precio Unit USD</th>
                  <th className="text-right p-2 font-medium">IVA %</th>
                  <th className="text-left p-2 font-medium">Comentario</th>
                  <th className="text-right p-2 font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 text-gray-600">{item.sku}</td>
                    <td className="p-2">
                      <Input
                        value={item.descripcion}
                        onChange={(e) => updateItem(index, 'descripcion', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={item.cantidad}
                        onChange={(e) => updateItem(index, 'cantidad', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right"
                        min="0"
                        step="1"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={item.precioUnitario}
                        onChange={(e) => updateItem(index, 'precioUnitario', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right"
                        min="0"
                        step="0.01"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={item.iva}
                        onChange={(e) => updateItem(index, 'iva', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right"
                        min="0"
                        max="100"
                        step="0.01"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        value={item.comentario}
                        onChange={(e) => updateItem(index, 'comentario', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="p-2 text-right font-medium">
                      {formatCurrency(item.cantidad * item.precioUnitario, quote.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="border rounded-lg p-4 bg-gray-50">
          <div className="space-y-2 text-sm max-w-md ml-auto">
            <div className="flex justify-between">
              <span className="font-medium">Neto gravado:</span>
              <span>{formatCurrency(totales.netoGravado, quote.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">IVA:</span>
              <span>{formatCurrency(totales.totalIVA, quote.currency)}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="font-semibold text-base">Total:</span>
              <span className="font-semibold text-base">
                {formatCurrency(totales.total, quote.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Opciones de envío */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">Selecciona una opción:</Label>
          <RadioGroup value={selectedAction} onValueChange={(value) => setSelectedAction(value as Action)}>
            {/* Opción 1: Remito + Factura (Recomendado) */}
            <div className="flex items-start space-x-3 rounded-lg border border-blue-300 bg-blue-50 p-4">
              <RadioGroupItem value="remito-factura" id="remito-factura" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="remito-factura"
                  className="flex items-center gap-2 text-sm font-semibold cursor-pointer text-blue-900"
                >
                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                  Remito + Factura (Recomendado)
                </Label>
                <p className="text-xs text-blue-700 mt-1">
                  Crea tanto el remito de entrega como la factura en Colppy
                </p>
              </div>
            </div>

            {/* Opción 2: Solo Remito */}
            <div className="flex items-start space-x-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
              <RadioGroupItem value="remito" id="remito" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="remito" className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                  <Package className="h-4 w-4 text-gray-600" />
                  Solo Remito
                </Label>
                <p className="text-xs text-gray-600 mt-1">
                  Crea únicamente el remito de entrega (sin factura)
                </p>
              </div>
            </div>

            {/* Opción 3: Solo Factura (Cuenta Corriente) */}
            <div className="flex items-start space-x-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
              <RadioGroupItem value="factura-cuenta-corriente" id="factura-cuenta-corriente" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="factura-cuenta-corriente"
                  className="flex items-center gap-2 text-sm font-semibold cursor-pointer"
                >
                  <FileSpreadsheet className="h-4 w-4 text-gray-600" />
                  Solo Factura (Cuenta Corriente)
                </Label>
                <p className="text-xs text-gray-600 mt-1">
                  Crea únicamente la factura a cuenta corriente (sin remito)
                </p>
              </div>
            </div>

            {/* Opción 4: Solo Factura (Contado) */}
            <div className="flex items-start space-x-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50">
              <RadioGroupItem value="factura-contado" id="factura-contado" className="mt-1" />
              <div className="flex-1">
                <Label htmlFor="factura-contado" className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
                  <FileSpreadsheet className="h-4 w-4 text-gray-600" />
                  Solo Factura (Contado)
                </Label>
                <p className="text-xs text-gray-600 mt-1">
                  Crea únicamente la factura de contado (sin remito)
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        {/* Advertencia */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Operación irreversible</p>
            <p className="text-amber-700 mt-1">
              Esta operación no se puede deshacer. Los documentos se crearán directamente en Colppy.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={sending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Crear borrador en Colppy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
