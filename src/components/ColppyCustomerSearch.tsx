/**
 * Componente: ColppyCustomerSearch
 * Buscador de clientes en tiempo real desde Colppy
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, Loader2, CheckCircle2, MapPin, Phone, Mail, DollarSign, RefreshCw, FileText } from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// TIPOS
// ============================================================================

export interface ColppyCustomer {
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
}

interface ColppyCustomerSearchProps {
  value: ColppyCustomer | null;
  onChange: (customer: ColppyCustomer | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ============================================================================
// COMPONENTE
// ============================================================================

export function ColppyCustomerSearch({
  value,
  onChange,
  placeholder = 'Buscar cliente por nombre o CUIT...',
  disabled = false,
}: ColppyCustomerSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<ColppyCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Búsqueda con debounce
  useEffect(() => {
    // Limpiar timer anterior
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Si el search term es muy corto, no buscar
    if (searchTerm.length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    // Esperar 300ms antes de buscar
    debounceTimer.current = setTimeout(() => {
      performSearch(searchTerm);
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchTerm]);

  // Realizar búsqueda
  const performSearch = async (search: string) => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/colppy/clientes?search=${encodeURIComponent(search)}&limit=20`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al buscar clientes');
      }

      const data = await response.json();
      setResults(data.customers || []);
      setShowDropdown(true);
    } catch (err: any) {
      console.error('Error buscando clientes:', err);
      setError(err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Seleccionar cliente
  const handleSelectCustomer = (customer: ColppyCustomer) => {
    onChange(customer);
    setSearchTerm('');
    setShowDropdown(false);
    setResults([]);
  };

  // Limpiar selección
  const handleClear = () => {
    onChange(null);
    setSearchTerm('');
    setResults([]);
  };

  // Formatear moneda
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Refrescar cache de clientes
  const handleRefreshCache = async () => {
    try {
      setRefreshing(true);
      const response = await fetch('/api/colppy/clientes', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Error al refrescar cache');
      }

      const data = await response.json();
      toast.success(`Cache actualizado: ${data.total} clientes cargados`);

      // Si hay una búsqueda activa, volver a buscar
      if (searchTerm.length >= 2) {
        performSearch(searchTerm);
      }
    } catch (err: any) {
      console.error('Error refrescando cache:', err);
      toast.error('Error al refrescar clientes');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Input de búsqueda */}
      {!value && (
        <div className="relative" ref={searchRef}>
          <div className="flex items-center justify-between mb-1">
            <Label htmlFor="customer-search" className="text-sm font-semibold">
              Cliente *
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRefreshCache}
              disabled={disabled || refreshing}
              className="h-7 px-2 text-xs"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              Refrescar
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              id="customer-search"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              className="pl-10 pr-10"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500 animate-spin" />
            )}
          </div>

          {/* Dropdown de resultados */}
          {showDropdown && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-auto">
              {loading && results.length === 0 && (
                <div className="p-4 text-center text-sm text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  <p className="font-medium">Cargando clientes de Colppy...</p>
                  <p className="text-xs mt-1 text-gray-400">
                    Primera carga puede tardar ~2 segundos
                  </p>
                </div>
              )}

              {!loading && error && (
                <div className="p-4 text-center text-sm text-red-600">
                  {error}
                </div>
              )}

              {!loading && !error && searchTerm.length < 2 && (
                <div className="p-4 text-center text-sm text-gray-500">
                  Escribí al menos 2 caracteres para buscar
                </div>
              )}

              {!loading && !error && searchTerm.length >= 2 && results.length === 0 && (
                <div className="p-4 text-center text-sm text-gray-500">
                  No se encontraron clientes
                </div>
              )}

              {results.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {results.map((customer) => (
                    <button
                      key={customer.id}
                      onClick={() => handleSelectCustomer(customer)}
                      className="w-full p-3 text-left hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {customer.name}
                          </p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            CUIT: {customer.cuit}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">
                              {customer.taxConditionDisplay}
                            </Badge>
                            {customer.city && (
                              <span className="text-xs text-gray-500">
                                {customer.city}{customer.province ? `, ${customer.province}` : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        {customer.saldo !== 0 && (
                          <div className="ml-2 text-right">
                            <p className={`text-xs font-medium ${customer.saldo < 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {formatCurrency(customer.saldo)}
                            </p>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tarjeta de cliente seleccionado */}
      {value && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-sm font-semibold">Cliente Seleccionado</Label>
            <button
              onClick={handleClear}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
              disabled={disabled}
            >
              Cambiar cliente
            </button>
          </div>

          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-1">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  {/* Nombre y CUIT */}
                  <div className="mb-2">
                    <h3 className="text-base font-bold text-gray-900 truncate">
                      {value.name}
                    </h3>
                    {value.businessName && value.businessName !== value.name && (
                      <p className="text-sm text-gray-600 truncate">
                        {value.businessName}
                      </p>
                    )}
                  </div>

                  {/* CUIT y Condición IVA */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-gray-700">
                      CUIT: <span className="font-medium">{value.cuit}</span>
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {value.taxConditionDisplay}
                    </Badge>
                  </div>

                  {/* Dirección */}
                  {(value.address || value.city) && (
                    <div className="flex items-start gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-gray-600">
                        {value.address && `${value.address}, `}
                        {value.city}
                        {value.province && `, ${value.province}`}
                      </span>
                    </div>
                  )}

                  {/* Contacto */}
                  <div className="space-y-1">
                    {value.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-600">{value.phone}</span>
                      </div>
                    )}
                    {value.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-600">{value.email}</span>
                      </div>
                    )}
                  </div>

                  {/* Saldo */}
                  {value.saldo !== 0 && (
                    <div className="mt-2 pt-2 border-t border-green-200">
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          Saldo en Colppy:{' '}
                          <span className={`font-semibold ${value.saldo < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(value.saldo)}
                          </span>
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Condición de Pago */}
                  <div className={`${value.saldo !== 0 ? 'mt-2' : 'mt-2 pt-2 border-t border-green-200'}`}>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-gray-400" />
                      <span className="text-sm text-gray-600">
                        Condición de pago:{' '}
                        <span className="font-semibold text-gray-900">
                          {value.paymentTerms}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
