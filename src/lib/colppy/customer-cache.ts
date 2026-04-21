/**
 * Cache en memoria del listado de clientes de Colppy.
 *
 * Se mantiene en este módulo (en lugar del route file) para que otros
 * endpoints puedan invalidarlo cuando detectan que un dato del cliente
 * cambió (p. ej. priceMultiplier editado desde la ficha o desde la
 * cotización). Si no se invalida, el buscador puede mostrar valores
 * viejos hasta que expire el TTL.
 */

import { logger } from '@/lib/logger';

export interface CachedCustomer {
  id: string;
  colppyId: string;
  name: string;
  businessName: string;
  cuit: string;
  taxCondition: string;
  taxConditionDisplay: string;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string;
  mobile: string;
  email: string;
  saldo: number;
  priceMultiplier: number;
  paymentTerms: string;
  paymentTermsDays: number;
  searchText: string;
}

export const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

let customerCache: CachedCustomer[] = [];
let cacheTimestamp = 0;

export function isCacheValid(): boolean {
  return customerCache.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL;
}

export function getCachedCustomers(): CachedCustomer[] {
  return customerCache;
}

export function setCachedCustomers(customers: CachedCustomer[]): void {
  customerCache = customers;
  cacheTimestamp = Date.now();
}

/**
 * Invalida el cache del buscador de clientes. El próximo request lo
 * reconstruirá desde Colppy + BD local.
 *
 * @param cuit - Opcional. Solo para logging/auditoría; la implementación
 *   actual invalida todo el cache independientemente del cuit. Cuando lo
 *   necesitemos, se puede optimizar a invalidación puntual.
 */
export function invalidateCustomerCache(cuit?: string): void {
  customerCache = [];
  cacheTimestamp = 0;
  if (cuit) {
    logger.info(`[colppy-cache] invalidado tras update de cliente ${cuit}`);
  } else {
    logger.info('[colppy-cache] invalidado manualmente');
  }
}
