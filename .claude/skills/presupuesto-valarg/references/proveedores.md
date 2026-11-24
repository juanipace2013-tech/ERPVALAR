# Proveedores y marcas de Val Arg

Para decidir en qué hoja va cada ítem, qué costo usar y de dónde sale el stock. Las reglas de costo son
de Santiago; si un caso no encaja, preguntarle antes de inventar un margen.

| Marca en el ERP | Qué cubre | Lista / venta | Costo | Stock |
|---|---|---|---|---|
| **GENEBRE** | Válvulas industriales e hidrosanitarias: esféricas (roscadas, bridadas, 3 piezas), compuerta/globo/retención en bronce, inox, WCB y forjado A105 cl.800, mariposas wafer/lug, retención wafer, filtros Y, actuadores, electroválvulas, purgadores, reductoras de vapor | `listaUSD` del ERP; la venta sale de lista × multiplicador del cliente | Casi nunca cargado; referencia lista × 0,70 | `stockPropio`. Sin stock = importación: el plazo hay que pedírselo a GENEBRE (Genebre no comparte cantidades de su stock) |
| **WINTERS** | Manómetros, termómetros, transmisores, sellos, válvulas de aguja/manifold para instrumentos | Lista con 40% de descuento de marca (ya viene en `descuentoMarcaPct` / `netoUSD`) | lista × 0,35 | `stockPropio` + `stockWintersBsAs` (planilla semanal del depósito de Winters en Bs. As.; si el código no figura, no hay stock local) |
| **FMQ** (FAMIQ) | Acero inoxidable: válvulas industriales y sanitarias, clamp, accesorios | Lista ERP = costo × 1,40 | Precio negociado, cargado en `costoUSD` | En vivo por sucursal: `stockVivo` |
| **CENI / JMH** | Manómetros, termómetros e instrumentación nacional | Lista pública de la tienda | lista pública × 0,65 | En vivo: `stockVivo` |
| **CODITAL, ANC, BERMAD, ERA, IRRITEC, PMGROUP** (Todoválvulas / Todoriego) | Agua y riego: PVC/PEAD, válvulas de aire, hidrantes, caudalímetros, electrofusión, mangas | Lista = precio de venta | lista × 0,65 | Solo `stockPropio`; consultar al proveedor |
| **VALAR / VB** (proveedor Válvulas Baumann) | Acero nacional: esclusas, globo y retención en WCB y forjado A105, clases 150 a 1500, bridadas, SW y NPT; también hierro fundido en medidas grandes. Primera opción cuando GENEBRE no llega en clase o medida | Lista ERP | Cargado en `costoUSD` | Fabricación a pedido: plazo a confirmar con Baumann |
| **CEPEX, RAIN BIRD, ASTRAL, SAB** | PVC/termoplástico, riego, piscinas | Lista ERP | — | `stockPropio` |

## Lo que no está en catálogo (hoja "OTROS PROVEEDORES" + pedido de cotización)

- **Válvulas de seguridad / alivio (LESER, Consolidated, API 526):** se piden a **Turbigas**. El pedido lleva
  marca, modelo, cantidad, entrada × salida, conexión, presión de set, de cierre y de servicio, fluido y
  temperatura. Si el cliente no dio presión de set, es lo primero que hay que preguntarle.
- **Aleaciones especiales (dúplex 2205, súper dúplex, titanio):** WSV / Weidouli (China, FOB Shanghai,
  ~13 semanas). Para minería y servicio corrosivo.
- **Bridas y accesorios de cañería:** EMI.
- **Fuera de la línea GENEBRE** (lo que más aparece en pliegos): acero aleado WC6 / F11 / F22 para vapor
  a más de ~425 °C, clase 300+ con extremos butt-weld, clase 600 y superiores en fundido, esféricas
  trunnion / API 6D de línea, mariposas de alto rendimiento (doble/triple excéntrica, API 609 cat. B),
  válvulas a diafragma (Saunders), repuestos de una marca específica.

## Trampas conocidas

- **SKU GENEBRE** = código de la lista PDF sin el prefijo `001` (`0013028 04` → `3028 04`). Los dos últimos
  dígitos son la medida: 02=1/4", 03=3/8", 04=1/2", 05=3/4", 06=1", 07=1¼", 08=1½", 09=2", 10=2½", 11=3",
  12=4", 13=5", 14=6", 16=8", 18=10", 20=12", 22=14", 24=16", 26=18", 28=20", 32=24". Verificarlo contra el nombre del producto, que siempre
  termina en `Diámetro X"`.
- **Equivalente no es lo mismo que alternativa.** Si el cliente pide una marca/modelo (Bray, KSB, Saunders)
  y GENEBRE tiene algo que cumple la misma función pero difiere en diseño, material o norma, es una
  *alternativa*: se ofrece marcando la diferencia, no se presenta como equivalente.
- **Límites de temperatura y presión:** el nombre del producto en el ERP trae el rango (ej. WCB "-20 +400 °C").
  Contrastarlo siempre con la condición de servicio del pliego; la ficha técnica (`tieneFicha`) tiene la
  curva presión-temperatura.
- **El catálogo tiene más marcas que las de la tabla.** Antes de mandar algo a "otros proveedores",
  buscarlo por texto **sin** filtrar por marca: puede estar en VALAR/VB u otra línea cargada.
- **El nombre del producto no siempre trae el límite de temperatura** (ej. serie 2232S). Si el servicio es
  exigente y el dato no está, queda "A confirmar" con el fabricante; no darlo por bueno.
- **Multiplicador del cliente en 1,00** puede ser deliberado o que nunca se cargó. Mirar las últimas
  cotizaciones (`ultimas`) para ver con cuánto se le viene cotizando y preguntarle a Santiago si no coincide.
