# Carpeta de Datos

## Archivo necesario para importación de productos

Para ejecutar el script de importación de productos, debe copiar el archivo Excel aquí:

```
data/Prototipo_Oferta.xltx
```

### Estructura esperada del Excel

**Hoja:** "Precio Lista"

**Columnas de productos:**
- **Columna B:** Material (SKU/código del producto)
- **Columna C:** Marca
- **Columna D:** Tipo (para categorización)
- **Columna E:** Descripción del producto
- **Columna F:** Precio lista en USD

**Columnas de descuentos:**
- **Columna H:** Tipo
- **Columna I:** Marca
- **Columna J:** Descuento (decimal, ej: 0.35 = 35%)

### Ejecutar importación

Una vez copiado el archivo, ejecutar:

```bash
npx tsx scripts/import-products.ts
```

Este script importará:
- 12,925 productos del catálogo VAL ARG
- Categorías automáticas basadas en el campo "Tipo"
- Descuentos por combinación de Tipo+Marca
