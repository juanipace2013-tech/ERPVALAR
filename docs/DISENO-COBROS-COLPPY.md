# Cobros (recibos) desde el ERP hacia Colppy

Estado: **fase 1 escrita, sin deployar** (10/11/2026). Formato capturado desde
la pantalla de Colppy (mismo método que `DISENO-PAGOS-PROVEEDORES-COLPPY.md`).

## Fase 1 en el ERP

- Pantallas: `/cobros` (listado, botón Verificar) y `/cobros/nuevo`.
- API: `GET/POST /api/cobros`, `GET /api/cobros/preparar`,
  `POST /api/cobros/[id]/verificar`. Roles FINANZAS.
- Código: `src/lib/cobros-colppy/` (`alta-cobro.ts` puro, `colppy-cobros.ts`,
  `registrar.ts`). Tablas `customer_collections*` (requiere `db push`).
- Alcance: FAV/NDV en pesos, cobro total o parcial, una o varias transferencias
  a cuentas en pesos (`leer_origen_fondos2` idTipo banco: Galicia, Supervielle,
  MERCADOPAGO...). Sin retenciones, dólares, e-cheqs, anticipos ni NC.
- Apagado por defecto: las altas se prenden con `COBROS_COLPPY=1`.
- Mismas protecciones que pagos: clave de idempotencia, un alta a la vez,
  relectura de Colppy al registrar, INCIERTO sin reintento. La verificación de
  un incierto mira los saldos de los comprobantes (no hay lectura de recibos
  por número en la API).
- Primera prueba real: un cliente con **una sola impaga** (forma verificada
  contra la captura); después uno con varias.

Todo va a `https://login.colppy.com/lib/frontera2/service.php` (el mismo
endpoint de la API), salvo lo marcado como PHP interno.

## Lectura de un recibo (capturado, recibo 0001-00012880, idCobro 12104090)

| Qué | Operación | Parámetros |
|---|---|---|
| Cabecera del recibo | `AR_DetalleCobro.php` (**PHP interno**, form-encoded) | `idCobro`, `idEmpresa` |
| Facturas del cobro / impagas del cliente | `FacturaVenta/leer_facturas_a_cobrar` | `idEmpresa`, `idCobro` (¿"0"/vacío en un recibo nuevo? a confirmar), `valorCambio`, `idCliente`, `start`, `limit` |
| Saldo de impagas | `FacturaVenta/leer_saldoFacturasImpagas` | `idUsuario`, `idCliente`, `idEmpresa`, `idCobro` |
| Medios de cobro | `Cliente/AR_leer_fondos_pagos` | `idEmpresa`, `idCobro`, `add` |
| Retenciones IIBB del recibo | `Cliente/listar_retsufridas` | `idEmpresa`, `idCobro` |
| Jurisdicciones IIBB y su cuenta | `Cliente/listar_retsufridasSetUp` | `idEmpresa` |
| Tipos/decodificadora | `Cliente/lista_decodificadora` | `idEmpresa`, `idTabla`, `idCobro`, `monotributo`, `idFactura`, `idCondicionIvaEmpresa` |
| Cuenta corriente | `AR_CuentaCorrienteCliente.php` (**PHP interno**) | — |

### Formas de los datos

Cabecera (`AR_DetalleCobro.php`):

```json
{"idEmpresa":"18446","idCobro":"12104090","idCliente":"11328281",
 "fechaCobro":"22/10/2026","totalEsteCobro":"7929549.05","totalCobrado":"7961419.24",
 "idEstadoCobro":"Aprobado","anticipo":"0.00","descuentos":"0.00","intereses":"0.00",
 "retGanancias":null,"retIVA":null,"retSUSS":null,"retencionIIBB":"19788.11",
 "retencionIIBB1":null,"retencionIIBB2":null,"IIBBLocal":null,"IIBBOtro":null,
 "retencionOtras":"0.00","descripcion":"","nroRecibo1":"0001","nroRecibo2":"00012880",
 "totalACobrar":7909760.94,"totalaplicado":7929549.05}
```

Factura a cobrar (`leer_facturas_a_cobrar`), factura en USD cobrada en pesos:

```json
{"idFactura":"54577906","nroFactura":"0007-00000154","tipoComprobante":"FAV",
 "fechaPago":"26-10-2026","totalFactura":"7929549.05","cobrado":0,
 "saldoAnterior":"7929549.05","esteCobro":"7929549.05","Saldo":0,
 "currency":"USD","rate":"1535.000000","tcCobroRate":"1545"}
```

`rate` = TC de la factura, `tcCobroRate` = TC del cobro; la diferencia de cambio
del recibo (51.658,30 en este caso) sale de ahí.

Medio de cobro (`AR_leer_fondos_pagos`), e-cheq de tercero:

