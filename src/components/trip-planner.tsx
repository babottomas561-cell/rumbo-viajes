"use client";

import {
  CalendarRange,
  Car,
  CloudRain,
  ExternalLink,
  Gauge,
  History,
  Hotel,
  MapPin,
  Plane,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sun,
  Users,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";

import yearlyRaw from "@/data/anio.json";
import destinationsRaw from "@/data/destinos.json";
import { StaySearch } from "@/components/stay-search";
import { LiveContext } from "@/components/live-context";

type Destination = {
  name: string;
  zone: string;
  ap: string;
  q: string;
  c: [number, number];
};

type FlightMonth = [number | null, number | null, number | null, number | null, string | null, number, string | null];
type HouseMonth = [number, number, number];
type ClimateMonth = [number, number, number, number];
type YearlyData = {
  fl: Record<string, Record<string, FlightMonth>>;
  hr: Record<string, Record<string, HouseMonth>>;
  cl: Record<string, Record<string, ClimateMonth>>;
  al: Array<{ texto: string }>;
  upd: string;
};

type Tab = "propuestas" | "anio" | "clima" | "auto" | "vivo";

const destinations = destinationsRaw as unknown as Record<string, Destination>;
const yearly = yearlyRaw as unknown as YearlyData;
const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function usd(value: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function qualityLabel(score: number) {
  if (score >= 82) return "Gran equilibrio";
  if (score >= 70) return "Muy buena opción";
  return "Conviene revisar";
}

function sourceUrl(destination: Destination, month: number, travelers: number) {
  const start = `2027-${String(month).padStart(2, "0")}-10`;
  const end = `2027-${String(month).padStart(2, "0")}-17`;
  return `https://www.airbnb.com/s/${destination.q}/homes?checkin=${start}&checkout=${end}&adults=${travelers}`;
}

export function TripPlanner() {
  const [tab, setTab] = useState<Tab>("propuestas");
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(1);
  const [travelers, setTravelers] = useState(4);
  const [nights, setNights] = useState(7);
  const [budget, setBudget] = useState(5000);
  const [zone, setZone] = useState("Todas");
  const [sort, setSort] = useState<"score" | "price" | "sun">("score");
  const [selectedKey, setSelectedKey] = useState("floripa");

  const proposals = useMemo(() => {
    const needle = normalize(query.trim());
    return Object.entries(destinations)
      .map(([key, destination]) => {
        const flight = yearly.fl[destination.ap]?.[String(month)];
        const house = yearly.hr[key]?.[String(month)];
        const climate = yearly.cl[key]?.[String(month)];
        if (!flight || !house || !climate) return null;
        const flightEach = flight[0] ?? flight[1] ?? 0;
        const weeklyHouse = house[1] * (nights / 7);
        const total = flightEach * travelers + weeklyHouse;
        const [maxTemp, rain, rainyDays, seaTemp] = climate;
        const priceFit = Math.max(0, 100 - (total / budget) * 55);
        const weatherFit = Math.max(0, 100 - rain / 4 - rainyDays * 1.3 + Math.max(0, seaTemp - 22) * 3);
        const score = Math.round(priceFit * 0.55 + weatherFit * 0.45);
        return { key, destination, flight, house, climate, total, flightEach, weeklyHouse, score, maxTemp, rain, rainyDays, seaTemp };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => zone === "Todas" || item.destination.zone === zone)
      .filter((item) => !needle || normalize(`${item.destination.name} ${item.destination.zone}`).includes(needle))
      .sort((a, b) => sort === "price" ? a.total - b.total : sort === "sun" ? a.rain - b.rain : b.score - a.score);
  }, [budget, month, nights, query, sort, travelers, zone]);

  const selected = destinations[selectedKey] ?? destinations.floripa;
  const selectedClimate = yearly.cl[selectedKey];
  const selectedHouse = yearly.hr[selectedKey];
  const selectedFlights = yearly.fl[selected.ap];
  const zones = ["Todas", ...Array.from(new Set(Object.values(destinations).map((item) => item.zone))).sort()];

  return (
    <section className="planner" id="planear">
      <div className="planner-heading">
        <div>
          <span className="eyebrow">TU MESA DE VIAJE</span>
          <h2>Compará el viaje completo.</h2>
        </div>
        <div className="freshness"><History size={17} /><span>Histórico actualizado {yearly.upd}</span></div>
      </div>

      <div className="planner-tabs" role="tablist" aria-label="Secciones del planeador">
        <button className={tab === "propuestas" ? "active" : ""} onClick={() => setTab("propuestas")} role="tab" aria-selected={tab === "propuestas"}><SlidersHorizontal />Propuestas</button>
        <button className={tab === "anio" ? "active" : ""} onClick={() => setTab("anio")} role="tab" aria-selected={tab === "anio"}><CalendarRange />Todo el año</button>
        <button className={tab === "clima" ? "active" : ""} onClick={() => setTab("clima")} role="tab" aria-selected={tab === "clima"}><Sun />Clima</button>
        <button className={tab === "auto" ? "active" : ""} onClick={() => setTab("auto")} role="tab" aria-selected={tab === "auto"}><Car />En auto</button>
        <button className={tab === "vivo" ? "active" : ""} onClick={() => setTab("vivo")} role="tab" aria-selected={tab === "vivo"}><Search />Buscar en vivo</button>
      </div>

      {tab === "propuestas" && (
        <div className="planner-panel">
          <div className="control-grid">
            <label><span>Destino</span><div className="control-input"><MapPin /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Brasil, Caribe, playa…" /></div></label>
            <label><span>Mes</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name} 2027</option>)}</select></label>
            <label><span>Viajeros</span><div className="control-input"><Users /><input type="number" min="1" max="16" value={travelers} onChange={(event) => setTravelers(Number(event.target.value))} /></div></label>
            <label><span>Noches</span><input type="number" min="2" max="30" value={nights} onChange={(event) => setNights(Number(event.target.value))} /></label>
            <label><span>Presupuesto total</span><div className="control-input"><WalletCards /><input type="number" min="500" step="250" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div></label>
            <label><span>Región</span><select value={zone} onChange={(event) => setZone(event.target.value)}>{zones.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label><span>Ordenar por</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="score">Mejor equilibrio</option><option value="price">Menor costo</option><option value="sun">Menos lluvia</option></select></label>
          </div>

          <div className="result-summary"><strong>{proposals.length} destinos comparables</strong><span>Vuelo + {nights} noches para {travelers} personas. Los importes son referencia histórica, no cotización.</span></div>
          <div className="proposal-grid">
            {proposals.slice(0, 12).map((item, index) => (
              <article className="proposal-card" key={item.key}>
                <div className="proposal-image" style={{ backgroundImage: `linear-gradient(180deg, transparent 35%, rgba(9,30,21,.78)), url(/casas/${item.key}.jpg)` }}>
                  <span className="rank">#{index + 1}</span><span className="score">{item.score}/100</span>
                  <div><p>{item.destination.zone}</p><h3>{item.destination.name}</h3></div>
                </div>
                <div className="proposal-body">
                  <div className="quality"><Gauge /><strong>{qualityLabel(item.score)}</strong><span>{item.maxTemp}° máxima · mar {item.seaTemp}°</span></div>
                  <div className="cost-lines">
                    <span><Plane />Vuelo por persona <strong>{usd(item.flightEach)}</strong></span>
                    <span><Hotel />Casa estimada <strong>{usd(item.weeklyHouse)}</strong></span>
                    <span><CloudRain />Lluvia mensual <strong>{item.rain} mm</strong></span>
                  </div>
                  <div className="proposal-total"><span>Total estimado</span><strong>{usd(item.total)}</strong></div>
                  <div className="card-actions">
                    <button onClick={() => { setSelectedKey(item.key); setTab("anio"); }}>Comparar meses</button>
                    <a href={sourceUrl(item.destination, month, travelers)} target="_blank" rel="noreferrer">Ver disponibilidad <ExternalLink /></a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {(tab === "anio" || tab === "clima") && (
        <div className="planner-panel year-panel">
          <div className="panel-toolbar">
            <div><span className="eyebrow">DESTINO</span><h3>{tab === "anio" ? "Cuándo conviene viajar" : "Clima mes por mes"}</h3></div>
            <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>{Object.entries(destinations).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([key, destination]) => <option value={key} key={key}>{destination.name}</option>)}</select>
          </div>
          <div className="year-grid">
            {monthNames.map((name, index) => {
              const key = String(index + 1);
              const climate = selectedClimate?.[key];
              const house = selectedHouse?.[key];
              const flight = selectedFlights?.[key];
              if (!climate) return null;
              const flightValue = flight?.[0] ?? flight?.[1] ?? 0;
              const total = flightValue * travelers + (house?.[1] ?? 0);
              return (
                <article key={name} className={index + 1 === month ? "selected" : ""}>
                  <div className="month-title"><strong>{name.slice(0, 3)}</strong><span>{climate[0]}°</span></div>
                  {tab === "anio" ? <><p><Plane />{flightValue ? usd(flightValue) : "Sin dato"}</p><p><Hotel />{house ? usd(house[1]) : "Sin dato"}</p><div className="month-total">{total ? usd(total) : "—"}<small>grupo + 7 noches</small></div></> : <><p><Sun />Máxima {climate[0]}°</p><p><CloudRain />{climate[1]} mm · {climate[2]} días</p><div className="sea-temp">Mar {climate[3]}°</div></>}
                </article>
              );
            })}
          </div>
          <div className="data-note">Clima: promedios históricos. Vuelos y casas: último relevamiento del proyecto. Antes de pagar, revalidá en la fuente.</div>
          {tab === "clima" && <LiveContext destination={selectedKey} month={month} />}
        </div>
      )}

      {tab === "auto" && <RoadTripCalculator />}
      {tab === "vivo" && <StaySearch embedded />}
    </section>
  );
}

function RoadTripCalculator() {
  const [distance, setDistance] = useState(1550);
  const [consumption, setConsumption] = useState(10);
  const [fuel, setFuel] = useState(1.2);
  const [tolls, setTolls] = useState(95);
  const [cars, setCars] = useState(1);
  const [people, setPeople] = useState(4);
  const [routeDestination, setRouteDestination] = useState("floripa");
  const [routeInfo, setRouteInfo] = useState<null | {
    route: { distanceKm: number; durationHours: number; directionsUrl: string; source: string };
    destination: { name: string };
    places: Array<{ id: string; name: string; category: string; mapUrl: string }>;
    tolls: { status: string; message?: string };
  }>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fuelReference, setFuelReference] = useState<null | {
    argentina: { price: number; currency: string; usdPerLiter: number; period: string; source: { url: string } };
    brazil: { price: number; currency: string; usdPerLiter: number; period: { start: string; end: string }; source: { url: string } };
    methodology: string;
  }>(null);
  const [fuelStatus, setFuelStatus] = useState<"idle" | "loading" | "error">("idle");
  const fuelCost = (distance * 2 / consumption) * fuel * cars;
  const total = fuelCost + tolls * 2 * cars;

  async function useOfficialFuelPrices() {
    setFuelStatus("loading");
    try {
      const response = await fetch("/api/travel/fuel");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo actualizar");
      setFuel(payload.recommendedUsdPerLiter);
      setFuelReference(payload);
      setFuelStatus("idle");
    } catch {
      setFuelStatus("error");
    }
  }

  async function calculateRoute() {
    setRouteStatus("loading");
    try {
      const response = await fetch(`/api/travel/route?destination=${encodeURIComponent(routeDestination)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo calcular");
      setDistance(payload.route.distanceKm);
      setRouteInfo(payload);
      setRouteStatus("idle");
    } catch {
      setRouteStatus("error");
    }
  }

  return (
    <div className="planner-panel road-panel">
      <div className="panel-toolbar"><div><span className="eyebrow">CALCULADORA DE RUTA</span><h3>¿Conviene ir en auto?</h3></div><span className="route-chip">Ida y vuelta</span></div>
      <div className="road-layout">
        <div className="road-controls">
          <label><span>Destino de ruta</span><select value={routeDestination} onChange={(event) => setRouteDestination(event.target.value)}>{Object.entries(destinations).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([key, destination]) => <option value={key} key={key}>{destination.name}</option>)}</select></label>
          <button className="official-fuel-button route-button" onClick={calculateRoute} disabled={routeStatus === "loading"}><MapPin />{routeStatus === "loading" ? "Calculando…" : "Calcular ruta real"}</button>
          <label><span>Distancia de ida (km)</span><input type="number" min="100" value={distance} onChange={(event) => setDistance(Number(event.target.value))} /></label>
          <label><span>Rendimiento (km/l)</span><input type="number" min="4" value={consumption} onChange={(event) => setConsumption(Number(event.target.value))} /></label>
          <label><span>Combustible USD/l</span><input type="number" min="0.1" step="0.05" value={fuel} onChange={(event) => setFuel(Number(event.target.value))} /></label>
          <label><span>Peajes por tramo</span><input type="number" min="0" value={tolls} onChange={(event) => setTolls(Number(event.target.value))} /></label>
          <label><span>Autos</span><input type="number" min="1" max="5" value={cars} onChange={(event) => setCars(Number(event.target.value))} /></label>
          <label><span>Personas</span><input type="number" min="1" max="25" value={people} onChange={(event) => setPeople(Number(event.target.value))} /></label>
          <button className="official-fuel-button" onClick={useOfficialFuelPrices} disabled={fuelStatus === "loading"}>
            <RefreshCw className={fuelStatus === "loading" ? "spin" : ""} />
            {fuelStatus === "loading" ? "Consultando…" : "Usar precios oficiales"}
          </button>
          {fuelStatus === "error" && <p className="fuel-error">No se pudieron actualizar los precios. Podés seguir usando el valor manual.</p>}
          {routeStatus === "error" && <p className="fuel-error">No se pudo calcular la ruta en este momento.</p>}
        </div>
        <div className="road-result"><Car /><span>Costo estimado del grupo</span><strong>{usd(total)}</strong><p>{usd(total / people)} por persona · {new Intl.NumberFormat("es-AR").format(distance * 2)} km totales</p><small>No incluye desgaste, estacionamiento, comidas ni alojamiento de ruta.</small></div>
      </div>
      {fuelReference && (
        <div className="fuel-reference">
          <div><strong>Argentina · {fuelReference.argentina.price.toLocaleString("es-AR")} {fuelReference.argentina.currency}/l</strong><span>Tucumán · {fuelReference.argentina.period} · USD {fuelReference.argentina.usdPerLiter}/l</span><a href={fuelReference.argentina.source.url} target="_blank" rel="noreferrer">Secretaría de Energía <ExternalLink /></a></div>
          <div><strong>Brasil · {fuelReference.brazil.price.toLocaleString("es-AR")} {fuelReference.brazil.currency}/l</strong><span>Santa Catarina · al {fuelReference.brazil.period.end} · USD {fuelReference.brazil.usdPerLiter}/l</span><a href={fuelReference.brazil.source.url} target="_blank" rel="noreferrer">ANP Brasil <ExternalLink /></a></div>
          <small>{fuelReference.methodology} El campo sigue siendo editable.</small>
        </div>
      )}
      {routeInfo && (
        <div className="route-reference">
          <div className="route-reference-head"><div><span>RUTA CALCULADA</span><strong>Tucumán → {routeInfo.destination.name}</strong></div><div><strong>{routeInfo.route.distanceKm.toLocaleString("es-AR")} km</strong><span>{routeInfo.route.durationHours} h estimadas</span></div><a href={routeInfo.route.directionsUrl} target="_blank" rel="noreferrer">Abrir navegación <ExternalLink /></a></div>
          <div className="nearby-places">
            {routeInfo.places.slice(0, 9).map((place) => <a href={place.mapUrl} target="_blank" rel="noreferrer" key={place.id}><span>{place.category === "parking" ? "Estacionamiento" : place.category === "food" ? "Comer" : "Actividad"}</span><strong>{place.name}</strong></a>)}
          </div>
          <small>Ruta: {routeInfo.route.source}. Lugares: OpenStreetMap. {routeInfo.tolls.message ?? "Proveedor de peajes preparado."}</small>
        </div>
      )}
    </div>
  );
}
