// Edge function for AI-powered health document analysis
import { serve } from "../_shared/deps.ts";

import {
  bearerTokenGuard,
  consentGuard,
  corsGuard,
  ownerOnlyNoLeakGuard,
} from "../_shared/analyzeTrackingDocumentGuards.ts";

import { preflightResponse, silentCorsDenyResponse } from "../_shared/cors.ts";
import { jsonResponse as jsonResponseBase } from "../_shared/http.ts";
import {
  createServiceRoleSupabaseClient,
  createUserSupabaseClient,
  requireSupabaseEnv,
} from "../_shared/supabase.ts";

import {
  getAllowedOriginsRaw,
  getAnalyzeTrackingDocumentModel,
  getOpenAiApiUrl,
} from "../_shared/runtimeConfig.ts";

import { getOpenAiApiKey } from "../_shared/openaiKey.ts";

const ANALYSES_PER_HOUR = 5;
const MAX_ANALYSIS_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_AI_INPUT_CHARS = 4000;

const allowedOriginsRaw = getAllowedOriginsRaw();

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponseBase(req, allowedOriginsRaw, body, status);
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get("Authorization") ?? "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
}

function clampText(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function redactText(input: string): string {
  // Best-effort redaction. Preserve medical values and dates; redact only direct identifiers.
  return input
    // Emails
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL-REDACTED]")
    // Phone numbers (very rough)
    .replace(/\b(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?)?\d{3}[ .-]?\d{3,4}\b/g, "[PHONE-REDACTED]")
    // SSN-like
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[ID-REDACTED]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCustomRedactions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const normalized = input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 120);

  const deduplicated = Array.from(new Set(normalized.map((value) => value.toLowerCase())));
  return deduplicated.slice(0, 50);
}

function applyCustomRedactions(input: string, customTerms: string[]): string {
  if (customTerms.length === 0) return input;

  let result = input;
  for (const term of customTerms) {
    const pattern = new RegExp(escapeRegExp(term), "gi");
    result = result.replace(pattern, "[CUSTOM-REDACTED]");
  }

  return result;
}

