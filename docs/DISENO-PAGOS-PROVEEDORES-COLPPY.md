# Pagos a proveedores desde el ERP, replicados en Colppy

Diseño — 30/10/2026, actualizado 5/11/2026 con la captura de una OP real. Estado: propuesta, sin código.

## Objetivo

Que las órdenes de pago (OP) a proveedores se carguen en el ERP y se den de alta solas en Colppy,
con la misma numeración, las mismas facturas aplicadas, los mismos medios y la misma retención de
Ganancias que hoy se cargan a mano en Colppy. Colppy sigue siendo el libro contable (ver
`project_contabilidad_en_colppy`); el ERP pasa a ser donde se arma y se registra el pago.

## Lo que muestran los datos (septiembre 2026, diario de Colppy)

| | OP |
|---|---|
| Total de OP del mes | **96** (260 facturas aplicadas; 17 OP pagan más de una factura) |
| Solo con transferencia, Mercado Pago, tarjeta o caja, en pesos | **86 (90 %)** |
| — de esas, pagadas solo con Tarjeta Galicia (111301) | 57 |
| Con e-cheqs de terceros endosados (113200 Valores a Depositar) | 6 (88 cheques en total) |
| Con cheque propio diferido (211300) | 4 |
| Con transferencia en USD (111260) | 1 |
| Con retención de Ganancias (114108) | 10 |
| Sin factura aplicada (anticipos / pagos a cuenta) | 8 |

Cuentas que usan las OP hoy: 211100 Proveedores (debe), 111200 Galicia, 111220 Mercado Pago,
111301 Tarjeta Galicia, 111100 Caja, 111260 USD Galicia, 113200 Valores a Depositar,
211300 Cheques diferidos, 114108 Ret. Ganancias a depositar, 541001 Intereses.

## Lo que sabemos de la API de Colppy

- **`Pago / leer_pago`** devuelve solo la cabecera de una OP (totales, retención, número), sin
  facturas ni medios.
- No existen: provisión `Cobro`, `listar_pago`, listados de cheques en cartera (probados varios
  nombres el 30/10; Colppy responde "la operación no existe").

## Cómo se arma hoy una OP en Colppy (capturado el 5/11/2026)

OP real **0001-00005506** a BMS BUILDING MANAGEMENT SYSTEM SRL (idProveedor 493365): 3 facturas
pagadas completas, 1 impaga dejada afuera, retención de Ganancias régimen 78, una sola
transferencia desde Galicia. Colppy respondió `idPago 9594743`. Se grabó desde el Chrome de
Santiago lo que la pantalla de Colppy le pidió y mandó al servidor (sin claves de sesión).

Todo va al mismo endpoint de la API (`lib/frontera2/service.php`, el mismo formato
`{auth, service:{provision, operacion}, parameters:{sesion, idEmpresa, ...}}` que ya usa el ERP),
salvo el cálculo de retenciones, que va a PHP internos de la pantalla.

### Lo que hace la pantalla, en orden

