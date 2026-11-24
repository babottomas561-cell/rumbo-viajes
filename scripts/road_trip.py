# Datos en vivo del itinerario en auto Tucumán → Jurerê → Tucumán (3 al 16 de enero de 2027).
# Guarda en Supabase (app_snapshots, key 'ruta'); /viaje lo inyecta como RUTALIVE y la pestaña "En auto" lo muestra.
# Corre en GitHub Actions cada 6 horas. Variables: SUPABASE_URL, SUPABASE_SECRET_KEY.
# Cada fuente es independiente: si una falla, se conserva lo último que se consiguió (nunca se pisa con vacíos).
import json, os, re, statistics, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept-Language": "es-AR,es;q=0.9,pt-BR;q=0.8"}
WIKI_UA = {"User-Agent": "rumbo-viajes/1.0 (planificador personal; github.com/babottomas561-cell/rumbo-viajes)"}

def get(url, headers=UA, timeout=40):
    for i in range(3):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout).read()
        except Exception:
            if i == 2: raise
            time.sleep(4 * (i + 1))

# ---------------------------------------------------------------- itinerario (lo fijo)
STOPS = {  # id: (lat, lon)
    "tuc": (-26.8241, -65.2038), "laband": (-27.733, -64.242), "quimili": (-27.644, -62.417), "gancedo": (-27.49, -61.67),
    "saenz": (-26.786, -60.439), "resis": (-27.451, -58.987), "ctes": (-27.463, -58.839), "gil": (-29.201, -58.079),
    "libres": (-29.717, -57.092), "urug": (-29.7547, -57.0883), "alegrete": (-29.7831, -55.7919), "sgabriel": (-30.3337, -54.3217),
    "pantano": (-30.1896, -52.3727), "poa": (-30.034, -51.241), "osorio": (-29.8869, -50.27), "torres": (-29.352, -49.727),
    "jurere": (-27.444, -48.499)}
DAYS = {
    "D1": ("2027-01-03", ["tuc", "laband", "quimili", "gancedo", "saenz", "resis", "ctes"]),
    "D2": ("2027-01-04", ["ctes", "gil", "libres", "urug"]),
    "D3": ("2027-01-05", ["urug", "alegrete", "sgabriel", "pantano", "poa"]),
    "D4": ("2027-01-06", ["poa", "osorio", "torres", "jurere"]),
    "R1": ("2027-01-14", ["jurere", "osorio", "pantano", "sgabriel"]),
    "R2": ("2027-01-15", ["sgabriel", "alegrete", "urug", "libres", "ctes"]),
    "R3": ("2027-01-16", ["ctes", "resis", "saenz", "quimili", "laband", "tuc"]),
}
NIGHTS = {  # día: (slug de Airbnb, caja del mapa sw_lat, sw_lng, ne_lat, ne_lng)
    "D1": ("Corrientes--Argentina", (-27.4992, -58.8606, -27.4392, -58.8006)),
    "D2": ("Uruguaiana--Brasil", (-29.7847, -57.1183, -29.7247, -57.0583)),
    "D3": ("Porto-Alegre--Brasil", (-30.0746, -51.2577, -29.9946, -51.1777)),
    "R1": ("S%C3%A3o-Gabriel--Brasil", (-30.3637, -54.3517, -30.3037, -54.2917)),
    "R2": ("Corrientes--Argentina", (-27.4992, -58.8606, -27.4392, -58.8006)),
}
PHOTOS = {  # parada: (wikipedia, artículo)
    "tuc": ("es", "San Miguel de Tucumán"), "quimili": ("es", "Quimilí"), "gancedo": ("es", "Campo del Cielo"),
    "saenz": ("es", "Presidencia Roque Sáenz Peña"), "resis": ("es", "Puente General Belgrano"), "ctes": ("es", "Puente General Belgrano"),
    "gil": ("es", "Gauchito Gil"), "libres": ("es", "Paso de los Libres"), "urug": ("pt", "Uruguaiana"), "alegrete": ("pt", "Alegrete"),
    "sgabriel": ("pt", "São Gabriel (Rio Grande do Sul)"), "pantano": ("pt", "Pantano Grande"), "poa": ("pt", "Usina do Gasômetro"),
    "osorio": ("pt", "Parque Eólico de Osório"), "torres": ("pt", "Parque Estadual da Guarita"), "jurere": ("pt", "Jurerê Internacional"),
    "laband": ("es", "La Banda"),
}
# Noticias de los tramos críticos (Google News, últimos 90 días)
NEWS = [
    ("rn89", "RN 89 (Santiago del Estero – Chaco)", '"ruta 89" OR "ruta nacional 89" Santiago OR Chaco', "es"),
    ("rn16", "RN 16 (plan B por el Chaco)", '"ruta 16" OR "ruta nacional 16" Chaco', "es"),
    ("puente", "Puente Paso de los Libres – Uruguaiana", '"Paso de los Libres" puente OR aduana OR frontera OR Uruguayana OR Uruguaiana', "es"),
    ("br290", "BR-290 (Uruguaiana – Porto Alegre)", '"BR-290" interdição OR obras OR acidente OR trânsito', "pt"),
    ("br101", "BR-101 (Porto Alegre – Florianópolis)", '"BR-101" Palhoça OR Florianópolis OR Torres OR Osório trânsito OR obras OR interdição OR bloqueio', "pt"),
]
# Solo titulares que hablan del estado del camino o del paso; se descartan policiales y política
RELEVANT = re.compile(r"bache|pozo|repavim|obra|reparac|licitac|corte|cortad|cierr|cerrad|habilit|demora|espera|fila|tr[aá]nsito|"
                      r"interdi|bloqueio|congestion|desv[ií]o|puente|aduana|migraci|estado de la ruta|"
                      r"pista|duplica|obras|pedágio|peaje|fluxo|lentid", re.I)
