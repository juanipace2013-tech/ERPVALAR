# Factura E (exportación) vía WSFEX — plan de implementación

> Diseño del 2/10/2026 (lectura de código + manual WSFEX + Exporta Simple). Todavía NO implementado. Primer caso: CLAUGER CHILE SPA, OC 90855-196-049, VAL-2026-3507 (3 × 2228 12 GENEBRE, USD 2.078,88 FOB).

## Estimación

Fase 1, Factura E por Exporta Simple completa: unos 6,5 días hábiles de desarrollo.
- Fase 0, lectura en prod con arca-fex-check y autorización de wsfex en WSASS de homo: 0,5 día (depende de Santiago para WSASS).
- 1a, cliente WSFEX, parámetros, emitir-exportacion, tests unitarios y matriz de homologación por script: 1,5 días.
- 1b, modelo Prisma FacturaExportacion, servicio, endpoint con dryRun y diálogo: 2 días.
- 1c, PDF letra E, Colppy MANUAL con vinculación del colppyId, arreglo del sync para E, guards y textos: 1,5 días.
- 1d, prueba completa local contra homo, deploy agrupado fuera de horario con db push y primera emisión supervisada: 1 día.

Fases siguientes:
- Fase 2, NC/ND E (Exporta Simple y general): unos 1,5 días.
- Fase 3: despachante con permiso de embarque, 1 día; Colppy por API, unos 2 días (después de la definición de la contadora).
- Plan B, registrar en el ERP una E emitida en RCEL (PV 9): 0,5 día.

En calendario, todo depende de que el DES esté generado, de las respuestas del dueño y de la contadora, y de confirmar el perfil Imp/Exp. Si el envío a Chile tiene que salir antes de unos 8 a 10 días hábiles, conviene emitir esa primera Factura E a mano en RCEL (PV 9) y estrenar el ERP con la siguiente.

## Decisiones del negocio

- Primer envío a Chile: ¿lo facturamos desde el ERP o a mano en ARCA? Desde el ERP hay que esperar unos 6 a 7 días hábiles de desarrollo y pruebas. A mano es en "Comprobantes en línea", punto de venta 9, y el ERP queda para los envíos siguientes.
- Incoterm del envío a Chile: ¿FCA (entregamos al courier y el flete lo paga el cliente) o DAP/CPT (el flete lo pagamos nosotros)? DDP no se recomienda. Si el flete lo pagamos nosotros, ¿se lo cobramos al cliente como línea aparte "Flete internacional"?
- Si en la factura va flete o seguro, ¿suma para la comisión del vendedor? Propuesta: no, la comisión se calcula solo sobre las válvulas.
- Tipo de cambio de la factura: propuesta usar el que publica ARCA (dólar oficial del día hábil anterior) y declarar que el cliente paga en dólares. Hay que confirmarlo con la contadora, porque Exporta Simple habla del tipo comprador.
- Colppy: propuesta que Caro cargue a mano cada Factura E (una sola vez crea el cliente del exterior y el talonario E 0010) y después pegue el número de Colppy en el ERP antes de las 9:00. ¿Cómo quiere la contadora que quede registrada (exportación exenta) y con qué tipo de cambio?
- Qué texto va como "Forma de pago" (por ejemplo "Transferencia anticipada 100%") y confirmar que la factura sale en español.
- Confirmar dos cosas antes de emitir: que el perfil Importador/Exportador figura dado de alta en Sistema Registral, y que el DES ya está generado en el portal con el mismo FOB que vamos a facturar, al centavo. Si los montos cambian, hay que corregir el DES primero.
- ¿Habilitamos el servicio wsfex en el certificado de pruebas (WSASS) para probar en homologación antes de la factura real? Recomendado; son unos 5 minutos que hace Santiago.
- ¿Hace falta remito R (talonario 6) para el retiro del courier, o alcanza la guía del OLE?
- Para exportaciones futuras con despachante: ¿facturamos antes de tener el permiso de embarque o después, con su número? No es urgente; define la Fase 3.

## Riesgos

