import { CloudSun, Compass, History, Plane, Waves } from "lucide-react";

import { TripPlanner } from "@/components/trip-planner";

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Rumbo, inicio"><span>R</span> Rumbo</a>
        <nav aria-label="Navegación principal">
          <a href="#planear">Planear</a><a href="#como-funciona">Fuentes</a><span className="build-badge">Datos + búsqueda en vivo</span>
        </nav>
      </header>
      <section className="hero" id="top">
        <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
        <div className="hero-content">
          <span className="eyebrow">BUSCADOR + PLANEADOR DE VIAJES</span>
          <h1>Encontrá el viaje que <em>sí cierra.</em></h1>
          <p>Elegí fechas, compará el costo completo y abrí fuentes reales. Histórico para orientarte; búsqueda en vivo para decidir.</p>
          <a className="hero-link" href="#planear">Abrir el planeador</a>
        </div>
        <div className="hero-stamp"><Waves size={28} /><span>Brasil y el mundo<br />cualquier fecha</span></div>
      </section>
      <TripPlanner />
      <section className="feature-section" id="como-funciona">
        <div className="section-intro">
          <span className="eyebrow">EL PLAN</span><h2>Una búsqueda, varias fuentes, cero humo.</h2>
          <p>El sistema conserva el histórico que ya reunimos y consulta proveedores actuales cuando elegís fechas concretas.</p>
        </div>
        <div className="feature-grid">
          <article><Plane /><strong>Vuelos</strong><p>Duffel y Amadeus detrás de un contrato intercambiable.</p></article>
          <article><Compass /><strong>Estadías</strong><p>Airbnb, Booking y Vrbo normalizados por proveedor.</p></article>
          <article><CloudSun /><strong>Clima</strong><p>Pronóstico para fechas cercanas y climatología para fechas lejanas.</p></article>
          <article><History /><strong>Histórico</strong><p>Precios comparables y alertas basadas en mediciones reales.</p></article>
        </div>
      </section>
      <footer><div className="brand"><span>R</span> Rumbo</div><p>Prototipo verificable. Ningún precio se considera final hasta revalidarlo.</p></footer>
    </main>
  );
}