```json
{"nroCheque":"14719505","Banco":"3ero. - ICBC","fechaValidez":"09/11/2026",
 "importe":"1459211.00","idMedioCobro":"Echeqs","idPlanCuenta":null,
 "Conciliado":"N","VAD":"VAD"}
```

(la cuenta real es 113200 Valores a Depositar; `VAD` marca que entra a cartera).

Retención IIBB sufrida (`listar_retsufridas`):

```json
{"Id":"1373820","idCobro":"12104090","jurisdiccion":"Buenos Aires",
 "nroCertificado":"2026000001000001836","importeRet":"19788.11","importeBaseRet":"0.00"}
```

Todas las jurisdicciones van a la cuenta 114301.

Transferencia en la misma grilla de medios: `idMedioCobro:"Transferencia"`
(id 3), `idPlanCuenta:"Cta Cte Galicia"` (111200), `fechaValidez` = fecha del
cobro, sin banco ni número. Echeqs = id 7, cuenta 113200. La grilla trae 3
renglones vacíos de relleno (`"Seleccionar medio de cobro"`, importe 0).

Estados (`lista_decodificadora`, `idTabla:"15"`): 3 = Aprobado, 5 = Anulado.

PDF: `Cliente/generar_pdf_recibo_cliente` (`idEmpresa`, `idCliente`, `idCobro`,
`envioMail`).

### Caso de referencia: recibo 0001-00012880 (LE GURIE, 22/10/2026)

Cuenta que tiene que reproducir el ERP (verificada contra el PDF):

| Concepto | Importe |
|---|---|
| Aplicado a FAV 0007-00000154 (USD 5.165,83 a TC factura 1.535) | 7.929.549,05 |
| Retención IIBB Buenos Aires, cert. 2026000001000001836 | −19.788,11 |
| Diferencia de cambio = USD 5.165,83 × (1.545 − 1.535) | +51.658,30 |
| **Total a cobrar** | **7.961.419,24** |
| 4 e-cheqs (1.459.211,00 + 623.077,00 + 460.945,07 + 5.329.985,70) | 7.873.218,77 |
| Transferencia a Cta Cte Galicia | 88.200,47 |
| **Total cobrado** | **7.961.419,24** |

Regla: `total a cobrar = aplicado − retenciones − descuentos + intereses +
anticipo + diferencia de cambio` y tiene que ser igual a la suma de medios.

## Alta del recibo: `Cliente/alta_cobro` (capturado 10/11/2026)

Recibo real 0001-00012987 (JASKOWSKY, venta ML, transferencia a MERCADOPAGO,
sin retenciones), idCobro 12183687. Va por `service.php`, o sea que el ERP lo
puede llamar igual que `alta_pago`.

Secuencia de la pantalla al abrir "Agregar cobro":

1. `Empresa/leer_talonario` (`comprobanteTipo:""`, `descTipoComprobante:"recibo"`,
   `talonarioDefault:1`) → talonario RECIBOS, prefijo `0001`.
2. `Empresa/leer_numero_recibo` (`idEmpresa`, `prefijo:"0001"`) → `proximoNum`
   (`"00012987"`). **El número lo manda el cliente**, igual que en la OP.
3. `FacturaVenta/leer_facturas_a_cobrar` con `idCobro:""` → impagas del cliente.
4. `Tesoreria/leer_origen_fondos2` → cuentas de destino (la misma que usa pagos).

Pedido:

```json
{"service":{"provision":"Cliente","operacion":"alta_cobro"},
 "parameters":{
  "sesion":{...},
  "cobros":[{"idFactura":"54854713","nroFactura":"0007-00000279","tipoComprobante":"FAV",
    "fechaPago":"09-11-2026","moneda":"","descripcion":"Venta Mercado Libre #... - CAE ...",
    "currency":null,"tcCobroRate":"","rate":null,
    "totalFactura":599275.76,"cobrado":0,"saldoAnterior":599275.76,
    "esteCobro":599275.76,"esteCobroMe":"","Saldo":0,"pagar":true}],
  "mediospagos":[{"idMedioCobro":"Transferencia","idPlanCuenta":"MERCADOPAGO",
    "Banco":"","nroCheque":"","fechaValidez":"","importe":599275.76,
    "VAD":"S","Conciliado":"","idTabla":0,"idElemento":0,"idItem":0}],
  "estesoreria":"0","idUsuario":"<usuario>","idCobro":"","idCliente":"14735302",
  "idEmpresa":"18446","nroRecibo1":"0001","nroRecibo2":"00012987",
  "fechaCobro":"02-11-2026","idEstadoCobro":"Aprobado","descripcion":"",
  "valorCambio":"0","totalEsteCobro":599275.76,"saldoFacturas":0,
  "anticipo":0,"descuentos":0,"intereses":0,"retencionIIBB":0,
  "totalACobrar":599275.76,"idMedioCobro":"Transferencia","totalCobrado":599275.76,
  "retencionOtras":0,"retsufridas":[],"retsufridasotras":[],"diferenciaTipoCambio":0}}
```

