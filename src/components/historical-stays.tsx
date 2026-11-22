"use client";

import { BedDouble, ExternalLink, MapPin, Star, Users } from "lucide-react";
import { useMemo, useState } from "react";

import destinationsRaw from "@/data/destinos.json";
import staysRaw from "@/data/historical-stays.json";

type House = {
  id: string; name: string; rating: number; rev: number; gf: boolean; dorm: number; baths: number;
  beds: number; sea: number | null; bnm: string | null; cap: number | null; base: number;
  tags: string[]; pics: string[];
};
type Destination = { name: string; q: string };
type StayData = Record<string, { poolCount: number; houses: House[] }>;

const stays = staysRaw as unknown as StayData;
const destinations = destinationsRaw as unknown as Record<string, Destination>;
const availableKeys = Object.keys(stays).filter((key) => destinations[key]);

function usd(value: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function distanceLabel(meters: number | null) {
  if (meters === null) return "Distancia sin dato";
  if (meters < 100) return "Frente al mar";
  if (meters < 1000) return `A ${Math.round(meters / 10) * 10} m del mar`;
  return `A ${(meters / 1000).toFixed(1).replace(".", ",")} km del mar`;
}

export function HistoricalStays() {
  const [destinationKey, setDestinationKey] = useState(availableKeys.includes("floripa") ? "floripa" : availableKeys[0]);
  const [guests, setGuests] = useState(6);
  const [bedrooms, setBedrooms] = useState(2);
  const [maxPrice, setMaxPrice] = useState(4000);
  const [maxSea, setMaxSea] = useState(5000);
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [sort, setSort] = useState<"price" | "rating" | "sea">("price");
  const [level, setLevel] = useState("all");

  const results = useMemo(() => {
    return [...(stays[destinationKey]?.houses ?? [])]
      .filter((house) => (house.cap ?? house.beds * 2) >= guests)
      .filter((house) => house.dorm >= bedrooms)
      .filter((house) => house.base <= maxPrice)
      .filter((house) => house.sea === null || house.sea <= maxSea)
      .filter((house) => !favoriteOnly || house.gf)
      .filter((house) => level === "all" || house.tags.some((tag) => tag.toLowerCase().includes(level)))
      .sort((a, b) => sort === "rating" ? b.rating - a.rating || b.rev - a.rev : sort === "sea" ? (a.sea ?? 99999) - (b.sea ?? 99999) : a.base - b.base);
  }, [bedrooms, destinationKey, favoriteOnly, guests, level, maxPrice, maxSea, sort]);

  const destination = destinations[destinationKey];
  const checkIn = "2027-01-06";
  const checkOut = "2027-01-14";

  return (
    <div className="planner-panel stays-panel">
      <div className="panel-toolbar">
        <div><span className="eyebrow">LAS TARJETAS DEL RELEVAMIENTO</span><h3>Casas con fotos y detalle real</h3></div>
        <span className="route-chip">Relevado 21 nov 2026</span>
      </div>
      <div className="stay-filters">
        <label><span>Destino</span><select value={destinationKey} onChange={(event) => setDestinationKey(event.target.value)}>{availableKeys.map((key) => <option value={key} key={key}>{destinations[key].name}</option>)}</select></label>
        <label><span>Personas</span><select value={guests} onChange={(event) => setGuests(Number(event.target.value))}>{[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Dormitorios mín.</span><select value={bedrooms} onChange={(event) => setBedrooms(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Nivel</span><select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">Todos</option><option value="barata">La más barata</option><option value="económica">Económica</option><option value="recomendada">Recomendada</option><option value="premium">Premium</option></select></label>
        <label><span>Hasta USD</span><select value={maxPrice} onChange={(event) => setMaxPrice(Number(event.target.value))}>{[1000, 1500, 2000, 3000, 4000, 6000, 10000].map((value) => <option key={value} value={value}>{value.toLocaleString("es-AR")}</option>)}</select></label>
        <label><span>Distancia al mar</span><select value={maxSea} onChange={(event) => setMaxSea(Number(event.target.value))}><option value="200">Hasta 200 m</option><option value="500">Hasta 500 m</option><option value="1000">Hasta 1 km</option><option value="2000">Hasta 2 km</option><option value="5000">Cualquiera</option></select></label>
        <label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="price">Menor precio</option><option value="rating">Mejor puntaje</option><option value="sea">Más cerca del mar</option></select></label>
        <label className="check-filter"><input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} /><span>Favorito huéspedes</span></label>
      </div>

      <div className="result-summary"><strong>{results.length} alojamientos</strong><span>El precio es el total histórico de 8 noches; validá fechas y disponibilidad antes de reservar.</span></div>
      {results.length === 0 && <div className="status-box">No hay casas que cumplan todos estos filtros. Probá subir el precio o la distancia al mar.</div>}
      <div className="historical-stay-grid">
        {results.slice(0, 18).map((house) => (
          <article className="historical-stay-card" key={house.id}>
            <div className="historical-photo">
              {house.pics[0] ? <div className="historical-photo-image" role="img" aria-label={house.name} style={{ backgroundImage: `url(${house.pics[0]})` }} /> : <div className="photo-fallback"><BedDouble /></div>}
              <span className="photo-count">{house.pics.length} fotos</span>
              {house.gf && <span className="guest-favorite">Favorito huéspedes</span>}
            </div>
            <div className="historical-copy">
              <div className="historical-tags">{house.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div>
              <h4>{house.name}</h4>
              <p className="stay-location"><MapPin /> {house.bnm ?? destination.name} · {distanceLabel(house.sea)}</p>
              <div className="house-facts"><span><Star fill="currentColor" />{house.rating} ({house.rev})</span><span><BedDouble />{house.dorm} dorm. · {house.baths} baños</span><span><Users />Hasta {house.cap ?? house.beds * 2}</span></div>
              <div className="historical-price"><div><strong>{usd(house.base)}</strong><span>8 noches · {usd(house.base / guests)} por persona</span></div><a href={`https://www.airbnb.com.ar/rooms/${house.id}?check_in=${checkIn}&check_out=${checkOut}&adults=${guests}`} target="_blank" rel="noreferrer">Ver y validar <ExternalLink /></a></div>
            </div>
          </article>
        ))}
      </div>
      <a className="more-stays-link" href={`https://www.airbnb.com.ar/s/${destination.q}/homes?checkin=${checkIn}&checkout=${checkOut}&adults=${guests}`} target="_blank" rel="noreferrer">Buscar más casas para estas fechas <ExternalLink /></a>
    </div>
  );
}
