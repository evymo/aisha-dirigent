import type { FastifyInstance } from 'fastify';
import { verifyToken, AuthError } from '../auth.js';
import { rpcService } from '../postgrest.js';
import { broadcastVote } from '../lib/cosmos.js';
import { config } from '../config.js';

const VALID_VOTE_OPTIONS = ['VOTE_OPTION_YES', 'VOTE_OPTION_NO', 'VOTE_OPTION_ABSTAIN', 'VOTE_OPTION_NO_WITH_VETO'] as const;
type VoteOption = typeof VALID_VOTE_OPTIONS[number];

const VOTE_OPTION_MAP: Record<VoteOption, number> = {
  VOTE_OPTION_YES: 1,
  VOTE_OPTION_ABSTAIN: 2,
  VOTE_OPTION_NO: 3,
  VOTE_OPTION_NO_WITH_VETO: 4,
};

/**
 * POST /governance/vote — Backend-signed governance vote (web only).
 */
export async function governanceVoteRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { proposal_id: string; vote_option: VoteOption };
  }>('/governance/vote', async (req, reply) => {
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ error: 'Unauthorized' });
    }

    const { proposal_id, vote_option } = req.body ?? {};

    if (!proposal_id || !/^\d+$/.test(proposal_id)) {
      return reply.code(400).send({ error: 'Invalid proposal_id' });
    }
    if (!VALID_VOTE_OPTIONS.includes(vote_option)) {
      return reply.code(400).send({ error: 'Invalid vote_option' });
    }
    if (!config.cosmosSignerAddress) {
      return reply.code(500).send({ error: 'Cosmos signer not configured' });
    }

    const txResult = await broadcastVote({
      proposalId: proposal_id,
      voteOption: VOTE_OPTION_MAP[vote_option as VoteOption],
      voter: config.cosmosSignerAddress,
    });

    if (!txResult.success) {
      return reply.code(502).send({ error: 'Vote broadcast failed', detail: txResult.error });
    }

    // Audit
    await rpcService('write_audit_journal', {
      p_action_type: 'integration',
      p_area: 'blockchain',
      p_details: { vote_option, tx_hash: txResult.txHash, chain_id: config.cosmosChainId, signed_by: 'backend' },
      p_entity_id: proposal_id,
      p_entity_type: 'cosmos_governance',
      p_summary: 'GOVERNANCE_VOTE',
      p_user_id: user.userId,
    });

    return reply.send({ tx_hash: txResult.txHash, proposal_id, vote_option });
  });
}
