# Módulo congelado: Cobros / Tesorería (cuentas)

**Congelado:** 2026-06-11 · **Decisión de producto:** la parte contable del
negocio sigue gestionándose en **Colppy**. Este código se retomará
eventualmente — **NO borrar**.

## Qué hay acá

Árbol espejo de `src/` (para revivir, basta mover cada carpeta de vuelta a su
ruta original):

| Acá | Ruta original | Qué es |
|---|---|---|
| `app/(dashboard)/cobros/` | `src/app/(dashboard)/cobros/` | Pantallas de recibos de cobranza (listado, nuevo, detalle/aprobar) |
| `app/(dashboard)/tesoreria/` | `src/app/(dashboard)/tesoreria/` | Dashboard de tesorería y ABM de cuentas (dependían 100 % de `/api/tesoreria/cuentas`) |
| `app/api/cobros/` | `src/app/api/cobros/` | API de recibos (crear/editar/aprobar, facturas pendientes por cliente) |
| `app/api/tesoreria/cuentas/route.ts` y `cuentas/[id]/route.ts` | ídem en `src/` | CRUD de cuentas de tesorería |
| `lib/cobros/` | `src/lib/cobros/` | `receipt.service` (retenciones, aplicación a facturas, asiento contable), helper de asientos y mapping de cuentas IIBB |

**OJO — esto NO se congeló y sigue vivo:**
- `src/app/api/tesoreria/cuentas/[id]/movimientos/` y `[id]/grafico/` (usan `BankTransaction`, funcionan).
- `src/app/api/tesoreria/cheques|operaciones|pagos|cobranzas|conciliacion`.
- Los componentes `src/components/tesoreria/*` (CheckManagementDialog, BankAccountDialog, etc.) y `TesoreriaTab` de Configuración (chequeras).

## Por qué se congeló

El código fue escrito contra un schema de Prisma que **nunca se aplicó**.
Generaba 42 errores de TypeScript y los endpoints crasheaban en runtime
(Prisma rechaza campos/modelos desconocidos). Como la contabilidad operativa
sigue en Colppy, se decidió congelar en vez de migrar.

Mecánica del congelado:
- Fuera de `src/app/` → Next ya no rutea: `/cobros` y `/tesoreria` devuelven 404.
- `src/_parked` está en el `exclude` de `tsconfig.json` → no entra al typecheck.
- No estaba linkeado en el sidebar, así que no hubo que quitar navegación.

## Qué necesita el schema para revivirlo

El código espera (ver errores de `npx tsc` al re-incluirlo):

1. **Modelo `Receipt` ampliado**: `pointOfSale` (string), `userId` + relación
   `user`, `totalApplied`, `totalWithholdings`, `totalCobrado` (Decimal),
   relación `journalEntry`, y `status` con un enum propio **`ReceiptStatus`**
   (hoy usa `PaymentStatus`).
2. **Modelos nuevos**: `ReceiptInvoiceApplication` (aplicación de recibo a
   facturas), `ReceiptWithholdingGroup` (retenciones agrupadas),
   `ReceiptPaymentMethod` (medios de pago del recibo).
3. **`Invoice.paidAmount`** (Decimal, default 0) — hoy existe en
   `PurchaseOrder` pero no en `Invoice`.
4. **Modelo `TreasuryAccount`** (cuentas de tesorería) — o refactorizar
   `api/tesoreria/cuentas/*` para usar el `BankAccount` existente, que es lo
   que ya usan movimientos/gráfico/operaciones.

Después: `prisma migrate` + mover las carpetas de vuelta + sacar
`src/_parked/**/*` del exclude + re-linkear en el sidebar si corresponde.
