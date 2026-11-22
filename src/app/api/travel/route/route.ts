import destinationsRaw from "@/data/destinos.json";

type Destination = { name: string; c: [number, number] };
type OsrmResponse = { routes?: Array<{ distance: number; duration: number }> };
type OverpassElement = { id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

const destinations = destinationsRaw as unknown as Record<string, Destination>;
const origin = { name: "San Miguel de Tucumán", latitude: -26.8083, longitude: -65.2176 };

function placeCategory(tags: Record<string, string>) {
  if (tags.amenity === "parking") return "parking";
  if (["restaurant", "cafe", "fast_food", "bar"].includes(tags.amenity)) return "food";
  return "attraction";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("destination") ?? "";
  const destination = destinations[key];
  if (!destination) return Response.json({ error: "Destino inválido." }, { status: 400 });
  const [latitude, longitude] = destination.c;
  const routeUrl = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${longitude},${latitude}?overview=false&alternatives=false&steps=false`;
  const overpassQuery = `[out:json][timeout:20];(nwr(around:5000,${latitude},${longitude})[amenity~"^(parking|restaurant|cafe|fast_food|bar)$"];nwr(around:5000,${latitude},${longitude})[tourism~"^(attraction|museum|viewpoint)$"];);out center 30;`;

  const [routeResponse, placesResponse] = await Promise.all([
    fetch(routeUrl, { headers: { "User-Agent": "RumboViajes/1.0" }, signal: AbortSignal.timeout(12_000), next: { revalidate: 86_400 } }),
    fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "RumboViajes/1.0" },
      body: new URLSearchParams({ data: overpassQuery }),
      signal: AbortSignal.timeout(7_000),
      next: { revalidate: 86_400 },
    }).catch(() => null),
  ]);
  if (!routeResponse.ok) return Response.json({ error: "El servicio de rutas no respondió." }, { status: 502 });
  const routePayload = await routeResponse.json() as OsrmResponse;
  const route = routePayload.routes?.[0];
  if (!route) return Response.json({ error: "No se encontró una ruta terrestre." }, { status: 404 });

  let places: Array<{ id: string; name: string; category: string; latitude: number; longitude: number; mapUrl: string }> = [];
  if (placesResponse?.ok) {
    const payload = await placesResponse.json() as { elements?: OverpassElement[] };
    places = (payload.elements ?? []).flatMap((element) => {
      const point = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : null);
      const name = element.tags?.name;
      if (!point || !name) return [];
      return [{
        id: String(element.id), name, category: placeCategory(element.tags ?? {}),
        latitude: point.lat, longitude: point.lon,
        mapUrl: `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=17/${point.lat}/${point.lon}`,
      }];
    }).slice(0, 18);
  }

  return Response.json({
    origin,
    destination: { key, name: destination.name, latitude, longitude },
    route: {
      distanceKm: Math.round(route.distance / 1000),
      durationHours: Math.round((route.duration / 3600) * 10) / 10,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&origin=${origin.latitude},${origin.longitude}&destination=${latitude},${longitude}&travelmode=driving`,
      source: "OSRM / OpenStreetMap",
    },
    places,
    placesSource: "OpenStreetMap / Overpass",
    tolls: process.env.HERE_API_KEY ? { status: "provider-ready" } : { status: "not-configured", message: "Falta HERE_API_KEY para calcular peajes reales." },
    fetchedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
}
