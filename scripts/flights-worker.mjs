// Robot de vuelos: abre Google Flights con Chrome (Playwright) para cada origen × destino × mes,
// guarda todas las opciones en Supabase (flight_quotes) y actualiza el resumen del año (app_snapshots 'anio').
// Corre en GitHub Actions cada 2 horas. Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, MESES (opcional, ej "1,2").
import { chromium } from "playwright";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SECRET_KEY");
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const ORIGINS = ["TUC", "SLA", "BUE"];
const IX = { TUC: [0, 2, 4], BUE: [1, 3, 6], SLA: [7, 8, 9] };
const TABS = Number(process.env.TABS || 3);

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
    // Escalas: "Escala (1 de 2) de 2 h 10 min en Aeropuerto ... (GRU)"
    const lay = [...a.matchAll(/Escala(?: \(\d+ de \d+\))? de (.+?) en (.+?)\./g)].map((m) => `${m[1]} en ${m[2]}`);
    if (!p || !sl) continue;
    const airline = al?.[1] ?? "?", key = airline + sl[3] + sl[6];
    if (seen.has(key)) continue;
    seen.add(key);
    const fx = (s) => (/[ap]\.m$/.test(s) ? s + "." : s);
    out.push({ price: parseInt(p[1].replace(/[.,]/g, ""), 10), stops: st ? +st[1] : 0, airline, dep: fx(sl[3]), arr: fx(sl[6]), dur: du?.[1] ?? "", from: sl[1], to: sl[4], nd: sl[5] !== sl[2] ? 1 : 0, lay });
  }
  return out.sort((x, y) => x.price - y.price).slice(0, 8);
}

// Devuelve {opts, none}: none=true cuando Google dice "No se encontraron resultados" (no hay vuelos, no es error).
// Fechas de salida a buscar (día del mes; vuelta 8 días después). Por defecto solo el 10. Ej. DIAS="3,10,17,24"
const DIAS = (process.env.DIAS || "10").split(",").map(Number);
const ymd = (m, d) => { const t = new Date(Date.UTC(2027, m - 1, d)); return t.toISOString().slice(0, 10); };
async function scrape(page, o, ap, m, d = 10) {
  const u = `https://www.google.com/travel/flights?q=Flights%20from%20${o}%20to%20${ap}%20on%20${ymd(m, d)}%20through%20${ymd(m, d + 8)}&curr=USD&hl=es-419&gl=AR`;
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
      const state = await page.waitForFunction(() => {
        if (document.querySelector('[aria-label^="Precio total ida y vuelta"]')) return "ok";
        if (/No se encontraron resultados/.test(document.body.innerText)) return "none";
        return false;
      }, null, { timeout: 40000, polling: 500 }).then((h) => h.jsonValue()).catch(() => "timeout");
      if (state === "none") return { opts: [], none: true };
      if (state === "ok") await page.waitForTimeout(1500); // deja terminar de cargar la lista
      const labels = await page.$$eval("[aria-label]", (els) => els.map((e) => e.getAttribute("aria-label")));
      const res = parse(labels);
      if (res.length) return { opts: res, none: false };
      if (process.env.DEBUG) console.log("DBG", o, ap, state, labels.length, (await page.innerText("body")).slice(0, 200).replace(/\s+/g, " "));
    } catch (e) { if (process.env.DEBUG) console.log("ERR", o, ap, String(e).slice(0, 200)); }
  }
  return { opts: [], none: false };
}

