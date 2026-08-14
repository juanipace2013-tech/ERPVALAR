# Auditoría de errores TypeScript — crm-valarg

**Fecha:** 2026-06-11 · **Comando:** `npx tsc --noEmit` · **Resultado:** **133 errores** (194 líneas de salida; el resto son líneas de detalle de cada error).

> Nota: ningún archivo fue modificado en esta pasada. Solo análisis.

## Distribución por código

| Código | Cantidad | Significado típico acá |
|---|---|---|
| TS2322 | 62 | Tipo no asignable (mayoría: `{}` de `settings` en Configuración + formatters de Recharts) |
| TS2339 | 33 | Propiedad inexistente (mayoría: modelos/campos Prisma que no están en el schema) |
| TS2345 | 13 | Argumento incompatible |
| TS2353 | 12 | Propiedad desconocida en objeto literal (queries Prisma inválidas) |
| TS18048 / TS18046 | 5 | Posible undefined / unknown |
| Otros (TS2552, TS2344, TS7006, TS2305, TS2551, TS2554) | 8 | Varios |

---

## Categoría A — RIESGO REAL EN RUNTIME (≈60 errores, 4 focos)

### A1. Módulo Cobros (recibos de cobranza) escrito contra un schema que NUNCA se aplicó — 33 errores

El código usa el modelo `Receipt` con campos `pointOfSale`, `totalApplied`, `totalWithholdings`, `totalCobrado`, `userId`, relaciones `invoiceApplications`, `withholdingGroups`, `paymentMethods`, `journalEntry`, modelos `ReceiptInvoiceApplication`, `ReceiptWithholdingGroup`, `ReceiptPaymentMethod` y enum `ReceiptStatus`. **Nada de eso existe en `prisma/schema.prisma`** (el `Receipt` real solo tiene `amount`, `collectionMethod`, `status: PaymentStatus`, etc.). También usa `Invoice.paidAmount`, que existe en `PurchaseOrder` pero **no** en `Invoice`.

**Consecuencia runtime:** Prisma lanza `ValidationError` ante cualquier campo desconocido en `select`/`include`/`update`. Las páginas `/cobros`, `/cobros/nuevo` y `/cobros/[id]` están cableadas a estos endpoints → **el módulo Cobros está roto hoy**: GET/POST `/api/cobros` crashean siempre.

| Archivo | Líneas | Códigos | Descripción | Módulo |
|---|---|---|---|---|
| `src/lib/cobros/receipt.service.ts` | 2, 88, 152, 170-172, 189, 249, 268-270, 281, 288, 293, 300, 327, 355, 368, 387 (19 err.) | TS2305, TS2353, TS2339, TS2345 | Todo el servicio opera contra modelos/campos inexistentes (`ReceiptStatus`, `pointOfSale`, `totalApplied`, `receiptInvoiceApplication`, `treasuryAccount`, `Invoice.paidAmount`…) | Cobranzas |
| `src/app/api/cobros/route.ts` | 81, 98, 109, 116-119 (11 err.) | TS2353, TS18048, TS2339 | `include: {user}` y `aggregate` sobre `totalApplied`/`totalCobrado`/`totalWithholdings` inexistentes | Cobranzas |
| `src/app/api/cobros/facturas-pendientes/route.ts` | 46, 59, 60 (3 err.) | TS2353, TS2339 | `select`/lectura de `Invoice.paidAmount` inexistente | Cobranzas |

### A2. Tesorería / Cuentas: modelo `TreasuryAccount` inexistente — 10 errores

`prisma.treasuryAccount` y `prisma.receiptPaymentMethod` no existen (el modelo real de cuentas es `BankAccount`). Las páginas `/tesoreria`, `/tesoreria/cuentas`, `/tesoreria/cuentas/nueva` y el selector de cuentas de `/cobros/nuevo` llaman a estos endpoints → **rotos en runtime** (`TypeError: Cannot read properties of undefined`).

| Archivo | Líneas | Códigos | Descripción | Módulo |
|---|---|---|---|---|
| `src/app/api/tesoreria/cuentas/[id]/route.ts` | 30, 73, 95, 126, 132, 137, 146 (7 err.) | TS2339 | GET/PUT/DELETE sobre `prisma.treasuryAccount` inexistente | Tesorería |
| `src/app/api/tesoreria/cuentas/route.ts` | 28, 84 (2 err.) | TS2339 | GET/POST ídem | Tesorería |
| `src/lib/cobros/receipt.service.ts` | 387 (contado en A1) | TS2339 | `tx.treasuryAccount` en transacción | Cobranzas |