function redactWithCustomTerms(input: string, customTerms: string[]): string {
  return applyCustomRedactions(redactText(input), customTerms);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  const originFailure = corsGuard({
    origin: req.headers.get("Origin"),
    allowedOriginsRaw,
  });

  if (originFailure) {
    // Silent deny for disallowed Origin (do not help attackers iterate).
    return silentCorsDenyResponse();
  }

  if (req.method === "OPTIONS") {
    return preflightResponse(req, allowedOriginsRaw);
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseEnv = requireSupabaseEnv({ requireServiceRole: true });

    if (!supabaseEnv.ok) return jsonResponse(req, { error: supabaseEnv.error }, supabaseEnv.status);
    const { supabaseUrl, supabaseAnonKey, supabaseServiceKey } = supabaseEnv;

    const openaiApiKey = (await getOpenAiApiKey(createServiceRoleSupabaseClient({
      supabaseUrl,
      supabaseServiceKey: supabaseServiceKey!,
    }))) ?? Deno.env.get("OPENAI_API_KEY");

    if (!openaiApiKey) {
      return jsonResponse(req, { error: "AI service not configured" }, 500);
    }

    interface AnalyzeRequestBody {
      documentId?: string;
      customRedactions?: string[];
    }

    let parsedBody: AnalyzeRequestBody;
    try {
      parsedBody = await req.json() as AnalyzeRequestBody;
    } catch {
      return jsonResponse(req, { error: "Invalid JSON body" }, 400);
    }

    const documentId = parsedBody.documentId;
    const customRedactions = parseCustomRedactions(parsedBody.customRedactions);
    if (typeof documentId !== "string" || documentId.length === 0) {
      return jsonResponse(req, { error: "documentId is required" }, 400);
    }

    const tokenResult = bearerTokenGuard({
      authorizationHeader: req.headers.get("Authorization"),
    });

    if ("status" in tokenResult) {
      return jsonResponse(req, { error: tokenResult.error }, tokenResult.status);
    }

    const token = tokenResult.token;

    // User-scoped client for auth + RLS-enforced DB access.
    const supabaseUser = createUserSupabaseClient({ supabaseUrl, supabaseAnonKey, token });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser(token);

    if (userError || !userData?.user) {
      return jsonResponse(req, { error: "Invalid token" }, 401);
    }

    const user = userData.user;

    // Service role client used only for rate limit counting.
    const supabaseAdmin = createServiceRoleSupabaseClient({
      supabaseUrl,
      supabaseServiceKey: supabaseServiceKey!,
    });

    const { error: rateError } = await supabaseUser.rpc("enforce_rate_limit", {
      p_endpoint_key: "health_document_analysis",
      p_max_requests: ANALYSES_PER_HOUR,
      p_window_ms: 60 * 60 * 1000
    });

    if (rateError) {
      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "documents",
        p_details: {
          result: "rate_limited",
          max_per_hour: ANALYSES_PER_HOUR,
          error: rateError.message,
        },
        p_entity_id: documentId,
        p_entity_type: "member_health_document",
        p_summary: "Health document analysis rate limited",
        p_user_id: user.id
      });

      return jsonResponse(req, { error: "Rate limit exceeded" }, 429);
    }

    const { data: documentRows, error: docError } = await supabaseUser.rpc(
      "get_health_document_for_analysis_audited",
      { p_document_id: documentId },
    );
    const document = documentRows?.[0];

    if (docError || !document) {
      // Do not leak existence.
      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "view",
        p_area: "documents",
        p_details: {
          result: "denied",
        },
        p_entity_id: documentId,
        p_entity_type: "member_health_document",
        p_summary: "Health document analysis denied",
        p_user_id: user.id
      });
      return jsonResponse(req, { error: "Not found" }, 404);
    }

    // P0: Only owners can run analysis because it writes back to the document row.
    if (document.user_id !== user.id) {
      const ownerFailure = ownerOnlyNoLeakGuard({
        requesterUserId: user.id,
        documentOwnerUserId: document.user_id,
      });

      if (ownerFailure) {
        await supabaseAdmin.rpc("write_audit_journal", {
          p_action_type: "view",
          p_area: "documents",
          p_details: {
            result: "denied",
            reason: "not_owner",
          },
          p_entity_id: documentId,
          p_entity_type: "member_health_document",
          p_summary: "Health document analysis denied",
          p_user_id: user.id
        });
        return jsonResponse(req, { error: ownerFailure.error }, ownerFailure.status);
      }
    }

    // Consent gate (minimum necessary): require data_processing consent.
    {
      const { data: consents, error: consentError } = await supabaseUser.rpc(
        "get_my_consents",
      );

      if (consentError) {
        await supabaseAdmin.rpc("write_audit_journal", {
          p_action_type: "error",
          p_area: "documents",
          p_details: {
            result: "error",
            reason: "consent_check_failed",
          },
          p_entity_id: documentId,
          p_entity_type: "member_health_document",
          p_summary: "Health document analysis denied",
          p_user_id: user.id
        });
        return jsonResponse(req, { error: "Consent check failed" }, 500);
      }

      const hasConsent = (consents ?? []).some((consent) =>
        consent?.consent_type === "data_processing" &&
        consent?.granted === true &&
        !consent?.revoked_at
      );

      const consentFailure = consentGuard({ hasConsent });
      if (consentFailure) {
        await supabaseAdmin.rpc("write_audit_journal", {
          p_action_type: "error",
          p_area: "documents",
          p_details: {
            result: "denied",
            reason: "consent_required",
          },
          p_entity_id: documentId,
          p_entity_type: "member_health_document",
          p_summary: "Health document analysis denied",
          p_user_id: user.id
        });
        return jsonResponse(req, { error: consentFailure.error }, consentFailure.status);
      }
    }

    if ((document.file_size ?? 0) > MAX_ANALYSIS_FILE_SIZE_BYTES) {
      await supabaseUser.rpc("set_health_document_processing_status_audited", {
        p_document_id: documentId,
        p_reason: "file_too_large",
        p_status: "failed"
      });

      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "documents",
        p_details: {
          result: "error",
          reason: "file_too_large",
          max_bytes: MAX_ANALYSIS_FILE_SIZE_BYTES,
        },
        p_entity_id: documentId,
        p_entity_type: "member_health_document",
        p_summary: "Health document analysis failed",
        p_user_id: user.id
      });

      return jsonResponse(req, { error: "Document too large for analysis" }, 413);
    }

    await supabaseUser.rpc("set_health_document_processing_status_audited", {
      p_document_id: documentId,
      p_reason: "analysis_started",
      p_status: "processing"
    });

    const mimeType = typeof document.mime_type === "string" && document.mime_type.length
      ? document.mime_type
      : "application/octet-stream";

    const safeTitle = typeof document.title === "string"
      ? redactWithCustomTerms(document.title, customRedactions)
      : "Not specified";
    const safeDescription = typeof document.description === "string"
      ? redactWithCustomTerms(document.description, customRedactions)
      : "Not provided";

    const ocrText = typeof document.extracted_text === "string" && document.extracted_text.trim().length
      ? document.extracted_text
      : "";

    // Build minimal, redacted AI input. Never include base64/raw binaries.
    let contentForAnalysis = "";
    if (ocrText) {
      contentForAnalysis = clampText(redactWithCustomTerms(ocrText, customRedactions), MAX_AI_INPUT_CHARS);
    } else {
      // Download via user token (Storage policy enforced for owner).
      const { data: fileData, error: downloadError } = await supabaseUser.storage
        .from("health-documents")
        .download(document.file_path);

      if (downloadError || !fileData) {
        await supabaseUser.rpc("set_health_document_processing_status_audited", {
          p_document_id: documentId,
          p_reason: "download_failed",
          p_status: "failed"
        });

        await supabaseAdmin.rpc("write_audit_journal", {
          p_action_type: "error",
          p_area: "documents",
          p_details: {
            result: "error",
            reason: "download_failed",
          },
          p_entity_id: documentId,
          p_entity_type: "member_health_document",
          p_summary: "Health document analysis failed",
          p_user_id: user.id
        });

        return jsonResponse(req, { error: "Failed to download document" }, 500);
      }

      if (mimeType.startsWith("image/")) {
        contentForAnalysis = "[Image document]\n(No OCR text provided.)";
      } else if (mimeType === "application/pdf") {
        contentForAnalysis = "[PDF document]\n(No OCR text provided.)";
      } else {
        // Best-effort: read text for text-like documents only.
        try {
          const text = await fileData.text();
          contentForAnalysis = clampText(redactWithCustomTerms(text, customRedactions), MAX_AI_INPUT_CHARS);
        } catch (err) {
          console.warn("[analyze-health-document] file.text() failed (binary?), falling back to placeholder:", err);
          contentForAnalysis = "[Unsupported document type]\n(No extractable text provided.)";
        }
      }
    }

    const aiInput = redactWithCustomTerms(
      clampText(
        `Document: ${document.file_name}\nCategory: ${document.category}\nTitle: ${safeTitle}\nDescription: ${safeDescription}\nDocument date: ${document.document_date || "Not specified"}\nMIME: ${mimeType}\n\nContent/Context:\n${contentForAnalysis}`,
        MAX_AI_INPUT_CHARS,
      ),
      customRedactions,
    );

    const aiInputHash = await sha256Hex(aiInput);

    const systemPrompt = `You are a medical document analysis assistant. Analyze health documents and extract structured information.

Your task is to:
1. Identify the type of document (lab results, imaging report, prescription, etc.)
2. Extract key medical data points (values, dates, diagnoses, medications, etc.)
3. Provide a brief summary in plain language
4. Identify any notable findings or insights
5. Suggest relevant categories/tags

IMPORTANT: 
- Be factual and objective
- Do not provide medical advice
- Flag any values that appear outside normal ranges
- Use ISO date formats where applicable
- Extract numerical values with their units

Respond in JSON format with the following structure:
{
  "document_type": "string",
  "summary": "string (plain language summary, max 200 words)",
  "test_date": "YYYY-MM-DD or null",
  "lab_name": "string or null",
  "extracted_data": {
    // Use keys matching lab_results columns where possible:
    // crp, esr, wbc, rbc, hemoglobin, platelets, glucose, hba1c, insulin,
    // cholesterol_total, ldl, hdl, triglycerides, alt, ast, creatinine, urea,
    // vitamin_d, vitamin_b12, nk_cells, cd4_count, cd8_count, il_4, il_6,
    // tnf_alpha, nad_nadh_ratio, omega3_index
    // If you include units, use a separate key like "crp_unit".
  },
  "insights": [
    // Array of notable findings or observations
  ],
  "categories": ["array", "of", "relevant", "tags"],
  "confidence": "high|medium|low"
}`;

    const aiResponse = await fetch(getOpenAiApiUrl(), {
        signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getAnalyzeTrackingDocumentModel(),
        messages: [
          { role: "system", content: systemPrompt },
          { 
            role: "user", 
            content: `Analyze this health document. Do not include user identifiers (names, emails, phone numbers, addresses) in the output.\n\n${aiInput}`,
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      await supabaseUser.rpc("set_health_document_processing_status_audited", {
        p_document_id: documentId,
        p_reason: "ai_request_failed",
        p_status: "failed"
      });

      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "documents",
        p_details: {
          result: "error",
          reason: "ai_request_failed",
          ai_provider: "openai",
          model: getAnalyzeTrackingDocumentModel(),
          ai_input_hash: aiInputHash,
          custom_redaction_terms: customRedactions.length,
        },
        p_entity_id: documentId,
        p_entity_type: "member_health_document",
        p_summary: "Health document analysis failed",
        p_user_id: user.id
      });

      return jsonResponse(req, { error: "AI analysis failed" }, 500);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    // Parse AI response
    let analysisResult;
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = aiContent.match(/```json\n?([\s\S]*?)\n?```/) || [null, aiContent];
      analysisResult = JSON.parse(jsonMatch[1] || aiContent);
    } catch (_parseError) {
      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "documents",
        p_details: {
          result: "error",
          ai_provider: "openai",
          model: getAnalyzeTrackingDocumentModel(),
          ai_input_hash: aiInputHash,
        },
        p_entity_id: documentId,
        p_entity_type: "member_health_document",
        p_summary: "Health document analysis response parse failed",
        p_user_id: user.id
      });
      analysisResult = {
        summary: clampText(String(aiContent ?? ""), 2000),
        extracted_data: {},
        insights: [],
        categories: [document.category],
      };
    }

    // Calculate token reward based on document type and completeness
    let tokensToAward = 5; // Base reward
    if (analysisResult.extracted_data && Object.keys(analysisResult.extracted_data).length > 3) {
      tokensToAward += 3; // Bonus for rich data
    }
    if (document.description) {
      tokensToAward += 2; // Bonus for providing description
    }

    const mergedExtractedData: Record<string, unknown> = (
      analysisResult?.extracted_data && typeof analysisResult.extracted_data === "object"
        ? { ...(analysisResult.extracted_data as Record<string, unknown>) }
        : {}
    );

    if (typeof analysisResult?.test_date === "string" && analysisResult.test_date.length > 0) {
      mergedExtractedData.test_date = analysisResult.test_date;
    }

    if (typeof analysisResult?.lab_name === "string" && analysisResult.lab_name.length > 0) {
      mergedExtractedData.lab_name = analysisResult.lab_name;
    }

    const aiSummary = typeof analysisResult?.summary === "string"
      ? clampText(redactWithCustomTerms(analysisResult.summary, customRedactions), 2000)
      : null;
    const aiInsights = Array.isArray(analysisResult?.insights)
      ? analysisResult.insights
      : [];
    const aiCategories = Array.isArray(analysisResult?.categories)
      ? analysisResult.categories
      : [document.category];

    const { error: updateError } = await supabaseUser.rpc(
      "submit_health_document_analysis_audited",
      {
        p_ai_categories: aiCategories,
        p_ai_insights: aiInsights,
        p_ai_summary: aiSummary,
        p_document_id: documentId,
        p_extracted_data: mergedExtractedData,
        p_tokens_awarded: tokensToAward
      },
    );

    if (updateError) {
      await supabaseUser.rpc("set_health_document_processing_status_audited", {
        p_document_id: documentId,
        p_reason: "analysis_store_failed",
        p_status: "failed"
      });

      await supabaseAdmin.rpc("write_audit_journal", {
        p_action_type: "error",
        p_area: "documents",
        p_details: {
          result: "error",
          error: updateError.message,
        },
        p_entity_id: documentId,
        p_entity_type: "member_health_document",
        p_summary: "Health document analysis update failed",
        p_user_id: user.id
      });
      return jsonResponse(req, { error: "Failed to store analysis" }, 500);
    }

    await supabaseAdmin.rpc("write_audit_journal", {
      p_action_type: "update",
      p_area: "documents",
      p_details: {
        result: "completed",
        ai_provider: "openai",
        model: getAnalyzeTrackingDocumentModel(),
        tokens_awarded: tokensToAward,
        ai_input_hash: aiInputHash,
        custom_redaction_terms: customRedactions.length,
      },
      p_entity_id: documentId,
      p_entity_type: "member_health_document",
      p_summary: "Health document analysis completed",
      p_user_id: user.id
    });

    return jsonResponse(req, {
      success: true,
      analysis: analysisResult,
      tokens_awarded: tokensToAward,
    });
  } catch (error) {
    // Never log raw errors that might contain sensitive data.
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