# Un accidente suelto no dice nada del estado de la ruta (salvo que deje filas o cortes, y eso lo agarra RELEVANT por otra palabra)
NOISE = re.compile(r"asesin|homicid|femicid|cad[aá]ver|cuerpo|robo|droga|narco|elecci|candidat|f[uú]tbol|muere|muri[oó]|morre|mortes|"
                   r"fatal|herid|amputa|vuelco|motociclista|bicicleta|choque|colis", re.I)

# ---------------------------------------------------------------- fuentes
def osrm():
    out = {}
    for k, (_, ids) in DAYS.items():
        coords = ";".join(f"{STOPS[i][1]},{STOPS[i][0]}" for i in ids)
        j = json.loads(get(f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=simplified&geometries=geojson"))
        r = j["routes"][0]
        geom = [[round(y, 4), round(x, 4)] for x, y in r["geometry"]["coordinates"]]
        out[k] = {"legs": [[round(l["distance"] / 1000), round(l["duration"] / 60)] for l in r["legs"]], "geom": geom}
        time.sleep(1)
    return out

def forecast():
    """Pronóstico real (Open-Meteo, hasta 16 días). Antes de eso no hay pronóstico y la página usa el promedio histórico."""
    today = date.today(); out = {}
    for k, (d, ids) in DAYS.items():
        dd = date.fromisoformat(d)
        if not 0 <= (dd - today).days <= 15: continue
        lat = ",".join(str(STOPS[i][0]) for i in ids); lon = ",".join(str(STOPS[i][1]) for i in ids)
        j = json.loads(get("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
            "latitude": lat, "longitude": lon, "start_date": d, "end_date": d, "timezone": "America/Argentina/Buenos_Aires",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,sunrise,sunset,wind_gusts_10m_max"})))
        j = j if isinstance(j, list) else [j]
        out[k] = {i: {"tmax": x["daily"]["temperature_2m_max"][0], "tmin": x["daily"]["temperature_2m_min"][0],
                      "mm": x["daily"]["precipitation_sum"][0], "prob": x["daily"]["precipitation_probability_max"][0],
                      "code": x["daily"]["weather_code"][0], "sunset": x["daily"]["sunset"][0][-5:], "gust": x["daily"]["wind_gusts_10m_max"][0]}
                  for i, x in zip(ids, j)}
        time.sleep(1)
    return out

def money_usd(s):
    m = re.search(r"\$\s*([\d.,]+)\s*USD", s or "")
    return float(m.group(1).replace(".", "").replace(",", ".")) if m else None

def airbnb():
    out = {}
    for k, (slug, b) in NIGHTS.items():
        d = DAYS[k][0]; d2 = date.fromordinal(date.fromisoformat(d).toordinal() + 1).isoformat()
        url = (f"https://www.airbnb.com.ar/s/{slug}/homes?checkin={d}&checkout={d2}&adults=6&currency=USD&search_type=user_map_move"
               f"&search_by_map=true&sw_lat={b[0]}&sw_lng={b[1]}&ne_lat={b[2]}&ne_lng={b[3]}&zoom_level=13")
        h = get(url).decode("utf8", "ignore")
        m = re.search(r'<script[^>]*id="data-deferred-state-0"[^>]*>(.*?)</script>', h, re.S)
        ss = json.loads(m.group(1))["niobeClientData"][0][1]["data"]["presentation"]["staysSearch"]["results"]["searchResults"]
        items = []
        for r in ss:
            pl = (r.get("structuredDisplayPrice") or {}).get("primaryLine") or {}
            p = money_usd(pl.get("discountedPrice") or pl.get("price") or pl.get("accessibilityLabel"))
            rm = re.match(r"([\d,]+)\s*\((\d+)\)", r.get("avgRatingLocalized") or "")
            if p: items.append({"p": p, "r": float(rm.group(1).replace(",", ".")) if rm else None, "n": int(rm.group(2)) if rm else 0,
                                "t": r.get("title") or r.get("nameLocalized") or ""})
        if len(items) < 3: continue
        good = sorted((x for x in items if (x["r"] or 0) >= 4.6 and x["n"] >= 3), key=lambda x: x["p"])
        ps = [x["p"] for x in items]
        out[k] = {"n": len(items), "min": min(ps), "med": statistics.median(ps), "best": good[0] if good else None, "url": url}
        time.sleep(3)
    return out

def news():
    out = {}; now = datetime.now(timezone.utc)
    for key, label, q, lang in NEWS:
        loc = "hl=es-419&gl=AR&ceid=AR:es-419" if lang == "es" else "hl=pt-BR&gl=BR&ceid=BR:pt-419"
        root = ET.fromstring(get("https://news.google.com/rss/search?q=" + urllib.parse.quote(q + " when:90d") + "&" + loc))
        items, seen = [], set()
        for it in root.findall(".//item"):
            t = it.findtext("title") or ""; src = it.findtext("source") or ""
            head = re.sub(r"\s+-\s+[^-]+$", "", t).strip()
            if not RELEVANT.search(head) or NOISE.search(head) or head.lower() in seen: continue
            seen.add(head.lower())
            when = parsedate_to_datetime(it.findtext("pubDate"))
            items.append({"t": head, "src": src, "url": it.findtext("link"), "d": when.date().isoformat(), "age": (now - when).days})
        items.sort(key=lambda x: x["d"], reverse=True)
        out[key] = {"label": label, "items": items[:4]}
        time.sleep(1)
    return out

def photos(prev):
    out = dict(prev or {})
    for sid, (lang, title) in PHOTOS.items():
        if sid in out: continue  # las fotos no cambian: se buscan una sola vez
        try:
            out[sid] = photo(lang, title)
        except Exception as e:
            print(f"foto {sid}: {e}", file=sys.stderr)
        time.sleep(3)
    return {k: v for k, v in out.items() if v}

def photo(lang, title):
        j = json.loads(get(f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "titles": title, "redirects": 1, "prop": "pageimages", "piprop": "thumbnail|name", "pithumbsize": 640, "format": "json"}), WIKI_UA))
        p = list(j["query"]["pages"].values())[0]
        if not p.get("pageimage"): return None
        meta = json.loads(get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
            "action": "query", "titles": "File:" + p["pageimage"], "prop": "imageinfo", "iiprop": "extmetadata", "format": "json"}), WIKI_UA))
        em = (list(meta["query"]["pages"].values())[0].get("imageinfo") or [{}])[0].get("extmetadata", {})
        artist = re.sub(r"^The original uploader was |\s*at [A-Za-z]+ Wikipedia.*$", "", re.sub(r"<[^>]+>", "", (em.get("Artist") or {}).get("value", "")).strip())[:50]
        return {"src": p["thumbnail"]["source"], "file": "https://commons.wikimedia.org/wiki/File:" + urllib.parse.quote(p["pageimage"]),
                "credit": " · ".join(x for x in [artist, (em.get("LicenseShortName") or {}).get("value", "")] if x)}

