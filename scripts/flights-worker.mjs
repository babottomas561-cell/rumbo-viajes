// Robot de vuelos: abre Google Flights con Chrome (Playwright) para cada origen × destino × mes,
// guarda todas las opciones en Supabase (flight_quotes) y actualiza el resumen del año (app_snapshots 'anio').
// Corre en GitHub Actions cada 2 horas. Variables: SUPABASE_URL, SUPABASE_SECRET_KEY, MESES (opcional, ej "1,2").
import { chromium } from "playwright";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) throw new Error("Faltan SUPABASE_URL / SUPABASE_SECRET_KEY");
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const ORIGINS = (process.env.ORIGENES || "TUC,SLA,BUE").split(",");
const IX = { TUC: [0, 2, 4], BUE: [1, 3, 6], SLA: [7, 8, 9] };
const TABS = Number(process.env.TABS || 3);

// Cada 4 horas renueva 1 mes (6 corridas por día): el año entero se renueva cada 2 días.
// Enero (el mes del viaje) se renueva en todas las corridas pares para estar siempre al día.
const run = Math.floor(Date.now() / 36e5 / 4);
const MESES = process.env.MESES ? process.env.MESES.split(",").map(Number) : [run % 2 === 0 ? 1 : 2 + (Math.floor(run / 2) % 11)];

