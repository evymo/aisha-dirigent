import type { FastifyInstance } from 'fastify';
import { verifyServiceRole } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { checkCosmosHealth, broadcastMsgSend } from '../lib/cosmos.js';
import { config } from '../config.js';

/**
 * POST /ledger-sync — Process a single blockchain_audit_record, sync to Cosmos.
 * Service-role only (called by n8n RabbitMQ consumer).
 */
export async function ledgerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { audit_record_id: string; reference_table?: string; reference_id?: string };
  }>('/ledger-sync', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { audit_record_id } = req.body ?? {};
    if (!audit_record_id) {
      return reply.code(400).send({ error: 'Missing audit_record_id' });
    }

    // Fetch record via RPC
    const records = await rpcService<Array<{
      id: string;
      status: string;
      record_type: string;
      data: Record<string, unknown> | null;
      cosmos_tx_hash: string | null;
      retry_count: number;
      max_attempts: number;
    }>>('get_blockchain_audit_record', { p_id: audit_record_id });

    const auditRecord = Array.isArray(records) ? records[0] : records;
    if (!auditRecord) {
      return reply.code(404).send({ error: 'Audit record not found', audit_record_id });
    }

    // Idempotency
    if (auditRecord.status === 'confirmed') {
      return reply.send({ skipped: true, reason: 'Already confirmed', cosmos_tx_hash: auditRecord.cosmos_tx_hash });
    }
    if (auditRecord.status === 'exhausted') {
      return reply.send({ skipped: true, reason: 'Max retries exhausted — check DLQ' });
    }

    // Mark processing
    await rpcService('update_blockchain_audit_status', {
      p_id: audit_record_id,
      p_status: 'processing',
    });

    // Circuit breaker
    const cosmosHealthy = await checkCosmosHealth();
    if (!cosmosHealthy) {
      await rpcService('update_blockchain_audit_status', {
        p_error_message: 'Circuit breaker: Cosmos node unreachable',
        p_id: audit_record_id,
        p_status: 'queued',
      });
      return reply.code(503).send({ error: 'Cosmos node unreachable', circuit_breaker: true, audit_record_id });
    }

    const payload = auditRecord.data;
    const tokenType = (payload?.token_type as string) ?? '';
    const actionType = (payload?.action_type as string) ?? auditRecord.record_type;
    const amount = (payload?.amount as number) ?? 0;
    const userId = (payload?.user_id as string) ?? '';

    // Look up user Cosmos address
    let userCosmosAddress: string | null = null;
    if (userId) {
      try {
        const profile = await rpcService<{ cosmos_address?: string }>('get_user_cosmos_address', { p_user_id: userId });
        userCosmosAddress = profile?.cosmos_address ?? null;
      } catch {
        // no address
      }
    }

    const isAward = actionType === 'award' || actionType === 'token_award';

    if (isAward && userCosmosAddress && config.cosmosSignerAddress && amount > 0) {
      const txResult = await broadcastMsgSend({
        fromAddress: config.cosmosSignerAddress,
        toAddress: userCosmosAddress,
        amount: String(amount),
        denom: tokenType === 'aisha' ? config.cosmosGasDenom : `u${tokenType}`,
        memo: `Sync: ${actionType} ${tokenType} ref:${req.body.reference_table}/${req.body.reference_id}`,
      });

      if (txResult.success) {
        await rpcService('update_blockchain_audit_status', {
          p_cosmos_tx_hash: txResult.txHash,
          p_id: audit_record_id,
          p_status: 'confirmed',
        });
        return reply.send({ success: true, audit_record_id, status: 'confirmed', cosmos_tx_hash: txResult.txHash });
      }

      // Failed — retry logic
      const retryCount = (auditRecord.retry_count ?? 0) + 1;
      const maxAttempts = auditRecord.max_attempts ?? 3;
      const newStatus = retryCount >= maxAttempts ? 'exhausted' : 'failed';

      await rpcService('update_blockchain_audit_status', {
        p_error_message: txResult.error,
        p_id: audit_record_id,
        p_retry_count: retryCount,
        p_status: newStatus,
      });

      return reply.code(newStatus === 'exhausted' ? 410 : 502).send({
        success: false, audit_record_id, status: newStatus, error: txResult.error, retry_count: retryCount,
      });
    }

    // Non-broadcast or no address — confirm as off-chain
    await rpcService('update_blockchain_audit_status', {
      p_id: audit_record_id,
      p_status: 'confirmed',
    });

    return reply.send({ success: true, audit_record_id, status: 'confirmed', cosmos_tx_hash: null });
  });
}
