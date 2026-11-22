import { NextResponse } from "next/server";

import { getStaySearchJob } from "@/lib/providers/staying-api";
import { completeStaySearchJob } from "@/lib/supabase/search-history";

export const maxDuration = 30;

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  if (!/^job_[A-Za-z0-9_-]+$/.test(jobId)) {
    return NextResponse.json({ error: "Identificador de búsqueda inválido." }, { status: 400 });
  }

  try {
    const startedAt = Date.now();
    const result = await getStaySearchJob(jobId);
    await completeStaySearchJob(jobId, result, Date.now() - startedAt);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("stay-search-job-failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos completar la búsqueda." },
      { status: 502 },
    );
  }
}
