# 🔄 FLUJO DE ESTADOS DE COTIZACIONES - IMPLEMENTADO

## ✅ ESTADO ACTUAL DE LA IMPLEMENTACIÓN

### Componentes Implementados

1. **API de Cambio de Estado** ✅
   - Endpoint: `/api/quotes/[id]/change-status`
   - Validación de transiciones permitidas
   - Historial automático de cambios de estado
   - Ubicación: `src/app/api/quotes/[id]/change-status/route.ts`

2. **API de Generación de Factura** ✅
   - Endpoint: `/api/quotes/[id]/generate-invoice`
   - Genera factura directamente desde cotización aceptada
   - Marca cotización como CONVERTED
   - Ubicación: `src/app/api/quotes/[id]/generate-invoice/route.ts`

3. **API de Generación de Remito** ✅
   - Endpoint: `/api/quotes/[id]/generate-delivery-note`
   - Genera remito desde cotización aceptada
   - Marca cotización como CONVERTED
   - Ubicación: `src/app/api/quotes/[id]/generate-delivery-note/route.ts`

4. **Lógica de Workflow** ✅
   - Archivo: `src/lib/quote-workflow.ts`
   - Validación de transiciones
   - Funciones helper para generación de documentos
   - Historial automático

5. **UI Mejorada** ✅
   - Página: `src/app/(dashboard)/cotizaciones/[id]/ver/page.tsx`
   - Badges visuales con emojis y colores
   - Botones contextuales según estado
   - Diálogos mejorados para aceptar/rechazar
   - Información adicional según estado

---

## 📊 ESTADOS DISPONIBLES

### 1. 📝 BORRADOR (DRAFT)
**Descripción:** Cotización en edición, no enviada al cliente

**Acciones disponibles:**
- ✏️ Editar Cotización
- 📧 Enviar al Cliente

**Color:** Azul claro

---

### 2. 📧 ENVIADA (SENT)
**Descripción:** Cotización enviada, esperando respuesta del cliente

**Acciones disponibles:**
- ✅ Marcar como Aceptada
- ❌ Marcar como Rechazada
- 📧 Reenviar Email

**Color:** Amarillo

**Información adicional:**
- Muestra fecha de validez
- Alerta si está próxima a vencer

---

### 3. ✅ ACEPTADA (ACCEPTED)
**Descripción:** Cliente aceptó la cotización, lista para facturar

**Acciones disponibles:**
- 📄 Generar Factura (directa)
- 📦 Generar Remito

**Color:** Verde

**Información adicional:**
- Fecha de aceptación
- Comentarios del cliente (si los hay)

---

### 4. ❌ RECHAZADA (REJECTED)
**Descripción:** Cliente rechazó la cotización

**Acciones disponibles:**
- 🔄 Duplicar Cotización

**Color:** Rojo

**Información adicional:**
- Motivo del rechazo
- Fecha de rechazo

---

### 5. ⏰ VENCIDA (EXPIRED)
**Descripción:** Cotización venció sin respuesta del cliente

**Acciones disponibles:**
- 🔄 Renovar Cotización (duplicar)

**Color:** Gris

---

### 6. 🚫 CANCELADA (CANCELLED)
**Descripción:** Cotización cancelada manualmente

**Acciones disponibles:**
- 🔄 Duplicar Cotización

**Color:** Gris claro

---

### 7. 🔄 CONVERTIDA (CONVERTED)
**Descripción:** Cotización convertida en factura o remito

**Color:** Púrpura

**Información:**
- Muestra mensaje indicando que ya fue convertida
- Links a documentos generados (factura/remito)

---

## 🔄 TRANSICIONES PERMITIDAS

```
BORRADOR → ENVIADA, CANCELADA
ENVIADA → ACEPTADA, RECHAZADA, VENCIDA, CANCELADA
ACEPTADA → CONVERTIDA, CANCELADA
RECHAZADA → (estado final)
VENCIDA → (estado final)
CANCELADA → (estado final)
CONVERTIDA → (estado final)
```

---

## 🎯 CÓMO USAR EL FLUJO

### Flujo Normal (Caso Exitoso)

1. **Crear Cotización**
   - Estado inicial: BORRADOR
   - Editar y agregar items

2. **Enviar al Cliente**
   - Click en "Enviar al Cliente"
   - Cambio automático a: ENVIADA
   - (Nota: Email aún no implementado, pero estado cambia)

3. **Cliente Acepta**
   - Click en "Marcar como Aceptada"
   - Agregar comentarios del cliente (opcional)
   - Cambio a: ACEPTADA

4. **Generar Factura**
   - Click en "Generar Factura"
   - Se crea factura automáticamente
   - Cambio a: CONVERTIDA
   - Redirección a factura

### Flujo Alternativo: Generar Remito Primero

1-3. (Igual que flujo normal hasta ACEPTADA)

4. **Generar Remito**
   - Click en "Generar Remito"
   - Se crea remito
   - Cambio a: CONVERTIDA
   - Desde el remito se puede generar factura

### Caso de Rechazo

1-2. (Crear y Enviar)

3. **Cliente Rechaza**
   - Click en "Marcar como Rechazada"
   - **Obligatorio:** Ingresar motivo de rechazo
   - Cambio a: RECHAZADA
   - Estado final

