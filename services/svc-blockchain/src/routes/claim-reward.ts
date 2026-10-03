import type { FastifyInstance } from 'fastify';
import { verifyToken, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { broadcastMsgSend } from '../lib/cosmos.js';
import { config } from '../config.js';

// Recipient addresses live on the deployed stock-simapp chain, whose bech32 prefix is
// 'cosmos' (see config.cosmosAddressPrefix / Dockerfile.cosmos), so every valid on-chain
// address is cosmos1… . Anchor the guard on ^cosmos1 to accept the addresses that exist.
const COSMOS_ADDRESS_REGEX = /^cosmos1[a-z0-9]{38,58}$/;

/**
 * POST /claim-reward — User claims a reward to their Cosmos wallet.
 */
export async function claimRewardRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { recipient_address: string; claim_id: string };
  }>('/claim-reward', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ error: 'Unauthorized' });
    }

    const { recipient_address, claim_id } = req.body ?? {};

    if (!COSMOS_ADDRESS_REGEX.test(recipient_address ?? '')) {
      return reply.code(400).send({ error: 'Invalid recipient address (expected cosmos1...)' });
    }
    if (!claim_id) {
      return reply.code(400).send({ error: 'Missing claim_id' });
    }
    if (!config.cosmosSignerAddress) {
      return reply.code(500).send({ error: 'Cosmos signer not configured' });
    }

    // Verify claim belongs to user
    const claim = await rpcService<{ id: string; user_id: string; amount: number; denom: string; status: string } | null>(
      'get_reward_claim',
      { p_claim_id: claim_id, p_user_id: user.userId },
    );

    if (!claim) {
      return reply.code(404).send({ error: 'Claim not found' });
    }
    if (claim.status === 'fulfilled') {
      return reply.code(409).send({ error: 'Claim already fulfilled' });
    }

    const amount = String(claim.amount ?? '0');
    const denom = claim.denom ?? config.cosmosGasDenom;

    const txResult = await broadcastMsgSend({
      fromAddress: config.cosmosSignerAddress,
      toAddress: recipient_address,
      amount,
      denom,
      memo: `Reward claim ${claim_id.slice(0, 8)}`,
    });

    if (!txResult.success) {
      return reply.code(502).send({ error: 'Broadcast failed', detail: txResult.error });
    }

    // Update claim
    await rpcService('fulfill_reward_claim', {
      p_claim_id: claim_id,
      p_tx_hash: txResult.txHash,
    });

    // Audit
    await rpcService('write_audit_journal', {
      p_action_type: 'integration',
      p_area: 'blockchain',
      p_details: { tx_hash: txResult.txHash, recipient: recipient_address, amount, denom, chain_id: config.cosmosChainId },
      p_entity_id: claim_id,
      p_entity_type: 'reward_claims',
      p_summary: 'COSMOS_REWARD_CLAIM',
      p_user_id: user.userId,
    });

    return reply.send({ tx_hash: txResult.txHash, claim_id, status: 'fulfilled' });
  });
}
