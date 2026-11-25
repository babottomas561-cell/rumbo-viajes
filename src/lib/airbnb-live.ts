import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

// Búsqueda de casas en Airbnb en el momento + playa más cercana (PostGIS) + guardado en Supabase.
// La usan /api/stays/live (cada ficha de la página) y /api/cron/stays (refresco de la base cada 20 min).

const UA = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "es-AR,es;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};

export type Beach = { m: number; name: string | null; kind: string; k: string | null; lat: number | null; lon: number | null };
export type LiveStay = {
  id: string;
  title: string;
  price: number;
  priceOrig: number | null;
  qualifier: string;
  rating: number | null;
  reviews: number | null;
  guestFav: boolean;
  bedrooms: number | null;
  beds: number | null;
  baths: number | null;
  lat: number | null;
  lon: number | null;
  photos: string[];
  beach: Beach | null;
};
export type Query = { box: number[]; checkin: string; checkout: string; adults: number; bedrooms: number; cursor?: string };

type Raw = {
  demandStayListing?: { id?: string; location?: { coordinate?: { latitude?: number; longitude?: number } } };
  structuredDisplayPrice?: { primaryLine?: Record<string, string> };
  avgRatingLocalized?: string;
  title?: string;
  nameLocalized?: { localizedStringWithTranslationPreference?: string };
  contextualPictures?: { picture?: string }[];
  badges?: { loggingContext?: { badgeType?: string } }[];
  structuredContent?: { primaryLine?: { body?: string }[]; mapPrimaryLine?: { body?: string }[] };
};

const usd = (s?: string) => {
  const m = /\$\s*([\d.,]+)\s*USD/.exec(s ?? "");
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
};
const num = (lines: string[], re: RegExp) => {
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return Number(m[1].replace(",", "."));
  }
  return null;
};