- Error 1668 (exportador registrado): Exporta Simple exige Tipo_expo=1, y para ese tipo WSFEX valida que el emisor esté registrado como exportador. ARCA dice que Exporta Simple no requiere el registro, pero el manual no documenta la excepción. La memoria se contradice: el 2/10 Santiago dice que el perfil está aprobado; el índice dice 'falta aprobación'. Hay que confirmarlo en Sistema Registral. Si se rechaza con 1668 o 2027, no se pierde nada: un rechazo no consume número.
- Exporta Simple no se puede probar de punta a punta en homologación: el DES solo existe en producción (errores 2059/2060/2022). La primera FEXAuthorize real con 2401/2402 es la prueba de verdad y es irreversible: solo se corrige con NC E, que además mueve el saldo FOB del DES. Mitigación: dryRun revisado contra el portal y una sola emisión supervisada.
- Permiso_existente='N' para Exporta Simple se DEDUJO: 'S' exige Permisos (1720) y 2056 prohíbe Permisos con Exporta Simple. Ningún documento lo dice textual. Si fuera vacío, el error es un rechazo, no un CAE malo. Se puede confirmar leyendo con FEXGetCMP una E emitida por RCEL en PV 9, si el método la devuelve (no confirmado).
- Formato del N° de DES dudoso: el manual dice alfanumérico de 11 caracteres y el ejemplo oficial '2133ECSI12' tiene 10. Se valida en forma laxa (8 a 11 caracteres alfanuméricos) y se copia exactamente como lo muestra el portal.
- El FOB de 2402 tiene que ser IGUAL al del DES (2022/2060) y ≤ Imp_total (2021). Con CPT o DAP, el total incluye el flete. Si el DES se cargó con otros precios o descuentos, ARCA rechaza. Puede que 2060 controle también otros datos del DES (cliente, moneda): el manual no lo detalla.
- Parámetros sacados de documentación de terceros, sin confirmar con ARCA: Dst_cmp Chile=208, CUIT país Chile 55000000034 para persona jurídica, y para persona física las fuentes se contradicen (50000000034 vs 50000000032), UMed 7=unidades, lista de Incoterms estilo 2000 (que incluye 'DES' = Delivered Ex Ship; no confundir con el documento DES). Se resuelve con las llamadas de solo lectura FEXGetPARAM_* antes de programar.
- Homologación poco representativa: usa el CUIT personal 20340026463 con perfil monotributo (pueden aparecer observaciones 14/15 y 1668 que no aplican a VAL ARG), y no sé qué PV de exportación acepta homo. Requiere autorizar wsfex en WSASS.
- Tipo de cambio: con CanMisMonExt='S' el TC tiene que ser exactamente el oficial de ARCA (1602-1605). El TC billete del diálogo actual sería rechazado. FEXGetPARAM_Ctz usa fecha YYYY-MM-DD, a diferencia del resto (yyyymmdd). CanMisMonExt no va en NC/ND. La contadora puede querer otro TC para los libros.
- Idempotencia: si después de un timeout se envía un Cmp.Id NUEVO, se puede autorizar dos veces la misma venta. El diseño guarda el Id antes de llamar, reintenta con el mismo Id y bloquea emisiones mientras haya una INCIERTA. Un error en esa lógica es el riesgo técnico más caro.
- Colppy: si Caro carga la E a mano y no se vincula el colppyId, el sync de las 9:00 hoy la toma como tipo 1 y crea una Invoice duplicada y un cliente fantasma con el CUIT país. Por eso hay que arreglar arcaCbteTipo para E en el mismo deploy. Hasta que se cargue en Colppy, el stock y el libro IVA no ven la exportación.
- Fechas: toCbteFch usa la zona horaria del servidor. Si el VPS está en UTC, una factura emitida a la noche sale con el día siguiente. Dentro de los ±5 días que acepta ARCA (1500), pero no coincide con issueDate. Para la E se calcula explícitamente en hora AR.
- Topes de Exporta Simple: la RGC 5846/2026 los eliminó para bienes con derecho de exportación 0% (válvulas 8481 según la memoria). No está confirmado que las validaciones 2020/2026 de WSFEX ya estén actualizadas; el primer pedido es chico, así que el impacto es bajo.
- Exporta Simple exige una factura por operación y por DES: facturar en partes una cotización implica un DES por factura. El diálogo no debe permitir dos E sobre el mismo DES con saldo.
- Hoy la NC sobre una E solo está frenada por casualidad (receptorDesdeCondicion tira error). Sin el guard explícito, un refactor podría emitir una NC B por WSFE contra una factura tipo 19.
- Deploy: next build corta la app 2-3 minutos. Agrupar en un solo deploy fuera de horario. El db push en prod lo corre Santiago por SSH; los writes remotos de Claude a veces los bloquea el clasificador.
- Riesgo menor: el QR usa el host afip.gob.ar en lugar de arca.gob.ar. La especificación de QR no define tipoDocRec/nroDocRec para un receptor del exterior; omitirlos es lo que la especificación permite.

## Plan

FACTURA E (tipo 19) VÍA WSFEX EN EL ERP: PLAN DE IMPLEMENTACIÓN
Raíz del repo: C:/Users/santi/crm-valarg. Solo hice lectura de código y memoria. No cambié archivos ni hice llamadas a ARCA.

== 0. Qué verifiqué y principios ==

Lo que ya existe:
- config.ts tiene solo las URLs de wsaa y wsfe.
- Homologación se elige por variables de entorno (ARCA_ENV=homo, ARCA_CUIT=20340026463, ARCA_CERT_PATH y ARCA_KEY_PATH apuntando a /home/deploy/afip/homo/valarg-homo.{crt,key}, ARCA_PUNTO_VENTA=1). No hay variables separadas para el certificado de homo y no hacen falta: alcanza con agregar la URL de wsfex. Lo que falta es autorizar el servicio "wsfex" al certificado valargerphomo en WSASS.
- wsaa.ts guarda el ticket por servicio, así que getTicketAcceso('wsfex') ya funciona (ta-wsfex-prod.json / ta-wsfex-homo.json).

Según la memoria del 2/10:
- Exporta Simple está adherido y delegado a Santiago.
- PV 9 es RCEL de exportación (manual) y PV 10 es el de Web Services.
- Santiago dice que el perfil Importador/Exportador ya está aprobado. Una línea más vieja del índice dice "falta aprobación", así que hay que confirmarlo.

