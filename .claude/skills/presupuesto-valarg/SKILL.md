---
name: presupuesto-valarg
description: Arma presupuestos de Val Arg a partir del pedido de un cliente (listado de válvulas, SOLPED, RFQ, pliego de licitación, mail, PDF o Excel). Identifica cada ítem contra el catálogo del ERP de producción, lo reparte por proveedor (GENEBRE, WINTERS, FAMIQ, CENI/JMH, Todoválvulas, otros), genera el Excel "cotizacion-...-por-proveedor", los Excel de pedido de cotización para lo que no está en lista y deja la cotización VAL-AAAA-NNNN en borrador en el ERP. Usar siempre que Santiago pase un pedido, listado, planilla o licitación para cotizar, o diga "armar presupuesto", "cotizar esto", "pedido de cotización", "qué tenemos de esta lista", "comparar con GENEBRE", aunque no nombre el skill ni pida explícitamente un Excel.
---

# Presupuesto Val Arg

Val Arg vende válvulas e instrumentación industrial. Cuando un cliente manda un pedido, el trabajo es
siempre el mismo: entender qué pide cada renglón, ver qué se puede ofrecer con lo que hay en catálogo,
pedir precio a terceros por el resto, y dejar la cotización lista para que el vendedor la revise y la mande.

El valor de este trabajo está en el criterio técnico: un presupuesto con un código mal elegido (medida,
clase, material o temperatura que no cumple) le cuesta plata y credibilidad a la empresa. Por eso todo lo
dudoso se marca a la vista en vez de resolverse en silencio.

## Herramientas

Todo está en `scripts/` de este skill. Los `.ts` corren contra **producción** a través de `prod.sh`, porque
la base de datos local tiene datos viejos y no sirve para precios ni stock.

| Qué | Cómo |
|---|---|
| Consultar productos, clientes, stock (solo lectura) | `bash scripts/prod.sh scripts/consultar-erp.ts entrada.json` |
| Armar un Excel con el formato de la casa | `python scripts/armar_excel.py libro.json` |
| Crear la cotización en borrador | `bash scripts/prod.sh scripts/crear-cotizacion.ts cotizacion.json [--confirmar]` |

El formato de cada JSON está documentado en la cabecera de cada script; leerla antes del primer uso.
Escribir los JSON con la herramienta Write y después ejecutar: en Windows un heredoc largo en Bash falla
(comillas, `ENAMETOOLONG`). Para explorar series grandes usar `"compacto": true`.
Los JSON de trabajo van al scratchpad; los Excel finales, a la raíz del repo (`C:\Users\santi\crm-valarg`),
que es donde Santiago los busca.

## Flujo

### 1. Leer el pedido completo

Extraer **todos** los renglones con: ítem/posición del cliente, TAG, descripción original, medida, clase o
PN, extremos, materiales (cuerpo e internos), accionamiento, condiciones de servicio (fluido, presión,
temperatura), marca/modelo pedido, cantidad, y cualquier referencia interna del cliente (SOLPED, código de
material, posición). Anotar también lo que el cliente pide informar: plazo, forma de pago, validez, lugar de
entrega, normas y certificados.

Contar los renglones y las unidades y comprobar que el total coincide con el documento: un renglón perdido
es el error más caro y el más fácil de cometer en PDFs de varias páginas. Si el listado trae incoherencias
(un TAG repetido, una medida que no existe, una clase que no cierra con la presión), anotarlas para
avisarle al cliente: es parte del valor que agrega Val Arg.

### 2. Cliente

Buscarlo con `"clientes": ["nombre o CUIT"]`. La respuesta trae condición de IVA, multiplicador, vendedor y
las últimas cotizaciones. Si alguna reciente parece ser el mismo pedido o una revisión anterior, traerla con
`"cotizaciones": ["VAL-..."]` y partir de ahí: lo que ya se ofreció y a qué precio es el mejor punto de
partida, y hay que avisarle a Santiago para no duplicar. Si hay más de un candidato, o el cliente no existe en el ERP, preguntarle a
Santiago: no se da de alta un cliente desde acá (el alta pasa por Colppy y no valida duplicados).

### 3. Identificar cada ítem contra el catálogo

Leer `references/proveedores.md` para saber qué cubre cada marca, cómo se arma el SKU y qué queda
siempre afuera.

Buscar en tandas, no de a un ítem: un solo `entrada.json` puede llevar muchos `skus`, `prefijos` y `textos`.
Lo que mejor funciona es ubicar la **serie** con una búsqueda de texto (`{"q": "compuerta \"clase 800\""}`,
con la frase entre comillas para que no matchee "API 800") y después traer toda la serie con `prefijos`
para elegir la medida. Empezar sin filtrar por marca: el catálogo tiene líneas (VALAR/VB, entre otras) que
cubren lo que GENEBRE no fabrica.

