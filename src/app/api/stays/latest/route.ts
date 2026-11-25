import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Última foto guardada de las casas de cada destino (la renueva /api/cron/stays cada 20 min y cada ficha que se abre),
// para que el mapa y el orden de todas las propuestas usen precios de Airbnb recientes y no los de la página.
// GET /api/stays/latest?adults=8&month=1
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const adults = Math.min(16, Math.max(1, Number(sp.get("adults")) || 8));
  const month = Math.min(12, Math.max(1, Number(sp.get("month")) || 1));
  const db = getSupabaseAdmin();
  if (!db) return Response.json({}, { status: 503 });
  const { data, error } = await db.rpc("stays_latest", { p_adults: adults, p_month: month });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data ?? {}, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400" } });
}