Principios:
(a) La E va por un camino propio: no pasa por sendQuoteToColppy, SendToColppyDialog ni las dos rutas A/B duplicadas, porque todo eso asume letra A/B, IVA 21 y Colppy.
(b) wsfe.ts y emitir.ts (en vivo desde 1/10) no se tocan, salvo un guard explícito en NC.
(c) Idempotencia: el Cmp.Id se guarda ANTES de llamar a ARCA.
(d) Si no está seteada ARCA_PUNTO_VENTA_EXPO, todo queda apagado.
(e) Los guards actuales contra clientes del exterior siguen (protegen WSFE). Solo cambia el texto, que ahora apunta a "Emitir Factura E".

== 1. Archivos NUEVOS ==

1) C:/Users/santi/crm-valarg/src/lib/arca/wsfex.ts: cliente SOAP de WSFEX.
- NS 'http://ar.gov.afip.dif.fexv1/', SOAPAction = NS + método, ticket 'wsfex', reutiliza postSoap y ArcaError.
- Copia mínima de los helpers esc/tag/ensureArray/dig. wsfe.ts no se refactoriza ahora.
- Mapa EXPLÍCITO de nombres de hijos: Permisos→Permiso, Cmps_asoc→Cmp_asoc, Items→Item, Opcionales→Opcional, Actividades→Actividad. Quitar la 's' final daría 'Cmps_aso' y 'Opcionale'.
- authXml(extra) agrega Pto_venta y Cbte_Tipo DENTRO de <Auth> solo para FEXGetLast_CMP.
- El parser ignora FEXErr y FEXEvents cuando el código es 0.
- Exports:
  - Puros: buildFexAuthorizeBody(cmp) en el orden del XSD (Id, Fecha_cbte, Cbte_Tipo, Punto_vta, Cbte_nro, Tipo_expo, Permiso_existente, Permisos, Dst_cmp, Cliente, Cuit_pais_cliente, Domicilio_cliente, Id_impositivo, Moneda_Id, Moneda_ctz, CanMisMonExt, Obs_comerciales, Imp_total, Obs, Cmps_asoc, Forma_pago, Incoterms, Incoterms_Ds, Idioma_cbte, Items, Opcionales, Fecha_pago, Actividades) y parseFexAuthorizeResult.
  - Llamadas: fexDummy, fexGetLastCmp(tipo, pv), fexGetLastId, fexAuthorize (no tira excepción ante 'R'), fexGetCmp(tipo, pv, nro) (devuelve null con 1020), fexGetParamCtz('DOL', fecha 'YYYY-MM-DD'), fexGetParam(tabla), fexCheckPermiso(id, dstMerc).

2) C:/Users/santi/crm-valarg/src/lib/arca/fex-params.ts: constantes y mapeos.
- FEX_CBTE {19, 20, 21}, TIPO_EXPO {1, 2, 4}, IDIOMA {1, 2, 3}, FEX_OPC {DES:'2401', FOB:'2402'}, UMED_UNIDADES = 7.
- DST_PAIS por ISO (CL: 208), DST_CUIT por ISO + tipo de persona (CL BUSINESS: 55000000034).
- INCOTERMS_PERMITIDOS: para Exporta Simple FCA, FOB, CPT, CIP, DAP (sin EXW ni DDP).
- receptorExportacion(customer) devuelve {cliente, domicilio, dstCmp, cuitPais, idImpositivo} o un error con la lista de datos faltantes.
- Los valores se cargan con la salida del script de chequeo (punto 9) y llevan un comentario con la fecha en que se consultaron.

3) C:/Users/santi/crm-valarg/src/lib/arca/emitir-exportacion.ts: emisión.
- buildFexRequest(input, numero, id) es PURA y valida todo lo de la sección 6.
- emitirExportacion(input, persistencia) hace el ciclo lock → número → Id → reserva → FEXAuthorize → recuperación (sección 7).
- Devuelve la misma unión ok/rechazo que emitirComprobante, más fexId y reproceso.
- La fecha se calcula en America/Argentina/Buenos_Aires. No se usa toCbteFch, que toma la zona horaria del servidor.

4) C:/Users/santi/crm-valarg/src/lib/facturacion/factura-exportacion.ts: servicio de negocio.
- Carga la cotización y el cliente, arma los ítems en USD sin IVA (bonificación como monto) y llama a emitirExportacion.
- En una transacción Prisma: Invoice + InvoiceItems (taxRate 0) + vínculo con FacturaExportacion + CotizacionFactura + cantidadFacturada + estado de la cotización.
- Después: sincronizarComisionesDeQuote y archivarFacturaEnSharePointBg.
- Si falla el guardado, la FacturaExportacion queda AUTORIZADA con invoiceId null. Esa es la "huérfana" que se resuelve con el script de reconciliación, sin perder el CAE.

5) C:/Users/santi/crm-valarg/src/app/api/quotes/[id]/factura-exportacion/route.ts
- GET (prellenado): chequeo de datos del cliente, ítems pendientes, cotización DOL de ARCA con su fecha, PV configurado y valores por defecto.
- POST (emitir), con la misma sesión y roles que generate-invoice.
- POST con dryRun=true: devuelve el Cmp/XML exacto sin llamar a FEXAuthorize. Sirve para revisar la primera emisión real.
- Lo usan la cotización y el tablero de facturación, mandando los ítems elegidos.

6) C:/Users/santi/crm-valarg/src/components/quotes/FacturaExportacionDialog.tsx: diálogo (sección 5).

