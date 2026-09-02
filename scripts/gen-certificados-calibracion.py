# -*- coding: utf-8 -*-
"""Certificados de calibración VELO ARGENTINA SA (11983-11987) en el formato
moderno VALAR (mismo diseño que Certificados_VALAR_Consolidado de MONTAJES INTERACERO)."""
import base64, os, subprocess

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = r"C:\Users\santi\VAL ARG SRL\SP - VALARG - Documentos\CERTIFICADOS\Clientes\VELO ARGENTINA SA\Cotización VAL-2026-2373"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
LOGO64 = base64.b64encode(open(os.path.join(SCRATCH, "valar-logo-navy.png"), "rb").read()).decode()

FECHA = "02/09/2026"

HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
  @page {{ size: A4; margin: 0; }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ font-family: Arial, Helvetica, sans-serif; color:#26303c; font-size:10.5pt; }}
  .page {{ width:210mm; height:296mm; position:relative; overflow:hidden; }}

  .band {{ background:#1F3864; color:#fff; padding:6mm 12mm 4mm 12mm; }}
  .band-top {{ display:flex; justify-content:space-between; align-items:flex-start; }}
  .logo img {{ height:15mm; }}
  .tagline {{ font-style:italic; color:#c9d3e3; font-size:9pt; margin-top:2.5mm; }}
  .razon {{ color:#aab7cc; font-size:8.5pt; margin-top:0.8mm; }}
  .contact {{ text-align:right; font-size:9.5pt; line-height:1.55; color:#dfe6f0; }}
  .contact .dir {{ font-weight:bold; color:#fff; }}
  .pill-row {{ display:flex; justify-content:flex-end; margin-top:2.5mm; }}
  .pill {{ background:#CF2E49; color:#fff; font-weight:bold; font-size:12pt;
           letter-spacing:0.5px; padding:3mm 7mm; }}
  .redline {{ height:1.6mm; background:#C8102E; margin-top:2.2mm; }}

  .content {{ padding:6mm 12mm 0 12mm; }}
  h1 {{ font-size:17pt; color:#1F3864; letter-spacing:0.5px; }}
  .subtitle {{ color:#C8102E; font-weight:bold; font-size:12pt; margin-top:1.5mm; }}
  .specline {{ color:#5C6573; font-size:9.5pt; margin-top:1.5mm; }}
  .desc {{ margin-top:3mm; text-align:justify; line-height:1.35; font-size:9.5pt; }}

  h2 {{ color:#1F3864; font-size:12pt; letter-spacing:0.4px; margin:3.5mm 0 0 0;
        display:inline-block; border-bottom:1mm solid #C8102E; padding-bottom:1.2mm; }}
  table {{ width:100%; border-collapse:collapse; margin-top:2mm; font-size:9.6pt; }}
  .kv td {{ padding:1.4mm 3mm; border-bottom:0.3mm solid #e3e7ed; }}
  .kv td:first-child {{ font-weight:bold; color:#3d4a5c; width:52%; }}
  .kv td:last-child {{ font-weight:bold; }}
  .kv tr:nth-child(even) {{ background:#F2F4F7; }}
  .th th {{ background:#1F3864; color:#fff; text-align:left; font-size:9.5pt;
            padding:1.4mm 3mm; }}
  .th td {{ padding:1.3mm 3mm; border-bottom:0.3mm solid #e3e7ed; }}
  .th tr:nth-child(even) {{ background:#F2F4F7; }}
  .ok {{ color:#1e7a34; font-weight:bold; }}
  .cols {{ display:flex; gap:6mm; }}
  .cols > div {{ flex:1; }}

  .signbox {{ border:0.4mm solid #cfd6df; border-radius:2mm; padding:2.5mm 5mm;
              margin-top:4mm; width:88mm; }}
  .signbox .lbl {{ color:#8b95a3; font-size:8.5pt; letter-spacing:1px; }}
  .signbox .who {{ color:#1F3864; font-weight:bold; font-size:11.5pt; margin-top:1.5mm; }}
  .signbox .rol {{ color:#5C6573; font-size:9.5pt; }}

  .footer {{ position:absolute; bottom:0; left:12mm; right:12mm;
             border-top:0.4mm solid #d7dce3; padding:3mm 0 6mm 0;
             display:flex; justify-content:space-between; font-size:8.5pt; white-space:nowrap; }}
  .footer .l {{ font-weight:bold; color:#1F3864; }}
  .footer .r {{ color:#5C6573; }}
  .flag {{ display:inline-block; width:4.5mm; height:3mm; vertical-align:-0.5mm;
           background:linear-gradient(#74acdf 33%,#fff 33%,#fff 66%,#74acdf 66%); }}
</style></head><body><div class="page">
  <div class="band">
    <div class="band-top">
      <div>
        <div class="logo"><img src="data:image/png;base64,{logo}"></div>
        <div class="tagline">Distribución de válvulas e instrumentación industrial</div>
        <div class="razon">VAL ARG S.R.L. · CUIT 30-71537357-9</div>
      </div>
      <div class="contact">
        <div class="dir">14 de Julio 175, Paternal, CABA</div>
        <div>Tel: +54 (11) 4551-3343 / 4552-2874 · WhatsApp: (11) 6055-1683</div>
        <div>ventas@val-ar.com.ar · info@val-ar.com.ar</div>
      </div>
    </div>
    <div class="pill-row"><div class="pill">CERTIFICADO DE CALIBRACIÓN Y PRUEBA NEUMÁTICA</div></div>
  </div>
  <div class="redline"></div>

  <div class="content">
    <h1>VÁLVULA DE SEGURIDAD</h1>
    <div class="subtitle">2" x 3" &nbsp;-&nbsp; SERIE 150 &nbsp;-&nbsp; AISI 304 &nbsp;(Flanged Safety Valve)</div>
    <div class="specline">Bridada RF · Cuerpo e internos en acero inoxidable AISI 304 · Asiento en PTFE · Capuchón · Calibrada a 4,0 bar</div>
    <div class="desc">Válvula de seguridad a resorte de fabricación VALAR, con extremos bridados Serie 150,
      cuerpo e internos (tobera, obturador, guía y resorte) en acero inoxidable AISI 304 y asiento en PTFE.
      El presente certificado documenta la identificación de la unidad, sus materiales y el resultado
      de la calibración a la presión de timbre, verificada mediante prueba neumática en banco VALAR.</div>

    <h2>IDENTIFICACIÓN</h2>
    <table class="kv">
      <tr><td>Identificación del usuario (N° de válvula)</td><td>{num}</td></tr>
      <tr><td>Cliente</td><td>VELO ARGENTINA SA</td></tr>
      <tr><td>Referencia</td><td>Cot. VAL-2026-2373</td></tr>
      <tr><td>Fecha de emisión</td><td>{fecha}</td></tr>
      <tr><td>Marca · Tipo de válvula</td><td>VALAR · Seguridad</td></tr>
    </table>

    <h2>MATERIALES DE CONSTRUCCIÓN</h2>
    <table class="th">
      <tr><th style="width:52%">Componente</th><th>Material</th></tr>
      <tr><td>Cuerpo</td><td>Acero inoxidable AISI 304</td></tr>
      <tr><td>Bonete</td><td>Acero inoxidable AISI 304</td></tr>
      <tr><td>Tobera</td><td>Acero inoxidable AISI 304</td></tr>
      <tr><td>Obturador</td><td>Acero inoxidable AISI 304</td></tr>
      <tr><td>Guía</td><td>Acero inoxidable AISI 304</td></tr>
      <tr><td>Resorte</td><td>Acero inoxidable AISI 304</td></tr>
      <tr><td>Asiento</td><td>PTFE</td></tr>
    </table>

    <div class="cols">
      <div>
        <h2>CALIBRACIÓN Y SERVICIO</h2>
        <table class="kv">
          <tr><td>Presión de timbre</td><td>4,0 bar</td></tr>
          <tr><td>Prueba neumática</td><td class="ok">APROBADO</td></tr>
          <tr><td>Temperatura de ensayo</td><td>25 °C</td></tr>
          <tr><td>Contrapresión</td><td>NO</td></tr>
        </table>
      </div>
      <div>
        <h2>CONEXIONES Y ACCESORIOS</h2>
        <table class="kv">
          <tr><td>Medida entrada - salida</td><td>2" x 3"</td></tr>
          <tr><td>Entrada / Salida</td><td>Bridada ANSI 150 RF</td></tr>
          <tr><td>Capuchón · Palanca</td><td>SI · NO</td></tr>
          <tr><td>Arandela de cobre</td><td>NO</td></tr>
        </table>
      </div>
    </div>

    <div class="signbox">
      <div class="lbl">APROBACIÓN FINAL — VALAR</div>
      <div class="who">ING Gabriel Krawczynski</div>
      <div class="rol">Encargado</div>
    </div>
  </div>

  <div class="footer">
    <div class="l">VALAR · Certificado de Calibración — Válvula de Seguridad 2" x 3" · N° {num}</div>
    <div class="r"><span class="flag"></span>&nbsp; Industria Argentina · www.val-ar.com.ar</div>
  </div>
</div></body></html>"""

for num in range(11983, 11988):
    html_path = os.path.join(SCRATCH, f"cert_{num}.html")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(HTML.format(logo=LOGO64, num=num, fecha=FECHA))
    pdf_path = os.path.join(OUT_DIR, f"{num} VELO ARGENTINA SA.pdf")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu",
                    "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
                    html_path], check=True, capture_output=True)
    print(pdf_path)
