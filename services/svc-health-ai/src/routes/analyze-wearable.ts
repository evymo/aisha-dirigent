import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from '../auth.js';
import { rpcUser, rpcService } from '../postgrest.js';
import { config } from '../config.js';
import { buildHeuristicInsights } from '../helpers.js';
import { z } from 'zod';

interface AnalyzeWearableBody {
  syncBatchId: string;
}

const AnalyzeWearableSchema = z.object({
  syncBatchId: z.string().min(1).max(64),
});

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function analyzeWearableRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AnalyzeWearableBody }>('/analyze-wearable-sync', async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers.authorization;
    const user = await verifyToken(authHeader);
    const jwt = (authHeader ?? '').replace(/^Bearer\s+/i, '');

    const parsed = AnalyzeWearableSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const { syncBatchId } = parsed.data;

    // Rate limit
    try {
      await rpcUser('enforce_rate_limit', {
        p_endpoint_key: 'wearable_sync_analysis',
        p_max_requests: config.wearableAnalysesPerHour,
        p_window_ms: 60 * 60 * 1000,
      }, jwt);
    } catch {
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }

    // Fetch payload via user-scoped RPC
    let payloadObj: Record<string, unknown>;
    try {
      const payload = await rpcUser<Record<string, unknown>>(
        'get_wearable_sync_payload_for_analysis_audited',
        { p_sync_batch_id: syncBatchId },
        jwt,
      );
      if (!payload) throw new Error('not found');
      payloadObj = payload;
    } catch {
      return reply.status(404).send({ error: 'Not found' });
    }

    const sync = (payloadObj.sync as Record<string, unknown>) ?? {};
    const aggregates = (payloadObj.aggregates as Record<string, unknown>) ?? {};
    const insights = buildHeuristicInsights(aggregates);

    const generatedAt = new Date().toISOString();
    const fileName = `wearable-analysis-${syncBatchId}-${generatedAt.slice(0, 10)}.json`;
    const filePath = `${user.userId}/${syncBatchId}/${fileName}`;
    const fileBucket = 'wearable-analysis';

    const analysisPayload = {
      version: '1.0',
      generated_at: generatedAt,
      sync_batch_id: syncBatchId,
      data_source: typeof sync.data_source === 'string' ? sync.data_source : 'wearable',
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

    // Upload to MinIO via service-role
    try {
      const uploadRes = await fetch(`${config.minioUrl}/${fileBucket}/${filePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysisPayload, null, 2),
        signal: AbortSignal.timeout(15_000),
      });
      if (!uploadRes.ok) throw new Error(`upload failed: ${uploadRes.status}`);
    } catch {
      return reply.status(500).send({ error: 'Failed to write analysis file' });
    }

    // Create file reference via service-role RPC
    try {
      await rpcService('create_wearable_analysis_file_reference', {
        p_analysis_kind: 'sync_summary',
        p_data_source: typeof sync.data_source === 'string' ? sync.data_source : 'wearable',
        p_file_bucket: fileBucket,
        p_file_name: fileName,
        p_file_path: filePath,
        p_metadata: {
          format: 'json',
          generated_at: generatedAt,
          heuristics_count: insights.length,
        },
        p_user_id: user.userId,
        p_sync_batch_id: syncBatchId,
      });
    } catch {
      return reply.status(500).send({ error: 'Failed to create analysis reference' });
    }

    return reply.send({
      success: true,
      syncBatchId,
      file: { bucket: fileBucket, path: filePath, name: fileName },
      insightsCount: insights.length,
    });
  });
}