7) C:/Users/santi/crm-valarg/src/app/api/facturas/[id]/colppy-id/route.ts
- PATCH para pegar a mano el colppyId de la factura y, si no lo tiene, el del cliente.
- Pasa colppySyncStatus de 'MANUAL' a 'OK'.

8) C:/Users/santi/crm-valarg/scripts/arca-fex-check.ts: chequeo de SOLO LECTURA, calcado de arca-check.ts.
- FEXDummy, ticket wsfex, FEXGetPARAM_PtoVenta, FEXGetLast_CMP 19/20/21 en PV 10, FEXGetLast_ID, Ctz DOL.
- Tablas MON, Cbte_Tipo, Tipo_Expo, Incoterms, Idiomas, UMed, DST_pais (filtrado Chile), DST_CUIT (filtrado Chile), Opcionales.
- Opción --cmp tipo:pv:nro para FEXGetCMP. Si ARCA devuelve también los comprobantes emitidos por RCEL en PV 9, vemos exactamente cómo RCEL arma Permiso_existente y los opcionales.

9) C:/Users/santi/crm-valarg/scripts/arca-fex-prueba.ts: emisiones de homologación. Se niega SIEMPRE si ARCA_ENV=prod (no hay flag para saltearlo). Arma la matriz de pruebas de la sección 12.

10) C:/Users/santi/crm-valarg/scripts/arca-fex-reconciliar.ts: para filas PENDIENTE, INCIERTA o huérfanas.
- Hace FEXGetCMP y, si hace falta, reenvía el mismo Id.
- Con --apply crea la Invoice que falte.

11) Tests:
- C:/Users/santi/crm-valarg/tests/unit/arca-wsfex.test.ts
- C:/Users/santi/crm-valarg/tests/unit/factura-exportacion.test.ts
- Un XML de referencia en C:/Users/santi/crm-valarg/tests/fixtures/fex-chile-exporta-simple.xml

== 2. Archivos MODIFICADOS ==

- src/lib/arca/config.ts:
  - URLS.wsfex: prod https://servicios1.afip.gov.ar/wsfexv1/service.asmx, homo https://wswhomo.afip.gov.ar/wsfexv1/service.asmx.
  - wsfexUrl y puntoVentaExportacion = Number(ARCA_PUNTO_VENTA_EXPO) || null. NO se agrega a la lista de variables obligatorias.
- prisma/schema.prisma: modelo nuevo FacturaExportacion y back-relation Invoice.exportacion (sección 3).
- src/lib/facturacion/factura-pdf-data.ts y src/lib/pdf/factura-generator.ts: soporte de letra E (sección 8).
- src/lib/sharepoint/facturas-emitidas.ts: verificar que el nombre salga "Factura E 0010-00000001 CLIENTE.pdf" en la misma carpeta "MM AAAA".
- src/lib/facturacion/sync-colppy.ts:
  - arcaCbteTipo: letra E → 19 (FAV), 21 (NC), 20 (ND), y buscar por PV 10 + número. Hoy E cae en 1 y crearía una Invoice duplicada.
  - Si la factura de Colppy coincide con una Invoice emitidaPor 'ARCA' con cbteTipo 19/20/21: vincular, no crear cliente fantasma con el CUIT país, y no degradar el estado (misma rama que resolverSyncArca).
- src/app/(dashboard)/cotizaciones/[id]/ver/page.tsx (botones de las líneas 863/886, montaje en 2117) y src/app/(dashboard)/facturacion/page.tsx (1103): si esClienteExterior(customer), abrir FacturaExportacionDialog en vez de SendToColppyDialog.
- src/app/api/facturacion/board/route.ts: agregar al select country, taxIdExterior, address, city y type.
- src/components/quotes/SendToColppyDialog.tsx: el cartel rojo pasa a decir "Para clientes del exterior usá Emitir Factura E".
- src/app/(dashboard)/facturas/[id]/page.tsx:
  - Tarjeta "Exportación" (régimen, DES, FOB, Incoterm, destino, PV 0010, Id FEX).
  - Estado Colppy 'MANUAL' con campo para pegar el colppyId; sin el botón "Reintentar Colppy".
  - Botón NC oculto para cbteTipo 19 hasta la Fase 2.
- src/lib/facturacion/nota-credito-arca.ts: guard explícito al principio. Si inv.cbteTipo es 19, 20 o 21, lanzar "NC de exportación: usar NC E (WSFEX)". Hoy solo la frena por casualidad receptorDesdeCondicion.
- src/app/api/facturas/[id]/reenviar-colppy/route.ts: rechazar si colppySyncStatus === 'MANUAL'.
- src/app/(dashboard)/remitos/nuevo/page.tsx (regex de la línea 382): aceptar E-dddd-dddddddd.
- Textos viejos de "Factura E no disponible": src/lib/cliente-exterior.ts:1-4, clientes/nuevo/page.tsx:389, ver/page.tsx:1474-1478 y los mensajes de los guards (generate-invoice:123, send-to-colppy:133, colppy.ts:1690).
- Opcional, cosmético: describeCbteTipo en emitir.ts con 19/20/21.
- Fuera de alcance, pero hay que avisarlo: src/app/(dashboard)/facturas/nueva/page.tsx:443 ofrece "Factura E (Exportación)" en una pantalla vieja sin POST.

== 3. Modelo de datos (Prisma 5.22, db push aditivo en prod por el VPS) ==

Modelo nuevo FacturaExportacion (@@map "facturas_exportacion"). Sirve a la vez de diario de idempotencia y de datos de exportación 1:1 con Invoice:

