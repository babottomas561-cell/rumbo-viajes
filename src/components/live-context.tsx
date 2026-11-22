"use client";

import { CalendarDays, CloudSun, RefreshCw, Wind } from "lucide-react";
import { useState } from "react";

type ContextData = {
  destination: string;
  period: { start: string; end: string };
  climate: { averageMax: number | null; averageMin: number | null; precipitation: number; averageWind: number | null; kind: string; source: string };
  rates: Array<{ currency: string; rate: number; date: string }>;
  holidays: Array<{ date: string; name: string }>;
  fetchedAt: string;
};

function rounded(value: number | null) {
  return value === null ? "—" : Math.round(value).toLocaleString("es-AR");
}

export function LiveContext({ destination, month }: { destination: string; month: number }) {
  const requestKey = `${destination}:${month}`;
  const [result, setResult] = useState<{ key: string; data: ContextData } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const data = result?.key === requestKey ? result.data : null;
  const error = failure?.key === requestKey ? failure.message : null;

  async function load() {
    setLoading(true); setFailure(null);
    try {
      const response = await fetch(`/api/travel/context?destination=${encodeURIComponent(destination)}&month=${month}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No pudimos actualizar el contexto.");
      setResult({ key: requestKey, data: body as ContextData });
    } catch (caught) {
      setFailure({ key: requestKey, message: caught instanceof Error ? caught.message : "No pudimos actualizar el contexto." });
    } finally { setLoading(false); }
  }

  return (
    <section className="live-context">
      <div className="live-context-head">
        <div><span className="eyebrow">FUENTES SINCRONIZADAS</span><h4>Contexto actualizado</h4><p>Proyección climática, cambio oficial y feriados para complementar el histórico.</p></div>
        <button onClick={load} disabled={loading}><RefreshCw />{loading ? "Consultando…" : "Actualizar datos"}</button>
      </div>
      {error && <div className="context-error">{error}</div>}
      {data && <div className="context-grid">
        <article><CloudSun /><span>Clima proyectado</span><strong>{rounded(data.climate.averageMax)}° / {rounded(data.climate.averageMin)}°</strong><small>{rounded(data.climate.precipitation)} mm en el mes · {data.climate.source}</small></article>
        <article><Wind /><span>Viento medio</span><strong>{rounded(data.climate.averageWind)} km/h</strong><small>Modelo climático, no pronóstico diario</small></article>
        <article><span>Cambio de referencia</span><strong>{data.rates.map((rate) => `1 USD = ${rate.rate.toLocaleString("es-AR")} ${rate.currency}`).join(" · ")}</strong><small>Frankfurter · {data.rates[0]?.date}</small></article>
        <article><CalendarDays /><span>Feriados del mes</span><strong>{data.holidays.length || "Ninguno"}</strong><small>{data.holidays.map((holiday) => `${holiday.date.slice(8, 10)}: ${holiday.name}`).join(" · ") || "Sin feriados nacionales informados"}</small></article>
      </div>}
      {!data && !error && <p className="context-placeholder">Consultá cuando quieras: los datos se guardan en caché y muestran siempre fuente y fecha.</p>}
    </section>
  );
}