### A3. Bugs puntuales con efecto real — 7 errores

| Archivo | Línea | Código | Descripción | Módulo | Efecto runtime |
|---|---|---|---|---|---|
| `.next/(dev/)types/validator.ts` (origen: `src/app/api/cai-config/[id]/route.ts:17-19`) | 855/846 | TS2344 ×2 | PUT recibe `params` sin `await` (Next 16 lo pasa como `Promise`) → `params.id` es `undefined` | Configuración / CAI | **Editar un talonario CAI está roto** (Prisma recibe `id: undefined`) |
| `src/lib/email/send-remito-email.ts` | 127, 137 | TS2339, TS2322 | Usa `prisma.caiRegistration` (no existe; el modelo es `CaiConfig`, con campos `caiExpirationDate`/`pointOfSale`, no `expiresAt`/`puntoVenta`) | Remitos / Email | Está dentro de un `try/catch` vacío → no crashea, pero **el PDF de remito enviado por email nunca incluye el CAI** (bug silencioso) |
| `src/components/configuracion/TesoreriaTab.tsx` | 112 | TS2552 | `catch (_error)` pero loguea `error` (nombre inexistente) | Configuración | **ReferenceError** dentro del catch cuando falla la carga de chequeras |
| `src/components/tesoreria/CheckManagementDialog.tsx` | 70 | TS2552 | Mismo patrón `_error` vs `error` | Tesorería / Cheques | **ReferenceError** en el manejo de errores |
| `src/components/clientes/TabFacturasAdeudadas.tsx` | 163 | TS2322 | `onClick={fetchFacturas}` donde la firma es `fetchFacturas(force?: boolean)` → recibe el MouseEvent como `force` (truthy) | Clientes | Menor: el botón "Reintentar" siempre fuerza refresh (probablemente la intención igual) |
| `src/components/tesoreria/BankAccountDialog.tsx` | 331 | TS2345 | Se pasa `number \| null` donde se espera `string \| number \| boolean` | Tesorería | Menor: posible `null` propagado a un handler de form |

---

## Categoría B — DESINCRONIZACIÓN CON PRISMA (tipo-only, sin riesgo runtime) — 10 errores

Acá el schema **sí** tiene los campos; lo desactualizado es la interface local del frontend.

| Archivo | Líneas | Código | Descripción | Módulo |
|---|---|---|---|---|
| `src/app/(dashboard)/remitos/[id]/editar/page.tsx` | 331 ×3, 332, 460, 462, 463, 464 (8 err.) | TS2339 | Interface local `DeliveryNote` sin el campo `supplier` (el schema y la API sí lo tienen — relación opcional en `DeliveryNote`) | Remitos |
| `src/app/(dashboard)/remitos/[id]/page.tsx` | 375 | TS2551 | Interface local sin `deliveryType` (existe en el schema, línea 1247) | Remitos |
| `src/lib/inventario/invoice-inventory.service.ts` | 67 | TS2322 | El tipo de retorno declarado (`StockMovementWithRelations[]`) exige relaciones `product`/`user` que la query no incluye | Inventario — **ver Categoría D: archivo sin importadores** |

**Fix:** agregar los campos a las interfaces locales (1 línea por campo). Trivial.

---

## Categoría C — TIPOS FALTANTES / TIPADO DÉBIL (funciona en runtime) — 76 errores

### C1. Cluster Configuración: `settings: Record<string, unknown>` — 51 errores, UNA causa raíz

Cada tab recibe `settings: Record<string, unknown>` y arma `useState({ campo: settings.x || '' })`. TS infiere `{}` para cada campo → todos los `value=` de los inputs fallan. **Un solo cambio por archivo** (tipar la prop o el estado inicial) elimina el cluster completo.

| Archivo | Errores | Líneas |
|---|---|---|
| `src/components/configuracion/ClientesProveedoresTab.tsx` | 18 | 106-378 (TS2322 `{}`) |
| `src/components/configuracion/DatosGeneralesTab.tsx` | 16 | 120-291 (TS2322 `{}`, incl. 264 `unknown`→ReactNode) |
| `src/components/configuracion/DatosImpositivosTab.tsx` | 15 | 103-300 (TS2322 `{}`) |
| `src/components/configuracion/TesoreriaTab.tsx` | 2 | 262, 275 (el 3.º del archivo es el bug A3) |

