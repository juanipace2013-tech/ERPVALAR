/**
 * Hook: useColppyStock
 * Consulta el stock disponible en Colppy para uno o varios SKUs
 */

import { useState, useEffect, useRef } from 'react';

interface StockItem {
  found: boolean;
  stock: number;
  colppyItemId: number | null;
  descripcion?: string;
}

interface StockResponse {
  items: Record<string, StockItem>;
  totalInCache: number;
}

export function useColppyStock(skus: string[], enabled: boolean = true) {
  const [stockData, setStockData] = useState<Record<string, StockItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Identifica la consulta más reciente: las respuestas de consultas viejas
  // que llegan tarde no deben pisar datos más nuevos ni el estado de loading
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || skus.length === 0) {
      return;
    }

    const requestId = ++requestIdRef.current;

    const fetchStock = async () => {
      try {
        setLoading(true);
        setError(null);

        const skusParam = skus.join(',');
        const response = await fetch(`/api/colppy/inventario?skus=${encodeURIComponent(skusParam)}`);

        if (!response.ok) {
          throw new Error('Error al obtener stock');
        }

        const data: StockResponse = await response.json();
        const items = data.items || {};
        // Merge en vez de reemplazo: cada SKU consultado se acumula. Si esta
        // respuesta quedó vieja (hay una consulta más nueva en vuelo), solo
        // aporta SKUs que aún no están, sin sobreescribir los existentes.
        setStockData((prev) =>
          requestId === requestIdRef.current ? { ...prev, ...items } : { ...items, ...prev }
        );
      } catch (err: any) {
        console.error('Error fetching stock:', err);
        if (requestId === requestIdRef.current) {
          setError(err.message);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    fetchStock();
  }, [skus.join(','), enabled]);

  return { stockData, loading, error };
}

/**
 * Hook para un solo SKU
 */
export function useColppySingleStock(sku: string | null, enabled: boolean = true) {
  const [stockItem, setStockItem] = useState<StockItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !sku) {
      return;
    }

    const fetchStock = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/colppy/inventario?sku=${encodeURIComponent(sku)}`);

        if (!response.ok) {
          throw new Error('Error al obtener stock');
        }

        const data = await response.json();
        setStockItem({
          found: data.found,
          stock: data.stock,
          colppyItemId: data.colppyItemId,
          descripcion: data.descripcion,
        });
      } catch (err: any) {
        console.error('Error fetching stock:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStock();
  }, [sku, enabled]);

  return { stockItem, loading, error };
}

/**
 * Función helper para refrescar el cache de inventario y persistir stock en DB
 */
export async function refreshInventoryCache(): Promise<{
  success: boolean;
  total: number;
  stockSync?: { updated: number; unchanged: number; notFound: number; totalProducts: number };
}> {
  try {
    const response = await fetch('/api/colppy/inventario', {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Error al refrescar cache');
    }

    const data = await response.json();
    return {
      success: true,
      total: data.total || 0,
      stockSync: data.stockSync || undefined,
    };
  } catch (error) {
    console.error('Error refreshing inventory cache:', error);
    return { success: false, total: 0 };
  }
}
