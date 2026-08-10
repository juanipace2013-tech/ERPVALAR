/**
 * Cálculo de selección de válvulas reductoras de presión de vapor
 * GENEBRE Art. 2274 / 2274N / 2275 (pilotadas, vapor saturado / aire comprimido)
 *
 * Replica exactamente la planilla de cálculo de Genebre Argentina.
 * Verificado contra caso de referencia: P1=4, P2=2, Q=300 kg/h
 *   → SUBCRÍTICO, CV calc 7,27, medida 1", CV elegido 9,36, 77,59% de trabajo.
 *
 * Fórmulas (Q en kg/h, presiones en bar manométricas):
 *   Flujo SUBCRÍTICO (ΔP ≤ P1/2):  CV = Q / (11,92 · √(ΔP · (P1 + P2)))
 *   Flujo CRÍTICO   (ΔP > P1/2):   CV = Q / (9,6 · P1)
 *   CV de cada medida = Kv (ficha técnica GENEBRE) × 1,156
 *
 * Colocar en: src/lib/calculoReguladoraVapor.ts
 */

export type RegimenFlujo = "SUBCRÍTICO" | "CRÍTICO";

export interface MedidaValvula {
  /** Denominación comercial */
  medida: string;
  /** DN equivalente */
  dn: number;
  /** Kv en m³/h según ficha técnica GENEBRE 2274/2275 (rev. 04/2021) */
  kv: number;
  /** CV = Kv × 1,156 */
  cv: number;
  /** % de trabajo de esta medida para el CV calculado (0–n, fracción) */
  porcentajeTrabajo: number;
}

export interface PuntoBanda {
  /** Caudal en kg/h (del 20% al 200% del caudal de diseño) */
  caudal: number;
  /** CV requerido para ese caudal */
  cv: number;
  /** % de apertura respecto del CV elegido (fracción; null si no hay medida) */
  porcentajeApertura: number | null;
  /** true si es el caudal de diseño */
  esDiseno: boolean;
}

export interface Verificacion {
  descripcion: string;
  ok: boolean;
  detalle: string;
}

export interface ResultadoCalculo {
  p1: number;
  p2: number;
  q: number;
  deltaP: number;
  p1Medio: number;
  regimen: RegimenFlujo;
  cvCalculado: number;
  /** Tabla completa de medidas con su % de trabajo */
  medidas: MedidaValvula[];
  /** Medida seleccionada (la menor con % de trabajo ≤ 80%), o null si fuera de rango */
  seleccion: MedidaValvula | null;
  fueraDeRango: boolean;
  banda: PuntoBanda[];
  verificaciones: Verificacion[];
}

/** Factor de conversión Kv → Cv usado por la planilla Genebre */
export const FACTOR_KV_CV = 1.156;

/** Banda de operación recomendada */
export const BANDA_MIN = 0.2;
export const BANDA_MAX = 0.8;

/** Kv por medida — ficha técnica GENEBRE 2274/2275, rev. 04/2021 */
export const TABLA_MEDIDAS: ReadonlyArray<{ medida: string; dn: number; kv: number }> = [
  { medida: '1/2"', dn: 15, kv: 2.8 },
  { medida: '3/4"', dn: 20, kv: 5.5 },
  { medida: '1"', dn: 25, kv: 8.1 },
  { medida: '1 1/4"', dn: 32, kv: 12 },
  { medida: '1 1/2"', dn: 40, kv: 17 },
  { medida: '2"', dn: 50, kv: 28 },
];

/** CV requerido para un caudal dado, según régimen. */
export function cvRequerido(q: number, p1: number, p2: number): number {
  const deltaP = p1 - p2;
  // Nota: la planilla Genebre trata ΔP = P1/2 como subcrítico (≤, no <).
  if (deltaP <= p1 / 2) {
    return q / (11.92 * Math.sqrt(deltaP * (p1 + p2)));
  }
  return q / (9.6 * p1);
}