Respuesta: `{"success":true,"message":"Cobro validado con exito",
"fechaFactura":"2026-11-02","estesoreria":"0","idCobro":"12183687"}`.

Notas:

- Acá `cobros` y `mediospagos` viajan como **arreglos** (en `alta_pago` las
  grillas van como texto JSON). Respetar tal cual.
- Fechas `DD-MM-AAAA`. Importes como número.
- Leído del front de Colppy (`colppyall_min.js`, `onSave3` del form de cobro):
  `cobros` = **todas** las filas de la grilla de impagas (`facturasacobrargrid`),
  las no cobradas con `esteCobro` 0; `mediospagos` = filas con cuenta e importe
  ≠ 0; `retsufridas` = filas de la grilla de IIBB con `importeRet` ≠ 0 (exige
  `jurisdiccion`); `retsufridasotras` = filas con `tipoRetencion` e `importeRet`.
  Con `idCobro` cargado la operación es `editar_cobro`.
- Validaciones del front: NCV con `esteCobro` > 0 o FAV/NDV con `esteCobro` < 0
  se rechazan; total cobrado no puede ser menor al total a cobrar; si es mayor,
  el excedente queda como **cobro a cuenta** (pide confirmación).
- `totalACobrar = aplicado − retIIBB − retOtras + anticipo − descuentos +
  intereses + diferencia de cambio`.
- Medio y cuenta por nombre (`"Transferencia"` + `"MERCADOPAGO"`).
- Impagas de un recibo nuevo traen además `idMoneda`, `valorCambio`, `is_fce`,
  `idTipoComprobante`, `totalme`.

## Facturas en dólares cobradas en pesos (10/11/2026, leído del front, SIN captura de guardado)

Val Arg factura en USD y cobra en pesos, al T/C de la factura o al del día del
pago según el cliente. Leído de `colppyall_min.js` (`facturasacobrargrid`,
`cobroform.calcularTotalConTCFactura/TCCobro`, `reCalculateTotal`, `onSave3`):

- La fila lleva `currency:"USD"`, `rate` (T/C factura, texto `"1535.000000"`),
  `esteCobro`/`saldoAnterior` en pesos **al T/C de la factura**, y
  `tcCobroRate` (número, hasta 4 decimales; al abrir Colppy lo carga con su T/C
  del día y es editable). El front le agrega `totalme` = `"USD-" +
  totalFactura / rate.toFixed(2)`. `esteCobroMe` va `""` salvo que se use el
  "Calculador moneda extranjera" (cobro parcial en USD).
- `diferenciaTipoCambio` = Σ `esteCobro / rate × tcCobroRate` − Σ `esteCobro`
  (solo filas con moneda).
- `totalACobrar` = `totalEsteCobro` − retenciones + … + `diferenciaTipoCambio`,
  y tiene que igualar a la suma de medios.
- En el ERP: columna "T/C cobro" por factura (arranca en el de la factura,
  botones "De la factura" / "Del día" con el BNA del ERP). La aplicación que
  se guarda es en pesos al T/C de la factura (lo que baja el saldo en Colppy).
- **Primer cobro real en dólares: revisar en Colppy** el recibo y el asiento
  de diferencia de cambio (tipos de dato de `tcCobroRate` sin confirmar).

## Pendiente de capturar

- [x] **Alta del recibo** (operación, grillas, numeración `nroRecibo1/2`).
- [x] Recibo con transferencia (cuenta destino por nombre, como en pagos).
- [ ] Cliente con varias impagas (qué se manda de las no cobradas) y cobro parcial.
- [ ] Recibo con retención IIBB (`retsufridas`) y otras (`retsufridasotras`).
- [x] Recibo con e-cheq recibido: `idMedioCobro:"Echeqs"`, `idPlanCuenta:"Valores a Depositar"`,
  `Banco` texto libre, `nroCheque` número, `fechaValidez` `DD/MM/AAAA` (la grilla `fondoscobro`
  la convierte en `onAfterEdit`). Leído del front y verificado contra el recibo real
  0001-00013016 de ZEN INGENIERIA (idCobro 12197091, 12/11/2026, cargado en Colppy); el
  guardado en sí no quedó grabado. En el ERP desde 12/11/2026.
- [ ] Recibo con retención de Ganancias / IVA / SUSS.
- [ ] Recibo de factura en USD: quién calcula la diferencia de cambio.
- [ ] Anticipo (cobro sin factura) y NC dentro del cobro.
