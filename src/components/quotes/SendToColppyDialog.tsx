/**
 * Componente: SendToColppyDialog
 * Dialog para enviar cotizaciones a Colppy (remitos y facturas)
 * Con tabla editable de items y configuración pre-envío
 *
 * Reutilizable: se puede usar desde Cotizaciones (default) y desde
 * Facturación (con onSend custom para facturación parcial).
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Send, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

// ============================================================================
// TIPOS (exportados para reutilización)
// ============================================================================

export interface QuoteItem {
  id: string;
  productSku: string;
  description: string;
  /** Cantidad sugerida a facturar (por default, la cantidad pendiente). */
  quantity: number;
  unitPrice: number;
  iva: number;
  /** Cantidad ya facturada previamente (acumulada en envíos anteriores a Colppy). */
  quantityInvoiced?: number;
  /** Cantidad original del item en la cotización. Si se omite, se asume = quantity. */
  originalQuantity?: number;
  /** Stock conocido del ERP: false = figura sin stock. Solo advertencia
   *  informativa — el stock se sincroniza recién al ingresar la factura del
   *  proveedor, así que es normal facturar ítems que figuran sin stock. */
  inStock?: boolean | null;
}

export type ColppyAction = 'remito-factura' | 'remito' | 'factura-cuenta-corriente' | 'factura-contado';

export interface EditableItem {
  id: string;
  sku: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  iva: number;
  comentario: string;
  /** Solo display: ya facturado en envíos previos. */
  yaFacturado?: number;
  /** Solo display: cantidad original del item en la cotización. */
  cantidadOriginal?: number;
  /** Checkbox de selección: si es false el ítem NO se incluye en la factura.
   *  Default true. Los excluidos no viajan en el payload. */
  incluido?: boolean;
  /** Solo display: figura sin stock en el ERP (advertencia, nunca bloquea). */
  sinStock?: boolean;
}

export type TipoCambioModo = 'BILLETE' | 'DIVISA';

export interface ColppySendPayload {
  action: ColppyAction;
  editedData: {
    items: EditableItem[];
    condicionPago: string;
    puntoVenta: string;
    descripcion: string;
    /** N° de remito que acompaña la factura (referencia; propuesto = próximo del talonario) */
    remitoNumero?: string;
    /** Solo cotizaciones en USD: TC con el que se emite la factura
     *  (cotización del comprobante en ARCA, tipoCambio en Colppy, PDF). */
    exchangeRate?: number;
    /** BILLETE = TC del sistema (/tipo-cambio), DIVISA = ingresado a mano. */
    exchangeRateModo?: TipoCambioModo;
  };
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
    /** Bonificación de cabecera (%) de la cotización. Solo display: el server
     *  la aplica al payload de Colppy por su cuenta (porcDesc por línea). */
    bonification?: number;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
  /** Optional custom send handler. If provided, overrides the default
   *  POST /api/quotes/{id}/send-to-colppy call.
   *  Should throw on error; resolved value is ignored. */
  onSend?: (payload: ColppySendPayload) => Promise<void>;
  /** Optional subtitle shown under the description */
  subtitle?: string;
}

// ============================================================================
// COMPONENTE
// ============================================================================

