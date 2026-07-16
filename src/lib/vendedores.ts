import type { Prisma } from '@prisma/client'

/**
 * Filtro canónico de "vendedor seleccionable": usuario activo y marcado como
 * vendedor.
 *
 * Por qué no alcanza `role`: el enum UserRole expresa nivel de permiso, no
 * función comercial. Todo el equipo es ADMIN, así que filtrar por role no
 * distingue a un vendedor de alguien de administración.
 *
 * Usar SOLO en selectores y filtros (dónde se elige o se filtra por vendedor).
 * NO usar para resolver el nombre de un vendedor en registros históricos: una
 * cotización o factura de alguien dado de baja tiene que seguir mostrando su
 * nombre.
 */
export const VENDEDOR_SELECCIONABLE = {
  status: 'ACTIVE',
  isVendedor: true,
} satisfies Prisma.UserWhereInput