// Reintenta si Supabase no responde (5xx o red caída): hasta 5 veces, esperando 10 s, 20 s, 40 s...
async function sb(path, init = {}) {
  for (let i = 0; ; i++) {
    let r;
    try { r = await fetch(`${URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } }); }
    catch (e) { if (i < 5) { await new Promise((ok) => setTimeout(ok, 10000 * 2 ** i)); continue; } throw e; }
    if (r.status >= 500 && i < 5) { await r.text(); await new Promise((ok) => setTimeout(ok, 10000 * 2 ** i)); continue; }
    if (!r.ok) throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return r.status === 204 || init.method === "POST" ? null : r.json();
  }
}

function parse(labels) {
  const out = [], seen = new Set();
  for (const raw of labels) {
    const a = raw.replace(/[  ]/g, " ");
    if (!a.startsWith("Precio total ida y vuelta desde") && !/^Desde [\d.,]+ dólares/.test(a)) continue;
    const p = a.match(/[Dd]esde ([\d.,]+) dólares/);
    const al = a.match(/Vuelo (?:sin escalas |directo )?de (.+?)(?: con \d+ escalas?| sin escalas)?\./);
    const sl = a.match(/Sale de (.+?) el (.+?) a las (.+?) y llega a (.+?) el (.+?) a las (.+?)\.\.?\s/);
    const du = a.match(/Duración total: (.+?)\./);
    const st = a.match(/con (\d+) escalas?/);
    // Escalas: "Escala (1 de 2) de 2 h 10 min en Aeropuerto ... (GRU)"
    const lay = [...a.matchAll(/escala \(\d+ de \d+\) en (.+?) tiene una duración de (.+?)\.(?: Transbordo aquí de (.+?) a (.+?)\.)?/gi)].map((m) => `${m[2]} en ${m[1]}${m[3] ? ` (cambio de aeropuerto: ${m[3]} → ${m[4]})` : ""}`);
    if (!p || !sl) continue;
    const airline = al?.[1] ?? "?", key = airline + sl[3] + sl[6];
    if (seen.has(key)) continue;
    seen.add(key);
    const fx = (s) => (/[ap]\.m$/.test(s) ? s + "." : s);
    out.push({ price: parseInt(p[1].replace(/[.,]/g, ""), 10), stops: st ? +st[1] : 0, airline, dep: fx(sl[3]), arr: fx(sl[6]), dur: du?.[1] ?? "", from: sl[1], to: sl[4], nd: sl[5] !== sl[2] ? 1 : 0, lay });
  }
  return out.sort((x, y) => x.price - y.price).slice(0, 14);
}

// Devuelve {opts, none}: none=true cuando Google dice "No se encontraron resultados" (no hay vuelos, no es error).
// Fechas de salida a buscar (día del mes; vuelta 8 días después). Por defecto solo el 10. Ej. DIAS="3,10,17,24"
const DIAS = (process.env.DIAS || "10").split(",").map(Number);
const ymd = (m, d) => { const t = new Date(Date.UTC(2027, m - 1, d)); return t.toISOString().slice(0, 10); };
// MODO: "iv" (ida y vuelta, 8 noches) · "ida" (solo ida origen→destino) · "vuelta" (solo ida destino→origen)
const MODO = process.env.MODO || "iv";
// Noches de la estadía (8 = 9 días; 9 = 10 días). Con otro valor que 8, las claves de 'fechas' y 'fdet' llevan '-n<noches>'.
const NOCHES = Number(process.env.NOCHES || 8), NK = NOCHES === 8 ? "" : `-n${NOCHES}`;
async function scrape(page, o, ap, m, d = 10) {
  const u = MODO === "iv" ? `https://www.google.com/travel/flights?q=Flights%20from%20${o}%20to%20${ap}%20on%20${ymd(m, d)}%20through%20${ymd(m, d + NOCHES)}&curr=USD&hl=es-419&gl=AR`
    : `https://www.google.com/travel/flights?q=Flights%20from%20${MODO === "ida" ? o : ap}%20to%20${MODO === "ida" ? ap : o}%20on%20${ymd(m, d)}%20one%20way&curr=USD&hl=es-419&gl=AR`;
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
      const state = await page.waitForFunction(() => {
        if (document.querySelector('[aria-label^="Precio total ida y vuelta"]') || [...document.querySelectorAll("[aria-label^='Desde ']")].some((e) => /dólares/.test(e.getAttribute("aria-label")))) return "ok";
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
// DESTINOS (opcional): lista propia de aeropuertos, p. ej. ciudades de conexión para armar escalas propias
const aps = process.env.DESTINOS ? process.env.DESTINOS.split(",") : [...new Set(dests.map((d) => d.airport).filter(Boolean))].sort();
const jobs = MESES.flatMap((m) => DIAS.flatMap((d) => aps.flatMap((a) => ORIGINS.filter((o) => o !== a).map((o) => [o, a, m, d])))).slice(0, Number(process.env.LIMIT || 1e9));
// En modo solo ida, saltea lo que ya está guardado (cada pasada completa los huecos)
if (MODO !== "iv") {
  const [ws0] = await sb("app_snapshots?key=eq.ow&select=data");
  const have = new Set(Object.keys(ws0?.data || {}));
  for (let i = jobs.length - 1; i >= 0; i--) {
    const [o, ap, m, d] = jobs[i], [a, b] = MODO === "ida" ? [o, ap] : [ap, o];
    if (have.has(`${a}>${b}|${ymd(m, d)}`)) jobs.splice(i, 1);
  }
}
// En ida y vuelta con SALTEAR=1, saltea las fechas que ya tienen precio en 'fechas' (pasadas para llenar huecos)
if (MODO === "iv" && process.env.SALTEAR === "1") {
  const [f0] = await sb("app_snapshots?key=eq.fechas&select=data");
  const have = new Set(Object.keys(f0?.data || {}));
  for (let i = jobs.length - 1; i >= 0; i--) { const [o, ap, m, d] = jobs[i]; if (have.has(`${o}-${ap}-${m}-${d}${NK}`)) jobs.splice(i, 1); }
}
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
    if (MODO !== "iv") await page.waitForTimeout(2500 + Math.random() * 2000);
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

if (MODO !== "iv") {
  const okw = results.filter((r) => r.opts.length);
  const [ws] = await sb("app_snapshots?key=eq.ow&select=data");
  const ow = ws?.data || {};
  // clave "ORIGEN>DESTINO|2027-01-12" (el sentido real del vuelo): [precio, escalas, aerolínea, sale, llega, duración, escalas detalle, aeropuerto salida, aeropuerto llegada, fecha dato]
  for (const { o, ap, m, d, opts } of okw) {
    const x = opts[0], [a, b] = MODO === "ida" ? [o, ap] : [ap, o];
    ow[`${a}>${b}|${ymd(m, d)}`] = [x.price, x.stops, x.airline, x.dep, x.arr, x.dur, x.lay, x.from, x.to, fetched_at.slice(0, 10)];
  }
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "ow", data: ow, updated_at: fetched_at }) });
  await sb("sync_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ source: "github_actions_ow", quotes: okw.length, note: `${MODO} meses ${MESES} días ${DIAS}` }) });
  console.log("listo solo ida", MODO, okw.length, "de", results.length);
  process.exit(okw.length ? 0 : 1);
}
const rows = results.flatMap(({ o, ap, m, d, opts }) => opts.map((x) => ({
  origin: o, dest: ap, depart_on: ymd(m, d), return_on: ymd(m, d + NOCHES),
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
  for (const { o, ap, m, d, opts } of okAll) fe[`${o}-${ap}-${m}-${d}${NK}`] = [opts[0].price, opts[0].stops, opts[0].airline, opts[0].dur, fetched_at.slice(0, 10)];
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "fechas", data: fe, updated_at: fetched_at }) });
}
// Detalle por ruta (aeropuerto de salida y llegada, horarios, escalas) para la página: app_snapshots 'fdet'
{
  const [fs] = await sb("app_snapshots?key=eq.fdet&select=data");
  const fdet = fs?.data || {};
  for (const { o, ap, m, opts } of ok) fdet[`${o}-${ap}-${m}${NK}`] = opts.map((x) => [x.price, x.stops, x.airline, x.dep, x.arr, x.nd, x.dur, x.lay, x.from, x.to]);
  await sb("app_snapshots?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key: "fdet", data: fdet, updated_at: fetched_at }) });
}
const [snap] = await sb("app_snapshots?key=eq.anio&select=data");
if (snap && ok.length && NOCHES === 8) {
  const anio = snap.data;
  for (const { o, ap, m, opts } of ok) {
    if (!IX[o]) continue; // orígenes nuevos: quedan en flight_quotes, fechas y fdet
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
