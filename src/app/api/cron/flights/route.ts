import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Actualizador de vuelos en el servidor: cada llamada renueva un lote de rutas (origen × destino × mes de 2027,
// ida el 10 y vuelta el 18) leyendo la página pública de Google Flights, guarda todas las opciones en
// flight_quotes y actualiza el resumen del año (app_snapshots 'anio') que usa /viaje.
// Lo dispara pg_cron de Supabase cada hora con el header x-cron-secret.

export const maxDuration = 60;

const ORIGINS = ["TUC", "SLA", "BUE"] as const;
const ORIGIN_IX: Record<string, [number, number, number]> = { TUC: [0, 2, 4], BUE: [1, 3, 6], SLA: [7, 8, 9] };
const BATCH = 24;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Opt = { price: number; stops: number; airline: string; dep: string; arr: string; dur: string };

function decode(s: string) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[  ]/g, " ");
}

function parse(html: string): Opt[] {
  const out: Opt[] = [];
  const seen = new Set<string>();
  for (const m of decode(html).matchAll(/aria-label="(Precio total ida y vuelta desde [^"]+)"/g)) {
    const a = m[1];
    const p = a.match(/desde ([\d.,]+) dólares/);
    const al = a.match(/Vuelo (?:sin escalas |directo )?de (.+?)(?: con \d+ escalas?| sin escalas)?\./);
    const sl = a.match(/Sale de (.+?) el (.+?) a las (.+?) y llega a (.+?) el (.+?) a las (.+?)\.\.?\s/);
    const du = a.match(/Duración total: (.+?)\./);
    const st = a.match(/con (\d+) escalas?/);
    if (!p || !sl) continue;
    const airline = al?.[1] ?? "?";
    const key = airline + sl[3] + sl[6];
    if (seen.has(key)) continue;
    seen.add(key);
    const fx = (s: string) => (/[ap]\.m$/.test(s) ? s + "." : s);
    out.push({ price: parseInt(p[1].replace(/[.,]/g, ""), 10), stops: st ? +st[1] : 0, airline, dep: fx(sl[3]), arr: fx(sl[6]), dur: du?.[1] ?? "" });
  }
  return out.sort((x, y) => x.price - y.price).slice(0, 8);
}

async function fetchRoute(o: string, ap: string, m: number) {
  const mm = String(m).padStart(2, "0");
  const url = `https://www.google.com/travel/flights?q=Flights%20from%20${o}%20to%20${ap}%20on%202027-${mm}-10%20through%202027-${mm}-18&curr=USD&hl=es-419&gl=AR`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-419" }, signal: AbortSignal.timeout(20000), cache: "no-store" });
    return parse(await r.text());
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  if (!secret || auth !== secret) return new Response("no", { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return new Response("sin supabase", { status: 503 });

  const { data: dests } = await db.from("destinations").select("airport");
  const aps = [...new Set((dests ?? []).map((d) => d.airport).filter(Boolean))].sort() as string[];
  const jobs = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((m) => aps.flatMap((a) => ORIGINS.filter((o) => o !== a).map((o) => [o, a, m] as const)));

  // Rota: cada hora sigue donde quedó la anterior.
  const { data: cur } = await db.from("app_snapshots").select("data").eq("key", "cron_cursor").maybeSingle();
  const start = ((cur?.data as { i?: number } | null)?.i ?? 0) % jobs.length;
  const batch = Array.from({ length: Math.min(BATCH, jobs.length) }, (_, k) => jobs[(start + k) % jobs.length]);

  const fetched_at = new Date().toISOString();
  const results = await Promise.all(batch.map(async ([o, ap, m]) => ({ o, ap, m, opts: await fetchRoute(o, ap, m) })));

  const rows = results.flatMap(({ o, ap, m, opts }) =>
    opts.map((x) => ({
      origin: o, dest: ap, depart_on: `2027-${String(m).padStart(2, "0")}-10`, return_on: `2027-${String(m).padStart(2, "0")}-18`,
      price_usd: x.price, stops: x.stops, airline: x.airline, airlines: x.airline.split(/,| y /).map((s) => s.trim()).filter(Boolean),
      dep_time: x.dep, arr_time: x.arr, duration: x.dur, source: "google_flights_server", fetched_at,
    })),
  );
  if (rows.length) await db.from("flight_quotes").upsert(rows, { onConflict: "origin,dest,depart_on,return_on,airline,dep_time,fetched_at", ignoreDuplicates: true });

  // Actualiza el resumen del año que lee /viaje (solo rutas con resultado; no pisa con vacíos).
  const { data: snap } = await db.from("app_snapshots").select("data").eq("key", "anio").maybeSingle();
  const ok = results.filter((r) => r.opts.length);
  if (snap && ok.length) {
    const anio = snap.data as { fl: Record<string, Record<string, (number | string | null)[]>>; upd?: string };
    for (const { o, ap, m, opts } of ok) {
      const [pi, si, ai] = ORIGIN_IX[o];
      const row = ((anio.fl[ap] ??= {})[String(m)] ??= [null, null, null, null, null, 0, null, null, null, null]);
      while (row.length < 10) row.push(null);
      row[pi] = opts[0].price; row[si] = opts[0].stops; row[ai] = opts[0].airline;
      if (row[0] != null && row[1] != null) row[5] = 0;
    }
    await db.from("app_snapshots").upsert({ key: "anio", data: anio, updated_at: fetched_at });
  }
  await db.from("app_snapshots").upsert({ key: "cron_cursor", data: { i: (start + batch.length) % jobs.length }, updated_at: fetched_at });
  await db.from("sync_runs").insert({ source: "vercel_cron", quotes: rows.length, note: `${ok.length}/${batch.length} rutas con dato desde ${start}` });

  return Response.json({ start, routes: batch.length, withData: ok.length, quotes: rows.length, byOrigin: Object.fromEntries(ORIGINS.map((o) => [o, ok.filter((r) => r.o === o).length + "/" + batch.filter(([x]) => x === o).length])) });
}
