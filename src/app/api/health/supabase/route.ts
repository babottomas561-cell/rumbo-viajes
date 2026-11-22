import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return Response.json({ configured: false, connected: false }, { status: 503 });
  const { error, count } = await admin.from("search_requests").select("id", { count: "exact", head: true });
  if (error) return Response.json({ configured: true, connected: false }, { status: 503 });
  return Response.json({ configured: true, connected: true, storedSearches: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
