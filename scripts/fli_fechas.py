#!/usr/bin/env python3
"""Calendario de enero (ida y vuelta por fecha) con fli: github.com/punitarani/fli, datos de Google Flights.

Actualiza el snapshot 'fechas' de Supabase (claves "TUC-FLN-1-6" = sale el 6 de enero, 8 noches; "-n9" = 9 noches),
el mismo que llena el robot de Playwright (scripts/flights-worker.mjs). Los dos conviven:
- fli es rápido y trae el mes entero por ruta en ~1 s: se corre seguido para las rutas comunes.
- Donde fli no trae nada (João Pessoa, São Luís, Ilhéus... Google no las devuelve por esta vía) queda lo del robot.
- "0 vuelos" NUNCA pisa un precio guardado: puede ser que Google nos frenó por hacer muchas búsquedas seguidas.

Uso: SUPABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/fli_fechas.py [ORIGENES] [NOCHES]
  ORIGENES por defecto TUC,BUE,COR,SLA,IGU · NOCHES por defecto 8,9
"""
import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.request

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SECRET_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
ORIG = (sys.argv[1] if len(sys.argv) > 1 else "TUC,BUE,COR,SLA,IGU").split(",")
NIGHTS = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else "8,9").split(",")]
PAUSE = float(os.environ.get("FLI_PAUSA", "2"))
TODAY = dt.date.today().isoformat()
# Códigos de ciudad que fli no resuelve: se busca el aeropuerto principal (la clave guardada sigue siendo la ciudad)
FLI_AP = {"RIO": "GIG", "SAO": "GRU"}


def rest(path, body=None, method="GET", extra=None):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=None if body is None else json.dumps(body).encode(),
                                 method=method, headers={**H, **(extra or {})})
    for i in range(5):  # Supabase a veces no responde (522): reintenta
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                t = r.read()
                return json.loads(t) if t else None
        except urllib.error.HTTPError as e:
            if e.code < 500 or i == 4:
                raise
        except (urllib.error.URLError, TimeoutError):
            if i == 4:
                raise
        time.sleep(10 * 2 ** i)


def snapshot():
    r = rest("app_snapshots?key=eq.fechas&select=data")
    return (r[0]["data"] if r else {}) or {}


def fli_month(o, ap, n):
    """Precio más barato por día de salida en enero 2027 para n noches. {} si Google no devolvió nada."""
    cmd = ["fli", "dates", FLI_AP.get(o, o), FLI_AP.get(ap, ap), "--from", "2027-01-01", "--to", "2027-01-31", "--round", "-d", str(n),
           "--currency", "USD", "--format", "json"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        d = json.loads(r.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        return {}
    out = {}
    for x in d.get("dates") or []:
        dep, p = x.get("departure_date") or "", x.get("price")
        if dep.startswith("2027-01-") and p and p > 0:
            out[int(dep[8:10])] = round(p)
    return out


def main():
    old = snapshot()
    routes = sorted({tuple(k.split("-")[:2]) for k in old if k.split("-")[0] in ORIG} | ({("TUC", "IGR")} if "TUC" in ORIG else set()))
    upd, empty, fails = {}, [], 0
    for o, ap in routes:
        # TUC-IGR ("Foz en avión"): si se llega a Foz el día anterior, el pasaje a Iguazú tiene una noche más
        for n in (NIGHTS + [max(NIGHTS) + 1] if (o, ap) == ("TUC", "IGR") else NIGHTS):
            res = fli_month(o, ap, n)
            if not res:  # puede ser freno de Google: una espera y un reintento
                time.sleep(15)
                res = fli_month(o, ap, n)
            if not res:
                empty.append(f"{o}-{ap}/{n}")
                fails += 1
                if fails >= 6:  # muchas seguidas vacías: Google nos está frenando, se espera un minuto
                    time.sleep(60)
                    fails = 0
                continue
            fails = 0
            suf = "" if n == 8 else f"-n{n}"
            for day, p in res.items():
                k = f"{o}-{ap}-1-{day}{suf}"
                prev = old.get(k)
                # Un precio verificado con un vuelo concreto (fli_verificar.py) de los últimos 2 días no se pisa con el calendario
                if prev and len(prev) > 5 and prev[5] == "v" and (dt.date.today() - dt.date.fromisoformat(prev[4])).days <= 2:
                    continue
                same = prev and abs((prev[0] or 0) - p) < 1
                # Si el precio no cambió se conserva aerolínea/escalas/duración del robot; si cambió, no se inventan
                upd[k] = [p, prev[1] if same else None, prev[2] if same else "", prev[3] if same else "", TODAY]
            time.sleep(PAUSE)
    if not upd:
        print("fli no trajo nada: no se toca el snapshot", file=sys.stderr)
        sys.exit(1)
    # Se vuelve a leer justo antes de guardar y solo se pisan las claves de fli (el robot puede haber escrito mientras tanto)
    cur = snapshot()
    cur.update(upd)
    rest("app_snapshots?on_conflict=key", [{"key": "fechas", "data": cur, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}],
         "POST", {"Prefer": "resolution=merge-duplicates"})
    print(f"{len(upd)} precios de {len(routes)} rutas · sin datos en fli (queda lo del robot): {len(empty)}")
    if empty:
        print("  " + ", ".join(empty))


def ow_igr():
    """Pasajes de solo ida TUC→IGR e IGR→TUC (para combinar la ida por Foz con la vuelta directa) en el snapshot 'ow'."""
    upd = {}
    for o, a in (("TUC", "IGR"), ("IGR", "TUC")):
        try:
            r = subprocess.run(["fli", "dates", o, a, "--from", "2027-01-01", "--to", "2027-01-31", "--currency", "USD", "--format", "json"],
                               capture_output=True, text=True, timeout=90)
            for x in json.loads(r.stdout).get("dates") or []:
                if x.get("price"):
                    upd[f"{o}>{a}|{x['departure_date']}"] = [round(x["price"]), None, "", "", "", "", [], "", "", TODAY]
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            pass
        time.sleep(PAUSE)
    if upd:
        r = rest("app_snapshots?key=eq.ow&select=data")
        cur = (r[0]["data"] if r else {}) or {}
        cur.update(upd)
        rest("app_snapshots?on_conflict=key", [{"key": "ow", "data": cur, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}],
             "POST", {"Prefer": "resolution=merge-duplicates"})
    print(f"solo ida TUC/IGR: {len(upd)}")


if __name__ == "__main__":
    if "TUC" in ORIG:
        ow_igr()
    main()