| Campo | Tipo | Contenido |
|---|---|---|
| id | String cuid | |
| fexId | BigInt @unique | Cmp.Id enviado |
| cbteTipo | Int | 19/20/21 |
| puntoVenta | Int | 10 |
| cbteNumero | Int | |
| estado | String | PENDIENTE, AUTORIZADA, RECHAZADA, INCIERTA |
| regimen | String | 'EXPORTA_SIMPLE' o 'DESPACHANTE' |
| tipoExpo | Int @default(1) | |
| desNumero | String? | |
| fobUSD | Decimal(15,2)? | |
| permisoExistente | String? | 'S', 'N' o '' |
| permisos | Json? | [{idPermiso, dstMerc}] |
| dstCmp | Int | |
| cuitPais | String? | |
| idImpositivo | String? | |
| domicilio | String | |
| incoterm | String? | |
| incotermDs | String? | |
| formaPago | String? | |
| idioma | Int @default(1) | |
| monedaCtz | Decimal(12,6) | |
| canMisMonExt | String? | |
| obsComerciales | String? @db.Text | |
| asociadoInvoiceId | String? | Para NC/ND E |
| request | Json | Cmp completo enviado: reproceso, reimpresión, NC |
| response | Json? | |
| errores | String? @db.Text | |
| reproceso | Boolean @default(false) | |
| quoteId | String? | |
| invoiceId | String? @unique | Relación con Invoice |
| createdById | String | |
| createdAt / updatedAt | DateTime | |

Restricciones e índices: @@unique([puntoVenta, cbteTipo, cbteNumero]) y @@index([desNumero]).

Cómo queda la Invoice de una E:
- invoiceType 'E', transactionType SALE, emitidaPor 'ARCA', pointOfSale 10, cbteTipo 19, cbteNumero N.
- invoiceNumber 'E-0010-0000000N'. Las NC/ND serán 'NCE-0010-…' y 'NDE-0010-…'.
- currency USD, subtotal = total, taxAmount 0, exchangeRate = Moneda_ctz.
- docTipo null y docNro = Id_impositivo (RUT).
- qrUrl, arcaObservaciones (Motivos_Obs), colppySyncStatus 'MANUAL'.

No hace falta cambiar Customer ni Quote para la v1. Opcional más adelante: Customer.incotermDefault y formaPagoExportacion.

== 4. Request para el caso real (Chile, Exporta Simple) ==

Cabecera:
- Id = max(FEXGetLast_ID, max fexId en la DB) + 1
- Fecha_cbte = hoy en hora AR (yyyymmdd)
- Cbte_Tipo 19, Punto_vta 10, Cbte_nro = FEXGetLast_CMP(19, 10) + 1 (hoy da 1)
- Tipo_expo 1, Permiso_existente 'N', SIN <Permisos>

Receptor:
- Dst_cmp 208 (confirmar con DST_pais)
- Cliente = businessName o name (máx. 200)
- Cuit_pais_cliente 55000000034 si es persona jurídica (confirmar con DST_CUIT)
- Domicilio_cliente = dirección + ciudad + país (máx. 300)
- Id_impositivo = taxIdExterior (RUT tal como se cargó)

Moneda:
- Moneda_Id 'DOL', Moneda_ctz = FEXGetPARAM_Ctz('DOL')
- CanMisMonExt 'S' si el cliente paga en dólares

Totales, condiciones e ítems:
- Imp_total = suma de Pro_total_item, calculada en centavos enteros
- Forma_pago (máx. 50), Incoterms, Incoterms_Ds = lugar (máx. 20), Idioma_cbte 1
- Cada ítem: Pro_codigo = sku, Pro_ds, Pro_qty, Pro_umed 7, Pro_precio_uni (USD), Pro_bonificacion = MONTO del descuento, Pro_total_item = redondeo a 2 de (qty × precio − bonificación)
- Con CPT o DAP, flete y seguro van como línea aparte

Opcionales: 2401 = N° de DES (sin espacios, en mayúsculas) y 2402 = FOB con dos decimales y punto ("1234.50").

== 5. Flujo de pantalla (FacturaExportacionDialog) ==

Se abre con "Emitir Factura E" desde la cotización o el tablero cuando el cliente es del exterior.

1. Chequeo previo (bloqueante):
   - Razón social, domicilio y ciudad, país con código ARCA, RUT o CUIT país, cotización en USD y PV de exportación configurado.
   - Link a "Editar cliente" si falta algo.
2. Ítems:
   - Líneas pendientes de la cotización con cantidad editable (como hoy), precio USD y Dto %, SIN columna de IVA.
   - Botón "Agregar línea de flete o seguro": línea manual que no comisiona.
3. Exportación:
   - Régimen: Exporta Simple (default). "Con despachante" visible pero deshabilitado en la v1.
   - N° de DES y "FOB del DES (USD)", con el aviso "Generá primero el DES en portal.exportasimple.gob.ar con el mismo FOB".
   - Incoterm (select) y lugar.
   - Forma de pago: texto con default.
   - País destino: solo lectura, sale del cliente.
   - Observaciones comerciales: opcional.
   - Idioma: Español, fijo en la v1.
4. Moneda:
   - USD fijo.
   - TC ARCA en solo lectura, con su fecha.
   - Tilde "El cliente paga en dólares" (CanMisMonExt), default según la decisión que se tome.