function listingId(r: Raw) {
  const enc = r.demandStayListing?.id;
  if (!enc) return null;
  try {
    return /:(\d+)$/.exec(Buffer.from(enc, "base64").toString("utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function airbnbUrl(q: Query) {
  const url = new URL("https://www.airbnb.com.ar/s/homes");
  const p: Record<string, string> = {
    checkin: q.checkin, checkout: q.checkout, adults: String(q.adults), currency: "USD", search_type: "user_map_move", search_by_map: "true",
    sw_lat: String(q.box[0]), sw_lng: String(q.box[1]), ne_lat: String(q.box[2]), ne_lng: String(q.box[3]), zoom_level: "14",
  };
  if (q.bedrooms) p.min_bedrooms = String(q.bedrooms);
  if (q.cursor) p.cursor = q.cursor;
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v);
  return url;
}

export async function searchAirbnb(q: Query): Promise<{ url: string; items: LiveStay[]; pageCursors: string[] }> {
  const url = airbnbUrl(q);
  const r = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Airbnb respondió ${r.status}`);
  const html = await r.text();
  const m = /<script[^>]*id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("Airbnb cambió la página");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = JSON.parse(m[1]).niobeClientData?.[0]?.[1]?.data?.presentation?.staysSearch?.results;
  const raw: Raw[] = res?.searchResults ?? [];
  const items = raw.map((x): LiveStay | null => {
    const id = listingId(x);
    const pl = x.structuredDisplayPrice?.primaryLine ?? {};
    const price = usd(pl.discountedPrice || pl.price || pl.accessibilityLabel);
    if (!id || !price) return null;
    const rate = /^(\d+,?\d*)(?:\s*\((\d+)\))?/.exec(x.avgRatingLocalized ?? "");
    const c = x.demandStayListing?.location?.coordinate;
    const lines = [...(x.structuredContent?.mapPrimaryLine ?? []), ...(x.structuredContent?.primaryLine ?? [])].map((l) => l.body ?? "");
    return {
      id,
      title: x.nameLocalized?.localizedStringWithTranslationPreference || x.title || "Alojamiento",
      price,
      priceOrig: usd(pl.originalPrice),
      qualifier: pl.qualifier ?? "",
      rating: rate ? Number(rate[1].replace(",", ".")) : null,
      reviews: rate?.[2] ? Number(rate[2]) : null,
      guestFav: (x.badges ?? []).some((b) => b.loggingContext?.badgeType === "GUEST_FAVORITE"),
      bedrooms: num(lines, /^(\d+)\s+dormitorio/),
      beds: num(lines, /^(\d+)\s+cama/),
      baths: num(lines, /^(\d+(?:,\d)?)\s+baño/),
      lat: c?.latitude ?? null,
      lon: c?.longitude ?? null,
      photos: (x.contextualPictures ?? []).map((p) => p.picture ?? "").filter(Boolean).slice(0, 8),
      beach: null,
    };
  }).filter((x): x is LiveStay => !!x);
  return { url: url.toString(), items, pageCursors: (res?.paginationInfo?.pageCursors ?? []) as string[] };
}

// Playa más cercana de cada casa. Más de 5 km = el mapa de playas de esa zona todavía no está bajado: sin dato.
export async function attachBeaches(db: SupabaseClient, items: LiveStay[]) {
  const withPt = items.filter((x) => x.lat != null);
  if (!withPt.length) return;
  const { data } = await db.rpc("nearest_beach_batch", { p_pts: withPt.map((x) => [x.lat, x.lon]) });
  for (const b of (data ?? []) as { i: number; beach_m: number; beach_name: string | null; beach_kind: string; k: string | null; beach_lat: number; beach_lon: number }[])
    if (withPt[b.i] && b.beach_m <= 5000)
      withPt[b.i].beach = { m: b.beach_m, name: b.beach_name, kind: b.beach_kind, k: b.k, lat: b.beach_lat, lon: b.beach_lon };
}

// Guarda la foto del momento: stay_listings (precio, disponibilidad para esas fechas, fotos) y listing_beach (metros a la playa).
export async function saveStays(db: SupabaseClient, k: string, q: Query, items: LiveStay[], source: string) {
  if (!items.length) return;
  const fetched_at = new Date().toISOString();
  const month = Number(q.checkin.slice(5, 7));
  const { error } = await db.from("stay_listings").upsert(items.map((x) => ({
    k, month, adults: q.adults, listing_id: x.id, name: x.title, stay_price_usd: x.price, price_orig_usd: x.priceOrig,
    rating: x.rating, reviews: x.reviews, bedrooms: x.bedrooms, beds: x.beds, baths: x.baths, lat: x.lat, lon: x.lon,
    photos: x.photos, guest_fav: x.guestFav, checkin: q.checkin, checkout: q.checkout, source, fetched_at,
  })), { onConflict: "k,month,adults,listing_id" });
  if (error) console.error("stay_listings", error.message);
  const lb = items.filter((x) => x.beach).map((x) => ({
    listing_id: x.id, k, beach_m: x.beach!.m, beach_name: x.beach!.name, beach_kind: x.beach!.kind, lat: x.lat, lon: x.lon,
    beach_lat: x.beach!.lat, beach_lon: x.beach!.lon, computed_at: fetched_at,
  }));
  if (lb.length) await db.from("listing_beach").upsert(lb, { onConflict: "listing_id" });
}

// Lo guardado hace menos de maxMin minutos para exactamente esa búsqueda (misma playa, fechas y grupo).
export async function cachedStays(db: SupabaseClient, k: string, q: Query, maxMin: number) {
  const since = new Date(Date.now() - maxMin * 60000).toISOString();
  const { data } = await db.from("stay_listings")
    .select("listing_id,name,stay_price_usd,price_orig_usd,rating,reviews,bedrooms,beds,baths,lat,lon,photos,guest_fav,fetched_at")
    .eq("k", k).eq("adults", q.adults).eq("checkin", q.checkin).eq("checkout", q.checkout).gte("fetched_at", since)
    .order("fetched_at", { ascending: false }).limit(60);
  if (!data?.length) return null;
  // Solo la última tanda: una casa que dejó de aparecer ya no está libre
  const last = new Date(data[0].fetched_at).getTime();
  const rows = data.filter((r) => last - new Date(r.fetched_at).getTime() < 120000)
    .filter((r) => !q.bedrooms || r.bedrooms == null || r.bedrooms >= q.bedrooms);
  if (rows.length < 3) return null;
  const { data: bs } = await db.from("listing_beach").select("listing_id,beach_m,beach_name,beach_kind,k,beach_lat,beach_lon").in("listing_id", rows.map((r) => r.listing_id));
  const B = new Map((bs ?? []).map((b) => [b.listing_id, b]));
  const items: LiveStay[] = rows.map((r) => {
    const b = B.get(r.listing_id);
    return {
      id: r.listing_id, title: r.name ?? "Alojamiento", price: Number(r.stay_price_usd), priceOrig: r.price_orig_usd == null ? null : Number(r.price_orig_usd),
      qualifier: "", rating: r.rating, reviews: r.reviews, guestFav: !!r.guest_fav, bedrooms: r.bedrooms, beds: r.beds, baths: r.baths,
      lat: r.lat, lon: r.lon, photos: r.photos ?? [],
      beach: b && b.beach_m <= 5000 ? { m: b.beach_m, name: b.beach_name, kind: b.beach_kind, k: b.k, lat: b.beach_lat, lon: b.beach_lon } : null,
    };
  });
  return { items, fetchedAt: data[0].fetched_at as string };
}

// Caja de búsqueda de cada destino, la misma que usa la página (ABB; si no hay, GEO ± 0,02°)
let BOXES: Record<string, number[]> | null = null;
export function destBoxes() {
  if (BOXES) return BOXES;
  const html = readFileSync(path.join(process.cwd(), "src/data/viaje/base.html"), "utf8");
  const out: Record<string, number[]> = {};
  const geo = /const GEO=\{([^}]*)\}/.exec(html)?.[1] ?? "";
  for (const m of geo.matchAll(/"?([a-z0-9_]+)"?:\[(-?[\d.]+),(-?[\d.]+)\]/g)) out[m[1]] = [+m[2] - 0.02, +m[3] - 0.02, +m[2] + 0.02, +m[3] + 0.02];
  const abb = /const ABB=(\{[^;]*\});/.exec(html)?.[1];
  if (abb) for (const [k, v] of Object.entries(JSON.parse(abb) as Record<string, number[]>)) out[k] = v;
  BOXES = out;
  return out;
}