const dests = await sb("destinations?select=airport");
const aps = [...new Set(dests.map((d) => d.airport).filter(Boolean))].sort();
const jobs = MESES.flatMap((m) => DIAS.flatMap((d) => aps.flatMap((a) => ORIGINS.filter((o) => o !== a).map((o) => [o, a, m, d])))).slice(0, Number(process.env.LIMIT || 1e9));
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
    const [o, ap, m, d] = jobs[next++];
    const { opts, none } = await scrape(page, o, ap, m, d);
    results.push({ o, ap, m, d, opts, none });
    console.log(`${results.length}/${jobs.length} ${o}-${ap} ${m}/${d}: ${opts.length ? "USD " + opts[0].price + " " + opts[0].airline : none ? "Google: sin vuelos" : "sin dato"}`);
  }
}));
// Segunda pasada: reintenta las que fallaron por demora (no las que Google dice que no tienen vuelos)
const retry = results.filter((r) => !r.opts.length && !r.none);
console.log(`reintento de ${retry.length} rutas`);
let ri = 0;
await Promise.all(Array.from({ length: Math.min(TABS, retry.length) }, async () => {
  const page = await ctx.newPage();
  while (ri < retry.length) {
    const r = retry[ri++];
    Object.assign(r, await scrape(page, r.o, r.ap, r.m, r.d));
    console.log(`reintento ${r.o}-${r.ap} ${r.m}: ${r.opts.length ? "USD " + r.opts[0].price : r.none ? "Google: sin vuelos" : "sin dato"}`);
  }
}));
await browser.close();

const rows = results.flatMap(({ o, ap, m, d, opts }) => opts.map((x) => ({
  origin: o, dest: ap, depart_on: ymd(m, d), return_on: ymd(m, d + 8),
  price_usd: x.price, stops: x.stops, airline: x.airline, airlines: x.airline.split(/,| y /).map((s) => s.trim()).filter(Boolean),
  dep_time: x.dep, arr_time: x.arr, duration: x.dur, source: "google_flights_actions", fetched_at,
})));
for (let i = 0; i < rows.length; i += 500)
  await sb("flight_quotes?on_conflict=origin,dest,depart_on,return_on,airline,dep_time,fetched_at", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 500)) });

const okAll = results.filter((r) => r.opts.length);
const ok = okAll.filter((r) => r.d === 10);
// Precio por fecha de salida: app_snapshots 'fechas' = {"TUC-FLN-1-17": [precio, escalas, aerolínea, duración, fecha]}
if (okAll.some((r) => r.d !== 10) || DIAS.length > 1) {
  const [fs] = await sb("app_snapshots?key=eq.fechas&select=data");
  const fe = fs?.data || {};
  for (const { o, ap, m, d, opts } of okAll) fe[`${o}-${ap}-${m}-${d}`] = [opts[0].price, opts[0].stops, opts[0].airline, opts[0].dur, fetched_at.slice(0, 10)];
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "fechas", data: fe, updated_at: fetched_at }) });
}
// Detalle por ruta (aeropuerto de salida y llegada, horarios, escalas) para la página: app_snapshots 'fdet'
{
  const [fs] = await sb("app_snapshots?key=eq.fdet&select=data");
  const fdet = fs?.data || {};
  for (const { o, ap, m, opts } of ok) fdet[`${o}-${ap}-${m}`] = opts.map((x) => [x.price, x.stops, x.airline, x.dep, x.arr, x.nd, x.dur, x.lay, x.from, x.to]);
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "fdet", data: fdet, updated_at: fetched_at }) });
}
const [snap] = await sb("app_snapshots?key=eq.anio&select=data");
if (snap && ok.length) {
  const anio = snap.data;
  for (const { o, ap, m, opts } of ok) {
    const [pi, si, ai] = IX[o];
    anio.fl[ap] ??= {};
    const row = (anio.fl[ap][String(m)] ??= [null, null, null, null, null, 0, null, null, null, null]);
    while (row.length < 11) row.push(null);
    row[pi] = opts[0].price; row[si] = opts[0].stops; row[ai] = opts[0].airline;
    if (o === "SLA") row[10] = opts[0].dur;
    row[5] = 0; // ya está a la venta: deja de ser estimado
  }
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "anio", data: anio, updated_at: fetched_at }) });
}
const by = Object.fromEntries(ORIGINS.map((o) => [o, `${okAll.filter((r) => r.o === o).length}/${results.filter((r) => r.o === o).length} (sin vuelos ${results.filter((r) => r.o === o && r.none).length})`]));
await sb("sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ source: "github_actions", quotes: rows.length, note: `meses ${MESES} · ${JSON.stringify(by)}` }) });
console.log("listo", rows.length, "precios", by);
if (!okAll.length) process.exit(1);
