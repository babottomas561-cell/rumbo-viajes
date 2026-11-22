import "server-only";

import { createHash } from "node:crypto";

import type { StaySearchInput, StaySearchResponse } from "@/lib/search/schema";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function requestHash(input: StaySearchInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function saveOffers(searchRequestId: string, result: StaySearchResponse) {
  if (!result.offers.length) return;
  const admin = getSupabaseAdmin();
  if (!admin) return;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error } = await admin.from("stay_offers").upsert(result.offers.map((offer) => ({
    search_request_id: searchRequestId,
    provider: "stayingapi",
    platform: offer.provider,
    platform_listing_id: offer.id,
    name: offer.name,
    destination_label: offer.location,
    currency: offer.currency,
    nightly_price: offer.nightlyPrice,
    total_price: offer.totalPrice,
    price_basis: offer.priceBasis,
    booking_url: offer.bookingUrl,
    payload: { propertyType: offer.propertyType, rating: offer.rating, reviewCount: offer.reviewCount, bedrooms: offer.bedrooms, imageUrl: offer.imageUrl },
    fetched_at: offer.fetchedAt,
    expires_at: expiresAt,
  })), { onConflict: "search_request_id,platform,platform_listing_id" });
  if (error) throw error;
}

export async function recordStaySearch(input: StaySearchInput, result: StaySearchResponse, durationMs: number) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const status = result.mode === "pending" ? "running" : "complete";
    const { data, error } = await admin.from("search_requests").insert({
      kind: "stay",
      request_hash: requestHash(input),
      criteria: { ...input, providerJobId: result.jobId ?? null },
      status,
      started_at: new Date(Date.now() - durationMs).toISOString(),
      completed_at: status === "complete" ? new Date().toISOString() : null,
    }).select("id").single();
    if (error) throw error;
    await admin.from("provider_calls").insert({
      search_request_id: data.id,
      provider: "stayingapi",
      operation: "search",
      http_status: 200,
      duration_ms: durationMs,
      result_count: result.offers.length,
      response_meta: { mode: result.mode, jobId: result.jobId ?? null },
    });
    await saveOffers(data.id, result);
  } catch (error) {
    console.error("supabase-search-history-failed", error);
  }
}

export async function completeStaySearchJob(jobId: string, result: StaySearchResponse, durationMs: number) {
  const admin = getSupabaseAdmin();
  if (!admin || result.mode === "pending") return;
  try {
    const { data, error } = await admin.from("search_requests")
      .select("id")
      .eq("criteria->>providerJobId", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;
    await admin.from("search_requests").update({ status: "complete", completed_at: new Date().toISOString() }).eq("id", data.id);
    await admin.from("provider_calls").insert({
      search_request_id: data.id,
      provider: "stayingapi",
      operation: "job-result",
      http_status: 200,
      duration_ms: durationMs,
      result_count: result.offers.length,
      response_meta: { jobId },
    });
    await saveOffers(data.id, result);
  } catch (error) {
    console.error("supabase-job-history-failed", error);
  }
}
