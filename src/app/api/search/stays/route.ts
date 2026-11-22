import { ZodError } from "zod";

import { searchStays } from "@/lib/providers/staying-api";
import { staySearchSchema } from "@/lib/search/schema";
import { recordStaySearch } from "@/lib/supabase/search-history";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const startedAt = Date.now();
    const input = staySearchSchema.parse(await request.json());
    const result = await searchStays(input);
    await recordStaySearch(input, result, Date.now() - startedAt);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Revisá los datos de la búsqueda.",
          issues: error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
        },
        { status: 400 },
      );
    }

    console.error("stay-search-failed", error);
    return Response.json(
      { error: "El proveedor de alojamientos no respondió. No reemplazamos el resultado con precios estimados." },
      { status: 502 },
    );
  }
}
