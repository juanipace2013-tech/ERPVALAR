/**
 * Convierte un string "YYYY-MM-DD" del frontend (o un Date) a un Date
 * pineado a 12:00 UTC del mismo día calendario.
 *
 * Evita el bug donde "2026-05-04" se interpreta como UTC midnight y al
 * renderizar en Argentina (UTC-3) muestra el día anterior.
 *
 * - String "YYYY-MM-DD" o ISO → toma los primeros 10 chars, agrega T12:00:00 UTC.
 * - Date → toma el día calendario en UTC y lo pinea a 12:00 UTC.
 *   ⚠️ Para datos del frontend, preferí pasar el string crudo en vez del Date.
 * - null/undefined → ahora (instante real, no se pinea).
 */
export function parseCivilDate(input: string | Date | undefined | null): Date {
  if (input == null) return new Date();
  if (input instanceof Date) {
    const y = input.getUTCFullYear();
    const m = input.getUTCMonth();
    const d = input.getUTCDate();
    return new Date(Date.UTC(y, m, d, 12, 0, 0, 0));
  }
  const dateOnly = input.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const fallback = new Date(input);
    return new Date(
      Date.UTC(
        fallback.getUTCFullYear(),
        fallback.getUTCMonth(),
        fallback.getUTCDate(),
        12,
        0,
        0,
        0
      )
    );
  }
  return new Date(`${dateOnly}T12:00:00.000Z`);
}