Para cada ítem decidir un estado:

- **Equivalente**: cumple medida, clase, extremos, material y condición de servicio de lo pedido.
- **Alternativa**: cumple la función pero difiere en algo que el cliente tiene que aceptar (diseño, material
  de internos, norma, marca distinta a la pedida). Escribir la diferencia en concreto.
- **A confirmar**: probablemente sirve pero falta un dato (del cliente o del fabricante).
- **Otro proveedor**: no está en catálogo. Anotar el motivo en una frase ("WC6 clase 600 BW para 480 °C,
  fuera de línea GENEBRE") para que quien pida precio sepa qué buscar.

**Válvulas actuadas.** Cuando piden una válvula con actuador (neumático, eléctrico o reductor), GENEBRE
tiene una tabla oficial de conjuntos armados. Consultarla con `"conjuntos": ["2528A 12"]`: devuelve el
actuador y los dados de acople que corresponden a esa válvula, con precio y stock. El conjunto se cotiza
en una sola línea (válvula + `adicionales`) y en el Excel se muestra cada componente en su fila. Si el
cliente pide un par o una tensión que la tabla no cubre, queda "A confirmar" con GENEBRE.

**Dos marcas para la misma posición.** Si una segunda marca del catálogo cubre lo mismo con mejor stock o
precio (ej. FMQ para una esférica inox que GENEBRE no tiene en stock), ofrecerla en una hoja aparte
rotulada como opción, sin sumarla al total, y cargarla en la cotización como alternativa del ítem.

**Marca pedida que no vendemos.** Si existe algo propio que cumple la función, ofrecerlo como Alternativa
con la diferencia explicada, aunque no sea idéntico: el cliente decide. Mandarlo a "otros proveedores"
solo cuando nada del catálogo sirve, o además de la alternativa si conviene cotizar también el original.

Verificar siempre contra el **nombre completo** del producto en el ERP, que describe material, norma,
rango de temperatura y diámetro; no asumir por el código. Si la condición de servicio está cerca del
límite del producto, decirlo.

### 4. Stock y plazo

`stockPropio` viene de Colppy. Para WINTERS sumar `stockWintersBsAs`; para FMQ y CENI/JMH pedir
`stockVivo` de los códigos que no se cubran con stock propio. Cobertura por ítem: "OK stock" si alcanza,
"parcial (N de M)" o "sin stock". Sin stock no se inventa un plazo: queda "A confirmar" y pasa a la lista de
cosas a preguntarle al proveedor.

### 5. Excel por proveedor

Nombre: `cotizacion-<rubro>-<CLIENTE>-por-proveedor.xlsx` (ej. `cotizacion-valvulas-EXAR-por-proveedor.xlsx`).
Si ya existe uno con ese nombre, no pisarlo: agregar la fecha o `-v2`.

Hojas, en este orden:

1. **RESUMEN** (hoja de texto): cliente y CUIT, qué documento se cotiza y de qué fecha, qué pide informar
   el cliente, una tabla Grupo / Ítems / Unidades / Total USD lista / Alcance, y al final dos listas:
   *Avisar al cliente* (incoherencias del pedido, alternativas a aceptar, datos que faltan) y
   *Pendientes internos* (precios y plazos a pedir, confirmaciones del fabricante).
2. **Una hoja por marca ofertable** (GENEBRE, WINTERS, FMQ...) con estas columnas: Ítem cliente ·
   Ref. cliente (TAG / SOLPED-pos.) · Pedido (descripción original resumida) · Cant. · Código propuesto ·
   Descripción del código · Lista USD · Dto. marca % · Neto USD unit. · Total USD (fórmula) · Stock ·
   Cobertura · Estado · Diferencias / a verificar · Plazo de entrega (`completar`).
   Colorear la fila según el estado: Alternativa y A confirmar en `amarillo`; Equivalente sin color.
3. **OTROS PROVEEDORES**: Ítem cliente · Ref. cliente · Rubro · Especificación completa · Marca/ref.
   pedida · Cant. · Motivo · Proveedor sugerido · Costo USD unit. (`completar`) · Total (fórmula) ·
   Plazo (`completar`).

Los precios de estas hojas son de **lista / neto antes del multiplicador del cliente**; decirlo en la
primera línea de cada hoja para que nadie los confunda con el precio de venta. Los totales y subtotales
van como fórmulas (columnas con `formula` y `total`), así la planilla sigue sirviendo cuando Santiago
completa o corrige un precio.

### 6. Pedidos de cotización a proveedores

Un archivo por proveedor: `pedido-cotizacion-<rubro>-<PROVEEDOR>.xlsx`, con una sola hoja pensada para
reenviarla tal cual. Encabezado: "PEDIDO DE COTIZACIÓN — <rubro>", "Solicita: VAL ARG S.R.L.", fecha, y la
obra o referencia si ayuda al proveedor. **No poner el nombre del cliente final ni precios de venta** salvo
que Santiago lo pida: el proveedor no tiene por qué conocerlos.

Columnas: Ítem · Marca · Modelo · Descripción / especificación · Cantidad · las columnas técnicas que ese
rubro necesita (para válvulas de seguridad: Entrada × Salida, Conexión, Presión de set, de cierre y de
servicio) · Precio unitario (`completar`) · Plazo de entrega (`completar`). Agrupar renglones idénticos y
sumar cantidades: al proveedor le sirve la cantidad total por especificación, no los TAG.

Cuando no se sabe a qué proveedor va algo, dejarlo en un único `pedido-cotizacion-<rubro>-otros-proveedores.xlsx`.
También va un pedido al fabricante de catálogo cuando hace falta plazo de importación o una confirmación
técnica (ej. empaquetadura para alta temperatura). Columnas: Ítem · Código · Descripción · Cantidad ·
A confirmar (la pregunta técnica concreta) · Plazo de entrega (`completar`).

### 7. Cotización en borrador en el ERP

Entran solo los ítems **con precio**: los de catálogo en estado Equivalente, y las Alternativas cargadas
como alternativa del ítem que reemplazan o como ítem principal con la diferencia aclarada en `notas`. Lo
que depende de otro proveedor queda afuera hasta tener costo; no se cargan ítems en cero.

Una línea por código, sumando cantidades, salvo que el cliente compre por posición (SOLPED, posiciones de
una OC): ahí va una línea por posición, porque después recibe y paga contra cada una. Cuando se agrupan
muchos TAG en una línea, `refCliente` lleva el rango de ítems (entra hasta 200 caracteres) y el detalle
de TAG va en `notasInternas`.

En cada ítem pasar `refCliente` con la referencia del cliente (TAG, "SOLPED 3000001204 · Pos. 30 · Mat.
8009384"): esa referencia viaja después al remito y a la factura, y hay clientes que la exigen. Pasar
`plazo` explícito.

Siempre en dos pasos:

1. Correr **sin** `--confirmar`. Devuelve la simulación con cada línea calculada igual que el ERP
   (lista × (1 − dto. de marca) × multiplicador, con IVA incluido si el cliente no es Responsable Inscripto).
2. Mostrarle a Santiago el resumen (cliente, vendedor, multiplicador, cantidad de ítems, total USD, lo que
   quedó afuera) y **esperar su OK** antes de correr con `--confirmar`. La cotización consume un número
   correlativo y aparece en el tablero de todo el equipo, así que no se crea "para probar".

Antes de simular, resolver con Santiago lo que el script no puede adivinar: el **vendedor** si el cliente no
tiene uno asignado, y el **multiplicador** si el del cliente es 1,00 pero las últimas cotizaciones usaron
otro. Las condiciones de pago por defecto son las de la última cotización al mismo cliente.

La cotización queda en estado DRAFT: no se envía al cliente desde acá.

### 8. Cierre

Responder con: los archivos generados (como links), el número y link de la cotización si se creó, y una
lista corta de lo que queda pendiente y de quién depende (cliente, proveedor, Santiago). Si conviene, un
texto breve para que Santiago le mande al cliente con las aclaraciones técnicas; solo como texto, sin
enviar nada.

## Criterios

- **Las cantidades son las del pedido.** No redondear a caja ni agregar repuestos sin decirlo.
- **Nunca inventar un precio, un costo ni un plazo.** Si no está en el ERP ni lo dio un proveedor, la celda
  queda para completar. Un margen estimado se rotula como estimado.
- **Diferencias de centavos por redondeo no son un problema** y no hace falta reportarlas.
- **Solo lectura salvo el alta confirmada.** `consultar-erp.ts` no escribe. No modificar precios, productos
  ni clientes en producción como parte de un presupuesto; si falta cargar algo, avisarlo.
- Si `prod.sh` falla por conexión, reintentar una vez y, si sigue, avisar: no usar la base local como
  reemplazo, porque daría precios viejos con apariencia de válidos.