### C2. Cluster TalonariosTab: firma de `handleFieldChange` — 8 errores

`handleFieldChange(field, value: string | number)` recibe `CheckedState` (boolean) de los Checkbox. Líneas 340-423, TS2345. **Fix:** ampliar la firma a `string | number | boolean`. Un cambio.

### C3. Cluster Recharts: formatters de tooltips — 12 errores

Recharts tipa `value` como `number | undefined`; los formatters locales declaran `(value: number)`. Funciona en runtime (Recharts nunca pasa undefined en estos charts), es estrictamente cosmético.

| Archivo | Línea | Código | Módulo |
|---|---|---|---|
| `src/app/(dashboard)/analisis-crediticio/page.tsx` | 948 | TS2322 | Análisis crediticio |
| `src/components/dashboard/DashboardClient.tsx` | 779 | TS2322 | Dashboard |
| `src/components/dashboard/EnhancedBarChart.tsx` | 179 | TS2322 | Dashboard |
| `src/components/dashboard/EnhancedDonutChart.tsx` | 196 | TS2322 | Dashboard |
| `src/components/dashboard/InteractiveBarChart.tsx` | 140 | TS2322 | Dashboard |
| `src/components/dashboard/InvoicesChart.tsx` | 130 | TS2322 | Dashboard |
| `src/components/inventario/InventoryDashboard.tsx` | 209 | TS2322 | Inventario |
| `src/components/inventario/RotationABCTab.tsx` | 138 | TS2322 | Inventario |
| `src/components/dashboard/InteractiveBarChart.tsx` | 109 | TS2345 | Tab de período: `setState(string)` vs union literal |
| `src/components/dashboard/InvoicesChart.tsx` | 92, 105 | TS2345 ×2 | Ídem (período y collect/pay) |

(Los 3 últimos son `Tabs onValueChange` que entrega `string` a un estado tipado con union; cast o validación, trivial.)

### C4. Sueltos — 5 errores

| Archivo | Línea | Código | Descripción | Módulo |
|---|---|---|---|---|
| `src/app/(dashboard)/clientes/page.tsx` | 121 | TS2554 | `useRef<...>()` sin argumento — React 19 exige valor inicial (`useRef<...>(undefined)`) | Clientes |
| `src/hooks/use-toast.ts` | 154 | TS7006 | Parámetro `open` con any implícito | UI compartido |
| `src/components/tesoreria/BankOperationDialog.tsx` | 168 | TS18046 | `error` de tipo `unknown` en catch sin narrowing | Tesorería |
| `src/components/clientes/TabFacturasAdeudadas.tsx` | — | — | (contado en A3) | — |
| `src/components/configuracion/TesoreriaTab.tsx` / `CheckManagementDialog.tsx` | — | — | (contados en A3) | — |

---

## Categoría D — CÓDIGO MUERTO — 1 error

| Archivo | Línea | Código | Evidencia | Módulo |
|---|---|---|---|---|
| `src/lib/inventario/invoice-inventory.service.ts` | 67 | TS2322 | `processInvoiceCreationWithInventory` no tiene **ningún importador** en `src/` (grep sobre el nombre del archivo y de la función solo matchea el propio archivo) | Inventario/Facturación |

**Ojo:** el módulo Cobros (Categoría A1) NO es código muerto — las páginas `/cobros/*` existen y llaman a esas APIs. Es código *activo y roto*.

---

## Categoría E — RUIDO / DERIVADOS — 2 errores

| Archivo | Código | Descripción |
|---|---|---|
| `.next/dev/types/validator.ts` + `.next/types/validator.ts` | TS2344 ×2 | Archivos **generados** por Next; son el síntoma del bug real en `cai-config/[id]/route.ts` (A3). Se arreglan solos al corregir la route. No suprimir: son el único aviso de routes con firma vieja. |

No hay errores de imports/variables sin usar (eso lo cubre ESLint, no este tsconfig).

---

# Resumen ejecutivo

## Top 10 a arreglar primero (por riesgo real en módulos críticos)

