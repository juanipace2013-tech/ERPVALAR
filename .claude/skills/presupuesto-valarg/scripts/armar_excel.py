#!/usr/bin/env python3
"""Arma un Excel de presupuesto con el formato de Val Arg a partir de un JSON.

Uso:  python armar_excel.py libro.json            (escribe libro["archivo"])

libro.json:
{
  "archivo": "C:/Users/santi/crm-valarg/cotizacion-valvulas-CLIENTE-por-proveedor.xlsx",
  "hojas": [
    {
      "nombre": "GENEBRE",                         # nombre de la pestaña (máx. 31 caracteres)
      "titulo": "COTIZACIÓN VÁLVULAS — LÍNEA GENEBRE",
      "lineas": ["Cliente: ...", "Fecha: 24/11/2026 — Cantidades según pedido"],
      "columnas": [
        {"clave": "item",  "titulo": "Ítem cliente", "ancho": 9},
        {"clave": "desc",  "titulo": "Descripción",  "ancho": 45},
        {"clave": "cant",  "titulo": "Cant.",        "ancho": 7,  "formato": "entero", "total": true},
        {"clave": "lista", "titulo": "Lista USD",    "ancho": 11, "formato": "usd"},
        {"clave": "tot",   "titulo": "Total USD",    "ancho": 12, "formato": "usd",
         "formula": "{cant}*{lista}", "total": true},
        {"clave": "plazo", "titulo": "Plazo de Entrega", "ancho": 16, "completar": true}
      ],
      "filas": [
        {"item": "1.1", "desc": "Válvula ...", "cant": 3, "lista": 291.75, "_color": "verde"}
      ]
    }
  ]
}

Columnas:
  formato    "texto" (default) | "usd" | "entero" | "pct"
  formula    expresión con {clave} de otras columnas de la misma fila; queda en blanco si falta un dato
  total      true → suma al pie de la tabla
  completar  true → celda amarilla: es para que la llene alguien (el proveedor, o Santiago al revisar)
Filas:
  _color     "verde" | "amarillo" | "rojo" | "gris" para destacar la fila (opcional)
  Un valor que empieza con "=" se escribe como fórmula tal cual.
Hoja sin "columnas" → hoja de texto (para el RESUMEN): cada elemento de "lineas" es una fila; una lista
  son varias celdas y [] una fila en blanco. Si la primera celda empieza con "**" toda la fila va en
  negrita (encabezados de tabla, títulos de sección). "anchos": [34, 18, 18, 70] fija el ancho de columnas.
"""
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AZUL = "1F3864"
ZEBRA = "EEF3FA"
COMPLETAR = "FFF2CC"
COLORES = {"verde": "E2EFDA", "amarillo": "FFF2CC", "rojo": "F8CBAD", "gris": "E7E6E6"}
FORMATOS = {"usd": "#,##0.00", "entero": "#,##0", "pct": "0.0%", "texto": "General"}
BORDE = Border(*(Side(style="thin", color="BFBFBF"),) * 4)


def fill(rgb):
    return PatternFill("solid", fgColor=rgb)


def hoja_tabla(ws, h):
    cols = h["columnas"]
    letra = {c["clave"]: get_column_letter(i + 1) for i, c in enumerate(cols)}
    r = 1
    if h.get("titulo"):
        ws.cell(r, 1, h["titulo"]).font = Font(name="Arial", size=13, bold=True)
        r += 1
    for linea in h.get("lineas", []):
        ws.cell(r, 1, linea).font = Font(name="Arial", size=10)
        r += 1
    if r > 1:
        r += 1  # fila en blanco antes de la tabla

    encabezado = r
    for i, c in enumerate(cols, 1):
        cell = ws.cell(r, i, c["titulo"])
        cell.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
        cell.fill = fill(AZUL)
        cell.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        cell.border = BORDE
        ws.column_dimensions[get_column_letter(i)].width = c.get("ancho", 14)
    ws.row_dimensions[r].height = 30
    r += 1

    primera = r
    for n, fila in enumerate(h.get("filas", [])):
        for i, c in enumerate(cols, 1):
            valor = fila.get(c["clave"])
            if valor is None and c.get("formula"):
                usadas = [k for k in letra if "{" + k + "}" in c["formula"]]
                expr = c["formula"]
                for k in usadas:
                    expr = expr.replace("{" + k + "}", f"{letra[k]}{r}")
                vacias = ",".join(f'{letra[k]}{r}=""' for k in usadas)
                valor = f'=IF(OR({vacias}),"",{expr})' if usadas else f"={expr}"
            cell = ws.cell(r, i, valor)
            cell.font = Font(name="Arial", size=9)
            cell.border = BORDE
            fmt = c.get("formato", "texto")
            cell.number_format = FORMATOS[fmt]
            cell.alignment = Alignment(
                wrap_text=True, vertical="top", horizontal="right" if fmt != "texto" else None
            )
            color = COLORES.get(fila.get("_color", ""))
            if c.get("completar"):
                cell.fill = fill(COMPLETAR)
            elif color:
                cell.fill = fill(color)
            elif n % 2 == 0:
                cell.fill = fill(ZEBRA)
        r += 1
    ultima = r - 1

    if ultima >= primera and any(c.get("total") for c in cols):
        for i, c in enumerate(cols, 1):
            cell = ws.cell(r, i)
            cell.font = Font(name="Arial", size=10, bold=True)
            cell.border = BORDE
            if c.get("total"):
                L = get_column_letter(i)
                cell.value = f"=SUM({L}{primera}:{L}{ultima})"
                cell.number_format = FORMATOS[c.get("formato", "texto")]
        primer_total = next(i for i, c in enumerate(cols, 1) if c.get("total"))
        if primer_total > 1:
            ws.cell(r, primer_total - 1, "TOTAL").alignment = Alignment(horizontal="right")

    if ultima >= primera:
        ws.auto_filter.ref = f"A{encabezado}:{get_column_letter(len(cols))}{ultima}"
    ws.freeze_panes = ws.cell(encabezado + 1, 1)
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def hoja_texto(ws, h):
    r = 1
    if h.get("titulo"):
        ws.cell(r, 1, h["titulo"]).font = Font(name="Arial", size=13, bold=True)
        r += 2
    anchos = h.get("anchos", [34, 18, 18, 70])
    for i, a in enumerate(anchos, 1):
        ws.column_dimensions[get_column_letter(i)].width = a
    for linea in h.get("lineas", []):
        celdas = linea if isinstance(linea, list) else [linea]
        negrita = bool(celdas) and isinstance(celdas[0], str) and celdas[0].startswith("**")
        for i, v in enumerate(celdas, 1):
            if isinstance(v, str) and v.startswith("**"):
                v = v.strip("*")
            cell = ws.cell(r, i, v)
            cell.font = Font(name="Arial", size=10, bold=negrita)
            cell.alignment = Alignment(wrap_text=i > 1, vertical="top")
            if isinstance(v, float):
                cell.number_format = FORMATOS["usd"]
        r += 1


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        libro = json.load(f)
    wb = Workbook()
    wb.remove(wb.active)
    for h in libro["hojas"]:
        ws = wb.create_sheet(h["nombre"][:31])
        (hoja_tabla if h.get("columnas") else hoja_texto)(ws, h)
    wb.save(libro["archivo"])
    print("OK", libro["archivo"])


if __name__ == "__main__":
    main()
