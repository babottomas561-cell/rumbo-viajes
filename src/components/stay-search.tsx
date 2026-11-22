"use client";

import { CalendarDays, ExternalLink, MapPin, Search, ShieldCheck, Star, Users } from "lucide-react";
import { FormEvent, useState } from "react";

import type { StaySearchResponse } from "@/lib/search/schema";

const today = new Date();
const inThirtyDays = new Date(today);
inThirtyDays.setDate(today.getDate() + 30);
const inThirtySevenDays = new Date(today);
inThirtySevenDays.setDate(today.getDate() + 37);
const dateValue = (date: Date) => date.toISOString().slice(0, 10);

function money(value: number | null, currency: string | null) {
  if (value === null || currency === null) return "Precio al consultar";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

const providerLabel: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
  google: "Google Hotels",
};

export function StaySearch({ embedded = false }: { embedded?: boolean }) {
  const [result, setResult] = useState<StaySearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      destination: form.get("destination"),
      checkIn: form.get("checkIn"),
      checkOut: form.get("checkOut"),
      adults: Number(form.get("adults")),
      rooms: Number(form.get("rooms")),
      currency: form.get("currency"),
    };

    try {
      const response = await fetch("/api/search/stays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No pudimos buscar.");
      let current = body as StaySearchResponse;
      setResult(current);
      for (let attempt = 0; current.mode === "pending" && current.jobId && attempt < 80; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const pollResponse = await fetch(`/api/search/stays/jobs/${encodeURIComponent(current.jobId)}`, { cache: "no-store" });
        const pollBody = await pollResponse.json();
        if (!pollResponse.ok) throw new Error(pollBody.error ?? "No pudimos completar la búsqueda.");
        current = pollBody as StaySearchResponse;
        setResult(current);
      }
      if (current.mode === "pending") throw new Error("La búsqueda continúa más de lo esperado. Probá nuevamente en unos minutos.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos buscar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={embedded ? "search-shell embedded-search" : "search-shell"} id="buscar">
      <form className="search-card" onSubmit={submit}>
        <div className="field field-destination">
          <label htmlFor="destination">¿A dónde querés ir?</label>
          <div className="input-wrap">
            <MapPin size={19} />
            <input id="destination" name="destination" defaultValue="Florianópolis, Brasil" minLength={2} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="checkIn">Entrada</label>
          <div className="input-wrap">
            <CalendarDays size={18} />
            <input id="checkIn" name="checkIn" type="date" defaultValue={dateValue(inThirtyDays)} min={dateValue(today)} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="checkOut">Salida</label>
          <div className="input-wrap">
            <CalendarDays size={18} />
            <input id="checkOut" name="checkOut" type="date" defaultValue={dateValue(inThirtySevenDays)} min={dateValue(today)} required />
          </div>
        </div>
        <div className="field field-small">
          <label htmlFor="adults">Viajeros</label>
          <div className="input-wrap">
            <Users size={18} />
            <input id="adults" name="adults" type="number" defaultValue="2" min="1" max="16" />
          </div>
        </div>
        <div className="field field-small">
          <label htmlFor="rooms">Habitaciones</label>
          <div className="input-wrap">
            <input id="rooms" name="rooms" type="number" defaultValue="1" min="1" max="8" />
          </div>
        </div>
        <input type="hidden" name="currency" value="USD" />
        <button className="search-button" type="submit" disabled={loading}>
          <Search size={19} />
          {loading ? "Buscando en vivo…" : "Buscar estadías"}
        </button>
      </form>

      <div className="trust-row">
        <span><ShieldCheck size={16} /> Precios identificados por proveedor</span>
        <span>Sin inventar disponibilidad</span>
        <span>Validación antes de reservar</span>
      </div>

      {error && <div className="status-box error-box">{error}</div>}
      {result?.warning && (
        <div className="status-box">
          <strong>{result.mode === "live" ? "Búsqueda en vivo completada" : result.mode === "sandbox" ? "Prueba de integración completada" : result.mode === "pending" ? "Buscando en proveedores" : "Integración preparada"}</strong>
          <span>{result.warning}</span>
          {result.mode === "not-configured" && (
            <a href="https://stayingapi.com/signup" target="_blank" rel="noreferrer">
              Obtener clave gratuita <ExternalLink size={15} />
            </a>
          )}
        </div>
      )}

      {result && result.offers.length > 0 && (
        <div className="results-section">
          <div className="results-heading">
            <div><span className="eyebrow">{result.mode === "sandbox" ? "Resultados de prueba" : "Resultados en vivo"}</span><h2>{result.offers.length} opciones encontradas</h2></div>
            <p>Actualizado {new Date(result.fetchedAt).toLocaleString("es-AR")}</p>
          </div>
          <div className="results-grid">
            {result.offers.map((offer) => (
              <article className="stay-card" key={offer.id}>
                <div className="stay-image" style={offer.imageUrl ? { backgroundImage: `url(${offer.imageUrl})` } : undefined}>
                  <span>{providerLabel[offer.provider] ?? offer.provider}</span>
                </div>
                <div className="stay-copy">
                  <p className="stay-location"><MapPin size={14} /> {offer.location || "Ubicación provista al reservar"}</p>
                  <h3>{offer.name}</h3>
                  <div className="stay-meta">
                    {offer.rating !== null && <span><Star size={14} fill="currentColor" /> {offer.rating}</span>}
                    {offer.reviewCount !== null && <span>{offer.reviewCount} reseñas</span>}
                    {offer.bedrooms !== null && <span>{offer.bedrooms} dorm.</span>}
                  </div>
                  <div className="stay-price">
                    <div><strong>{money(offer.totalPrice, offer.currency)}</strong><span>total de la estadía</span></div>
                  <a href={offer.bookingUrl} target="_blank" rel="noopener noreferrer">Ver opción</a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