5. Resumen:
   - Total USD, FOB, diferencia (flete) y equivalente en ARS solo informativo.
   - Aviso de operación irreversible: "Emite la Factura E en ARCA, PV 0010. Para anularla hace falta una NC E, que además mueve el saldo del DES. No se carga en Colppy: hay que cargarla a mano."
6. Botones:
   - "Vista previa": dryRun, muestra el Cmp completo.
   - "Emitir Factura E": pide confirmación.
   - Al terminar, toast con número y CAE, link a /facturas/[id] y al PDF.

== 6. Validaciones ==

Todas en funciones puras y con test. El servidor es la autoridad; el diálogo las repite para avisar antes.

Cliente:
- esClienteExterior.
- Cliente de 1 a 200 caracteres.
- Domicilio no vacío, hasta 300 caracteres.
- dstCmp mapeado.
- Al menos uno de cuitPais o idImpositivo (error 1580).

Configuración, moneda y fecha:
- ARCA_PUNTO_VENTA_EXPO seteado.
- Cotización en USD (v1).
- Moneda_ctz > 0.
- Fecha_cbte = hoy AR (error 1500).

Ítems:
- Al menos 1 ítem; cantidad ≤ pendiente; precio > 0.
- Bonificación entre 0 y precio × cantidad (1811/1812).
- Total del ítem dentro de tolerancia (1815).
- Imp_total igual a la suma (1610).
- Pro_ds hasta 4000 y Pro_codigo hasta 50 caracteres.

Condiciones:
- Forma_pago obligatoria, hasta 50 caracteres (1620).
- Incoterm obligatorio y dentro de la lista permitida (1640).
- Incoterms_Ds hasta 20 caracteres.
- Obs_comerciales hasta 4000 caracteres.

Exporta Simple:
- DES normalizado con /^[0-9A-Z]{8,11}$/. La regla es laxa a propósito: el manual dice 11 caracteres y el ejemplo oficial tiene 10.
- FOB > 0, con 2 decimales, ≤ Imp_total (2021).
- FOB de la factura == "FOB del DES" ingresado, al centavo (2022/2060). Si no coinciden, se bloquea con mensaje claro.
- Con Incoterm FCA o FOB, FOB == Imp_total. Si no, error "una línea de flete solo corresponde con CPT, CIP o DAP".
- Moneda DOL, Tipo_expo 1, Permiso_existente 'N' y sin Permisos (2011/2016/2056).
- El DES no puede estar ya usado en otra E AUTORIZADA con saldo FOB neto > 0 (control en la DB).

Despachante (Fase 3):
- 'S' exige al menos un permiso con formato /^\d{5}[A-Z]{2}[A-Z0-9]{2}\d{6}[A-Z]$/ y Dst_merc.
- Opcionalmente se valida con FEXCheck_Permiso.
- Sin los opcionales 2401/2402.

NC/ND E (Fase 2):
- Permiso_existente vacío.
- Sin CanMisMonExt (1605).
- Cmps_asoc con exactamente 1 comprobante: {19, 10, nro, 30715373579}.
- En Exporta Simple: solo el opcional 2402, nunca el 2401 (2057), y FOB ≤ FOB original (2023).

Concurrencia: no se puede emitir si hay otra FacturaExportacion PENDIENTE o INCIERTA en el PV 10.

== 7. Emisión, idempotencia y recuperación ==

1. Lock en memoria 'wsfex', uno solo: el Id es único por CUIT y el volumen es mínimo. Además, las restricciones únicas de la DB atajan cualquier otro proceso (scripts).
2. Número = FEXGetLast_CMP + 1. Id = max(FEXGetLast_ID, máximo fexId en la DB) + 1.
3. Se arma el request puro y se INSERTA FacturaExportacion en estado PENDIENTE (con request y fexId) ANTES de llamar a ARCA.
4. FEXAuthorize:
   - Resultado 'A' con CAE: AUTORIZADA, con Motivos_Obs como observaciones.
   - 'R' o FEXErr distinto de 0: RECHAZADA con los errores. Se guarda para auditoría; no consume número.
   - Timeout o error de red: reintento único con el MISMO cuerpo y el MISMO Id. ARCA devuelve lo guardado con Reproceso 'S'. Si sigue fallando, FEXGetCMP(19, 10, nro):
     - Existe y coinciden Imp_total, fecha e Id_impositivo: AUTORIZADA (recuperada).
     - No existe: INCIERTA. Bloquea nuevas emisiones hasta correr arca-fex-reconciliar, que reenvía el mismo Id.
   - Nunca se manda un Id nuevo para un comprobante cuyo resultado no se conoce.
5. El servicio guarda la Invoice y la vincula. Si eso falla, queda una huérfana recuperable por script, en lugar del COLPPY_ORPHAN de hoy.
6. QR: buildQrUrl({fecha, cuit, ptoVta: 10, tipoCmp: 19, nroCmp, importe: Imp_total, moneda: 'DOL', ctz, codAut: CAE}) sin tipoDocRec ni nroDocRec. Esos campos son "de corresponder" y omitirlos cumple la especificación.

== 8. PDF ==

