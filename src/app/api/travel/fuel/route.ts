import fuelRaw from "@/data/fuel-prices.json";

type Rate = { date: string; base: string; quote: string; rate: number };

const fuel = fuelRaw as unknown as {
  generatedAt: string;
  argentina: {
    period: string;
    latestEffectiveDate: string;
    provinces: Record<string, { super?: { median: number; average: number } }>;
    source: { name: string; url: string };
  };
  brazil: {
    period: { start: string; end: string };
    states: Record<string, { regular?: { average: number } }>;
    national: { regular?: { average: number } };
    source: { name: string; url: string };
  };
};

export async function GET() {
  const ratesResponse = await fetch("https://api.frankfurter.dev/v2/rates?base=USD&quotes=BRL,ARS", {
    next: { revalidate: 21_600 },
  });
  if (!ratesResponse.ok) {
    return Response.json({ error: "No se pudo convertir los precios oficiales a USD." }, { status: 502 });
  }
  const rates = await ratesResponse.json() as Rate[];
  const arsRate = rates.find((rate) => rate.quote === "ARS")?.rate;
  const brlRate = rates.find((rate) => rate.quote === "BRL")?.rate;
  const argentinaPrice = fuel.argentina.provinces.Tucuman?.super?.median;
  const brazilPrice = fuel.brazil.states["SANTA CATARINA"]?.regular?.average ?? fuel.brazil.national.regular?.average;
  if (!arsRate || !brlRate || !argentinaPrice || !brazilPrice) {
    return Response.json({ error: "Faltan datos para calcular el combustible." }, { status: 502 });
  }

  const argentinaUsd = argentinaPrice / arsRate;
  const brazilUsd = brazilPrice / brlRate;
  return Response.json({
    recommendedUsdPerLiter: Math.round(((argentinaUsd + brazilUsd) / 2) * 100) / 100,
    methodology: "Promedio 50/50 del trayecto entre Tucumán y Santa Catarina.",
    argentina: {
      product: "Nafta súper",
      location: "Tucumán",
      price: argentinaPrice,
      currency: "ARS",
      usdPerLiter: Math.round(argentinaUsd * 100) / 100,
      period: fuel.argentina.period,
      source: fuel.argentina.source,
    },
    brazil: {
      product: "Gasolina comum",
      location: "Santa Catarina",
      price: brazilPrice,
      currency: "BRL",
      usdPerLiter: Math.round(brazilUsd * 100) / 100,
      period: fuel.brazil.period,
      source: fuel.brazil.source,
    },
    exchangeRates: { ARS: arsRate, BRL: brlRate, date: rates[0]?.date },
    snapshotGeneratedAt: fuel.generatedAt,
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
