import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Búsqueda de casas en Airbnb en el momento: precios y disponibilidad para las fechas pedidas (Airbnb solo
// devuelve lo que está libre), con la playa más cercana y los metros calculados en Supabase (beaches + PostGIS).
// GET /api/stays/live?sw_lat=&sw_lng=&ne_lat=&ne_lng=&checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&adults=6&bedrooms=3&cursor=
export const maxDuration = 30;

const UA = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "es-AR,es;q=0.9",
  Accept: "text/html,application/xhtml+xml",
};
const iso = /^\d{4}-\d{2}-\d{2}$/;

type Raw = Record<string, unknown> & {
  demandStayListing?: { id?: string; location?: { coordinate?: { latitude?: number; longitude?: number } } };
  structuredDisplayPrice?: { primaryLine?: Record<string, string> };
  avgRatingLocalized?: string;
  title?: string;
  nameLocalized?: { localizedStringWithTranslationPreference?: string };
  subtitle?: string;
  contextualPictures?: { picture?: string }[];
  structuredContent?: { primaryLine?: { body?: string }[]; mapPrimaryLine?: { body?: string }[] };
};

const usd = (s?: string) => {
  const m = /\$\s*([\d.,]+)\s*USD/.exec(s ?? "");
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
};

function listingId(r: Raw) {
  const enc = r.demandStayListing?.id;
  if (!enc) return null;
  try {
    const dec = Buffer.from(enc, "base64").toString("utf8");
    return /:(\d+)$/.exec(dec)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const box = ["sw_lat", "sw_lng", "ne_lat", "ne_lng"].map((k) => Number(q.get(k)));
  const checkin = q.get("checkin") ?? "", checkout = q.get("checkout") ?? "";
  const adults = Math.min(16, Math.max(1, Number(q.get("adults")) || 6));
  const bedrooms = Math.min(8, Math.max(0, Number(q.get("bedrooms")) || 0));
  const cursor = q.get("cursor") ?? "";
  if (box.some((x) => !Number.isFinite(x)) || Math.abs(box[2] - box[0]) > 1 || Math.abs(box[3] - box[1]) > 1)
    return Response.json({ error: "Zona inválida." }, { status: 400 });
  if (!iso.test(checkin) || !iso.test(checkout) || checkout <= checkin)
    return Response.json({ error: "Fechas inválidas." }, { status: 400 });

  const url = new URL("https://www.airbnb.com.ar/s/homes");
  const params: Record<string, string> = {
    checkin, checkout, adults: String(adults), currency: "USD", search_type: "user_map_move", search_by_map: "true",
    sw_lat: String(box[0]), sw_lng: String(box[1]), ne_lat: String(box[2]), ne_lng: String(box[3]), zoom_level: "14",
  };
  if (bedrooms) params.min_bedrooms = String(bedrooms);
  if (cursor) params.cursor = cursor;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let html: string;
  try {
    const r = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Airbnb respondió ${r.status}`);
    html = await r.text();
  } catch (e) {
    return Response.json({ error: `Airbnb no respondió (${e instanceof Error ? e.message : "error"}). Probá de nuevo en un rato.`, airbnbUrl: url.toString() }, { status: 502 });
  }
  const m = /<script[^>]*id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return Response.json({ error: "Airbnb cambió la página y no se pudo leer. Abrí la búsqueda directo en Airbnb.", airbnbUrl: url.toString() }, { status: 502 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = JSON.parse(m[1]).niobeClientData?.[0]?.[1]?.data?.presentation?.staysSearch?.results;
  const raw: Raw[] = res?.searchResults ?? [];
  const items = raw.map((r) => {
    const pl = r.structuredDisplayPrice?.primaryLine ?? {};
    const rate = /([\d,]+)\s*\((\d+)\)/.exec(r.avgRatingLocalized ?? "");
    const c = r.demandStayListing?.location?.coordinate;
    return {
      id: listingId(r),
      title: r.nameLocalized?.localizedStringWithTranslationPreference || r.title || "",
      kind: r.title || "",
      rooms: [...new Set([...(r.structuredContent?.mapPrimaryLine ?? []), ...(r.structuredContent?.primaryLine ?? [])].map((x) => x.body).filter(Boolean))].join(" · "),
      price: usd(pl.discountedPrice || pl.price || pl.accessibilityLabel),
      priceOrig: usd(pl.originalPrice),
      qualifier: pl.qualifier ?? "",
      rating: rate ? Number(rate[1].replace(",", ".")) : null,
      reviews: rate ? Number(rate[2]) : 0,
      lat: c?.latitude ?? null,
      lon: c?.longitude ?? null,
      photos: (r.contextualPictures ?? []).map((p) => p.picture).filter(Boolean).slice(0, 6),
      beach: null as null | { m: number; name: string | null; kind: string; k: string | null },
    };
  }).filter((x) => x.id && x.price);

  const db = getSupabaseAdmin();
  const pts = items.filter((x) => x.lat != null).map((x) => [x.lat, x.lon]);
  if (db && pts.length) {
    const { data } = await db.rpc("nearest_beach_batch", { p_pts: pts });
    const withPt = items.filter((x) => x.lat != null);
    for (const b of (data ?? []) as { i: number; beach_m: number; beach_name: string | null; beach_kind: string; k: string | null }[])
      if (withPt[b.i]) withPt[b.i].beach = { m: b.beach_m, name: b.beach_name, kind: b.beach_kind, k: b.k };
  }

  return Response.json(
    { fetchedAt: new Date().toISOString(), airbnbUrl: url.toString(), pageCursors: (res?.paginationInfo?.pageCursors ?? []) as string[], items },
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" } },
  );
}
