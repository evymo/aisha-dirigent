import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken, AuthError } from '../auth.js';
import { rpcUser, rpcService } from '../postgrest.js';
import { config } from '../config.js';
import {
  redactWithCustomTerms,
  parseCustomRedactions,
  clampText,
  sha256Hex,
  HEALTH_DOCUMENT_SYSTEM_PROMPT,
} from '../helpers.js';
import { withAitgGuard, createAitgRunner } from '@aisha/aitg';
import { createSsrfGuard, parseHostAllowlist } from '@aisha/security';
import { z } from 'zod';

// OWASP A10 — the LLM egress goes through the SSRF guard so scheme + host are
// validated and the resolved IP is re-checked (DNS-rebinding safe). The gateway
// is a mesh-internal host (allowInternalNetworks); the `direct` provider host is
// public and must be covered by SSRF_HOST_ALLOWLIST. The operator-configured
// egress hosts are added to the allowlist so the guard preserves the intended
// destination rather than blocking it.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}
const llmEgressGuard = createSsrfGuard({
  service: 'svc-health-ai',
  hostAllowlist: [
    ...parseHostAllowlist(config.ssrfHostAllowlist),
    hostOf(config.llmGatewayUrl),
    hostOf(config.openaiApiUrl),
  ].filter(Boolean),
  allowedSchemes: ['http:', 'https:'],
  allowInternalNetworks: true,
});

interface AnalyzeDocumentBody {
  documentId: string;
  customRedactions?: unknown;
}

const AnalyzeDocumentSchema = z.object({
  documentId: z.string().min(1),
  customRedactions: z.unknown().optional(),
});

// OWASP AITG output guard runner. Health documents are an untrusted injection
// vector, so every model response is run through the AITG classifiers before it
// leaves the service (same wiring as svc-ai-chat).
const aitgRunner = createAitgRunner({
  postgrestUrl: config.postgrestUrl,
  serviceToken: config.postgrestServiceToken,
  service: 'svc-health-ai:analyze-document',
});

