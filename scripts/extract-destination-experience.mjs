import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../brasil-verano-2027.html", import.meta.url), "utf8");
const start = source.indexOf("const D = [");
const end = source.indexOf("\nconst C = [", start);

if (start < 0 || end < 0) throw new Error("No se encontró el bloque D del artefacto original");

const literal = source.slice(start + "const D = ".length, end).trim().replace(/;$/, "");
const rows = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1_000 });
const output = Object.fromEntries(rows.map((row) => [row.k, {
  beach: row.s?.[0] ?? null,
  nightlife: row.s?.[1] ?? null,
  young: row.s?.[2] ?? null,
  vibe: row.vibe ?? "",
  how: row.how ?? "",
  warning: row.flag ?? null,
}]));

const stayOptions = Object.fromEntries(rows.map((row) => [row.k, (row.st ?? []).map((stay, index) => ({
  price: stay[0], rating: stay[1], reviews: stay[2], guestFavorite: Boolean(stay[3]), bedrooms: stay[4],
  bathrooms: stay[5], beds: stay[6], name: stay[7], id: String(stay[8]),
  level: ["Económica", "Recomendada", "Premium"][index] ?? "Opción",
}))]));

const flightStart = source.indexOf("const FL=");
const flightEnd = source.indexOf(";\nconst CITY=", flightStart);
if (flightStart < 0 || flightEnd < 0) throw new Error("No se encontró el bloque FL del artefacto original");
const flights = vm.runInNewContext(`(${source.slice(flightStart + "const FL=".length, flightEnd)})`, Object.create(null), { timeout: 1_000 });
const cheapest = (origin, airport) => {
  const values = Object.entries(flights[origin]?.[airport] ?? {}).map(([day, value]) => ({ day: Number(day), price: value[0] }));
  return values.sort((a, b) => a.price - b.price)[0] ?? null;
};
const airportRoutes = Object.fromEntries([...new Set(rows.map((row) => row.ap))].map((airport) => [airport, [
  { label: "Desde Tucumán", origin: "TUC", extra: 0 },
  { label: "Vía Buenos Aires", origin: "BUE", extra: 283 },
  { label: "Vía Córdoba", origin: "COR", extra: 100 },
  { label: "Vía Foz en micro", origin: "IGU", extra: 210 },
].map((route) => {
  const found = cheapest(route.origin, airport);
  return found ? { ...route, price: found.price + route.extra, flightPrice: found.price, day: found.day } : null;
}).filter(Boolean)]));

await writeFile(new URL("../src/data/destination-experience.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
await writeFile(new URL("../src/data/proposal-stays.json", import.meta.url), `${JSON.stringify(stayOptions, null, 2)}\n`);
await writeFile(new URL("../src/data/january-flight-options.json", import.meta.url), `${JSON.stringify(airportRoutes, null, 2)}\n`);
console.log(`Exportados ${Object.keys(output).length} destinos`);