4. **Crear Nueva Cotización**
   - Click en "Duplicar Cotización"
   - Se crea nueva cotización con datos de la rechazada

---

## 📝 HISTORIAL DE ESTADOS

Cada cambio de estado se registra automáticamente en `quote_status_history`:

- Fecha y hora del cambio
- Usuario que realizó el cambio
- Estado anterior y nuevo estado
- Notas (comentarios del cliente o motivos de rechazo)

**Ver historial:**
- En la página de detalle de cotización
- Sección "Historial de Estados"

---

## 🔧 APIs DISPONIBLES

### Cambiar Estado
```typescript
POST /api/quotes/[id]/change-status
Body: {
  status: 'SENT' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED',
  customerResponse?: string,  // Para ACCEPTED
  rejectionReason?: string    // Para REJECTED (obligatorio)
}
```

### Generar Factura
```typescript
POST /api/quotes/[id]/generate-invoice
Body: {
  pointOfSale?: string,
  dueDate?: string,
  notes?: string
}
```

### Generar Remito
```typescript
POST /api/quotes/[id]/generate-delivery-note
Body: {
  deliveryAddress?: string,
  deliveryCity?: string,
  deliveryProvince?: string,
  deliveryPostalCode?: string,
  carrier?: string,
  notes?: string
}
```

---

## ⚠️ VALIDACIONES IMPORTANTES

1. **No se puede retroceder estados**
   - Solo se permiten transiciones hacia adelante
   - Estados finales (RECHAZADA, VENCIDA, CANCELADA, CONVERTIDA) no pueden cambiar

2. **Factura requiere estado ACCEPTED**
   - Solo cotizaciones aceptadas pueden generar factura
   - Al generar factura, pasa automáticamente a CONVERTED

3. **Rechazo requiere motivo**
   - El campo `rejectionReason` es obligatorio al rechazar
   - Se valida en el frontend y backend

4. **Un estado, una acción**
   - Una cotización ACEPTADA solo puede generar UNA factura o remito
   - Después de generar, pasa a CONVERTED (no se puede facturar dos veces)

---

## 📋 PENDIENTE (Prioridad 2)

### Funcionalidades Faltantes

1. **Sistema de Emails** 🔴
   - Envío automático al cambiar a ENVIADA
   - Template de email con PDF adjunto
   - Botones en email para aceptar/rechazar
   - Endpoint: Crear `/api/quotes/[id]/send-email`

2. **Verificación Automática de Vencimiento** 🔴
   - Cron job que revise cotizaciones ENVIADAS
   - Marcar como EXPIRED si pasó validUntil
   - Ejecutar diariamente
   - Archivo: Crear `lib/cron/check-expired-quotes.ts`

3. **Vista Pública para Cliente** 🟡
   - Página pública: `/public/quotes/[token]`
   - Cliente puede ver cotización
   - Botones para aceptar/rechazar directamente
   - No requiere login

4. **PDF de Cotización** 🟡
   - Generar PDF profesional
   - Ruta: `/cotizaciones/[id]/pdf`
   - Usar jsPDF o similar

5. **Notificaciones** 🟡
   - Notificar vendedor cuando cliente responde
   - Notificar cuando cotización está por vencer
   - Sistema de notificaciones en app

---

## 🎨 MEJORAS UI FUTURAS

1. **Timeline Visual**
   - Vista de línea de tiempo con todos los cambios
   - Iconos y colores por estado

2. **Dashboard de Cotizaciones**
   - Tarjetas por estado
   - Métricas: tasa de aceptación, tiempo promedio de respuesta

3. **Filtros Avanzados**
   - Filtrar por estado
   - Filtrar por fecha de vencimiento
   - Filtrar por vendedor

---

## 📚 RECURSOS

- **Schema Prisma:** `prisma/schema.prisma` (línea 841+)
- **Workflow Logic:** `src/lib/quote-workflow.ts`
- **API Routes:** `src/app/api/quotes/[id]/`
- **UI Components:** `src/app/(dashboard)/cotizaciones/[id]/ver/page.tsx`

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

- [x] Modelo de datos (Quote, QuoteStatus, QuoteStatusHistory)
- [x] API de cambio de estado con validaciones
- [x] Historial automático de estados
- [x] UI con badges visuales
- [x] Botones contextuales por estado
- [x] Diálogos de aceptar/rechazar mejorados
- [x] Generación de factura desde cotización
- [x] Generación de remito desde cotización
- [x] Transiciones validadas en backend
- [ ] Sistema de emails
- [ ] Verificación automática de vencimiento
- [ ] Vista pública para cliente
- [ ] PDF de cotización

---

## 🚀 PRÓXIMOS PASOS

1. **Probar el flujo completo:**
   - Crear cotización → Enviar → Aceptar → Facturar
   - Verificar que todos los estados cambien correctamente
   - Revisar historial

2. **Implementar emails (Prioridad 2):**
   - Configurar servicio de email (Resend, SendGrid, etc.)
   - Crear templates
   - Implementar endpoint de envío

3. **Verificación de vencimiento:**
   - Crear cron job
   - Configurar ejecución diaria
   - Testear con cotizaciones de prueba

---

**Última actualización:** 16 de febrero de 2026
**Estado:** ✅ Flujo básico completo y funcional
