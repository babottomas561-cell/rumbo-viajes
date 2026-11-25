import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { airbnbUrl, attachBeaches, cachedStays, destBoxes, saveStays, searchAirbnb, type Query } from "@/lib/airbnb-live";

// Casas de Airbnb en el momento para cada ficha de la página: precio total y disponibilidad para esas fechas y ese grupo
// (Airbnb solo devuelve lo que está libre), fotos, playa más cercana y metros. Lo que trae se guarda en Supabase;
// si la misma búsqueda se hizo hace menos de 30 min (otra persona o el refresco automático), sale de la base.
// GET /api/stays/live?k=jurere&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=8&bedrooms=3[&sw_lat=&sw_lng=&ne_lat=&ne_lng=][&cursor=][&fresh=1]
export const maxDuration = 30;

const iso = /^\d{4}-\d{2}-\d{2}$/;
const FRESH_MIN = 30;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const k = (sp.get("k") ?? "").replace(/[^a-z0-9_]/g, "");
  let box = ["sw_lat", "sw_lng", "ne_lat", "ne_lng"].map((x) => Number(sp.get(x)));
  if (box.some((x) => !Number.isFinite(x) || x === 0)) box = (k && destBoxes()[k]) || [];
  const q: Query = {
    box,
    checkin: sp.get("checkin") ?? "",
    checkout: sp.get("checkout") ?? "",
    adults: Math.min(16, Math.max(1, Number(sp.get("adults")) || 6)),
    bedrooms: Math.min(8, Math.max(0, Number(sp.get("bedrooms")) || 0)),
    cursor: sp.get("cursor") ?? "",
  };
  if (box.length !== 4 || Math.abs(box[2] - box[0]) > 1 || Math.abs(box[3] - box[1]) > 1)
    return Response.json({ error: "Zona inválida." }, { status: 400 });
  if (!iso.test(q.checkin) || !iso.test(q.checkout) || q.checkout <= q.checkin)
    return Response.json({ error: "Fechas inválidas." }, { status: 400 });

  const db = getSupabaseAdmin();
  const headers = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" };
  // Búsqueda por destino (no por zona del mapa): primero la base, si está fresca
  if (db && k && !q.cursor && sp.get("fresh") !== "1") {
    const c = await cachedStays(db, k, q, FRESH_MIN);
    if (c) return Response.json({ fetchedAt: c.fetchedAt, from: "base", airbnbUrl: airbnbUrl(q).toString(), pageCursors: [], items: c.items }, { headers });
  }
  try {
    const r = await searchAirbnb(q);
    if (db) {
      await attachBeaches(db, r.items);
      if (k && !q.cursor) await saveStays(db, k, q, r.items, "live");
    }
    return Response.json({ fetchedAt: new Date().toISOString(), from: "airbnb", airbnbUrl: r.url, pageCursors: r.pageCursors, items: r.items }, { headers });
  } catch (e) {
    // Si Airbnb no responde, lo último guardado (aunque tenga más de 30 min), avisando la hora
    const c = db && k ? await cachedStays(db, k, q, 60 * 24 * 7) : null;
    if (c) return Response.json({ fetchedAt: c.fetchedAt, from: "base", stale: true, airbnbUrl: airbnbUrl(q).toString(), pageCursors: [], items: c.items });
    return Response.json({ error: `Airbnb no respondió (${e instanceof Error ? e.message : "error"}).`, airbnbUrl: airbnbUrl(q).toString() }, { status: 502 });
  }
}