# ---------------------------------------------------------------- guardar
if __name__ == "__main__":
    U, K = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    H = {"apikey": K or "", "Authorization": "Bearer " + (K or ""), "Content-Type": "application/json"}
    prev = {}
    if U and K:
        r = json.load(urllib.request.urlopen(urllib.request.Request(U + "/rest/v1/app_snapshots?key=eq.ruta&select=data", headers=H)))
        prev = (r[0]["data"] if r else {}) or {}
    data = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "src_at": dict(prev.get("src_at") or {})}
    for name, fn in [("osrm", osrm), ("wx", forecast), ("noches", airbnb), ("news", news), ("fotos", lambda: photos(prev.get("fotos")))]:
        try:
            v = fn()
            if v or name == "wx":  # el pronóstico vacío es válido (todavía falta para el viaje)
                data[name] = v; data["src_at"][name] = data["at"]
            else:
                data[name] = prev.get(name)
        except Exception as e:
            print(f"{name}: falló ({e}); queda el valor anterior", file=sys.stderr)
            data[name] = prev.get(name)
    if U and K:
        req = urllib.request.Request(U + "/rest/v1/app_snapshots?on_conflict=key", method="POST",
                                     headers={**H, "Prefer": "resolution=merge-duplicates,return=minimal"},
                                     data=json.dumps({"key": "ruta", "data": data, "updated_at": data["at"]}).encode())
        urllib.request.urlopen(req, timeout=60)
    else:
        json.dump(data, open(os.environ.get("RUTA_OUT", "ruta.json"), "w"), ensure_ascii=False)
    print(json.dumps({k: (len(v) if isinstance(v, (dict, list)) else v) for k, v in data.items() if k != "src_at"}))
