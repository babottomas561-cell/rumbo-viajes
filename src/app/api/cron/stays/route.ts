import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { attachBeaches, destBoxes, saveStays, searchAirbnb, type Query } from "@/lib/airbnb-live";

// Refresco de casas en el servidor (sin depender de ninguna compu): cada llamada renueva 4 destinos × 2 tamaños de grupo
// con la búsqueda de Airbnb del momento y lo guarda en stay_listings + listing_beach. Lo dispara pg_cron cada 20 min.
export const maxDuration = 60;

const PAXES = [8, 6];
const PER_RUN = 4;
const CHECKIN = "2027-01-06", CHECKOUT = "2027-01-15"; // las fechas por defecto de la página (9 noches)

export async function GET(req: Request) {
  const keys = [process.env.CRON_SECRET, process.env.FLIGHTS_HOOK_KEY].filter(Boolean);
  const auth = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace("Bearer ", "");
  if (!auth || !keys.includes(auth)) return new Response("no", { status: 401 });
  const db = getSupabaseAdmin();
  if (!db) return new Response("sin supabase", { status: 503 });

  const boxes = destBoxes();
  const { data: dests } = await db.from("destinations").select("k").order("k");
  const ks = (dests ?? []).map((d) => d.k as string).filter((k) => boxes[k]);
  const { data: cur } = await db.from("app_snapshots").select("data").eq("key", "stays_cursor").maybeSingle();
  const start = ((cur?.data as { i?: number } | null)?.i ?? 0) % ks.length;
  const pick = Array.from({ length: Math.min(PER_RUN, ks.length) }, (_, i) => ks[(start + i) % ks.length]);

  const jobs = pick.flatMap((k) => PAXES.map((adults) => ({ k, q: { box: boxes[k], checkin: CHECKIN, checkout: CHECKOUT, adults, bedrooms: Math.max(2, Math.ceil(adults / 3)) } as Query })));
  const done: string[] = [];
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(jobs.slice(i, i + 4).map(async ({ k, q }) => {
      try {
        const r = await searchAirbnb(q);
        await attachBeaches(db, r.items);
        await saveStays(db, k, q, r.items, "cron");
        done.push(`${k}/${q.adults}:${r.items.length}`);
      } catch (e) {
        done.push(`${k}/${q.adults}:error ${e instanceof Error ? e.message : ""}`);
      }
    }));
  }
  await db.from("app_snapshots").upsert({ key: "stays_cursor", data: { i: (start + pick.length) % ks.length }, updated_at: new Date().toISOString() });
  await db.from("sync_runs").insert({ source: "stays_cron", quotes: 0, note: done.join(" ") });
  return Response.json({ start, of: ks.length, done });
}