export async function analyzeDocumentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AnalyzeDocumentBody }>('/analyze-document', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    const user = await verifyToken(authHeader);
    const jwt = (authHeader ?? '').replace(/^Bearer\s+/i, '');

    const parsed = AnalyzeDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { documentId, customRedactions: rawRedactions } = parsed.data;

    const customRedactions = parseCustomRedactions(rawRedactions);

    // Rate limit via DB
    try {
      await rpcUser('enforce_rate_limit', {
        p_endpoint_key: 'health_document_analysis',
        p_max_requests: config.analysesPerHour,
        p_window_ms: 60 * 60 * 1000,
      }, jwt);
    } catch {
      await rpcService('write_audit_journal', {
        p_action_type: 'error',
        p_area: 'documents',
        p_details: { result: 'rate_limited', max_per_hour: config.analysesPerHour },
        p_entity_id: documentId,
        p_entity_type: 'member_health_document',
        p_summary: 'Health document analysis rate limited',
        p_user_id: user.userId,
      });
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }

    // Fetch document with RLS enforcement via user JWT
    let document: Record<string, unknown>;
    try {
      const rows = await rpcUser<Record<string, unknown>[]>(
        'get_health_document_for_analysis_audited',
        { p_document_id: documentId },
        jwt,
      );
      if (!rows?.[0]) throw new Error('not found');
      document = rows[0];
    } catch {
      await rpcService('write_audit_journal', {
        p_action_type: 'view',
        p_area: 'documents',
        p_details: { result: 'denied' },
        p_entity_id: documentId,
        p_entity_type: 'member_health_document',
        p_summary: 'Health document analysis denied',
        p_user_id: user.userId,
      });
      return reply.status(404).send({ error: 'Not found' });
    }

    // Owner check
    if (document.user_id !== user.userId) {
      await rpcService('write_audit_journal', {
        p_action_type: 'view',
        p_area: 'documents',
        p_details: { result: 'denied', reason: 'not_owner' },
        p_entity_id: documentId,
        p_entity_type: 'member_health_document',
        p_summary: 'Health document analysis denied',
        p_user_id: user.userId,
      });
      return reply.status(404).send({ error: 'Not found' });
    }

    // Consent gate
    try {
      const consents = await rpcUser<Array<{ consent_type: string; granted: boolean; revoked_at: string | null }>>('get_my_consents', {}, jwt);
      const hasConsent = (consents ?? []).some(
        (c) => c?.consent_type === 'data_processing' && c?.granted === true && !c?.revoked_at,
      );
      if (!hasConsent) {
        await rpcService('write_audit_journal', {
          p_action_type: 'error',
          p_area: 'documents',
          p_details: { result: 'denied', reason: 'consent_required' },
          p_entity_id: documentId,
          p_entity_type: 'member_health_document',
          p_summary: 'Health document analysis denied',
          p_user_id: user.userId,
        });
        return reply.status(403).send({ error: 'Data processing consent required' });
      }
    } catch {
      return reply.status(500).send({ error: 'Consent check failed' });
    }

    // File size check
    if ((document.file_size as number ?? 0) > config.maxAnalysisFileSizeBytes) {
      await rpcUser('set_health_document_processing_status_audited', {
        p_document_id: documentId,
        p_reason: 'file_too_large',
        p_status: 'failed',
      }, jwt);
      return reply.status(413).send({ error: 'Document too large for analysis' });
    }

    // Mark processing
    await rpcUser('set_health_document_processing_status_audited', {
      p_document_id: documentId,
      p_reason: 'analysis_started',
      p_status: 'processing',
    }, jwt);

    const mimeType = typeof document.mime_type === 'string' && (document.mime_type as string).length
      ? document.mime_type as string
      : 'application/octet-stream';

    const safeTitle = typeof document.title === 'string'
      ? redactWithCustomTerms(document.title as string, customRedactions)
      : 'Not specified';
    const safeDescription = typeof document.description === 'string'
      ? redactWithCustomTerms(document.description as string, customRedactions)
      : 'Not provided';

    const ocrText = typeof document.extracted_text === 'string' && (document.extracted_text as string).trim().length
      ? document.extracted_text as string
      : '';

    let contentForAnalysis = '';
    if (ocrText) {
      contentForAnalysis = clampText(redactWithCustomTerms(ocrText, customRedactions), config.maxAiInputChars);
    } else if (mimeType.startsWith('image/')) {
      contentForAnalysis = '[Image document]\n(No OCR text provided.)';
    } else if (mimeType === 'application/pdf') {
      contentForAnalysis = '[PDF document]\n(No OCR text provided.)';
    } else {
      contentForAnalysis = '[Unsupported document type]\n(No extractable text provided.)';
    }

    const aiInput = redactWithCustomTerms(
      clampText(
        `Document: ${document.file_name}\nCategory: ${document.category}\nTitle: ${safeTitle}\nDescription: ${safeDescription}\nDocument date: ${document.document_date || 'Not specified'}\nMIME: ${mimeType}\n\nContent/Context:\n${contentForAnalysis}`,
        config.maxAiInputChars,
      ),
      customRedactions,
    );

    const aiInputHash = await sha256Hex(aiInput);

    // Resolve the governed LLM egress. Default routes through the internal LLM
    // gateway (AISHA Omni /v1); `direct` mode is an opt-in documented fallback to
    // the provider host in OPENAI_API_URL. PII is already redacted (above) before
    // anything is sent to the model.
    const useGateway = config.llmMode !== 'direct';
    const llmUrl = useGateway
      ? `${config.llmGatewayUrl.replace(/\/$/, '')}/v1/chat/completions`
      : config.openaiApiUrl;
    const llmKey = useGateway ? config.llmGatewayKey : config.openaiApiKey;
    const llmProvider = useGateway ? 'gateway' : 'openai';

    if (!llmUrl || !llmKey) {
      await rpcUser('set_health_document_processing_status_audited', {
        p_document_id: documentId,
        p_reason: 'llm_egress_not_configured',
        p_status: 'failed',
      }, jwt);
      return reply.status(503).send({ error: 'LLM egress not configured' });
    }

    // Dispatch the model call through the resolved egress (SSRF-guarded).
    const aiResponse = await llmEgressGuard.safeFetch(llmUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${llmKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openaiModel,
        messages: [
          { role: 'system', content: HEALTH_DOCUMENT_SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this health document. Do not include user identifiers.\n\n${aiInput}` },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!aiResponse.ok) {
      await rpcUser('set_health_document_processing_status_audited', {
        p_document_id: documentId,
        p_reason: 'ai_request_failed',
        p_status: 'failed',
      }, jwt);
      await rpcService('write_audit_journal', {
        p_action_type: 'error',
        p_area: 'documents',
        p_details: {
          result: 'error',
          reason: 'ai_request_failed',
          ai_provider: llmProvider,
          model: config.openaiModel,
          ai_input_hash: aiInputHash,
          custom_redaction_terms: customRedactions.length,
        },
        p_entity_id: documentId,
        p_entity_type: 'member_health_document',
        p_summary: 'Health document analysis failed',
        p_user_id: user.userId,
      });
      return reply.status(500).send({ error: 'AI analysis failed' });
    }

    const aiData = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
    const aiContent = aiData.choices?.[0]?.message?.content ?? '';

    // OWASP AITG output guard — the model may echo an injection payload embedded
    // in the (untrusted) health document. Run the raw output through the AITG
    // classifiers (APP-01 injection bleed-through, APP-12 toxic output) BEFORE it
    // is parsed or returned. Fail LOUD on a violation — never leak the response.
    const guarded = await withAitgGuard(
      {
        runner: aitgRunner,
        buildSha: config.buildSha,
        triggeredBy: 'self',
        enabled: ['AITG-APP-01', 'AITG-APP-12'],
        service: 'svc-health-ai:analyze-document',
      },
      async () => ({ text: aiContent }),
    );
    if (guarded.violated) {
      await rpcUser('set_health_document_processing_status_audited', {
        p_document_id: documentId,
        p_reason: 'aitg_guard_violation',
        p_status: 'failed',
      }, jwt);
      await rpcService('write_audit_journal', {
        p_action_type: 'error',
        p_area: 'documents',
        p_details: {
          result: 'error',
          reason: 'aitg_guard_violation',
          ai_provider: llmProvider,
          model: config.openaiModel,
          ai_input_hash: aiInputHash,
          custom_redaction_terms: customRedactions.length,
        },
        p_entity_id: documentId,
        p_entity_type: 'member_health_document',
        p_summary: 'Health document analysis blocked by AITG guard',
        p_user_id: user.userId,
      });
      return reply.status(502).send({ error: 'aitg_guard_violation' });
    }

    // Parse AI response
    let analysisResult: Record<string, unknown>;
    try {
      const jsonMatch = aiContent.match(/```json\n?([\s\S]*?)\n?```/) ?? [null, aiContent];
      analysisResult = JSON.parse(jsonMatch[1] ?? aiContent) as Record<string, unknown>;
    } catch {
      analysisResult = {
        summary: clampText(String(aiContent ?? ''), 2000),
        extracted_data: {},
        insights: [],
        categories: [document.category],
      };
    }

    // Token reward
    let tokensToAward = 5;
    if (analysisResult.extracted_data && typeof analysisResult.extracted_data === 'object' && Object.keys(analysisResult.extracted_data as Record<string, unknown>).length > 3) {
      tokensToAward += 3;
    }
    if (document.description) {
      tokensToAward += 2;
    }

    const mergedExtractedData: Record<string, unknown> = analysisResult?.extracted_data && typeof analysisResult.extracted_data === 'object'
      ? { ...(analysisResult.extracted_data as Record<string, unknown>) }
      : {};

    if (typeof analysisResult?.test_date === 'string') mergedExtractedData.test_date = analysisResult.test_date;
    if (typeof analysisResult?.lab_name === 'string') mergedExtractedData.lab_name = analysisResult.lab_name;

    const aiSummary = typeof analysisResult?.summary === 'string'
      ? clampText(redactWithCustomTerms(analysisResult.summary as string, customRedactions), 2000)
      : null;
    const aiInsights = Array.isArray(analysisResult?.insights) ? analysisResult.insights : [];
    const aiCategories = Array.isArray(analysisResult?.categories) ? analysisResult.categories : [document.category];

    try {
      await rpcUser('submit_health_document_analysis_audited', {
        p_ai_categories: aiCategories,
        p_ai_insights: aiInsights,
        p_ai_summary: aiSummary,
        p_document_id: documentId,
        p_extracted_data: mergedExtractedData,
        p_tokens_awarded: tokensToAward,
      }, jwt);
    } catch {
      await rpcUser('set_health_document_processing_status_audited', {
        p_document_id: documentId,
        p_reason: 'analysis_store_failed',
        p_status: 'failed',
      }, jwt);
      return reply.status(500).send({ error: 'Failed to store analysis' });
    }

    await rpcService('write_audit_journal', {
      p_action_type: 'update',
      p_area: 'documents',
      p_details: {
        result: 'completed',
        ai_provider: llmProvider,
        model: config.openaiModel,
        tokens_awarded: tokensToAward,
        ai_input_hash: aiInputHash,
        custom_redaction_terms: customRedactions.length,
      },
      p_entity_id: documentId,
      p_entity_type: 'member_health_document',
      p_summary: 'Health document analysis completed',
      p_user_id: user.userId,
    });

    return reply.send({ success: true, analysis: analysisResult, tokens_awarded: tokensToAward });
  });
}
