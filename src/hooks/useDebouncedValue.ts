import { useEffect, useState } from 'react'

/**
 * Devuelve el valor con un retraso de `delay` ms desde el último cambio.
 * Sirve para no disparar una búsqueda por cada tecla.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