| Paso de Santiago | Lo que pide la pantalla | Lo usamos |
|---|---|---|
| Elige proveedor y "Agregar pago" | `Proveedor/facturas_impagas_proveedor` `{idProveedor, idPago:"", valorCambio:0, start:0, limit:200}` → `resultados[]` con `idFactura, nroFactura, tipoComprobante (FAC/NC), fechaPago (vto), RG, totalFactura, pagado, saldoAnterior, Saldo, Saldoacum, percepcionIVA, moneda/currency/rate/totalme` | **Sí**: es la lista de impagas, mejor que `listar_facturascompra` |
| | `Proveedor/detalle_proveedor` → `idRetGanancias`, `CUIT`, `CBU`, `Banco` | Sí (régimen y CBU para la transferencia) |
| | `Proveedor/buscar_numero_op {prefijo:"0001"}` → `{proximoNum:"00005506"}` | **Sí**: el número de OP lo manda el cliente |
| | `Retencion/consultaPadronIIBB {fecha, cuit, idProvincia}` | Fase IIBB |
| Elige medio | `Tesoreria/leer_origen_fondos2` → bancos/cajas: `Nombre` ("Cta Cte Galicia"), `idPlanCuenta` (111200), `Moneda`, `nroCuenta` | **Sí**: lista de medios |
| Tilda facturas | `proveedores/AP_calcularRetencion.php` (interno) → por factura: `bruto` (neto sin IVA), `acumulado`, `aretener`, `retenido`, `saldoaretener` | No: se calcula en el ERP con la misma fórmula (ver abajo) |
| | `proveedores/AP_calcularRetencionIIBB.php` (interno) | No |
| **Confirma** | **`Pago/alta_pago`** (abajo) → `{success:true, idPago:"9594743"}` | **Sí** |
| | `Proveedor/generar_pdf_pagos_proveedores {idProveedor, idPago, noPrint:1, envioMail:{}}` | Sí: PDF de la OP desde Colppy |

### `Pago/alta_pago` real (parameters)

```json
{
  "idEmpresa": "18446", "idPago": "", "idProveedor": "493365",
  "fechaPago": "05-11-2026", "valorCambio": "0",
  "idEstadoPago": "Aprobado", "userId": "19396", "origen": "proveedores", "descripcion": "",
  "nroPago1": "0001", "nroPago2": "00005506",
  "totalFacturas": 5605030.29,
  "anticipo": 0, "descuentos": 0, "intereses": 0, "diferenciaTipoCambio": 0,
  "idRetGanancias1": "78", "baseCalculo1": 4632256.44, "retGanancias1": 88165.13,
  "retencionIIBB": 0, "retemitidas": [],
  "totalpagado": 5516865.16,
  "recordsToInsertUpdate": [
    { "idFactura": "24296591", "nroFactura": "00006-00011271", "tipoComprobante": "FAC",
      "fechaPago": "30-10-2026", "RG": "78", "totalFactura": "588876.75", "pagado": 0,
      "saldoAnterior": 588876.75, "estePago": 588876.75, "Saldo": 0, "pagar": true,
      "percepcionIVA": "0.00", "retencionAcumulada": "0.00", "RETE": "", "saldoNC": "",
      "moneda": "", "rate": null, "currency": null, "totalme": null, "tcPagoRate": "" },
    "… una por cada factura impaga listada; las no pagadas van con pagar:false, estePago:0"
  ],
  "recordsToInsertUpdate1": [
    { "idMedioPago": "Transferencia", "idPlanCuenta": "Cta Cte Galicia", "nroCheque": "",
      "fechaValidez": "05/11/2026", "importe": 5516865.16, "idTabla": 0, "idElemento": 0,
      "idItem": 0, "CED": "S", "Conciliado": "", "Moneda": "" }
  ]
}
```

- `recordsToInsertUpdate` = facturas; `recordsToInsertUpdate1` = medios de pago.
- **Las dos grillas viajan como TEXTO JSON** (`"recordsToInsertUpdate": "[{...}]"`), no como arreglo:
  arriba están desplegadas para leerlas. Mandadas como arreglo, Colppy contesta
  "Error al registrar pago … Intente nuevamente" (primer alta desde el ERP, 0001-00005513, 5/11/2026).
- **Sin régimen de Ganancias**: `idRetGanancias1: ""`, `baseCalculo1: ""`, `retGanancias1: 0`.
- **Tarjeta de crédito** (captura real 0001-00005513, idPago 9596726): `idMedioPago: "Tarjeta de Crédito"`,
  `idPlanCuenta: "TARJETA GALICIA"`, `fechaValidez: ""`; el resto igual que la transferencia.