export function SendToColppyDialog({
  quote,
  open,
  onOpenChange,
  onSent,
  onSend,
  subtitle,
}: SendToColppyDialogProps) {
  // Siempre se envía como Factura Cuenta Corriente (única opción soportada
  // desde el dialog tras el ajuste de UX de abril 2026).
  const selectedAction: ColppyAction = 'factura-cuenta-corriente';
  const [sending, setSending] = useState(false);

  // Estado del AlertDialog de inconsistencia crítica (factura emitida en Colppy
  // pero persistencia en ERP falló). Bloqueante: el usuario tiene que confirmar
  // que leyó el número de factura antes de poder seguir.
  const [orphanInfo, setOrphanInfo] = useState<{
    message: string;
    colppyFacturaId: string | null;
    colppyFacturaNumber: string | null;
    colppyRemitoNumber: string | null;
  } | null>(null);

  // Estados editables
  const [items, setItems] = useState<EditableItem[]>([]);
  const [condicionPago, setCondicionPago] = useState('Contado');
  const [puntoVenta, setPuntoVenta] = useState('0003');
  const [descripcionFactura, setDescripcionFactura] = useState('');
  const [remitoNumero, setRemitoNumero] = useState('');
  const [remitoSugerido, setRemitoSugerido] = useState('');

  // Tipo de cambio actual del ERP (billete, de /tipo-cambio)
  const [latestRate, setLatestRate] = useState<{ rate: number; date: string } | null>(null);
  const [loadingRate, setLoadingRate] = useState(false);
  // TC con el que se factura: por defecto billete (sistema); "Divisa" habilita
  // el campo para tipear el TC que usan los clientes grandes.
  const [tcModo, setTcModo] = useState<TipoCambioModo>('BILLETE');
  const [tcManual, setTcManual] = useState('');
  const tcBillete = latestRate?.rate ?? quote.exchangeRate ?? null;
  const tcEfectivo =
    quote.currency !== 'USD'
      ? null
      : tcModo === 'DIVISA'
        ? Number(tcManual.replace(',', '.')) || null
        : tcBillete;

  // Mapeo de días a texto de condición de pago
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

  // Obtener último tipo de cambio del ERP al abrir el dialog
  // Proponer el N° de remito que acompaña la factura: el próximo del talonario
  useEffect(() => {
    if (!open) return;
    fetch('/api/delivery-notes/next-number')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.next) {
          setRemitoSugerido(d.next);
          setRemitoNumero((prev) => prev || d.next);
        }
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open && quote.currency === 'USD') {
      setLoadingRate(true);
      fetch('/api/tipo-cambio?from=USD&to=ARS')
        .then((r) => r.json())
        .then((data) => {
          if (data.length > 0) {
            setLatestRate({
              rate: Number(data[0].rate),
              date: data[0].validFrom,
            });
          }
        })
        .catch(() => {})
        .finally(() => setLoadingRate(false));
    }
  }, [open, quote.currency]);

  // Inicializar datos cuando se abre el dialog
  useEffect(() => {
    if (open) {
      setTcModo('BILLETE');
      setTcManual('');
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
          yaFacturado: item.quantityInvoiced ?? 0,
          cantidadOriginal: item.originalQuantity ?? item.quantity,
          incluido: true,
          sinStock: item.inStock === false,
        }))
      );

      // Inicializar condición de pago: primero usar el valor del prop si existe
      if (quote.customer.idCondicionPago && quote.customer.idCondicionPago !== '0') {
        setCondicionPago(condicionMap[quote.customer.idCondicionPago] || 'Contado');
      } else {
        // Si no hay valor del prop o es "0", intentar obtenerlo desde la cache de Colppy
        setCondicionPago('Contado'); // default mientras carga
        const cuit = quote.customer.cuit?.replace(/\D/g, '');
        if (cuit && cuit.length >= 7) {
          fetch(`/api/colppy/clientes?search=${cuit}&limit=5`)
            .then((r) => r.json())
            .then((data) => {
              if (data.customers?.length > 0) {
                // Buscar match exacto de CUIT (sin guiones)
                const match = data.customers.find(
                  (c: any) => c.cuit?.replace(/\D/g, '') === cuit
                ) || data.customers[0];
                if (match.paymentTermsDays != null && match.paymentTermsDays > 0) {
                  const days = String(match.paymentTermsDays);
                  const mapped = condicionMap[days];
                  if (mapped) {
                    setCondicionPago(mapped);
                  }
                }
              }
            })
            .catch(() => {
              // Silenciar error, mantener "Contado" como default
            });
        }
      }

      // Inicializar descripción
      setDescripcionFactura(`Cotización ${quote.quoteNumber}`);
    }
  }, [open, quote]);

  // Determinar tipo de factura según condición IVA
  const invoiceType = quote.customer.taxCondition === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B';

  // Cantidad pendiente de facturar de un ítem (tope del input de cantidad)
  const pendienteDe = (item: EditableItem) =>
    Math.max(0, (item.cantidadOriginal ?? item.cantidad) - (item.yaFacturado ?? 0));

  // Ítems seleccionados (checkbox) — son los únicos que viajan en el payload
  const selectedCount = useMemo(() => items.filter((i) => i.incluido !== false).length, [items]);

  // Ítems seleccionados con cantidad inválida (fuera de 1..pendiente)
  const invalidSelected = useMemo(
    () =>
      items.filter(
        (i) => i.incluido !== false && (i.cantidad <= 0 || i.cantidad > pendienteDe(i))
      ),
    [items]
  );

  // Calcular totales en tiempo real — solo ítems seleccionados, aplicando la
  // bonificación de cabecera con el mismo factor que usa el server para armar
  // el payload de Colppy (porcDesc por línea → neto × (1 − bonif/100)).
  const bonification = Number(quote.bonification ?? 0);
  const totales = useMemo(() => {
    const seleccionados = items.filter((i) => i.incluido !== false);
    const bonifFactor = 1 - bonification / 100;
    const subtotalSinBonif = seleccionados.reduce(
      (sum, item) => sum + item.cantidad * item.precioUnitario,
      0
    );
    const netoGravado = subtotalSinBonif * bonifFactor;
    const totalIVA = seleccionados.reduce((sum, item) => {
      const subtotal = item.cantidad * item.precioUnitario * bonifFactor;
      return sum + subtotal * (item.iva / 100);
    }, 0);
    const total = netoGravado + totalIVA;

    return { subtotalSinBonif, netoGravado, totalIVA, total };
  }, [items, bonification]);

  // Indica que estamos en un re-envío (facturación parcial)
  const hasAnyInvoiced = useMemo(
    () => items.some((i) => (i.yaFacturado ?? 0) > 0),
    [items]
  );

  // Formatear moneda
  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Construir payload — solo los ítems seleccionados (checkbox)
  const buildPayload = (): ColppySendPayload => ({
    action: selectedAction,
    editedData: {
      items: items.filter((i) => i.incluido !== false),
      condicionPago,
      puntoVenta,
      descripcion: descripcionFactura,
      remitoNumero: remitoNumero.trim() || undefined,
      ...(quote.currency === 'USD' && tcEfectivo
        ? { exchangeRate: tcEfectivo, exchangeRateModo: tcModo }
        : {}),
    },
  });

  // Handler para enviar a Colppy
  const handleSend = async () => {
    if (quote.currency === 'USD' && !(tcEfectivo && tcEfectivo > 0)) {
      toast.error('Ingresá un tipo de cambio válido');
      return;
    }
    setSending(true);

    try {
      const payload = buildPayload();

      if (onSend) {
        // Usar handler custom (facturación parcial, etc.)
        await onSend(payload);
      } else {
        // Handler default: POST /api/quotes/{id}/send-to-colppy
        const response = await fetch(`/api/quotes/${quote.id}/send-to-colppy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          // Caso crítico: Colppy emitió pero el ERP no pudo persistir.
          // Aunque el endpoint default todavía no emite este errorCode (solo
          // generate-invoice lo hace), lo manejamos acá también para que el día
          // que el refactor unifique los endpoints ya esté soportado.
          if (data.errorCode === 'COLPPY_ORPHAN') {
            const err: any = new Error(data.message);
            err.errorCode = 'COLPPY_ORPHAN';
            err.colppyFacturaId = data.colppyFacturaId;
            err.colppyFacturaNumber = data.colppyFacturaNumber;
            err.colppyRemitoNumber = data.colppyRemitoNumber;
            throw err;
          }
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
      }

      // Cerrar dialog y notificar
      onOpenChange(false);
      onSent();
    } catch (error: any) {
      console.error('Error al enviar a Colppy:', error);
      // Caso crítico: mostrar AlertDialog bloqueante en lugar del toast genérico.
      if (error?.errorCode === 'COLPPY_ORPHAN') {
        setOrphanInfo({
          message: error.message || 'Inconsistencia crítica',
          colppyFacturaId: error.colppyFacturaId || null,
          colppyFacturaNumber: error.colppyFacturaNumber || null,
          colppyRemitoNumber: error.colppyRemitoNumber || null,
        });
      } else {
        toast.error('Error al enviar a Colppy', {
          description: error.message,
        });
      }
    } finally {
      setSending(false);
    }
  };

  // Handler para copiar al portapapeles el número de factura del AlertDialog
  const copyOrphanFactura = async () => {
    if (!orphanInfo?.colppyFacturaNumber) return;
    try {
      await navigator.clipboard.writeText(orphanInfo.colppyFacturaNumber);
      toast.success('Número de factura copiado');
    } catch {
      toast.error('No se pudo copiar al portapapeles');
    }
  };

  // Handler para actualizar un item
  const updateItem = (index: number, field: keyof EditableItem, value: any) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-blue-600" />
            Enviar a Colppy
          </DialogTitle>
          <DialogDescription>
            Revisa y ajusta los datos antes de crear el borrador en Colppy
            {subtitle && (
              <span className="block mt-1 text-blue-600 font-medium">{subtitle}</span>
            )}
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
              {quote.currency === 'USD' && (
                <div className="flex justify-between">
                  <span className="font-medium text-blue-900">TC de la factura:</span>
                  <span className="text-blue-700">
                    {loadingRate ? (
                      <span className="flex items-center gap-1"><RefreshCw className="h-3 w-3 animate-spin" /> Cargando...</span>
                    ) : tcEfectivo ? (
                      <>$ {tcEfectivo.toLocaleString('es-AR', { minimumFractionDigits: 2 })} <span className="text-xs text-blue-500">({tcModo === 'DIVISA' ? 'divisa / manual' : latestRate ? `billete del ${new Date(latestRate.date).toLocaleDateString('es-AR')}` : 'de la cotización'})</span></>
                    ) : 'N/A'}
                  </span>
                </div>
              )}
              {quote.currency === 'USD' && tcEfectivo && quote.exchangeRate && Math.abs(tcEfectivo - quote.exchangeRate) > 0.001 && (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                  La cotización se hizo a $ {quote.exchangeRate.toLocaleString('es-AR', { minimumFractionDigits: 2 })}; la factura sale a $ {tcEfectivo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
        <div className={`grid ${quote.currency === 'USD' ? 'grid-cols-4' : 'grid-cols-3'} gap-4 p-4 border rounded-lg bg-gray-50`}>
          {quote.currency === 'USD' && (
            <div className="space-y-2">
              <Label htmlFor="tc-modo">Tipo de cambio</Label>
              <Select value={tcModo} onValueChange={(v) => setTcModo(v as TipoCambioModo)}>
                <SelectTrigger id="tc-modo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BILLETE">
                    Billete (sistema){tcBillete ? ` · $ ${tcBillete.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : ''}
                  </SelectItem>
                  <SelectItem value="DIVISA">Divisa / otro (manual)</SelectItem>
                </SelectContent>
              </Select>
              {tcModo === 'DIVISA' && (
                <Input
                  inputMode="decimal"
                  placeholder={tcBillete ? `Ej. ${tcBillete.toLocaleString('es-AR')}` : 'TC'}
                  value={tcManual}
                  onChange={(e) => setTcManual(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          )}
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

          <div className="space-y-2">
            <Label htmlFor="remito-numero">N° de remito (referencia)</Label>
            <Input
              id="remito-numero"
              value={remitoNumero}
              onChange={(e) => setRemitoNumero(e.target.value)}
              placeholder="RE 0004-00000123"
            />
            <p className="text-xs text-gray-500">
              {remitoSugerido
                ? `Propuesto: ${remitoSugerido} (próximo del talonario). Editalo si la factura acompaña un remito anterior, o dejalo vacío.`
                : 'Remito que acompaña la factura (opcional).'}
            </p>
          </div>
        </div>

        {/* Tabla editable de items */}
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="p-2 w-8" title="Incluir en la factura" />
                  <th className="text-left p-2 font-medium">SKU</th>
                  <th className="text-left p-2 font-medium">Descripción</th>
                  <th className="text-right p-2 font-medium text-gray-500">Cant. total</th>
                  <th className="text-right p-2 font-medium text-blue-700">Ya facturada</th>
                  <th className="text-right p-2 font-medium text-green-700">Pendiente</th>
                  <th className="text-right p-2 font-medium">Cant. a facturar</th>
                  <th className="text-right p-2 font-medium">Precio Unit {quote.currency}</th>
                  <th className="text-right p-2 font-medium">IVA %</th>
                  <th className="text-left p-2 font-medium">Comentario</th>
                  <th className="text-right p-2 font-medium">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const yaFacturado = item.yaFacturado ?? 0;
                  const cantidadOriginal = item.cantidadOriginal ?? item.cantidad;
                  const maxCantidad = Math.max(0, cantidadOriginal - yaFacturado);
                  const incluido = item.incluido !== false;
                  const cantidadInvalida =
                    incluido && (item.cantidad <= 0 || item.cantidad > maxCantidad);
                  return (
                  <tr
                    key={item.id}
                    className={`border-b hover:bg-gray-50 ${incluido ? '' : 'opacity-50 bg-gray-50'}`}
                  >
                    <td className="p-2 align-top pt-3">
                      <Checkbox
                        checked={incluido}
                        onCheckedChange={(checked) => updateItem(index, 'incluido', checked === true)}
                        aria-label="Incluir ítem en la factura"
                      />
                    </td>
                    <td className="p-2 text-gray-600 align-top">
                      <div>{item.sku}</div>
                      {item.sinStock && (
                        <span
                          className="mt-1 inline-block text-[10px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-1.5 py-0.5 whitespace-nowrap"
                          title="El stock se sincroniza desde Colppy al ingresar la factura del proveedor — figura sin stock pero se puede facturar igual"
                        >
                          ⚠ Sin stock (no bloquea)
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <Input
                        value={item.descripcion}
                        onChange={(e) => updateItem(index, 'descripcion', e.target.value)}
                        className="h-8 text-sm"
                        disabled={!incluido}
                      />
                    </td>
                    <td className="p-2 text-right font-mono text-gray-500">{cantidadOriginal}</td>
                    <td className="p-2 text-right font-mono text-blue-700">{yaFacturado || '—'}</td>
                    <td className="p-2 text-right font-mono text-green-700">{maxCantidad}</td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={item.cantidad}
                        onChange={(e) => updateItem(index, 'cantidad', parseFloat(e.target.value) || 0)}
                        className={`h-8 text-sm text-right ${cantidadInvalida ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                        min="1"
                        max={maxCantidad}
                        step="1"
                        disabled={!incluido}
                      />
                      {cantidadInvalida && (
                        <p className="text-[10px] text-red-600 mt-0.5 text-right whitespace-nowrap">
                          Debe ser entre 1 y {maxCantidad}
                        </p>
                      )}
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        value={item.precioUnitario}
                        onChange={(e) => updateItem(index, 'precioUnitario', parseFloat(e.target.value) || 0)}
                        className="h-8 text-sm text-right"
                        min="0"
                        step="0.01"
                        disabled={!incluido}
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
                        disabled={!incluido}
                      />
                    </td>
                    <td className="p-2">
                      <textarea
                        value={item.comentario}
                        onChange={(e) => updateItem(index, 'comentario', e.target.value)}
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          target.style.height = 'auto';
                          target.style.height = target.scrollHeight + 'px';
                        }}
                        rows={2}
                        disabled={!incluido}
                        className="w-full min-h-[60px] resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                      />
                    </td>
                    <td className="p-2 text-right font-medium">
                      {incluido
                        ? formatCurrency(item.cantidad * item.precioUnitario, quote.currency)
                        : '—'}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="border rounded-lg p-4 bg-gray-50">
          {(hasAnyInvoiced || selectedCount < items.length) && (
            <div className="mb-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-1.5">
              Facturación parcial: {selectedCount} de {items.length} ítem(s) seleccionado(s) en este envío.
              Total a facturar ahora: <span className="font-semibold">{formatCurrency(totales.total, quote.currency)}</span>
            </div>
          )}
          {selectedCount === 0 && (
            <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5">
              Seleccioná al menos un ítem para facturar.
            </div>
          )}
          <div className="space-y-2 text-sm max-w-md ml-auto">
            {bonification > 0 && (
              <>
                <div className="flex justify-between">
                  <span className="font-medium">Subtotal:</span>
                  <span>{formatCurrency(totales.subtotalSinBonif, quote.currency)}</span>
                </div>
                <div className="flex justify-between text-green-700">
                  <span className="font-medium">Bonificación ({bonification}%):</span>
                  <span>
                    - {formatCurrency(totales.subtotalSinBonif - totales.netoGravado, quote.currency)}
                  </span>
                </div>
              </>
            )}
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
            disabled={sending || selectedCount === 0 || invalidSelected.length > 0}
            className="bg-blue-600 hover:bg-blue-700"
            title={
              selectedCount === 0
                ? 'Seleccioná al menos un ítem'
                : invalidSelected.length > 0
                ? 'Hay ítems con cantidad fuera del rango pendiente'
                : undefined
            }
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

      {/* AlertDialog bloqueante: factura emitida en Colppy + persistencia ERP fallida.
          NO se autocierra ni se cierra clickeando afuera — el usuario tiene que
          confirmar que leyó el número de factura para reconciliar manualmente. */}
      <Dialog
        open={!!orphanInfo}
        onOpenChange={(o) => {
          // Solo permitir que se cierre vía el botón "Entendido". Si Radix intenta
          // cerrarlo por click fuera o ESC, ignoramos.
          if (!o) return;
        }}
      >
        <DialogContent
          className="sm:max-w-lg border-2 border-red-500"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-6 w-6" />
              ⚠️ Inconsistencia crítica — Factura emitida pero no registrada
            </DialogTitle>
            <DialogDescription className="text-gray-900 pt-2">
              {orphanInfo?.message}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {orphanInfo?.colppyFacturaNumber && (
              <div className="rounded-md border-2 border-red-300 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                  Número de factura en Colppy
                </p>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <code className="text-lg font-mono font-bold text-red-900 select-all break-all">
                    {orphanInfo.colppyFacturaNumber}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyOrphanFactura}
                    className="flex-shrink-0 border-red-300 text-red-700 hover:bg-red-100"
                  >
                    Copiar
                  </Button>
                </div>
              </div>
            )}

            {orphanInfo?.colppyRemitoNumber && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                  Número de remito en Colppy
                </p>
                <code className="text-base font-mono text-red-900 select-all break-all">
                  {orphanInfo.colppyRemitoNumber}
                </code>
              </div>
            )}

            {orphanInfo?.colppyFacturaId && (
              <div className="text-xs text-gray-500">
                Colppy invoice ID: <code className="font-mono">{orphanInfo.colppyFacturaId}</code>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={() => setOrphanInfo(null)}
              className="bg-red-600 hover:bg-red-700 text-white w-full"
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