factura-pdf-data.ts:
- Aceptar letra 'E' (hoy cualquier otra letra se fuerza a 'B').
- claseDe 19→FACTURA, 20→ND, 21→NC.
- Sumar al select del cliente country, taxIdExterior y type, más FacturaExportacion.
- Para E: sin fila de IVA, condición "IVA Exento – Operación de Exportación", forma de pago desde FacturaExportacion y no desde idCondicionPago de Colppy.

factura-generator.ts:
- letra 'A'|'B'|'C'|'E'; CODIGO_CBTE 19 "FACTURA DE EXPORTACIÓN", 20 y 21.
- Bloque del receptor:
  - Señor(es) y Domicilio.
  - "CUIT País: 55000000034 (CHILE – Persona Jurídica)".
  - "RUT: …" según etiquetaIdFiscal.
  - "Divisa: USD – Dólar Estadounidense".
  - "Destino: CHILE".
- Filas de exportación:
  - Incoterm + lugar y Forma de pago.
  - Leyenda Exporta Simple: "Documento de Exportación Simplificada N° X – Monto FOB DES: USD … – Monto FOB en esta factura: USD …". En la Fase 3, permiso de embarque.
- Se sacan la banda "Régimen de Transparencia Fiscal (Ley 27.743)" y "IVA contenido".
- Totales: "Importe Total USD" y "Tipo de cambio ARCA: X".
- importeEnLetras en dólares estadounidenses.
- QR y CAE quedan como están.
- facturaPdfFilename con 'E'.
- Solo en español en la v1.

== 9. Colppy (decisión para la v1: carga MANUAL) ==

No se reutiliza sendQuoteToColppy:
- Lanza error para clientes del exterior.
- Fuerza letra A/B e IVA 21.
- Rechaza IVA 0.
- Busca el cliente por CUIT, y el CUIT país lo comparten todos los chilenos. Colppy además no valida CUIT duplicado.

Coincide con la memoria: "la Factura E se carga a mano; DJ IVA como exportación exenta".

Flujo:
1. El ERP deja colppySyncStatus 'MANUAL'. /facturas/[id] muestra "Cargar en Colppy" con los datos a copiar.
2. Caro, una sola vez: alta del cliente del exterior en Colppy y talonario no electrónico letra E PV 0010.
3. Caro carga la FAV E en USD, exenta, con los códigos de producto para que mueva stock y CMV.
4. Se pega el colppyId en el ERP antes del sync de las 9:00. Si se olvida, el arreglo de arcaCbteTipo la vincula por PV + número en vez de duplicarla.

Fase 3 (opcional, cuando la contadora defina el tratamiento): función nueva colppyCreateInvoiceExportacion, NO sendQuoteToColppy.
- tipoFactura 'E', USD, IVA 0, Aprobada, nro 0010-…, tipoItem 'P'.
- Cliente identificado SOLO por Customer.colppyId.
- Los IDs de condición de IVA y país de Colppy se sacan LEYENDO un cliente que ya exista. Nunca con un alta de prueba en prod.

== 10. Comisiones, stock, SharePoint, remitos ==

Comisiones: CotizacionFactura igual que en A/B.
- estado EMITIDA, numeroFactura 'E-0010-…', invoiceId.
- tipoCambio = Moneda_ctz redondeado a 4 decimales.
- montoUSD = suma SOLO de las líneas vinculadas a la cotización (sin flete ni seguro manual; queda a decisión del dueño).
- montoARS = montoUSD × tipo de cambio.
- Luego sincronizarComisionesDeQuote(quoteId, {crearLiquidacion: true}).
- Las NC E (Fase 2) generan filas negativas, igual que las NC A/B.

Stock: en el ERP se mueve cuando Colppy registra la factura (manual). Se llama a syncStockForSkusFireAndForget después de vincular el colppyId.

SharePoint: archivarFacturaEnSharePointBg sin cambios, aparte del nombre de archivo.

Remitos: regex de E en remitos/nuevo. El remito R (PV 6) para el courier es opcional (decisión).

== 11. Sin cerrarse puertas ==

Fase 2, NC/ND E:
- nota-credito-exportacion.ts reutiliza emitirExportacion con cbte 21 o 20.
- Toma los datos del receptor y del Incoterm del request guardado en la FacturaExportacion original.
- Cmps_asoc a la E; en Exporta Simple solo el 2402 (FOB a descontar; con 0 no toca el saldo del DES).
- Enganche en POST /api/facturas/[id]/nota-credito con un if cbteTipo === 19 que deriva acá.
- nc-unidades: factor de IVA 1 en lugar de 1,21 para E.

Fase 3, despachante:
- regimen DESPACHANTE.
- Permiso_existente 'N' (factura antes del permiso) o 'S' + Permisos validados con FEXCheck_Permiso.
- Sin opcionales.
- Exige el perfil de exportador (1668).

Lo genérico ya queda resuelto en la Fase 1: el Tipo_expo 2 (servicios, Fecha_pago obligatoria) y el idioma 2/3 son solo parámetros del builder.

== 12. Testing ==

A) Tests unitarios (vitest, puros, sin red):
- buildFexAuthorizeBody:
  - Orden del XSD contra el XML de referencia de Chile.
  - Nombres de hijos Cmp_asoc, Opcional, Item, Permiso.
  - Omite vacíos.
  - Auth de Last_CMP con Pto_venta y Cbte_Tipo.
