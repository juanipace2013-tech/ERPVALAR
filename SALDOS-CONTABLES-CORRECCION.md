# CORRECCIÓN DE SALDOS CONTABLES

## ✅ PROBLEMA CORREGIDO

**Error**: Los saldos contables aparecían como negativos, lo cual es incorrecto en contabilidad.

**Ejemplo del error**:
- Mercaderías (Activo): Debe 0, Haber 400 → Mostraba **-$400** ❌

**Solución correcta**:
- Mercaderías (Activo): Debe 0, Haber 400 → Muestra **$400 (A)** ✅
  - Saldo anormal detectado (Activo con saldo acreedor)

## 📋 REGLA FUNDAMENTAL IMPLEMENTADA

En contabilidad **NO EXISTEN SALDOS NEGATIVOS**, solo naturalezas:

### Cuentas de Naturaleza Deudora (ACTIVO y EGRESO)
- **Saldo Normal**: Debe > Haber → Saldo DEUDOR (D)
- **Saldo Anormal**: Haber > Debe → Saldo ACREEDOR (A)
- **Siempre se muestra**: `$X,XXX.XX (D)` o `$X,XXX.XX (A)`

### Cuentas de Naturaleza Acreedora (PASIVO, PATRIMONIO, INGRESO)
- **Saldo Normal**: Haber > Debe → Saldo ACREEDOR (A)
- **Saldo Anormal**: Debe > Haber → Saldo DEUDOR (D)
- **Siempre se muestra**: `$X,XXX.XX (A)` o `$X,XXX.XX (D)`

## 🔧 ARCHIVOS MODIFICADOS

### 1. **Nuevo Archivo Helper**
`src/lib/contabilidad/balance-helper.ts`

Funciones creadas:
- `calculateAccountBalance()`: Calcula saldo con naturaleza
- `calculateRunningBalance()`: Calcula saldo acumulado para Libro Mayor
- `formatBalance()`: Formatea saldo para mostrar
- `getBalanceColorClass()`: Retorna clases CSS según normalidad

### 2. **API del Libro Mayor**
`src/app/api/contabilidad/libro-mayor/route.ts`

**Cambios**:
- Importa `calculateRunningBalance` del helper
- Calcula saldos acumulados correctamente (siempre positivos)
- Retorna `balance` (número) y `balanceNature` ('DEUDOR' | 'ACREEDOR')
- Aplica a ambos modos: cuenta individual y libro mayor completo

**Antes**:
```typescript
balance += debit - credit  // Podía ser negativo
```

**Después**:
```typescript
runningBalance = calculateRunningBalance(
  account.accountType,
  runningBalance,
  debit,
  credit
)
// Retorna: { amount: positivo, nature: 'DEUDOR' | 'ACREEDOR' }
```

### 3. **Frontend del Libro Mayor**
`src/app/(dashboard)/contabilidad/libro-mayor/page.tsx`

**Cambios**:
- Actualiza interfaces para incluir `balanceNature`
- Muestra saldos con formato: `$X,XXX.XX (D)` o `$X,XXX.XX (A)`
- Elimina colores rojo/verde por signos (ahora todos son grises)
- Exportación a Excel incluye columna "D/A"

**Antes**:
```typescript
<TableCell className={movement.balance >= 0 ? 'text-green-700' : 'text-red-700'}>
  ${movement.balance.toFixed(2)}
</TableCell>
```

**Después**:
```typescript
<TableCell className="text-gray-900">
  ${movement.balance.toFixed(2)} <span className="text-xs">({movement.balanceNature === 'DEUDOR' ? 'D' : 'A'})</span>
</TableCell>
```

### 4. **Exportación a Excel**
Todas las exportaciones ahora incluyen:
- Columna adicional **"D/A"** (Deudor/Acreedor)
- Saldos siempre positivos
- Naturaleza en columna separada

**Estructura de hojas Excel**:
- **Libro Mayor Completo**:
  - Hoja por cada cuenta + Hoja Resumen
  - Columnas: Fecha | Asiento | Descripción | Debe | Haber | Saldo | **D/A**
- **Cuenta Individual**:
  - Una hoja con todos los movimientos
  - Mismas columnas incluyendo **D/A**

## 🧪 VERIFICACIÓN

### Script de Prueba
`scripts/test-balance-calculation.ts`

**Resultados**:
```
Mercaderías (ACTIVO):
  Debe:  $0.00 | Haber: $400.00
  ❌ Antiguo: $-400.00 (NEGATIVO - INCORRECTO)
  ✅ Correcto: $400.00 (ACREEDOR) ⚠️ Saldo Anormal

Créditos por Ventas (ACTIVO):
  Debe:  $726.00 | Haber: $0.00
  ✅ Correcto: $726.00 (DEUDOR)

Ventas (INGRESO):
  Debe:  $0.00 | Haber: $600.00
  ✅ Correcto: $600.00 (ACREEDOR)
```

### Casos Probados
1. ✅ Cuenta de activo con saldo deudor (normal)
2. ✅ Cuenta de activo con saldo acreedor (anormal)
3. ✅ Cuenta de pasivo con saldo acreedor (normal)
4. ✅ Cuenta de ingreso con saldo acreedor (normal)
5. ✅ Cuenta de egreso con saldo deudor (normal)
6. ✅ Saldos acumulados en Libro Mayor
7. ✅ Exportación a Excel con D/A

## 📊 IMPACTO EN REPORTES

### Libro Mayor
- ✅ Muestra saldos positivos con (D) o (A)
- ✅ Detecta saldos anormales
- ✅ Exportación correcta a Excel

### Balance de Sumas y Saldos
- ⚠️ **Pendiente actualizar** con mismo patrón

### Balance General
- ⚠️ **Pendiente actualizar** con mismo patrón

### Dashboard Contable
- ⚠️ **Pendiente actualizar** con mismo patrón

## 🎯 PRÓXIMOS PASOS

Para completar la corrección en todo el sistema:

1. **Balance de Sumas y Saldos**
   - Importar `calculateAccountBalance`
   - Mostrar columnas: Debe | Haber | Saldo | D/A

2. **Balance General**
   - Usar helper para cálculo de saldos
   - Agrupar por tipo y mostrar naturaleza

3. **Dashboard**
   - Actualizar gráficos si usan saldos
   - Verificar cálculos de KPIs

4. **Actualización de Saldos en DB**
   - La función `updateAccountBalances` ya almacena debitBalance y creditBalance
   - El saldo final se calcula dinámicamente con el helper
   - ✅ No requiere cambios en DB

## ✨ RESUMEN

### Antes
```
Mercaderías: -$400.00 ❌
```

### Después
```
Mercaderías: $400.00 (A) ⚠️ Saldo Anormal ✅
```

**Beneficios**:
1. ✅ Cumple con normas contables
2. ✅ Elimina confusión de saldos negativos
3. ✅ Detecta automáticamente saldos anormales
4. ✅ Exportaciones más claras
5. ✅ Preparado para auditorías
