// Robot de vuelos: abre Google Flights con Chrome (Playwright) para cada origen × destino × mes,
// guarda todas las opciones en Supabase (flight_quotes) y actualiza el resumen del año (app_snapshots 'anio').
// Corre en GitHub Actions cada 2 horas. Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, MESES (opcional, ej "1,2").
import { chromium } from "playwright";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SECRET_KEY");
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const ORIGINS = ["TUC", "SLA", "BUE"];
const IX = { TUC: [0, 2, 4], BUE: [1, 3, 6], SLA: [7, 8, 9] };
const TABS = Number(process.env.TABS || 6);

// Cada 4 horas renueva 1 mes (6 corridas por día): el año entero se renueva cada 2 días.
// Enero (el mes del viaje) se renueva en todas las corridas pares para estar siempre al día.
const run = Math.floor(Date.now() / 36e5 / 4);
const MESES = process.env.MESES ? process.env.MESES.split(",").map(Number) : [run % 2 === 0 ? 1 : 2 + (Math.floor(run / 2) % 11)];

async function sb(path, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 || init.method === "POST" ? null : r.json();
}

function parse(labels) {
  const out = [], seen = new Set();
  for (const raw of labels) {
    const a = raw.replace(/[  ]/g, " ");
    if (!a.startsWith("Precio total ida y vuelta desde")) continue;
    const p = a.match(/desde ([\d.,]+) dólares/);
    const al = a.match(/Vuelo (?:sin escalas |directo )?de (.+?)(?: con \d+ escalas?| sin escalas)?\./);
    const sl = a.match(/Sale de (.+?) el (.+?) a las (.+?) y llega a (.+?) el (.+?) a las (.+?)\.\.?\s/);
    const du = a.match(/Duración total: (.+?)\./);
    const st = a.match(/con (\d+) escalas?/);
    if (!p || !sl) continue;
    const airline = al?.[1] ?? "?", key = airline + sl[3] + sl[6];
    if (seen.has(key)) continue;
    seen.add(key);
    const fx = (s) => (/[ap]\.m$/.test(s) ? s + "." : s);
    out.push({ price: parseInt(p[1].replace(/[.,]/g, ""), 10), stops: st ? +st[1] : 0, airline, dep: fx(sl[3]), arr: fx(sl[6]), dur: du?.[1] ?? "" });
  }
  return out.sort((x, y) => x.price - y.price).slice(0, 8);
}

async function scrape(page, o, ap, m) {
  const mm = String(m).padStart(2, "0");
  const u = `https://www.google.com/travel/flights?q=Flights%20from%20${o}%20to%20${ap}%20on%202027-${mm}-10%20through%202027-${mm}-18&curr=USD&hl=es-419&gl=AR`;
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForSelector('[aria-label^="Precio total ida y vuelta"]', { timeout: 20000 }).catch(() => {});
      const labels = await page.$$eval("[aria-label]", (els) => els.map((e) => e.getAttribute("aria-label")));
      const res = parse(labels);
      if (res.length) return res;
    } catch {}
  }
  return [];
}

const dests = await sb("destinations?select=airport");
const aps = [...new Set(dests.map((d) => d.airport).filter(Boolean))].sort();
const jobs = MESES.flatMap((m) => aps.flatMap((a) => ORIGINS.filter((o) => o !== a).map((o) => [o, a, m]))).slice(0, Number(process.env.LIMIT || 1e9));
console.log(`meses ${MESES} · ${jobs.length} rutas`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "es-419", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" });
// Acepta cookies de Google para que no aparezca el cartel de consentimiento
await ctx.addCookies([{ name: "SOCS", value: "CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzIaAmVzIAEaBgiA_LyaBg", domain: ".google.com", path: "/" }]);
const fetched_at = new Date().toISOString();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: TABS }, async () => {
  const page = await ctx.newPage();
  await page.route(/\.(png|jpg|jpeg|gif|webp|woff2?)$/, (r) => r.abort());
  while (next < jobs.length) {
    const [o, ap, m] = jobs[next++];
    const opts = await scrape(page, o, ap, m);
    results.push({ o, ap, m, opts });
    console.log(`${results.length}/${jobs.length} ${o}-${ap} ${m}: ${opts.length ? "USD " + opts[0].price + " " + opts[0].airline : "sin dato"}`);
  }
}));
await browser.close();

const rows = results.flatMap(({ o, ap, m, opts }) => opts.map((x) => ({
  origin: o, dest: ap, depart_on: `2027-${String(m).padStart(2, "0")}-10`, return_on: `2027-${String(m).padStart(2, "0")}-18`,
  price_usd: x.price, stops: x.stops, airline: x.airline, airlines: x.airline.split(/,| y /).map((s) => s.trim()).filter(Boolean),
  dep_time: x.dep, arr_time: x.arr, duration: x.dur, source: "google_flights_actions", fetched_at,
})));
for (let i = 0; i < rows.length; i += 500)
  await sb("flight_quotes?on_conflict=origin,dest,depart_on,return_on,airline,dep_time,fetched_at", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });

const ok = results.filter((r) => r.opts.length);
const [snap] = await sb("app_snapshots?key=eq.anio&select=data");
if (snap && ok.length) {
  const anio = snap.data;
  for (const { o, ap, m, opts } of ok) {
    const [pi, si, ai] = IX[o];
    anio.fl[ap] ??= {};
    const row = (anio.fl[ap][String(m)] ??= [null, null, null, null, null, 0, null, null, null, null]);
    while (row.length < 10) row.push(null);
    row[pi] = opts[0].price; row[si] = opts[0].stops; row[ai] = opts[0].airline;
    row[5] = 0; // ya está a la venta: deja de ser estimado
  }
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "anio", data: anio, updated_at: fetched_at }) });
}
const by = Object.fromEntries(ORIGINS.map((o) => [o, `${ok.filter((r) => r.o === o).length}/${results.filter((r) => r.o === o).length}`]));
await sb("sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ source: "github_actions", quotes: rows.length, note: `meses ${MESES} · ${JSON.stringify(by)}` }) });
console.log("listo", rows.length, "precios", by);
if (!ok.length) process.exit(1);