- Medio y cuenta van **por nombre** (`"Transferencia"`, `"Cta Cte Galicia"`), no por código.
- Ojo con los formatos de fecha: `fechaPago` con guiones (DD-MM-YYYY), `fechaValidez` con barras.
- Cuentas que cierran: `totalFacturas` = Σ `estePago` (5.605.030,29);
  `totalpagado` = totalFacturas − retGanancias1 = Σ medios (5.516.865,16).
- **Retención régimen 78**, verificada al centavo con lo que calculó Colppy:
  base = Σ neto sin IVA de lo pagado (`totalFactura / 1,21`; 4.632.256,44) más lo ya pagado al
  proveedor en el mes; retención = (base − 224.000) × 2 % − lo ya retenido en el mes = 88.165,13.

### E-cheqs de terceros endosados + e-cheq propio (captura real 5/11/2026)

OP 0001-00005515 a GENEBRE (idPago 9597180), cargada a mano en Colppy con la grabación activa:
47 facturas pagadas de 97 impagas listadas, retención 78 calculada al centavo con
(base − 224.000) × 2 %, pagada con 7 e-cheqs de terceros endosados + 1 e-cheq propio.

**Cheque de tercero (endoso de cartera)**: una fila por cheque en `recordsToInsertUpdate1`
(valores de ejemplo, no reales):

```json
{ "idMedioPago": "Cheque de Tercero", "idPlanCuenta": "Valores a Depositar",
  "nroCheque": "12345678", "fechaValidez": "07/11/2026", "importe": "1000000.00",
  "idTabla": "20", "idElemento": "<id del cobro>", "idItem": "<renglón del cheque en el cobro>",
  "CED": "S", "Conciliado": "", "Moneda": "" }
```

- `idTabla` "20" = cobros; `idElemento` e `idItem` se copian tal cual de la fila de cartera, como texto
  (igual que el importe).
- `idMedioPago` es "Cheque de Tercero" aunque el valor sea un e-cheq (en la cartera dice `tipo: "Echeqs"`).

**E-cheq propio** (emitido desde el banco):

```json
{ "idMedioPago": "Echeqs", "idPlanCuenta": "Cta Cte Galicia", "nroCheque": "00000001",
  "fechaValidez": "06/11/2026", "importe": 1000000.00, "idTabla": 0, "idElemento": 0,
  "idItem": 0, "CED": "S", "Conciliado": "", "Moneda": "" }
```

Antes del alta el front valida el número con `TE_ValidacionNumCheque.php`
(`idEmpresa, banco, idMedioPago, nroCheque` → `{success: true}`).

**De dónde sale la cartera:** `resources/php/tesoreria/TE_ValoresADepositar.php` (`idEmpresa`), un PHP
interno del front, **no** la API pública (por eso no apareció al probar operaciones el 30/10).
Devuelve un objeto con índices "0".."n"; cada valor trae `nroCheque, Emisor, Banco, fechaValidez,
importe, idTabla, idElemento, idItem, Documento` (ej. "REC 0001-000xxxxx"), `tipo` ("Echeqs") y `fecha`.

Pendiente para la fase 2: ver si el ERP puede llamar ese PHP (usa la sesión web del front, no la de la
API) o armar la cartera desde otra fuente conservando `idElemento`/`idItem` exactos.

### Lo que falta capturar

- Una OP con **e-cheqs de terceros endosados** (cómo se referencia el cheque de cartera: seguramente
  `idTabla`/`idElemento`/`nroCheque` en `recordsToInsertUpdate1`, y de dónde sale la lista de cartera).
- Una con **Tarjeta Galicia** y una con **Mercado Pago** (solo para confirmar el nombre del medio).
- Una **parcial** (estePago < saldo) y una con **NC** del proveedor aplicada.
- Una de un proveedor que ya cobró en el mes (para ver `retencionAcumulada` y el descuento de lo ya retenido).

Mismo método: Santiago carga la OP real que tenía que hacer igual, con la grabación activa.

## Flujo propuesto en el ERP

Pantalla nueva **Proveedores → Pagos → Nueva orden de pago**:

