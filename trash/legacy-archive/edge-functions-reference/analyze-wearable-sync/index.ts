// Edge function for generating wearable sync analysis output files
import { serve } from "../_shared/deps.ts";

import {
  bearerTokenGuard,
  corsGuard,
} from "../_shared/analyzeTrackingDocumentGuards.ts";

import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  createServiceRoleSupabaseClient,
  createUserSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";

import { getAllowedOriginsRaw } from "../_shared/runtimeConfig.ts";

const ANALYSES_PER_HOUR = 12;
const MAX_SYNC_ID_LENGTH = 64;
const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildHeuristicInsights(aggregates: Record<string, unknown>): string[] {
  const insights: string[] = [];
  const stepsAvg = safeNumber(aggregates.steps_avg);
  const sleepAvg = safeNumber(aggregates.sleep_hours_avg);
  const hrAvg = safeNumber(aggregates.heart_rate_avg);
  const activeMinutesTotal = safeNumber(aggregates.activity_minutes_total);
  const samples = safeNumber(aggregates.samples);

  if (samples === 0) {
    insights.push("No wearable samples were available for this sync batch.");
    return insights;
  }

  if (stepsAvg >= 8000) insights.push("Average daily step count indicates strong activity.");
  else if (stepsAvg >= 5000) insights.push("Average daily step count indicates moderate activity.");
  else insights.push("Average daily step count indicates low activity.");

  if (sleepAvg >= 7) insights.push("Average sleep duration is within recommended range.");
  else if (sleepAvg > 0) insights.push("Average sleep duration appears below recommended range.");

  if (hrAvg >= 0) {
    if (hrAvg > 100) insights.push("Average heart rate is elevated and should be reviewed in context.");
    else if (hrAvg >= 50 && hrAvg <= 90) insights.push("Average heart rate is within a typical resting range.");
  }

  if (activeMinutesTotal > 0) {
    insights.push("Active minutes were captured in this sync batch.");
  }

  return insights;
}

serve(async (req) => {
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });

  if (originFailure) {
    return silentCorsDenyResponse();
  }

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });
  if (!supabaseEnv.ok) return jsonResponse(req, { error: supabaseEnv.error }, supabaseEnv.status);
  const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = supabaseEnv;

  const tokenResult = bearerTokenGuard({
    authorizationHeader: req.headers.get("Authorization"),
  });
  if ("status" in tokenResult) {
    return jsonResponse(req, { error: tokenResult.error }, tokenResult.status);
  }
  const token = tokenResult.token;

  interface AnalyzeRequestBody {
    syncBatchId?: string;
  }

  let parsedBody: AnalyzeRequestBody;
  try {
    parsedBody = await req.json() as AnalyzeRequestBody;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const syncBatchId = parsedBody.syncBatchId;
  if (typeof syncBatchId !== "string" || syncBatchId.length === 0 || syncBatchId.length > MAX_SYNC_ID_LENGTH) {
    return jsonResponse(req, { error: "syncBatchId is required" }, 400);
  }

  const supabaseUser = createUserSupabaseClient({ supabaseUrl, supabaseAnonKey, token });
  const supabaseAdmin = createServiceRoleSupabaseClient({
    supabaseUrl,
    supabaseServiceKey: supabaseServiceKey!,
  });

  const { data: userData, error: userError } = await supabaseUser.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse(req, { error: "Invalid token" }, 401);
  }
  const user = userData.user;

  const { error: rateError } = await supabaseUser.rpc("enforce_rate_limit", {
    p_endpoint_key: "wearable_sync_analysis",
    p_max_requests: ANALYSES_PER_HOUR,
    p_window_ms: 60 * 60 * 1000,
  });

  if (rateError) {
    return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
  }

  const { data: payload, error: payloadError } = await supabaseUser.rpc(
    "get_wearable_sync_payload_for_analysis_audited",
    { p_sync_batch_id: syncBatchId },
  );

  if (payloadError || !payload) {
    return jsonResponse(req, { error: "Not found" }, 404);
  }

  const payloadObj = (payload as Record<string, unknown>) ?? {};
  const sync = ((payloadObj.sync as Record<string, unknown>) ?? {});
  const aggregates = ((payloadObj.aggregates as Record<string, unknown>) ?? {});
  const insights = buildHeuristicInsights(aggregates);

  const generatedAt = new Date().toISOString();
  const fileName = `wearable-analysis-${syncBatchId}-${generatedAt.slice(0, 10)}.json`;
  const filePath = `${user.id}/${syncBatchId}/${fileName}`;
  const fileBucket = "wearable-analysis";

  const analysisPayload = {
    version: "1.0",
    generated_at: generatedAt,
    sync_batch_id: syncBatchId,
    data_source: typeof sync.data_source === "string" ? sync.data_source : "wearable",
    summary: {
      sample_count: safeNumber(aggregates.samples),
      steps_total: safeNumber(aggregates.steps_total),
      steps_avg: safeNumber(aggregates.steps_avg),
      sleep_hours_avg: safeNumber(aggregates.sleep_hours_avg),
      heart_rate_avg: safeNumber(aggregates.heart_rate_avg),
      heart_rate_max: safeNumber(aggregates.heart_rate_max),
      activity_minutes_total: safeNumber(aggregates.activity_minutes_total),
      distance_meters_total: safeNumber(aggregates.distance_meters_total),
    },
    heuristics: insights,
  };

  const uploadBody = new Blob(
    [JSON.stringify(analysisPayload, null, 2)],
    { type: "application/json" },
  );
  const { error: uploadError } = await supabaseAdmin.storage
    .from(fileBucket)
    .upload(filePath, uploadBody, {
      upsert: true,
      contentType: "application/json",
    });

  if (uploadError) {
    return jsonResponse(req, { error: "Failed to write analysis file" }, 500);
  }

  const { data: refData, error: refError } = await supabaseAdmin.rpc(
    "create_wearable_analysis_file_reference",
    {
      p_analysis_kind: "sync_summary",
      p_data_source: typeof sync.data_source === "string" ? sync.data_source : "wearable",
      p_file_bucket: fileBucket,
      p_file_name: fileName,
      p_file_path: filePath,
      p_metadata: {
        format: "json",
        generated_at: generatedAt,
        heuristics_count: insights.length,
      },
      p_user_id: user.id,
    
      p_sync_batch_id: syncBatchId,},
  );

  if (refError || !refData) {
    return jsonResponse(req, { error: "Failed to create analysis reference" }, 500);
  }

  return jsonResponse(req, {
    success: true,
    syncBatchId: syncBatchId,
    file: {
      bucket: fileBucket,
      path: filePath,
      name: fileName,
    },
    insightsCount: insights.length,
  });
});
