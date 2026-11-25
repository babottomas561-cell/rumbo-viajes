import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Sirve la misma página del artefacto, con los precios del año (ANIO) leídos en vivo de Supabase.
export async function GET(req: Request) {
  let html = await readFile(path.join(process.cwd(), "src/data/viaje/base.html"), "utf8");
  const db = getSupabaseAdmin();
  // IDs de las casas de la plantilla, antes de inyectar los datos grandes (si no, la búsqueda recorre 6 MB)
  const ids = [...new Set([...html.matchAll(/,"(\d{5,20})"[,\]]/g)].map((m) => m[1]))];
  // Todo lo de Supabase en paralelo: una sola consulta de snapshots + las distancias a la playa
  const chunks = Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150));
  const [snapRes, ...beachRes] = db ? await Promise.all([
    db.from("app_snapshots").select("key,data,updated_at").in("key", ["anio", "carprices", "fdet", "ow", "fechas", "ruta"]),
    ...chunks.map((c) => db.from("listing_beach").select("listing_id,beach_m,lat,lon,beach_name").in("listing_id", c)),
  ]) : [{ data: null }];
  const SNAP = new Map(((snapRes.data ?? []) as { key: string; data: unknown; updated_at: string }[]).map((r) => [r.key, r]));
  const snap = (k: string) => ({ data: (SNAP.get(k) ?? null) as { data: any; updated_at: string } | null }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = snap("anio");
  if (data) {
    const i = html.indexOf("const ANIO=");
    const j = html.indexOf(";\nconst MES=[", i);
    if (i >= 0 && j > i) html = html.slice(0, i) + "const ANIO=" + JSON.stringify(data.data).replace(/</g, "\\u003c") + html.slice(j);
    const d = new Date(data.updated_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    html = html.replace(/Precios del [^<]*?: los de meses/, `Precios del ${d}: los de meses`);
    const hours = (Date.now() - new Date(data.updated_at).getTime()) / 36e5;
    if (hours > 12) {
      const banner = `<div style="position:sticky;top:0;z-index:999;background:#f2c230;color:#3a2c00;padding:8px 16px;font:500 14px Inter,system-ui,sans-serif;text-align:center">Ojo: los precios son del ${d} (hace ${Math.round(hours)} h). Confirmalos antes de reservar.</div>`;
      html = html.replace(/<body[^>]*>/, (m) => m + banner);
      if (!/<body/.test(html)) html = banner + html;
    }
  }
  // Valores oficiales del cálculo en auto (los actualiza scripts/car_prices.py todos los días)
  const { data: cp } = snap("carprices");
  html = html.replace("const CARLIVE=null;", "const CARLIVE=" + JSON.stringify(cp?.data ?? null).replace(/</g, "\\u003c") + ";");
  // Detalle de vuelos del robot (aeropuertos, horarios, escalas) del mes de enero: pisa FD
  const { data: fdx } = snap("fdet");
  if (fdx?.data) {
    const live: Record<string, { o: unknown[] }> = {};
    for (const [k, o] of Object.entries(fdx.data as Record<string, unknown[]>)) if (k.endsWith("-1")) live[k.slice(0, -2)] = { o };
    html = html.replace("const FD={", "const FDLIVE=" + JSON.stringify(live).replace(/</g, "\\u003c") + ";const FD={");
  }
  // Vuelos solo ida de cualquier día (ow) e ida y vuelta por fecha (fechas): calendario de la pestaña Vuelos
  for (const [key, name] of [["ow", "OWLIVE"], ["fechas", "FELIVE"]] as const) {
    const { data: x } = snap(key);
    if (x?.data) html = html.replace(`const ${name}=null;`, `const ${name}=` + JSON.stringify(x.data).replace(/</g, "\\u003c") + ";");
  }
  // Itinerario en auto día por día (horarios OSRM, pronóstico, noches de Airbnb, noticias de ruta y fotos): scripts/road_trip.py cada 6 h
  const { data: rt } = snap("ruta");
  if (rt?.data) html = html.replace("const RUTALIVE=null;", "const RUTALIVE=" + JSON.stringify(rt.data).replace(/</g, "\\u003c") + ";");
  // Distancia de cada casa de la página a la playa más cercana (OpenStreetMap + PostGIS, tabla listing_beach)
  if (db) {
    const live: Record<string, [number, number | null, number | null, string | null]> = {};
    for (const r of beachRes) for (const x of (r.data ?? []) as { listing_id: string; beach_m: number; lat: number | null; lon: number | null; beach_name: string | null }[]) live[x.listing_id] = [x.beach_m, x.lat, x.lon, x.beach_name];
    if (Object.keys(live).length) html = html.replace("const BEACHLIVE=null;", "const BEACHLIVE=" + JSON.stringify(live).replace(/</g, "\\u003c") + ";");
  }
  // Link compartido de una ficha (?p=jurere&pax=6&n=8): vista previa con la playa, la foto de una casa libre y el precio en vivo
  const sp = new URL(req.url).searchParams;
  const pk = (sp.get("p") ?? "").replace(/[^a-z0-9_]/g, "");
  if (db && pk) {
    const pax = Math.min(16, Math.max(1, Number(sp.get("pax")) || 6)), n = Math.min(30, Math.max(2, Number(sp.get("n")) || 9));
    const casa = (sp.get("casa") ?? "").replace(/\D/g, "");
    const [{ data: dest }, { data: st }] = await Promise.all([
      db.from("destinations").select("name").eq("k", pk).maybeSingle(),
      db.from("stay_listings").select("listing_id,name,stay_price_usd,photos,checkin,checkout,adults,fetched_at").eq("k", pk).not("photos", "is", null)
        .gte("fetched_at", new Date(Date.now() - 3 * 864e5).toISOString()).order("fetched_at", { ascending: false }).limit(60),
    ]);
    if (dest?.name) {
      const rows = (st ?? []).filter((r) => r.photos?.length);
      const same = rows.filter((r) => r.adults === pax);
      const h = rows.find((r) => r.listing_id === casa) ?? [...(same.length ? same : rows)].sort((a, b) => a.stay_price_usd - b.stay_price_usd)[0];
      const nights = h?.checkin && h?.checkout ? (Date.parse(h.checkout) - Date.parse(h.checkin)) / 864e5 : n;
      const pp = h ? Math.round((Number(h.stay_price_usd) / (h.adults || pax)) * (n / nights)) : null;
      const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const title = `${dest.name} · Viaje Brasil 2027`;
      const desc = pp ? `Casa libre en Airbnb desde USD ${pp.toLocaleString("es-AR")} por persona (${pax} personas, ${n} noches). Precios, vuelos y distancia a la playa en vivo.` : `Casas, vuelos y distancia a la playa en vivo para ${pax} personas, ${n} noches.`;
      const img = h?.photos?.[0] ? `${h.photos[0].split("?")[0]}?im_w=1200` : "";
      const og = `<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta name="description" content="${esc(desc)}">${img ? `<meta property="og:image" content="${esc(img)}"><meta name="twitter:card" content="summary_large_image">` : ""}<meta property="og:url" content="${esc(req.url)}">`;
      html = og + html.replace("<title>Brasil Verano 2027</title>", `<title>${esc(title)}</title>`);
    }
  }
  // La plantilla es un artefacto (sin <head>): se agrega lo necesario para que el celular la muestre a su ancho real
  if (!/name="viewport"/.test(html)) html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` + html;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=86400" } });
}