1. **Proveedor.** Se busca en el ERP; tiene que tener su id de Colppy (ya lo resuelve
   `colppyFindSupplierByCUIT`).
2. **Facturas impagas.** Se leen en vivo de Colppy (`Proveedor/facturas_impagas_proveedor`, igual
   que la pantalla de Colppy), no de la base del ERP: muchas facturas de compra se cargan directo en Colppy y los
   pagos anteriores están allá. Si la factura también existe en el ERP (`PurchaseInvoice.colppyInvoiceId`)
   se muestra el vínculo. Se tildan las facturas y el importe a aplicar de cada una (permite parcial).
   Sin factura = anticipo.
3. **Retención de Ganancias.** Se calcula sola y se puede corregir a mano (el importe cargado
   manda). Se porta la lógica que ya está validada al centavo en el laboratorio contable
   (RG 830 régimen 78: base = pagos del mes al proveedor sin IVA ni percepciones, mínimo
   $224.000, 2 %, descontando lo ya retenido en el mes). El acumulado del mes se toma del diario
   de Colppy (cuenta 114108 por proveedor), así cuentan también las OP cargadas a mano.
   Régimen 30 (alquileres) queda para cuando la contadora lo confirme.
4. **Medios de pago.** Transferencia Galicia, Mercado Pago, Tarjeta Galicia, Caja (fase 1);
   e-cheq de terceros endosado y e-cheq/cheque propio (fase 2); transferencia USD (fase 3).
   Cada medio apunta a su cuenta de Colppy en una tabla de configuración (no hardcodeada).
5. **Control.** No deja confirmar si medios ≠ aplicado + anticipo − retenciones − descuentos + intereses
   (tolerancia de centavos, ver `feedback_redondeos_centavos`).
6. **Confirmar → Colppy primero.** Justo antes de mandar se pide el próximo número
   (`buscar_numero_op`, prefijo 0001) y se manda `alta_pago` en estado Aprobado con ese
   `nroPago1/nroPago2`, como hace la pantalla de Colppy. Si Colppy responde
   bien, se guarda `idPago` y el número 0001-XXXXXXXX y la OP queda
   "Registrada". Si falla, queda "Error" con el mensaje y un botón Reintentar. **Antes de reintentar
   se verifica que no se haya creado igual** (diario de Colppy por proveedor/fecha/importe), para
   no duplicar el pago.
7. **Después.** PDF de la OP (y del certificado de retención si Colppy no lo da), borrador de mail
   al proveedor con el comprobante (mismo esquema que el borrador de factura), y se actualiza
   saldo/estado de las `PurchaseInvoice` vinculadas.

## Datos (Prisma)

Tablas nuevas; las viejas `SupplierPayment` y `PurchasePayment` (solo locales, atadas a OC/factura
del ERP) quedan como están y no se usan para esto.

- `SupplierPaymentOrder`: proveedor, fecha, estado (BORRADOR / REGISTRADA / ERROR / ANULADA),
  totales (aplicado, anticipo, retención Ganancias + régimen + base, descuentos, intereses, pagado),
  `colppyPaymentId`, `paymentNumber`, último error, usuario, fechas.
- `SupplierPaymentApplication`: OP, `colppyInvoiceId`, `purchaseInvoiceId` opcional, número de
  factura, importe aplicado.
- `SupplierPaymentMedium`: OP, tipo de medio, cuenta Colppy, importe, moneda, TC, datos de cheque
  (número, banco, fecha de pago) cuando aplique.
- `PaymentMediumAccount`: configuración medio → `idPlanCuenta` de Colppy.

Requiere `db push` en el deploy (como siempre, vía DIRECT_URL antes del build).

## Fases

