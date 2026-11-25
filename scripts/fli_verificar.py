#!/usr/bin/env python3
"""Verifica con un vuelo concreto (que se puede comprar) los días más baratos del calendario de enero.

El calendario de Google Flights ('fechas', de fli_fechas.py y del robot) muestra la tarifa más baja que Google vio, que muchas
veces ya no se puede comprar: buscando el vuelo puntual sale USD 50-180 más. Este script toma, para cada ruta y cantidad de
noches, los K días más baratos y busca el vuelo de ida y vuelta concreto con `fli flights`. Guarda en la misma clave:

  [precio comprable, escalas, aerolínea, duración ida, fecha, "v", sale_ida, llega_ida, sale_vuelta, llega_vuelta]

La página usa con preferencia los días con "v" y con los horarios chequea que las conexiones (Foz) lleguen a tiempo.
"0 vuelos" nunca pisa nada (puede ser freno de Google).

Uso: SUPABASE_URL=... SUPABASE_SECRET_KEY=... python3 scripts/fli_verificar.py [ORIGENES] [K] [MAX_BUSQUEDAS]
"""
import datetime as dt
import json
import subprocess
import sys
import time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from fli_fechas import FLI_AP, PAUSE, TODAY, rest, snapshot  # noqa: E402

ORIG = (sys.argv[1] if len(sys.argv) > 1 else "TUC,IGU,BUE,COR,SLA").split(",")
K = int(sys.argv[2]) if len(sys.argv) > 2 else 3
MAXQ = int(sys.argv[3]) if len(sys.argv) > 3 else 350


def hm(m):
    return f"{m // 60} h {m % 60} min" if m else ""


def fli_rt(o, ap, d1, d2):
    cmd = ["fli", "flights", FLI_AP.get(o, o), FLI_AP.get(ap, ap), d1, "--return", d2, "--currency", "USD", "--sort", "CHEAPEST",
           "--format", "json"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        fl = json.loads(r.stdout).get("flights") or []
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        return None
    fl = [f for f in fl if f.get("price")]
    if not fl:
        return None
    f = min(fl, key=lambda x: x["price"])
    ob, rb = f.get("outbound") or {}, f.get("return") or {}
    ol, rl = ob.get("legs") or [], rb.get("legs") or []
    al = " y ".join(dict.fromkeys((l.get("airline") or {}).get("name", "") for l in ol if l.get("airline")))
    return [round(f["price"]), ob.get("stops"), al, hm(ob.get("duration") or 0), TODAY, "v",
            ol[0]["departure_time"] if ol else "", ol[-1]["arrival_time"] if ol else "",
            rl[0]["departure_time"] if rl else "", rl[-1]["arrival_time"] if rl else ""]


def main():
    old = snapshot()
    groups = {}
    for k, v in old.items():
        p = k.split("-")
        if len(p) < 4 or p[0] not in ORIG or not v or not v[0]:
            continue
        n = int(p[4][1:]) if len(p) > 4 else 8
        groups.setdefault((p[0], p[1], n), []).append((v[0], int(p[3]), k, v))
    todo = []
    for (o, ap, n), lst in groups.items():
        lst.sort()
        # los K más baratos que no se verificaron hoy
        todo += [(o, ap, n, d, k) for _, d, k, v in lst[:K] if not (len(v) > 5 and v[5] == "v" and v[4] == TODAY)]
    todo.sort(key=lambda x: (x[0] != "TUC", x[0] != "IGU"))  # primero lo que más usa la página
    upd, empty, fails = {}, 0, 0
    for o, ap, n, d, k in todo[:MAXQ]:
        a = dt.date(2027, 1, 1) + dt.timedelta(days=d - 1)
        res = fli_rt(o, ap, a.isoformat(), (a + dt.timedelta(days=n)).isoformat())
        if not res:
            empty += 1
            fails += 1
            if fails >= 5:
                time.sleep(60)
                fails = 0
            continue
        fails = 0
        upd[k] = res
        time.sleep(PAUSE)
    if not upd:
        print("no se verificó nada (¿Google frenó?)", file=sys.stderr)
        sys.exit(1)
    cur = snapshot()
    cur.update(upd)
    rest("app_snapshots?on_conflict=key", [{"key": "fechas", "data": cur, "updated_at": dt.datetime.now(dt.timezone.utc).isoformat()}],
         "POST", {"Prefer": "resolution=merge-duplicates"})
    sube = [upd[k][0] - (old[k][0] or 0) for k in upd]
    print(f"{len(upd)} verificados de {min(len(todo), MAXQ)} · sin respuesta {empty} · diferencia media "
          f"{round(sum(sube) / len(sube))} USD (calendario → comprable)")


if __name__ == "__main__":
    main()
