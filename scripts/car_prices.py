# Actualiza los valores oficiales del cálculo en auto desde sus fuentes y los guarda en Supabase
# (app_snapshots, key 'carprices'). /viaje los inyecta como CARLIVE y la página los usa como valores por defecto.
# Corre en GitHub Actions una vez por día. Variables: SUPABASE_URL, SUPABASE_SECRET_KEY.
# Si una fuente falla, deja el valor anterior (no pisa con vacíos).
import csv, io, json, os, re, statistics, sys, urllib.request, zipfile
from datetime import date, datetime, timedelta, timezone

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
U, K = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"]
H = {"apikey": K, "Authorization": "Bearer " + K, "Content-Type": "application/json"}

def get(url, timeout=90):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()

out = {}  # key -> {v, fecha, fuente, url, como}

def dolar_bna():
    j = json.loads(get("https://dolarapi.com/v1/dolares/oficial"))
    out["usd"] = {"v": j["venta"], "fecha": j["fechaActualizacion"][:10], "fuente": "Banco Nación, dólar oficial vendedor",
                  "url": "https://www.bna.com.ar/Personas", "como": "vía dolarapi.com"}

def ptax():
    hoy = date.today()
    a, b = (hoy - timedelta(days=10)).strftime("%m-%d-%Y"), hoy.strftime("%m-%d-%Y")
    j = json.loads(get(f"https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@a,dataFinalCotacao=@b)?@a='{a}'&@b='{b}'&$format=json&$top=100"))
    last = j["value"][-1]
    out["brl"] = {"v": round(last["cotacaoVenda"], 2), "fecha": last["dataHoraCotacao"][:10], "fuente": "Banco Central do Brasil, PTAX venta",
                  "url": "https://www.bcb.gov.br/estabilidadefinanceira/historicocotacoes", "como": "API oficial Olinda"}

def energia_ar():
    # Precios vigentes en surtidor (Res. 314/2016): mediana de estaciones YPF que actualizaron en los últimos 30 días
    raw = get("http://datos.energia.gob.ar/dataset/1c181390-5045-475e-94dc-410429be4b17/resource/80ac25de-a44a-4445-9215-090cf55cfda5/download/precios-en-surtidor-resolucin-3142016.csv", 400)
    desde = (date.today() - timedelta(days=30)).isoformat()
    rows = [x for x in csv.DictReader(io.StringIO(raw.decode("utf-8-sig", "ignore"))) if x["idtipohorario"] == "2" and "YPF" in x["empresabandera"] and x["fecha_vigencia"] >= desde]
    for key, prod in (("naftaAR", "Nafta (súper) entre 92 y 95 Ron"), ("gasoilAR", "Gas Oil Grado 2")):
        a = [float(x["precio"]) for x in rows if x["producto"] == prod]
        if len(a) >= 5:
            out[key] = {"v": round(statistics.median(a)), "fecha": max(x["fecha_vigencia"][:10] for x in rows if x["producto"] == prod),
                        "fuente": f"Secretaría de Energía, mediana de {len(a)} estaciones YPF (últimos 30 días)",
                        "url": "https://preciosensurtidor.energia.gob.ar/", "como": "datos.energia.gob.ar, Res. 314/2016"}

def anp_br(estado="SANTA CATARINA"):
    page = get("https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas").decode("utf-8", "ignore")
    url = re.findall(r'href="([^"]*resumo_semanal_lpc_[^"]+\.xlsx)"', page)[0]
    z = zipfile.ZipFile(io.BytesIO(get(url)))
    ss = [re.sub(r"<[^>]+>", "", m) for m in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)]
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode())
    sheet = z.read(f"xl/worksheets/sheet{names.index('ESTADOS') + 1}.xml").decode()
    def cells(row):
        o = {}
        for ref, t, v in re.findall(r'<c r="([A-Z]+)\d+"([^>]*)>(?:<f>[^<]*</f>)?<v>([^<]*)</v>', row):
            o[ref] = ss[int(v)] if 't="s"' in t else v
        return o
    rows = [cells(r) for r in re.findall(r"<row[^>]*>(.*?)</row>", sheet, re.S)]
    head = next(r for r in rows if "PRODUTO" in [str(v).strip() for v in r.values()])
    col = {str(v).strip(): k for k, v in head.items()}
    cp = col["PRODUTO"]; ce = next(k for n, k in col.items() if n.startswith("ESTADO"))
    cm = next(k for n, k in col.items() if "PREÇO MÉDIO REVENDA" in n or "PRECO MEDIO REVENDA" in n)
    semana = re.search(r"(\d{4}_\d{2}_\d{2})-(\d{4}_\d{2}_\d{2})", url).group(2).replace("_", "-")
    for key, prod in (("gasBR", "GASOLINA COMUM"), ("dieBR", "OLEO DIESEL S10")):
        r = next((r for r in rows if r.get(cp) == prod and r.get(ce) == estado), None)
        if r:
            out[key] = {"v": round(float(r[cm]), 2), "fecha": semana, "fuente": f"ANP, precio medio de reventa en {estado.title()}",
                        "url": url, "como": "Levantamento de Preços de Combustíveis, semanal"}

for f in (dolar_bna, ptax, energia_ar, anp_br):
    try:
        f(); print("ok", f.__name__)
    except Exception as e:
        print("FALLÓ", f.__name__, e, file=sys.stderr)

prev = json.load(urllib.request.urlopen(urllib.request.Request(U + "/rest/v1/app_snapshots?key=eq.carprices&select=data", headers=H)))
data = (prev[0]["data"] if prev else {}) or {}
data.setdefault("vals", {}).update(out)
data["at"] = datetime.now(timezone.utc).isoformat()
req = urllib.request.Request(U + "/rest/v1/app_snapshots?on_conflict=key", method="POST", headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                             data=json.dumps({"key": "carprices", "data": data, "updated_at": data["at"]}).encode())
urllib.request.urlopen(req)
print(json.dumps({k: v["v"] for k, v in data["vals"].items()}))
if not out: sys.exit(1)