| Fase | Qué cubre | OP de sept. cubiertas |
|---|---|---|
| 0 | Contrato de `alta_pago` — **hecho 5/11** para transferencia + retención 78; faltan capturas de e-cheq, tarjeta, MP, parcial y NC | — |
| 1 | Facturas en pesos, transferencia / MP / tarjeta / caja, retención Ganancias 78, anticipos | 86 de 96 |
| 2 | E-cheqs de terceros endosados y cheques propios | +10 |
| 3 | Pagos en USD y facturas USD pagadas en pesos (diferencia de cambio) | resto |
| 4 | Anular OP desde el ERP (si la API lo permite) | — |

Fase 2 tiene un problema propio: Colppy no expone la cartera de cheques por API y los cobros
siguen en Colppy, así que el ERP no sabe qué e-cheqs hay para endosar. Opciones: elegirlos a mano
(número, banco, importe, vencimiento) y que Colppy valide, o esperar a que los cobros pasen por el
sistema propio (`project_cobros_futuro_sistema`). Se decide después del paso 0.

## Riesgos y reglas

- **No hay ambiente de prueba de Colppy.** La primera OP de verdad tiene que ser una chica, revisada
  en Colppy al momento y anulada a mano si salió mal. Nunca probar contra Colppy desde tests.
- **Doble carga.** Desde el día que arranque, todas las OP de proveedores se hacen por el ERP; si
  alguien carga la misma OP a mano en Colppy, queda duplicada. Avisar a administración.
- **USD.** La UI de Colppy rompe NC en USD al editarlas (`reference_colppy_nc_imputacion`); no
  editar en Colppy pagos en USD hechos por API.
- **Laboratorio contable.** No cambia nada: sigue importando las OP desde el diario de Colppy.
  Cuando se fusione con el CRM, esta pantalla es la base de su orden de pago (el lab ya tiene la
  lógica de OP, retenciones y cartera).

## Fase 1 programada (5/11/2026)

- Pantallas: **Proveedores → Pagos** (listado), `/proveedores/pagos/nueva`, `/proveedores/pagos/[id]`.
- Código: `src/lib/pagos-proveedores/` (retencion, alta-pago, colppy-pagos, registrar) y
  `src/app/api/pagos-proveedores/`. Tests: `tests/unit/pagos-proveedores.test.ts` (BMS y GENEBRE al centavo).
- **Apagado por defecto**: sin `PAGOS_PROVEEDORES_COLPPY=1` en el `.env` del VPS la pantalla solo
  calcula (vista previa). El deploy necesita `db push` (tablas `supplier_payment_*`).
- Fase 1 corta con aviso: NC, facturas en USD, régimen distinto de 78, facturas con RG distinto al
  de la ficha del proveedor, fecha futura o de hace más de 45 días.
- Una orden INCIERTA (Colppy no contestó claro) frena nuevas órdenes del mismo proveedor hasta
  verificarla; verificar espera 5 minutos antes de darla por no creada y avisa si hay un pago del
  mismo total con otro número.
- El saldo del proveedor en el ERP (`Supplier.balance`) no se toca: no se sincroniza con Colppy.

## Preguntas abiertas

0. **Importe mínimo de retención** (RG 830): ¿Colppy no retiene si da menos de cierto monto
   (p. ej. $240)? Hoy el ERP retiene cualquier importe mayor a 0. Confirmar con la contadora.

1. ¿Quién carga hoy las OP en Colppy y quién las aprobaría en el ERP (rol)?
2. Las 57 OP pagadas solo con Tarjeta Galicia, ¿son gastos/servicios chicos? ¿Conviene que también
   pasen por el ERP o se dejan en Colppy?
3. ¿Val Arg retiene IIBB o solo Ganancias? (`retencionIIBB` vino en 0 en la OP leída).
4. ¿El certificado de retención lo emite Colppy al dar de alta el pago o se arma aparte?
5. ~~Numeración~~: resuelto. La pantalla pide `buscar_numero_op` y manda el número en el alta;
   el ERP hace lo mismo (talonario 0001, próximo 00005507 al 5/11).
