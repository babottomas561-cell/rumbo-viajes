import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Sirve la misma página del artefacto, con los precios del año (ANIO) leídos en vivo de Supabase.
export async function GET() {
  let html = await readFile(path.join(process.cwd(), "src/data/viaje/base.html"), "utf8");
  const db = getSupabaseAdmin();
  const { data } = db ? await db.from("app_snapshots").select("data,updated_at").eq("key", "anio").maybeSingle() : { data: null };
  if (data) {
    const i = html.indexOf("const ANIO=");
    const j = html.indexOf(";\nconst MES=[", i);
    if (i >= 0 && j > i) html = html.slice(0, i) + "const ANIO=" + JSON.stringify(data.data).replace(/</g, "\\u003c") + html.slice(j);
    const d = new Date(data.updated_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    html = html.replace(/Precios del [^<]*?: los de meses/, `Precios del ${d}: los de meses`);
  }
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
