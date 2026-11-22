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

await writeFile(new URL("../src/data/destination-experience.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Exportados ${Object.keys(output).length} destinos`);