| # | Qué | Por qué | Esfuerzo |
|---|---|---|---|
| 1 | **Decidir el destino del módulo Cobros** (`receipt.service` + `api/cobros/*`) | 33 errores; las páginas `/cobros/*` están cableadas y **crashean hoy**. O se aplica el schema que el código espera (migración: campos en `Receipt`, 3 modelos nuevos, enum, `Invoice.paidAmount`) o se retira/oculta el módulo | **Requiere refactor + decisión de producto** |
| 2 | **`api/tesoreria/cuentas/*` → `prisma.treasuryAccount`** | 9 errores; `/tesoreria/cuentas` y el selector de cuenta en `/cobros/nuevo` rotos. Decidir: ¿migrar a `BankAccount` o crear el modelo? | Moderado (si se mapea a `BankAccount`) |
| 3 | **`cai-config/[id]/route.ts`: `params` sin await** | Editar talonario CAI roto (afecta numeración de facturación) | Trivial (`{ params }: { params: Promise<{id:string}> }` + `await params`) |
| 4 | **`send-remito-email.ts`: `caiRegistration` → `CaiConfig`** | El email de remito sale sin CAI en el PDF, silenciosamente. Remitos es módulo crítico | Trivial-moderado (renombrar modelo + mapear `caiExpirationDate`/`pointOfSale`) |
| 5 | **`TesoreriaTab.tsx:112` y `CheckManagementDialog.tsx:70`: `_error` vs `error`** | ReferenceError dentro del catch: cuando algo falla, el manejo de error también falla | Trivial (2 líneas) |
| 6 | **Remitos: interfaces locales sin `supplier`/`deliveryType`** | 9 errores en módulo crítico; tipo-only pero ensucian el diff de remitos | Trivial |
| 7 | **`TabFacturasAdeudadas.tsx:163`: onClick pasa MouseEvent como `force`** | Comportamiento accidental (siempre force-refresh) | Trivial |
| 8 | **Cluster Configuración `settings` (51 err.)** | Mayor reducción de ruido con un cambio por archivo; hoy el tipado no ayuda nada en esas tabs | Trivial-moderado (tipar la prop `settings`) |
| 9 | **`BankAccountDialog.tsx:331`: `null` no manejado** | Posible null en form de cuenta bancaria | Trivial |
| 10 | **`InvoicesChart`/`InteractiveBarChart`: `setState(string)`** | Tabs de período sin validar contra la union | Trivial |

## Reducción por cluster (si se arregla la causa raíz)

| Cluster | Errores eliminados | Esfuerzo |
|---|---|---|
| Configuración `settings: Record<string, unknown>` (4 tabs) | **51** | Trivial-moderado |
| Cobros vs schema Prisma (incl. `treasuryAccount`) | **42** | Requiere refactor |
| Recharts formatters + setState de Tabs | **12** | Trivial |
| Remitos interfaces locales | **9** | Trivial |
| TalonariosTab `handleFieldChange` | **8** | Trivial (1 firma) |
| cai-config params (incl. los 2 validators de `.next`) | **2** | Trivial |
| Sueltos (catch `error`, useRef, use-toast, etc.) | **8** | Trivial |
| `invoice-inventory.service` (muerto) | **1** | Trivial (borrar archivo) |

Con los clusters triviales (~80 errores) el conteo baja de 133 a ~53 en una tarde; el resto (~42) depende de la decisión sobre Cobros.

## Qué ignorar / suprimir y por qué

- **`.next/*/validator.ts`**: no suprimir ni excluir — son generados y desaparecen al arreglar la route origen. Excluirlos taparía futuras routes con firma vieja.
- **Recharts formatters (12)**: si no se quiere tocar, son los únicos candidatos razonables a convivir — cero riesgo runtime. Alternativa barata: tipar `value?: number` con fallback.
- **Nada más amerita supresión**: el resto o es bug real o se elimina con fixes triviales. No se recomienda `// @ts-expect-error` en los clusters de Prisma — taparía un módulo roto de verdad.

## Observación final

El patrón dominante no es "deuda de tipos" dispersa: son **dos features (Cobros y Tesorería/Cuentas) mergeadas sin su migración de schema**, más un cluster de tipado débil en Configuración. Vale la pena revisar si existe una rama/migración pendiente de Cobros antes de decidir, porque el código del servicio está completo (retenciones, aplicación a facturas, asiento contable) — parece trabajo terminado al que solo le falta el schema.
