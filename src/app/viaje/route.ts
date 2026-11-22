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
    const hours = (Date.now() - new Date(data.updated_at).getTime()) / 36e5;
    if (hours > 12) {
      const banner = `<div style="position:sticky;top:0;z-index:999;background:#f2c230;color:#3a2c00;padding:8px 16px;font:500 14px Inter,system-ui,sans-serif;text-align:center">Ojo: los precios son del ${d} (hace ${Math.round(hours)} h). Confirmalos antes de reservar.</div>`;
      html = html.replace(/<body[^>]*>/, (m) => m + banner);
      if (!/<body/.test(html)) html = banner + html;
    }
  }
  // Valores oficiales del cálculo en auto (los actualiza scripts/car_prices.py todos los días)
  const { data: cp } = db ? await db.from("app_snapshots").select("data").eq("key", "carprices").maybeSingle() : { data: null };
  html = html.replace("const CARLIVE=null;", "const CARLIVE=" + JSON.stringify(cp?.data ?? null).replace(/</g, "\\u003c") + ";");
  // La plantilla es un artefacto (sin <head>): se agrega lo necesario para que el celular la muestre a su ancho real
  if (!/name="viewport"/.test(html)) html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` + html;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
