/**
 * Componente: StockBadge
 * Muestra el stock disponible de un producto en Colppy
 */

'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Package, AlertTriangle, Loader2 } from 'lucide-react';

interface StockBadgeProps {
  sku: string;
  stock: number | null | undefined;
  found: boolean | null | undefined;
  loading?: boolean;
  showQuantity?: boolean; // Si mostrar la cantidad o solo el estado
  size?: 'sm' | 'md';
}

export function StockBadge({
  sku,
  stock,
  found,
  loading = false,
  showQuantity = true,
  size = 'sm',
}: StockBadgeProps) {
  if (loading) {
    return (
      <Badge variant="outline" className="text-xs">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Consultando...
      </Badge>
    );
  }

  // No existe en Colppy
  if (found === false || (found === null && stock === null)) {
    return (
      <Badge variant="secondary" className="text-xs text-gray-600 bg-gray-100">
        <Package className="h-3 w-3 mr-1" />
        No registrado en inventario
      </Badge>
    );
  }

  // Existe en Colppy pero sin stock
  if (found && stock === 0) {
    return (
      <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Sin stock
      </Badge>
    );
  }

  // Tiene stock disponible
  if (found && stock && stock > 0) {
    return (
      <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50">
        <Package className="h-3 w-3 mr-1" />
        {showQuantity ? `Stock: ${stock} un.` : 'Disponible'}
      </Badge>
    );
  }

  // Estado desconocido
  return (
    <Badge variant="outline" className="text-xs text-gray-500">
      <Package className="h-3 w-3 mr-1" />
      Stock no disponible
    </Badge>
  );
}

/**
 * Componente simplificado para mostrar solo el ícono y cantidad
 */
export function StockIndicator({ stock, found }: { stock: number | null; found: boolean | null }) {
  if (!found) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  if (stock === 0) {
    return (
      <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
        0 ⚠️
      </span>
    );
  }

  if (stock && stock > 0) {
    return (
      <span className="text-xs text-green-700 font-medium flex items-center gap-1">
        {stock} ✅
      </span>
    );
  }

  return <span className="text-xs text-gray-400">—</span>;
}

/**
 * Componente para mostrar advertencia de stock insuficiente
 */
export function StockWarning({ requested, available }: { requested: number; available: number }) {
  if (requested <= available) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
      <AlertTriangle className="h-3 w-3" />
      <span>
        Stock insuficiente (pedido: {requested}, disponible: {available})
      </span>
    </div>
  );
}