- parseFexAuthorizeResult con XML de ejemplo:
  - Respuesta 'A' con FEXErr 0 y FEXEvents 0 da ok sin errores.
  - Rechazo con 2059 o 1668.
  - Reproceso 'S'.
  - SOAP Fault da ArcaError.
  - FEXGetCMP con 1020 da null.
- buildFexRequest:
  - Sumas en centavos y tolerancia; bonificación como monto.
  - Opcionales 2401 y 2402 con formato "1234.50".
  - Exporta Simple: Permiso 'N' sin Permisos, DOL y Tipo_expo 1.
  - Rechazos: FOB > total, FOB ≠ FOB del DES, FCA con línea de flete, falta Forma_pago, Incoterm o Domicilio, receptor sin cuitPais ni idImpositivo, DES con formato inválido.
  - NC: sin 2401, sin CanMisMonExt, Permiso vacío, Cmps_asoc obligatorio.
  - Formato del permiso del despachante.
- Otros:
  - Fecha AR cuando son las 22:30 hora AR (ya es el día siguiente en UTC).
  - receptorExportacion para Chile BUSINESS: 208 / 55000000034 / RUT.
  - Número interno 'E-0010-00000001'.
  - Datos del PDF de una E: sin IVA, letra E, CUIT país, leyenda DES.
  - sync-colppy: letra E con PV 10 se vincula y no se duplica.
  - Extensión de cliente-exterior.test.ts.

B) Lectura en prod (permitido: no crea comprobantes). Correr arca-fex-check.ts en el VPS con las ARCA_* de prod. Confirma:
- PV 10 no bloqueado.
- Last_CMP 19/20/21 = 0.
- Last_ID y Ctz DOL.
- Que Opcionales incluya 2401 y 2402.
- Códigos de Chile en DST_pais y DST_CUIT, UMed 7 y lista de Incoterms.
Esos valores se copian a fex-params.ts.

C) Homologación:
- La config ya la soporta por env override. Falta, en WSASS, autorizar wsfex al certificado valargerphomo (CUIT 20340026463), lo hace Santiago.
- PV de homo: usar lo que devuelva FEXGetPARAM_PtoVenta en homo. Si no devuelve nada, probar ARCA_PUNTO_VENTA_EXPO=1 (dato no confirmado).
- Matriz de arca-fex-prueba.ts:
  1. E 19, Tipo_expo 1, Permiso 'N', DOL, con línea de flete, sin opcionales: se espera 'A'. Si homo rechaza con 1668 (el CUIT personal no es exportador), repetir con Tipo_expo 4 solo para validar el armado.
  2. Reenvío del mismo Id: se espera Reproceso 'S' y el mismo CAE.
  3. FEXGetCMP de la #1: los campos coinciden.
  4. E con 2401 (DES inventado) + 2402: se espera rechazo 2059, 2060 o 2027. Eso prueba que el formato pasó los controles 2005-2008. Si da 'A', también sirve.
  5. NC 21 asociada a la #1: 'A'.
  6. CanMisMonExt 'S' con un TC equivocado: se espera rechazo 1604 o 1667. Con el TC de ARCA: 'A'.
  7. Errores provocados: 1610, 1620, 1535.
- Después, prueba completa con la app local apuntando a homo (la DB local NO es la de prod, sirve para esto): diálogo, Invoice, PDF, CotizacionFactura y comisiones.

D) Primera emisión en prod, supervisada:
- arca-fex-check antes de emitir.
- dryRun revisado por Santiago contra el DES del portal: N° de DES, FOB, cliente e Incoterm.
- Emisión única, FEXGetCMP de control y revisión del PDF.
- Carga en Colppy, vinculación del colppyId y control de comisión y SharePoint.

== 13. Puesta en producción ==

0. Requisitos del negocio:
   - Confirmar en Sistema Registral que el perfil Imp/Exp quedó dado de alta.
   - DES generado.
   - Respuestas de la contadora (TC y Colppy).
   - Datos completos del cliente chileno en el ERP.
1. Lectura en prod con arca-fex-check y autorización de wsfex en WSASS de homo.
2. Commit 1: wsfex.ts, fex-params.ts, emitir-exportacion.ts, scripts y tests. Pruebas en homo por script. Sin cambios de UI.
3. Commit 2: Prisma, servicio, endpoint, diálogo, PDF, sync E, guards y textos, más tests. Prueba completa local contra homo.
4. Un solo deploy agrupado, FUERA de horario laboral (cada next build corta la app 2-3 minutos):
   - Commits directos a master.
   - En el VPS, Santiago corre prisma db push (aditivo) y agrega ARCA_PUNTO_VENTA_EXPO=10 al .env.
   - pm2 restart y health check.
   - Sin esa variable, el diálogo muestra "Factura E no configurada".
5. Primera E real según 12D.
6. Fase 2 (NC/ND E) antes de la segunda exportación. Después la Fase 3 (despachante, Colppy por API).

== 14. Plan B si el envío no puede esperar ==

Emitir la primera E a mano en RCEL, PV 9 "Factura en Línea" de exportación, tildando "Régimen de Exportación Simplificada". No interfiere con la numeración del PV 10.

Opcional (+0,5 día): acción "Registrar Factura E emitida en RCEL" que crea la Invoice (emitidaPor 'RCEL', PV 9, cbteTipo 19) y la CotizacionFactura, para que la cotización y las comisiones queden bien.

Si FEXGetCMP lee el PV 9, esa factura muestra exactamente cómo arma RCEL los campos dudosos.
