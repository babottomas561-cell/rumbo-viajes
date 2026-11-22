import destinationsRaw from "@/data/destinos.json";

type Destination = { name: string; zone: string; c: [number, number] };
type ClimateResponse = { daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[]; wind_speed_10m_mean?: number[] } };
type Rate = { date: string; base: string; quote: string; rate: number };
type Holiday = { date: string; name: string; countryCode: string; nationalHoliday: boolean };

const destinations = destinationsRaw as unknown as Record<string, Destination>;

function countryCode(key: string, zone: string) {
  if (["Sudeste", "Sur", "Nordeste", "Bahía"].includes(zone)) return "BR";
  if (zone === "Costa argentina") return "AR";
  if (zone === "Uruguay") return "UY";
  if (zone === "Chile") return "CL";
  if (zone === "Perú") return "PE";
  const special: Record<string, string> = { curazao: "CW", puntacana: "DO", sanandres: "CO", cartagena: "CO", santamarta: "CO", bocas: "PA", eltunco: "SV", tamarindo: "CR", sanjuandelsur: "NI", playadelcarmen: "MX", puertoescondido: "MX", sayulita: "MX", montanita: "EC" };
  return special[key] ?? "BR";
}

function average(values: number[] | undefined) {
  const valid = (values ?? []).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function sum(values: number[] | undefined) {
  return (values ?? []).filter(Number.isFinite).reduce((total, value) => total + value, 0);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("destination") ?? "";
  const month = Number(url.searchParams.get("month"));
  const destination = destinations[key];
  if (!destination || !Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: "Destino o mes inválido." }, { status: 400 });
  }

  const year = 2027;
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
  const [latitude, longitude] = destination.c;
  const country = countryCode(key, destination.zone);
  const climateUrl = new URL("https://climate-api.open-meteo.com/v1/climate");
  climateUrl.search = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), start_date: start, end_date: end,
    models: "EC_Earth3P_HR", daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_mean",
  }).toString();

  const [climateResponse, ratesResponse, holidaysResponse] = await Promise.all([
    fetch(climateUrl, { next: { revalidate: 86_400 } }),
    fetch("https://api.frankfurter.dev/v2/rates?base=USD&quotes=BRL,ARS", { next: { revalidate: 21_600 } }),
    fetch(`https://nagerholidays.com/api/v4/Holidays/${country}/${year}`, { next: { revalidate: 604_800 } }),
  ]);
  if (!climateResponse.ok || !ratesResponse.ok) return Response.json({ error: "Una fuente externa no respondió." }, { status: 502 });

  const climate = await climateResponse.json() as ClimateResponse;
  const rates = await ratesResponse.json() as Rate[];
  const holidays = holidaysResponse.ok ? await holidaysResponse.json() as Holiday[] : [];
  const monthHolidays = holidays.filter((holiday) => holiday.date >= start && holiday.date <= end);

  return Response.json({
    destination: destination.name,
    period: { start, end },
    climate: {
      averageMax: average(climate.daily?.temperature_2m_max),
      averageMin: average(climate.daily?.temperature_2m_min),
      precipitation: sum(climate.daily?.precipitation_sum),
      averageWind: average(climate.daily?.wind_speed_10m_mean),
      kind: "climate-projection",
      source: "Open-Meteo / EC_Earth3P_HR",
    },
    rates: rates.map((rate) => ({ currency: rate.quote, rate: rate.rate, date: rate.date })),
    holidays: monthHolidays,
    fetchedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
}
