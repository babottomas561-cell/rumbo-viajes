import "server-only";

import type { StayOffer, StaySearchInput, StaySearchResponse } from "@/lib/search/schema";

type StayingApiProperty = {
  id?: string;
  platform?: string;
  platformListingId?: string;
  url?: string;
  name?: string;
  propertyType?: string;
  location?: { city?: string | null; region?: string | null; country?: string | null };
  guestRating?: number | null;
  reviewCount?: number | null;
  bedrooms?: number | null;
  images?: string[];
  price?: {
    currency?: string;
    nightlyPrice?: number;
    totalPrice?: number;
    priceBasis?: string;
    url?: string;
  } | null;
};

type StayingApiEnvelope = {
  data?: StayingApiProperty[] | {
    jobId?: string;
    status?: "pending" | "running" | "completed" | "failed";
    result?: StayingApiProperty[];
    error?: { message?: string };
  };
  error?: { message?: string };
};

const supportedProviders = new Set(["airbnb", "booking", "vrbo", "google"]);

function locationLabel(property: StayingApiProperty) {
  return [property.location?.city, property.location?.region, property.location?.country]
    .filter(Boolean)
    .join(", ");
}

function normalizeProperty(property: StayingApiProperty, fetchedAt: string): StayOffer | null {
  const provider = property.platform ?? "";
  if (!supportedProviders.has(provider) || !property.url || !property.name) return null;

  return {
    id: property.id ?? `${provider}:${property.platformListingId ?? property.url}`,
    provider: provider as StayOffer["provider"],
    name: property.name,
    propertyType: property.propertyType ?? "alojamiento",
    location: locationLabel(property),
    imageUrl: property.images?.[0] ?? null,
    rating: property.guestRating ?? null,
    reviewCount: property.reviewCount ?? null,
    bedrooms: property.bedrooms ?? null,
    totalPrice: property.price?.totalPrice ?? null,
    nightlyPrice: property.price?.nightlyPrice ?? null,
    currency: property.price?.currency ?? null,
    priceBasis: property.price?.priceBasis ?? null,
    bookingUrl: property.price?.url ?? property.url,
    fetchedAt,
  };
}

function normalizeOffers(properties: StayingApiProperty[] | undefined, fetchedAt: string) {
  return (properties ?? [])
    .map((property) => normalizeProperty(property, fetchedAt))
    .filter((offer): offer is StayOffer => offer !== null);
}

function getApiKey() {
  return process.env.STAYINGAPI_KEY?.trim();
}

export async function searchStays(input: StaySearchInput): Promise<StaySearchResponse> {
  const fetchedAt = new Date().toISOString();
  const apiKey = getApiKey();

  if (!apiKey) {
    return {
      mode: "not-configured",
      provider: "StayingAPI",
      fetchedAt,
      offers: [],
      warning: "El buscador está listo, pero falta STAYINGAPI_KEY. No mostramos precios inventados ni datos viejos como si fueran actuales.",
    };
  }

  const params = new URLSearchParams({
    location: input.destination,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: String(input.adults),
    rooms: String(input.rooms),
    currency: input.currency,
    platforms: "airbnb,booking,vrbo",
    limit: "12",
    sort: "price_asc",
  });

  const response = await fetch(`https://api.stayingapi.com/v1/search?${params}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const payload = (await response.json()) as StayingApiEnvelope;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? `StayingAPI respondió con estado ${response.status}`);
  }

  if (!Array.isArray(payload.data) && payload.data?.jobId) {
    return {
      mode: "pending",
      provider: "StayingAPI",
      fetchedAt,
      offers: [],
      jobId: payload.data.jobId,
      warning: "La búsqueda está consultando los proveedores. Puede tardar algunos minutos y se actualizará automáticamente.",
    };
  }

  const offers = normalizeOffers(Array.isArray(payload.data) ? payload.data : [], fetchedAt);

  const sandbox = apiKey.startsWith("stay_test_");

  return {
    mode: sandbox ? "sandbox" : "live",
    provider: "StayingAPI",
    fetchedAt,
    offers,
    warning: sandbox
      ? "Modo de prueba: estos resultados son fixtures de StayingAPI y no representan disponibilidad real. Para buscar inventario actual hace falta una clave stay_live_."
      : offers.length === 0
        ? "El proveedor no devolvió alojamientos para esta combinación."
        : undefined,
  };
}

export async function getStaySearchJob(jobId: string): Promise<StaySearchResponse> {
  const fetchedAt = new Date().toISOString();
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Falta STAYINGAPI_KEY");

  const response = await fetch(`https://api.stayingapi.com/v1/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json()) as StayingApiEnvelope;
  if (!response.ok) throw new Error(payload.error?.message ?? `StayingAPI respondió con estado ${response.status}`);
  if (Array.isArray(payload.data) || !payload.data) throw new Error("Respuesta de trabajo inválida");
  if (payload.data.status === "failed") throw new Error(payload.data.error?.message ?? "La búsqueda falló en el proveedor");
  if (payload.data.status !== "completed") {
    return { mode: "pending", provider: "StayingAPI", fetchedAt, offers: [], jobId, warning: "La búsqueda sigue en curso." };
  }
  return { mode: "live", provider: "StayingAPI", fetchedAt, offers: normalizeOffers(payload.data.result, fetchedAt) };
}
