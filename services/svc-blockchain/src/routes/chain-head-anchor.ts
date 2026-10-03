import type { FastifyInstance } from 'fastify';
import { verifyServiceRole } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { checkCosmosHealth, broadcastMsgSend } from '../lib/cosmos.js';
import { config } from '../config.js';

/**
 * POST /chain-head-anchor — Path-2 external tamper-evidence.
 *
 * Reads the current audit-chain head (fn_verify_audit_chain head_hash), commits
 * it on-chain as a Cosmos attestation (a self-MsgSend whose memo carries the
 * head_hash — NOT a per-record reward transfer), then persists the attestation
 * result (head_hash + returned cosmos tx hash) via the audited
 * record_chain_head_anchor RPC.
 *
 * WHY: the in-DB hash chain (record_hash/previous_hash) is only self-referential
 *   — a superuser or a silent restore-from-backup can rewrite history and re-run
 *   the heals backfill so fn_verify_audit_chain still returns ok=true. Publishing
 *   the head hash to an append-only external ledger (Cosmos) on a schedule makes a
 *   later divergence between the DB head and the last anchored head provable.
 *
 * Service-role only (driven by the scheduled n8n WF_LEDGER_CHAIN_ANCHOR workflow).
 */
export async function chainHeadAnchorRoutes(app: FastifyInstance): Promise<void> {
  app.post('/chain-head-anchor', async (req, reply) => {
    try {
      verifyServiceRole(req.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // A1 — read the current chain head (the deterministic tip of the hash chain).
    const verification = await rpcService<{
      ok: boolean;
      rows_total: number;
      rows_verified: number;
      head_hash: string | null;
      first_broken: unknown;
    }>('fn_verify_audit_chain', { p_limit: null });

    const result = Array.isArray(verification) ? verification[0] : verification;
    const headHash = result?.head_hash ?? null;

    if (!result?.ok) {
      // Fail loud — a broken chain must NOT be anchored (that would launder a
      // tampered head into the external ledger).
      return reply.code(409).send({
        error: 'Audit chain is broken — refusing to anchor',
        first_broken: result?.first_broken ?? null,
      });
    }

    if (!headHash) {
      // Empty chain — nothing to attest yet.
      return reply.send({ skipped: true, reason: 'Empty audit chain — no head to anchor' });
    }

    // On-chain broadcast requires a configured signer. Fail loud if unset — no
    // silent off-chain fallback (an un-anchored head is not tamper-evident).
    if (!config.cosmosSignerAddress || !config.cosmosSignerMnemonic) {
      return reply.code(503).send({ error: 'Cosmos signer not configured — cannot anchor chain head' });
    }

    // Circuit breaker — do not attempt a broadcast against an unreachable node.
    const cosmosHealthy = await checkCosmosHealth();
    if (!cosmosHealthy) {
      return reply.code(503).send({ error: 'Cosmos node unreachable', circuit_breaker: true, head_hash: headHash });
    }

    // A2 — commit the head on-chain. A self-MsgSend (signer → signer) carrying the
    // head hash in the memo as an ANCHOR ATTESTATION. The token movement is
    // incidental (1 base unit to self); the memo is the payload.
    const memo = `chain-head-anchor attest head_hash:${headHash} rows:${result.rows_verified}`;
    const txResult = await broadcastMsgSend({
      fromAddress: config.cosmosSignerAddress,
      toAddress: config.cosmosSignerAddress,
      amount: '1',
      denom: config.cosmosGasDenom,
      memo,
    });

    // A3 — persist the attestation result back into the DB (audited).
    const anchorResult = await rpcService('record_chain_head_anchor', {
      p_cosmos_tx_hash: txResult.success ? txResult.txHash : null,
      p_error_message: txResult.success ? null : txResult.error,
      p_head_hash: headHash,
      p_rows_verified: result.rows_verified,
      p_status: txResult.success ? 'confirmed' : 'failed',
    });
    const anchorId = anchorResult as string | null;

    if (!txResult.success) {
      return reply.code(502).send({
        success: false,
        head_hash: headHash,
        anchor_id: anchorId,
        error: txResult.error,
      });
    }

    return reply.send({
      success: true,
      head_hash: headHash,
      rows_verified: result.rows_verified,
      cosmos_tx_hash: txResult.txHash,
      anchor_id: anchorId,
    });
  });
}
