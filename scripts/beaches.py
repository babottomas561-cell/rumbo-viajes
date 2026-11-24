# Baja las playas de OpenStreetMap (natural=beach, y la línea de costa como respaldo) para cada destino,
# las guarda en Supabase (tabla beaches) y recalcula la distancia de cada casa a la playa más cercana (listing_beach).
# Uso: python scripts/beaches.py [k1,k2,...]   (sin argumentos: todos los destinos que todavía no tienen playas)
# La caja de cada destino sale de la vista materializada destination_extent (refresh materialized view destination_extent).
# Variables: SUPABASE_URL, SUPABASE_SECRET_KEY. Opcional: OVERPASS_URL, FORCE=1 para volver a bajar todo.
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

U = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL"); K = os.environ["SUPABASE_SECRET_KEY"]
H = {"apikey": K, "Authorization": "Bearer " + K, "Content-Type": "application/json"}
# Se rotan servidores públicos de Overpass: el principal se satura seguido
OVERPASS = [os.environ["OVERPASS_URL"]] if os.environ.get("OVERPASS_URL") else [
    "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
UA = {"User-Agent": "rumbo-viajes/1.0 (planificador personal de viaje)"}

def rest(path, body=None, method="GET", prefer=None):
    h = dict(H)
    if prefer: h["Prefer"] = prefer
    req = urllib.request.Request(U + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=300).read()
    except urllib.error.HTTPError as ex:
        raise RuntimeError(f"{method} {path.split('?')[0]}: {ex.code} {ex.read()[:300]!r}") from None
    return json.loads(r) if r else None

def overpass(s, w, n, e):
    q = f"""[out:json][timeout:90];
(way["natural"="beach"]({s},{w},{n},{e});relation["natural"="beach"]({s},{w},{n},{e});way["natural"="coastline"]({s},{w},{n},{e}););
out geom;"""
    for i in range(8):
        srv = OVERPASS[i % len(OVERPASS)]
        try:
            req = urllib.request.Request(srv, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
            return json.loads(urllib.request.urlopen(req, timeout=180).read())["elements"]
        except Exception as ex:
            print(f"  overpass {srv.split('/')[2]}: {ex}", file=sys.stderr); time.sleep(5 * (i + 1))
    return None

def wkt(el):
    """Línea(s) del borde: alcanza para medir la distancia a la arena o a la costa."""
    lines = []
    if el["type"] == "way" and el.get("geometry"):
        lines.append(el["geometry"])
    for m in el.get("members", []) if el["type"] == "relation" else []:
        if m.get("geometry"): lines.append(m["geometry"])
    lines = [l for l in lines if len(l) >= 2]
    if not lines: return None
    parts = ["(" + ",".join(f"{p['lon']} {p['lat']}" for p in l) + ")" for l in lines]
    return "SRID=4326;MULTILINESTRING(" + ",".join(parts) + ")"

def main():
    only = set(sys.argv[1].split(",")) if len(sys.argv) > 1 else None
    ext = rest("/rest/v1/destination_extent?select=*")
    have = {r["k"] for r in rest("/rest/v1/beaches?select=k")} if os.environ.get("FORCE") != "1" else set()
    todo = [x for x in ext if (only is None or x["k"] in only) and (only or x["k"] not in have)]
    print(f"{len(todo)} destinos para bajar")
    for x in todo:
        els = overpass(x["s"], x["w"], x["n"], x["e"])
        if els is None: print(f"{x['k']}: Overpass no respondió"); continue
        rows = []
        for el in els:
            g = wkt(el)
            if not g: continue
            kind = "beach" if (el.get("tags") or {}).get("natural") == "beach" else "coastline"
            rows.append({"k": x["k"], "osm_id": el["id"] if el["type"] == "way" else -el["id"], "kind": kind,
                         "name": (el.get("tags") or {}).get("name"), "geom": g})
        n = 0
        try:
            if rows:
                for i in range(0, len(rows), 200):
                    rest(f"/rest/v1/beaches?on_conflict=k,osm_id", rows[i:i + 200], "POST", "resolution=merge-duplicates,return=minimal")
                n = rest("/rest/v1/rpc/refresh_listing_beach", {"p_k": x["k"]}, "POST")
        except Exception as ex:
            print(f"{x['k']}: {ex}", flush=True)
        print(f"{x['k']}: {sum(r['kind'] == 'beach' for r in rows)} playas, {sum(r['kind'] == 'coastline' for r in rows)} tramos de costa, {n} casas medidas", flush=True)
        time.sleep(2)

if __name__ == "__main__":
    main()
