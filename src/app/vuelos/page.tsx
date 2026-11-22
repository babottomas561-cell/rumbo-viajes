import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import "./vuelos.css";

export const metadata: Metadata = { title: "Vuelos en vivo", description: "Precios de vuelos desde Tucumán, Salta y Buenos Aires, por aerolínea, actualizados cada 4 horas." };

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--f-display", weight: ["500", "700", "800"] });
const body = Inter({ subsets: ["latin"], variable: "--f-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--f-mono", weight: ["500", "700"] });

const ORIGINS = [["TUC", "Tucumán"], ["SLA", "Salta"], ["BUE", "Buenos Aires"]] as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type Row = { origin: string; dest: string; depart_on: string; return_on: string; airline: string; airlines: string[]; price_usd: number; stops: number; dep_time: string; arr_time: string; duration: string | null; fetched_at: string };
type Sp = Promise<{ m?: string; d?: string; al?: string }>;

const usd = (n: number) => "USD " + n.toLocaleString("es-AR");
function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  return h < 1 ? "hace minutos" : h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

export default async function Vuelos({ searchParams }: { searchParams: Sp }) {
  const sp = await searchParams;
  const m = Math.min(12, Math.max(1, Number(sp.m) || 1));
  const db = getSupabaseAdmin();
  if (!db) return <main className="vz"><p>Falta configurar Supabase.</p></main>;

  const from = `2027-${String(m).padStart(2, "0")}-01`;
  const to = `2027-${String(m).padStart(2, "0")}-28`;
  const [{ data: rows }, { data: dests }, { data: run }] = await Promise.all([
    db.from("flight_latest").select("*").gte("depart_on", from).lte("depart_on", to).limit(5000),
    db.from("destinations").select("airport,name,zone"),
    db.from("sync_runs").select("started_at").order("started_at", { ascending: false }).limit(1),
  ]);
  const all = (rows ?? []) as Row[];
  const names = new Map<string, string>();
  for (const d of dests ?? []) if (d.airport && !names.has(d.airport)) names.set(d.airport, d.name);
  const label = (ap: string) => names.get(ap) ?? ap;

  const airlinesAll = [...new Set(all.flatMap((r) => r.airlines))].sort();
  const pick = sp.al && airlinesAll.includes(sp.al) ? sp.al : "";
  const list = pick ? all.filter((r) => r.airlines.includes(pick)) : all;

  // destino → origen → la opción más barata
  const grid = new Map<string, Map<string, Row>>();
  for (const r of list) {
    const g = grid.get(r.dest) ?? new Map<string, Row>();
    const cur = g.get(r.origin);
    if (!cur || r.price_usd < cur.price_usd) g.set(r.origin, r);
    grid.set(r.dest, g);
  }
  const dests2 = [...grid.entries()].sort((a, b) => Math.min(...[...a[1].values()].map((r) => r.price_usd)) - Math.min(...[...b[1].values()].map((r) => r.price_usd)));
  const sel = sp.d && grid.has(sp.d) ? sp.d : dests2[0]?.[0];
  const detail = list.filter((r) => r.dest === sel).sort((a, b) => a.price_usd - b.price_usd);

  const href = (p: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const v = { m, d: sel, al: pick, ...p };
    for (const [k, x] of Object.entries(v)) if (x) q.set(k, String(x));
    return "/vuelos?" + q.toString();
  };
  const best = (o: string) => Math.min(...list.filter((r) => r.origin === o).map((r) => r.price_usd));

  return (
    <main className={`vz ${display.variable} ${body.variable} ${mono.variable}`}>
      <header className="vz-head">
        <div>
          <p className="vz-kicker">Rumbo · base de vuelos</p>
          <h1>Vuelos desde el norte, por aerolínea</h1>
          <p className="vz-sub">Ida y vuelta del 10 al 18 de cada mes de 2027, precio por persona. Se actualiza solo cada 4 horas{run?.[0] ? ` · última carga ${ago(run[0].started_at)}` : ""}.</p>
        </div>
        <div className="vz-kpis">
          {ORIGINS.map(([o, n]) => (
            <div key={o} className="vz-kpi"><span>{n}</span><b>{Number.isFinite(best(o)) ? usd(best(o)) : "—"}</b><small>más barato del mes</small></div>
          ))}
        </div>
      </header>

      <nav className="vz-chips" aria-label="Mes">
        {MONTHS.map((n, i) => <a key={n} href={href({ m: i + 1, d: undefined })} className={i + 1 === m ? "on" : ""}>{n}</a>)}
      </nav>
      <nav className="vz-chips small" aria-label="Aerolínea">
        <a href={href({ al: "" })} className={!pick ? "on" : ""}>Todas las aerolíneas</a>
        {airlinesAll.map((a) => <a key={a} href={href({ al: a })} className={a === pick ? "on" : ""}>{a}</a>)}
      </nav>

      <div className="vz-grid">
        <section className="vz-card">
          <h2>Destinos ordenados por precio</h2>
          <div className="vz-table-wrap">
            <table className="vz-table">
              <thead><tr><th>Destino</th>{ORIGINS.map(([o, n]) => <th key={o} className="num">{n}</th>)}</tr></thead>
              <tbody>
                {dests2.map(([ap, g]) => {
                  const min = Math.min(...[...g.values()].map((r) => r.price_usd));
                  return (
                    <tr key={ap} className={ap === sel ? "sel" : ""}>
                      <td><a href={href({ d: ap })}><b>{label(ap)}</b> <span className="code">{ap}</span></a></td>
                      {ORIGINS.map(([o]) => {
                        const r = g.get(o);
                        return <td key={o} className={"num" + (r?.price_usd === min ? " best" : "")}>{r ? usd(r.price_usd) : <span className="muted">—</span>}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="vz-card">
          <h2>{sel ? `${label(sel)}: todas las opciones` : "Sin datos para este mes"}</h2>
          <ul className="vz-list">
            {detail.map((r, i) => (
              <li key={i}>
                <div className="vz-price">{usd(r.price_usd)}</div>
                <div>
                  <b>{r.airline}</b> <span className="tag">desde {ORIGINS.find(([o]) => o === r.origin)?.[1]}</span>
                  <p className="muted">{r.stops === 0 ? "Directo" : `${r.stops} escala${r.stops > 1 ? "s" : ""}`}{r.dep_time ? ` · sale ${r.dep_time}, llega ${r.arr_time}` : ""}{r.duration ? ` · ${r.duration}` : ""} · medido {ago(r.fetched_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="vz-foot">Fuente: Google Flights (página pública), guardado en Supabase con todo el historial. Antes de comprar, confirmá el precio en la aerolínea.</p>
    </main>
  );
}