export function calcularReguladoraVapor(p1: number, p2: number, q: number): ResultadoCalculo {
  if (!(p1 > 0) || !(p2 > 0) || !(q > 0) || p2 >= p1) {
    throw new Error("Parámetros inválidos: se requiere P1 > P2 > 0 y Q > 0.");
  }

  const deltaP = p1 - p2;
  const p1Medio = p1 / 2;
  const regimen: RegimenFlujo = deltaP <= p1Medio ? "SUBCRÍTICO" : "CRÍTICO";
  const cvCalculado = cvRequerido(q, p1, p2);

  const medidas: MedidaValvula[] = TABLA_MEDIDAS.map((m) => {
    const cv = m.kv * FACTOR_KV_CV;
    return { ...m, cv, porcentajeTrabajo: cvCalculado / cv };
  });

  // Selección: la medida más chica cuyo % de trabajo quede ≤ 80%.
  const seleccion = medidas.find((m) => m.porcentajeTrabajo <= BANDA_MAX) ?? null;
  const fueraDeRango = seleccion === null;

  const banda: PuntoBanda[] = Array.from({ length: 10 }, (_, i) => {
    const caudal = q * 0.2 * (i + 1);
    const cv = cvRequerido(caudal, p1, p2);
    return {
      caudal,
      cv,
      porcentajeApertura: seleccion ? cv / seleccion.cv : null,
      esDiseno: i === 4, // 100% del caudal de diseño
    };
  });

  const pct = seleccion ? seleccion.porcentajeTrabajo : null;
  const verificaciones: Verificacion[] = [
    {
      descripcion: "Banda de operación 20%–80%",
      ok: pct !== null && pct >= BANDA_MIN && pct <= BANDA_MAX,
      detalle:
        pct === null
          ? "Sin medida seleccionada"
          : pct < BANDA_MIN
            ? "SOBREDIMENSIONADA (<20%): regulación inestable a baja apertura"
            : pct > BANDA_MAX
              ? "EXIGIDA (>80%): sin margen de regulación"
              : "OK",
    },
    {
      descripcion: "Régimen de flujo subcrítico",
      ok: regimen === "SUBCRÍTICO",
      detalle:
        regimen === "SUBCRÍTICO"
          ? "OK"
          : "CRÍTICO (ΔP > P1/2): recomendación GENEBRE, evaluar la reducción en dos etapas con dos reguladoras en serie (bajar a una presión intermedia y de ahí a la regulada). Menos ruido y desgaste, mejor regulación.",
    },
    {
      descripcion: "P1 ≤ 17 bar (máx. aguas arriba, vapor saturado)",
      ok: p1 <= 17,
      detalle: p1 <= 17 ? "OK" : "Excede la presión máxima de trabajo aguas arriba",
    },
    {
      descripcion: "P2 entre 0,5 y 12 bar (rango del muelle estándar)",
      ok: p2 >= 0.5 && p2 <= 12,
      detalle: p2 >= 0.5 && p2 <= 12 ? "OK" : "Fuera del rango del muelle de regulación",
    },
    {
      descripcion: "ΔP ≤ 17 bar (presión diferencial máxima)",
      ok: deltaP <= 17,
      detalle: deltaP <= 17 ? "OK" : "Excede el diferencial máximo",
    },
    {
      descripcion: "Relación de reducción ≤ 10:1",
      ok: p1 / p2 <= 10,
      detalle: p1 / p2 <= 10 ? "OK" : "Instalar dos válvulas en serie (manual GENEBRE §4.2)",
    },
  ];

  return {
    p1,
    p2,
    q,
    deltaP,
    p1Medio,
    regimen,
    cvCalculado,
    medidas,
    seleccion,
    fueraDeRango,
    banda,
    verificaciones,
  };
}

/** Resumen en texto plano para pegar en cotizaciones o mails. */
export function resumenTexto(r: ResultadoCalculo): string {
  const fmt = (n: number, d = 2) => n.toFixed(d).replace(".", ",");
  const lineas = [
    "SELECCIÓN DE REGULADORA DE VAPOR — GENEBRE 2274/2274N/2275",
    `Condiciones: P1 = ${fmt(r.p1)} bar | P2 = ${fmt(r.p2)} bar | Q = ${fmt(r.q, 0)} kg/h`,
    `Régimen de flujo: ${r.regimen} (ΔP = ${fmt(r.deltaP)} bar, P1/2 = ${fmt(r.p1Medio)} bar)`,
    `CV calculado: ${fmt(r.cvCalculado)}`,
    r.seleccion
      ? `Medida recomendada: ${r.seleccion.medida} (DN${r.seleccion.dn}) — CV ${fmt(r.seleccion.cv)} — ${fmt(r.seleccion.porcentajeTrabajo * 100)}% de trabajo (banda 20%–80%)`
      : "FUERA DE RANGO: el caudal excede la capacidad de 2\" — evaluar válvula mayor o dos en paralelo",
  ];
  if (r.regimen === "CRÍTICO") {
    lineas.push(
      "Recomendación GENEBRE (régimen crítico): evaluar la reducción en dos etapas con dos reguladoras en serie, bajando a una presión intermedia y de ahí a la regulada.",
    );
  }
  return lineas.join("\n");
}

/* ------------------------------------------------------------------ */
/* Casos de verificación (copiar a un test o correr con tsx/vitest)    */
/* ------------------------------------------------------------------ */
export function verificarCasoReferencia(): void {
  const r = calcularReguladoraVapor(4, 2, 300);
  const aprox = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol;

  console.assert(r.regimen === "SUBCRÍTICO", "régimen debe ser SUBCRÍTICO");
  console.assert(aprox(r.cvCalculado, 7.2653), `CV calc ${r.cvCalculado} ≠ 7.2653`);
  console.assert(r.seleccion?.medida === '1"', `medida ${r.seleccion?.medida} ≠ 1"`);
  console.assert(aprox(r.seleccion!.cv, 9.3636), `CV elegido ${r.seleccion?.cv} ≠ 9.3636`);
  console.assert(
    aprox(r.seleccion!.porcentajeTrabajo, 0.7759, 0.0005),
    `% trabajo ${r.seleccion?.porcentajeTrabajo} ≠ 77,59%`,
  );
  console.assert(aprox(r.banda[0].porcentajeApertura!, 0.1552, 0.0005), "banda 60 kg/h ≠ 15,52%");
  console.assert(aprox(r.banda[9].porcentajeApertura!, 1.5518, 0.0005), "banda 600 kg/h ≠ 155,18%");

  // Caso crítico: ΔP > P1/2 → CV = Q/(9,6·P1)
  const rc = calcularReguladoraVapor(10, 2, 1000);
  console.assert(rc.regimen === "CRÍTICO", "régimen debe ser CRÍTICO");
  console.assert(aprox(rc.cvCalculado, 1000 / (9.6 * 10)), "CV crítico incorrecto");

  console.log("verificarCasoReferencia: OK");
}
