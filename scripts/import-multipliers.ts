/**
 * Script: import-multipliers.ts
 * Importa multiplicadores de precio para clientes existentes en la BD.
 *
 * Uso: npx tsx scripts/import-multipliers.ts
 *
 * Estrategia de búsqueda (en orden):
 * 1. Exacto (case insensitive) en name, businessName
 * 2. Contains en name, businessName con palabra clave principal
 * 3. Refinamiento con múltiples keywords si hay varios candidatos
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const clientMultipliers = [
  { name: "A EVANGELISTA S A", multiplier: 1.30 },
  { name: "ACHERAL S.A.", multiplier: 1.11 },
  { name: "ADEA ADMINISTRADORA DE ARCHIVOS SA", multiplier: 1.10 },
  { name: "AGRICULTORES FEDERADOS ARGENTINOS SOC COOP LTDA", multiplier: 1.21 },
  { name: "AGROFINA S A", multiplier: 1.10 },
  { name: "AGUA Y SANEAMIENTOS ARGENTINOS SOCIEDAD ANONIMA", multiplier: 1.45 },
  { name: "AGUAS BONAERENSES S.A.", multiplier: 1.45 },
  { name: "ALUAR ALUMINIO ARGENTINO SOCIEDAD ANONIMA INDUSTRIAL Y COMERCIAL", multiplier: 1.30 },
  { name: "ANTARES NAVIERA SOCIEDAD ANONIMA", multiplier: 1.11 },
  { name: "ARTE GRAFICO EDITORIAL ARGENTINO S A", multiplier: 1.10 },
  { name: "ASOCIACION DE LOS TESTIGOS DE JEHOVA", multiplier: 1.10 },
  { name: "ATANOR SOCIEDAD EN COMANDITA POR ACCIONES", multiplier: 1.10 },
  { name: "AUSTIN POWDER ARGENTINA S A", multiplier: 1.10 },
  { name: "AZUL NATURAL BEEF S.A.", multiplier: 1.11 },
  { name: "BACS SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "BELGRANO CARGAS Y LOGISTICA SA", multiplier: 1.10 },
  { name: "BENITO ROGGIO E HIJOS S.A.-JOSE CARTELLONE CONSTRUCCIONES CIV.S.A.-SUPERCEMENTO S.A.I.YC. UTE", multiplier: 1.11 },
  { name: "BIO TRINIDAD SOCIEDAD ANONIMA", multiplier: 1.04 },
  { name: "BIOELECTRICA DOS S.A", multiplier: 1.10 },
  { name: "BIOSIDUS SOCIEDAD ANONIMA", multiplier: 1.21 },
  { name: "BOMBAS GRUNDFOS DE ARGENTINA S.A.U", multiplier: 1.10 },
  { name: "CARTELLONE OIL&GAS S.A.U.", multiplier: 1.20 },
  { name: "CENTRAL COSTANERA S.A.", multiplier: 1.20 },
  { name: "CENTRAL DOCK SUD SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "CENTRAL PUERTO S A", multiplier: 1.20 },
  { name: "CENTRAL TERMICA ROCA S.A.", multiplier: 1.20 },
  { name: "CENTRALES DE LA COSTA ATLANTICA SA", multiplier: 1.21 },
  { name: "CERAMICA ALBERDI S A", multiplier: 1.21 },
  { name: "CITROMAX SOCIEDAD ANONIMA COMERCIAL E INDUSTRIAL", multiplier: 1.10 },
  { name: "CITRUSVIL S.A.", multiplier: 1.10 },
  { name: "CLUB ATLETICO RIVER PLATE ASOC CIVIL", multiplier: 1.10 },
  { name: "COLORTEX S A", multiplier: 1.05 },
  { name: "COMPANIA INVERSORA INDUSTRIAL S.A.", multiplier: 1.15 },
  { name: "COMPAÑIA ARGENTINA DE LEVADURAS S A I C", multiplier: 1.15 },
  { name: "COMPAÑIA NAVIOS ARGENTINA S.A.", multiplier: 1.10 },
  { name: "CONSTRUCTORA SUDAMERICANA S A C I F INMOB Y AGROP", multiplier: 1.10 },
  { name: "COORDINACION ECOLOGICA AREA METROPOLITANA SOCIEDAD DEL ESTADO", multiplier: 1.11 },
  { name: "COTEMINAS ARGENTINA SOCIEDAD ANONIMA", multiplier: 1.06 },
  { name: "COTO CENTRO INTEGRAL DE COMERCIALIZACION SOCIEDAD ANONIMA", multiplier: 1.20 },
  { name: "CR CONSTRUCTORA SRL", multiplier: 1.10 },
  { name: "CT BARRAGAN S.A.", multiplier: 1.11 },
  { name: "CULLIGAN ARGENTINA SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "DANIEL RICCA SA", multiplier: 1.10 },
  { name: "DECAVIAL S.A.I.C.A.C.", multiplier: 1.10 },
  { name: "DECAVIAL S.A.I.C.A.C. - ESUCO S.A. - SUPERCEMENTO S.A.I.C. - FIORITO - UTE", multiplier: 1.10 },
  { name: "DECAVIAL SAICAC", multiplier: 1.10 },
  { name: "DECAVIAL SAICAC - ESUCO SA - RP 46 - UTE", multiplier: 1.10 },
  { name: "DEL PLATA INGENIERIA S A", multiplier: 1.10 },
  { name: "DESTILERIA ARGENTINA DE PETROLEO SA", multiplier: 1.10 },
  { name: "ECO MINERA S A", multiplier: 1.21 },
  { name: "EMPRESA DISTRIBUIDORA Y COMERCIALIZADORA NORTE SOCIEDAD ANONIMA (EDENOR S A)", multiplier: 1.15 },
  { name: "ENEL GENERACION COSTANERA SOCIEDAD ANONIMA", multiplier: 1.18 },
  { name: "ESTABLECIMIENTO FRIGORIFICO AZUL S A", multiplier: 1.11 },
  { name: "ESTREMAR S.A.U.", multiplier: 1.11 },
  { name: "ETERNIT ARGENTINA SA", multiplier: 1.15 },
  { name: "F V SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "FADEL  SA", multiplier: 1.11 },
  { name: "FATE SAICI", multiplier: 1.30 },
  { name: "FIDEICOMISO TRINIDAD", multiplier: 1.04 },
  { name: "FRIGOLAR S. A.", multiplier: 1.11 },
  { name: "FRIGORIFICO COSTANZO S A", multiplier: 1.11 },
  { name: "FRIGORIFICO DE AVES SOYCHU SAICFIA", multiplier: 1.11 },
  { name: "FRIGORIFICO EL BIERZO S A", multiplier: 1.11 },
  { name: "FRIGORIFICO FAIMALI SOCIEDAD ANONIMA", multiplier: 1.11 },
  { name: "FRIGORIFICO GENERAL PICO S A", multiplier: 1.11 },
  { name: "FRIGORIFICO GORINA S A I C", multiplier: 1.15 },
  { name: "FRIGORIFICO INDUSTRIAL DEL NORTE SA", multiplier: 1.11 },
  { name: "FRIGORIFICO LAMAR S A", multiplier: 1.11 },
  { name: "FRIGORIFICO MARK S.A.", multiplier: 1.11 },
  { name: "FRIGORIFICO MONTECARLO SA", multiplier: 1.11 },
  { name: "FRIGORIFICO RIOPLATENSE S A I C I F", multiplier: 1.11 },
  { name: "FRIGORIFICO SAN AGUSTIN SRL", multiplier: 1.11 },
  { name: "FUEGOTECNIC S R L", multiplier: 1.05 },
  { name: "GALAN LITIO S. A.", multiplier: 1.21 },
  { name: "GEA FARM TECHNOLOGIES ARGENTINA S R L", multiplier: 1.10 },
  { name: "GEA PROCESS ENGINEERING SA", multiplier: 1.10 },
  { name: "GENERACION MEDITERRANEA S.A.", multiplier: 1.20 },
  { name: "GERARDO RAMON Y CIA S A I C", multiplier: 1.10 },
  { name: "GRUPO COMECA (ARGENTINA) SA", multiplier: 1.20 },
  { name: "HEMPEL ARGENTINA S R L", multiplier: 1.10 },
  { name: "HENN Y CIA SRL", multiplier: 1.15 },
  { name: "HIDRAULICA CVC S.A.S.", multiplier: 1.10 },
  { name: "HOERBIGER DE ARGENTINA SA", multiplier: 1.02 },
  { name: "INDUSTRIAS METALURGICAS PESCARMONA SAICF", multiplier: 1.10 },
  { name: "INDUSTRIAS QUIMICAS Y MINERAS TIMBO SA", multiplier: 1.21 },
  { name: "INFA SOCIEDAD ANONIMA", multiplier: 1.21 },
  { name: "INGENIERIA BERNOULLI S.A.", multiplier: 1.10 },
  { name: "INNOVACION TECNICA TOTAL S.A.", multiplier: 1.10 },
  { name: "INQUINAT SA", multiplier: 1.05 },
  { name: "INVAP SE", multiplier: 1.10 },
  { name: "JUGOS S A", multiplier: 1.10 },
  { name: "KLEPPE SA", multiplier: 1.10 },
  { name: "KSB ARGENTINA S. A.", multiplier: 1.15 },
  { name: "LABORATORIOS POEN SOCIEDAD ANONIMA COMERCIAL INDUSTRIAL FINANCIERA E INMOBILIARI", multiplier: 1.10 },
  { name: "LACTEOS CONOSUR S A", multiplier: 1.10 },
  { name: "LIEX S.A.", multiplier: 1.21 },
  { name: "LITIO MINERA ARGENTINA SOCIEDAD ANONIMA", multiplier: 1.21 },
  { name: "LUBRICANTES AVELLANEDA S.A.U.", multiplier: 1.10 },
  { name: "LUIS ALBERTO SABOREDO", multiplier: 1.11 },
  { name: "M ROYO S. A.", multiplier: 1.20 },
  { name: "MAN SER SOCIEDAD DE RESPONSABILIDAD LIMITADA", multiplier: 1.10 },
  { name: "MANSFIELD MINERA  S A", multiplier: 1.21 },
  { name: "MANUEL SANMARTIN S A", multiplier: 1.20 },
  { name: "MATADERO Y FRIGORIFICO MERLO SA", multiplier: 1.11 },
  { name: "MAURO PAUL SUAREZ", multiplier: 1.10 },
  { name: "MEGA ENERGIAS SA", multiplier: 1.10 },
  { name: "MINERA DEL ALTIPLANO S A", multiplier: 1.21 },
  { name: "MINERA EXAR SA", multiplier: 1.21 },
  { name: "MINERA SANTA CRUZ S.A", multiplier: 1.21 },
  { name: "MINERA SANTA RITA SRL", multiplier: 1.21 },
  { name: "MINERA TEA S A M I C A Y F", multiplier: 1.21 },
  { name: "MINERAR SA", multiplier: 1.21 },
  { name: "MIRBLA S A", multiplier: 1.10 },
  { name: "MOLINO CAÑUELAS SOCIEDAD ANONIMA COMERCIAL INDUSTRIAL  FINANCIERA INMOBILIARIA Y AGROPECUARIA", multiplier: 1.25 },
  { name: "MORIXE HERMANOS SOCIEDAD ANONIMA COMERCIAL E INDUSTRIAL", multiplier: 1.11 },
  { name: "MSU ENERGY S.A.", multiplier: 1.10 },
  { name: "NEWSAN SOCIEDAD ANONIMA", multiplier: 1.21 },
  { name: "OILFIELD SERVICES S.A.", multiplier: 1.21 },
  { name: "OLIGRA SUDAMERICANA S.A.", multiplier: 1.10 },
  { name: "PALMERO SAN LUIS SA", multiplier: 1.10 },
  { name: "PAMPA ENERGIA S A", multiplier: 1.10 },
  { name: "PAN AMERICAN ENERGY, S.L.,  SUCURSAL ARGENTINA", multiplier: 1.10 },
  { name: "PANEDILE ARGENTINA S.A.I.C.F. E I. - ROVELLA CARRANZA S.A. - ELEPRINT S.A. - COARCO S.A. UTE", multiplier: 1.10 },
  { name: "PANEDILE ARGENTINA S.A.I.C.F.E I. - ESUCO S.A - ECOPRENEUR S.A. - UNION TRANSITORIA", multiplier: 1.10 },
  { name: "PANEDILE ARGENTINA SA IND COM FIN EINMOB", multiplier: 1.10 },
  { name: "PAPELERA DEL NOA SA", multiplier: 1.20 },
  { name: "PAPELERA SAMSENG SA", multiplier: 1.10 },
  { name: "PATAGONIA GOLD S.A.", multiplier: 1.21 },
  { name: "PEHUENCHE S R L", multiplier: 1.11 },
  { name: "PRAXAIR ARGENTINA SOCIEDAD DE RESPONSABILIDAD LIMITADA", multiplier: 1.18 },
  { name: "PRYSMIAN ENERGIA CABLES Y SISTEMAS DE ARG. SA", multiplier: 1.21 },
  { name: "PUNA MINING S.A.", multiplier: 1.21 },
  { name: "QUERUCLOR SRL", multiplier: 1.10 },
  { name: "QUICKFOOD S A", multiplier: 1.21 },
  { name: "QUIMICA MONTPELLIER S A", multiplier: 1.10 },
  { name: "QUIMICA OESTE SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "RAFAEL G ALBANESI  SOCIEDAD ANONIMA", multiplier: 1.20 },
  { name: "REFINERIAS DE GRASAS SUDAMERICANA S.A.", multiplier: 1.15 },
  { name: "RICARDO SIXTO ANSONNAUD", multiplier: 1.04 },
  { name: "RIS SOCIEDAD ANONIMA", multiplier: 1.11 },
  { name: "S.N.F. ARGENTINA S.R.L.", multiplier: 1.10 },
  { name: "SACDE SOCIEDAD ARGENTINA DE CONSTRUCCION Y DESARROLLO ESTRATEGICO S.A.", multiplier: 1.10 },
  { name: "SALES DE JUJUY SOCIEDAD ANONIMA", multiplier: 1.21 },
  { name: "SALTA REFRESCOS S A", multiplier: 1.11 },
  { name: "SERVICIOS Y PRODUCTOS PARA BEBIDAS REFRESCANTES SOCIEDAD DE RESPONSABILIDAD LIMITADA", multiplier: 1.10 },
  { name: "SIAT SOCIEDAD ANONIMA", multiplier: 1.21 },
  { name: "SIDERCA S A I C", multiplier: 1.21 },
  { name: "SIDUS SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "SILVATEAM ENERGIAS RENOVABLES S.A.", multiplier: 1.10 },
  { name: "SILVIA ESTER GONZALEZ", multiplier: 1.12 },
  { name: "SINERGIUM BIOTECH SA", multiplier: 1.10 },
  { name: "SINTEPLAST SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "SODECAR SA", multiplier: 1.20 },
  { name: "SOL MINERALES Y SERVICIOS SA", multiplier: 1.21 },
  { name: "SPIRAX SARCO S A", multiplier: 1.18 },
  { name: "SUAVESTAR S.A.", multiplier: 1.10 },
  { name: "SUCESORES DE ALFREDO WILLINER S A", multiplier: 1.15 },
  { name: "SUPERCEMENTO SAIC - ROVELLA CARRANZA SA - 2DO ACUED P INTERIOR CHACO U T", multiplier: 1.10 },
  { name: "TANDANOR SACI Y N", multiplier: 1.28 },
  { name: "TECHINT COMPAÑIA TECNICA INTERNACIONAL SOCIEDAD ANONIMA COMERCIAL E INDUSTRIAL", multiplier: 1.15 },
  { name: "TECHINT CTI SACI - SACDE SA - UTE", multiplier: 1.15 },
  { name: "TECHINT SACEI SACDE S.A. ARGENTINA DE CONSTRUCCION Y DESARROLLO UTE", multiplier: 1.15 },
  { name: "TECHINT SAIC", multiplier: 1.15 },
  { name: "TECHNIA S A", multiplier: 1.10 },
  { name: "TECNOLOGIA ARGENTINA EN CINTAS SA T A C S A", multiplier: 1.11 },
  { name: "TECNOTAR SA", multiplier: 1.21 },
  { name: "TECPETROL S A", multiplier: 1.21 },
  { name: "TERNIUM ARGENTINA S A", multiplier: 1.21 },
  { name: "TETRA DE ARGENTINA S.R.L.", multiplier: 1.05 },
  { name: "TIGRE ARGENTINA S. A.", multiplier: 1.11 },
  { name: "TOYOTA ARGENTINA S A", multiplier: 1.15 },
  { name: "TUBOSCOPE VETCO DE ARGENTINA S A", multiplier: 1.15 },
  { name: "TYC  S.A", multiplier: 1.10 },
  { name: "UT MINERA SAL DE LOS ANGELES - POTASIO Y LITIO DE ARGENTINA SA - SALTA EXPLORACIONES SA", multiplier: 1.21 },
  { name: "VARTECO QUIMICA PUNTANA S A", multiplier: 1.10 },
  { name: "VEOLIA SERVICIOS Y GESTION DE ENERGIA ARGENTINA S.A.U", multiplier: 1.11 },
  { name: "VEOLIA WATER TECHNOLOGIES ARGENTINA S.A.", multiplier: 1.11 },
  { name: "VICENTE TRAPANI S.A.", multiplier: 1.21 },
  { name: "VICENTIN S.A.I.C.", multiplier: 1.21 },
  { name: "YKK ARGENTINA SOCIEDAD ANONIMA", multiplier: 1.10 },
  { name: "YPF ENERGIA ELECTRICA S.A.", multiplier: 1.30 },
  { name: "YPF GAS S.A.", multiplier: 1.30 },
]

async function main() {
  console.log('='.repeat(70))
  console.log('IMPORTACION DE MULTIPLICADORES DE CLIENTES')
  console.log(`Total a procesar: ${clientMultipliers.length} clientes`)
  console.log('='.repeat(70))
  console.log('')

  let updated = 0
  let notFound = 0
  const notFoundList: string[] = []
  const updatedList: { name: string; multiplier: number; matchType: string }[] = []

  // Palabras comunes a ignorar en la búsqueda por keywords
  const STOP_WORDS = new Set([
    'SOCIEDAD', 'ANONIMA', 'RESPONSABILIDAD', 'LIMITADA', 'COMERCIAL',
    'INDUSTRIAL', 'FINANCIERA', 'INMOBILIARIA', 'AGROPECUARIA', 'CIVIL',
    'SUCURSAL', 'ARGENTINA', 'ARGENTINO', 'ARGENTINOS', 'UNION', 'TRANSITORIA',
    'UTE', 'CONSTRUCCIONES', 'EMPRESA', 'SERVICIOS', 'NORTE', 'NACIONAL',
    'GENERAL', 'COMPAÑIA', 'COMPANIA', 'GRUPO', 'INTERNACIONAL',
  ])

  for (const entry of clientMultipliers) {
    const searchName = entry.name.trim()

    // 1. Buscar por nombre exacto (case insensitive) en name y businessName
    let customer = await prisma.customer.findFirst({
      where: {
        OR: [
          { name: { equals: searchName, mode: 'insensitive' } },
          { businessName: { equals: searchName, mode: 'insensitive' } },
        ],
      },
    })

    let matchType = 'exacto'

    // 2. Si no encuentra, buscar con contains en name y businessName
    if (!customer) {
      // Extraer palabras clave significativas (>3 chars, no stop words)
      const keywords = searchName
        .split(/[\s\-,\.()]+/)
        .filter(w => w.length > 3)
        .filter(w => !STOP_WORDS.has(w.toUpperCase()))

      if (keywords.length > 0) {
        // Buscar con la primera palabra clave significativa
        const mainKeyword = keywords[0]
        const candidates = await prisma.customer.findMany({
          where: {
            OR: [
              { name: { contains: mainKeyword, mode: 'insensitive' } },
              { businessName: { contains: mainKeyword, mode: 'insensitive' } },
            ],
          },
        })

        // Si hay un solo candidato, usarlo
        if (candidates.length === 1) {
          customer = candidates[0]
          matchType = `contains("${mainKeyword}")`
        } else if (candidates.length > 1) {
          // Si hay varios, intentar con más keywords para refinar
          const refined = candidates.filter(c => {
            const fullName = `${c.name} ${c.businessName || ''}`.toUpperCase()
            return keywords.slice(0, 3).every(kw => fullName.includes(kw.toUpperCase()))
          })
          if (refined.length === 1) {
            customer = refined[0]
            matchType = `refinado(${keywords.slice(0, 3).join('+')})`
          } else if (refined.length > 1) {
            // Tomar el primero como mejor match
            customer = refined[0]
            matchType = `primer-match(${refined.length} candidatos)`
          }
        }

        // 3. Si todavía no encuentra, intentar con el nombre completo como substring
        if (!customer) {
          // Intentar buscar el nombre de la BD que contenga alguna keyword del script
          // y viceversa, usando todas las keywords
          const allCandidates = await prisma.customer.findMany({
            where: {
              OR: keywords.flatMap(kw => [
                { name: { contains: kw, mode: 'insensitive' as const } },
                { businessName: { contains: kw, mode: 'insensitive' as const } },
              ]),
            },
          })

          if (allCandidates.length === 1) {
            customer = allCandidates[0]
            matchType = `keyword-any`
          } else if (allCandidates.length > 1) {
            // Buscar el que más keywords matchea
            const scored = allCandidates.map(c => {
              const fullName = `${c.name} ${c.businessName || ''}`.toUpperCase()
              const score = keywords.filter(kw => fullName.includes(kw.toUpperCase())).length
              return { customer: c, score }
            }).sort((a, b) => b.score - a.score)

            if (scored[0].score > scored[1]?.score) {
              customer = scored[0].customer
              matchType = `best-score(${scored[0].score}/${keywords.length})`
            }
          }
        }
      }
    }

    if (customer) {
      // Actualizar multiplicador
      await prisma.customer.update({
        where: { id: customer.id },
        data: { priceMultiplier: entry.multiplier },
      })
      updated++
      updatedList.push({
        name: customer.businessName || customer.name,
        multiplier: entry.multiplier,
        matchType,
      })
      console.log(`  ✅ ${entry.name}`)
      console.log(`     → ${customer.businessName || customer.name} (${matchType}) → ${entry.multiplier}x`)
    } else {
      notFound++
      notFoundList.push(searchName)
      console.log(`  ❌ ${entry.name} — NO ENCONTRADO`)
    }
  }

  console.log('')
  console.log('='.repeat(70))
  console.log('RESUMEN')
  console.log('='.repeat(70))
  console.log(`  Actualizados: ${updated}/${clientMultipliers.length}`)
  console.log(`  No encontrados: ${notFound}/${clientMultipliers.length}`)

  if (notFoundList.length > 0) {
    console.log('')
    console.log('Clientes NO encontrados:')
    for (const name of notFoundList) {
      console.log(`  - ${name}`)
    }
  }

  console.log('')
  console.log('Multiplicadores aplicados:')
  const byMultiplier = updatedList.reduce((acc, item) => {
    const key = item.multiplier.toFixed(2)
    if (!acc[key]) acc[key] = 0
    acc[key]++
    return acc
  }, {} as Record<string, number>)

  Object.entries(byMultiplier)
    .sort(([a], [b]) => parseFloat(a) - parseFloat(b))
    .forEach(([mult, count]) => {
      console.log(`  ${mult}x: ${count} clientes`)
    })

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('Error fatal:', e)
  await prisma.$disconnect()
  process.exit(1)
})
