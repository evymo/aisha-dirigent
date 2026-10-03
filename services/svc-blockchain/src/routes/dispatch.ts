import type { FastifyInstance } from 'fastify';
import { verifyServiceRole } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { publishBlockchainSync, type BlockchainSyncMessage } from '../lib/mq-client.js';
import { config } from '../config.js';

/**
 * POST /dispatch — Pick queued blockchain_audit_records and publish to RabbitMQ.
 * Service-role only (invoked by pg_notify or n8n cron).
 */
export async function dispatchRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { batch_size?: number } }>('/dispatch', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const batchSize = Math.min(Math.max(req.body?.batch_size ?? config.defaultBatchSize, 1), 100);

    const records = await rpcService<Array<{
      id: string;
      correlation_id?: string;
      record_type: string;
      reference_table: string;
      reference_id: string;
      token_transaction_id?: string;
      retry_count?: number;
    }>>('retry_pending_blockchain_syncs', { p_batch_size: batchSize });

    if (!records || records.length === 0) {
      return reply.send({ dispatched: 0, message: 'No queued records' });
    }

    let published = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const record of records) {
      const message: BlockchainSyncMessage = {
        audit_record_id: record.id,
        correlation_id: record.correlation_id ?? record.id,
        event_type: record.record_type,
        reference_table: record.reference_table,
        reference_id: record.reference_id,
        token_transaction_id: record.token_transaction_id ?? null,
        retry_count: record.retry_count ?? 0,
        dispatched_at: new Date().toISOString(),
      };

      const ok = await publishBlockchainSync(message);
      if (ok) {
        published++;
      } else {
        failed++;
        errors.push(`Failed to publish record ${record.id}`);
      }
    }

    return reply.send({ dispatched: published, failed, total: records.length, errors: errors.length > 0 ? errors : undefined });
  });
}
