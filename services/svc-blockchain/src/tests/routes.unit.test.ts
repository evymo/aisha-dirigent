/**
 * Unit tests for svc-blockchain route handlers.
 *
 * Coverage:
 *   - POST /audit       (record-audit.ts — admin-only intake, validates
 *                        event/table allowlists, computes SHA-256 hash,
 *                        writes both edge_blockchain_audit + audit_journal)
 *   - POST /ledger-sync (ledger-sync.ts — service-role, fetches record,
 *                        idempotency on confirmed/exhausted, circuit-breaker
 *                        on Cosmos health, token-award MsgSend broadcast +
 *                        retry-with-max-attempts logic)
 *
 * Both routes are security-sensitive (audit trail for token ops), so
 * we lock in:
 *   - The allowlist contents (changing them is a deliberate decision,
 *     not a typo)
 *   - The SHA-256 hash is computed over the canonical JSON of the payload
 *   - Idempotency markers (confirmed/exhausted) short-circuit before any
 *     Cosmos broadcast — preventing double-spends on retry
 *   - Circuit breaker re-queues + returns 503 (Stripe-pattern: retryable)
 *   - Max-attempts → "exhausted" + 410 Gone (caller stops retrying)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

const {
  mockRpcService,
  mockVerifyToken,
  mockIsAdminOrStaff,
  mockVerifyServiceRole,
  mockCheckCosmosHealth,
  mockBroadcastMsgSend,
  mockBroadcastVote,
  mockPublishBlockchainSync,
  mockConfig,
} = vi.hoisted(() => ({
  mockRpcService: vi.fn(),
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
  mockVerifyServiceRole: vi.fn(),
  mockCheckCosmosHealth: vi.fn(),
  mockBroadcastMsgSend: vi.fn(),
  mockBroadcastVote: vi.fn(),
  mockPublishBlockchainSync: vi.fn(),
  // Mutable so individual tests can null out the signer (missing-config path).
  mockConfig: {
    port: 3013,
    cosmosSignerAddress: 'cosmos1signer',
    cosmosGasDenom: 'uaisha',
    cosmosChainId: 'aisha-1',
    cosmosRestUrl: 'http://cosmos-node:1317',
    defaultBatchSize: 20,
  },
}));

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn() }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

vi.mock('../postgrest.js', () => ({ rpcService: mockRpcService }));

vi.mock('../auth.js', () => ({
  verifyToken: mockVerifyToken,
  isAdminOrStaff: mockIsAdminOrStaff,
  verifyServiceRole: mockVerifyServiceRole,
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.name = 'AuthError';
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../lib/cosmos.js', () => ({
  checkCosmosHealth: mockCheckCosmosHealth,
  broadcastMsgSend: mockBroadcastMsgSend,
  broadcastVote: mockBroadcastVote,
}));

vi.mock('../lib/mq-client.js', () => ({
  publishBlockchainSync: mockPublishBlockchainSync,
}));

vi.mock('../config.js', () => ({ config: mockConfig }));

function makeApp() {
  const handlers = new Map<string, (req: unknown, reply: unknown) => unknown>();
  const post = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  const get = vi.fn((path: string, h: (req: unknown, reply: unknown) => unknown) => handlers.set(path, h));
  return { app: { post, get } as unknown as Parameters<typeof import('../routes/record-audit.js').recordAuditRoutes>[0], handlers };
}

function makeReply() {
  const calls: { code: number | null; body: unknown; headers: Record<string, string> } = {
    code: null,
    body: undefined,
    headers: {},
  };
  const reply = {
    code(c: number) { calls.code = c; return reply; },
    send(b: unknown) { calls.body = b; return reply; },
    header(k: string, v: string) { calls.headers[k] = v; return reply; },
  };
  return { reply, calls };
}

// ============================================================================
// POST /audit (record-audit.ts)
// ============================================================================

describe('recordAuditRoutes :: POST /audit', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
    mockVerifyToken.mockReset();
    mockIsAdminOrStaff.mockReset();
  });

  async function postAudit(body: unknown, authHeader = 'Bearer t') {
    const { recordAuditRoutes } = await import('../routes/record-audit.js');
    const { app, handlers } = makeApp();
    await recordAuditRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('/audit')!({ headers: { authorization: authHeader }, body }, reply);
    return calls;
  }

  it('401 on auth failure', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('expired'), { name: 'AuthError', statusCode: 401 }));
    const calls = await postAudit({});
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
  });

  it('403 when user is not admin/staff', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(false);
    const calls = await postAudit({ event_type: 'token_award', reference_table: 'token_transactions', reference_id: 'r', payload: {} });
    expect(calls.code).toBe(403);
  });

  it('400 on missing required fields', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const calls = await postAudit({ event_type: 'token_award' }); // missing the rest
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Missing required');
  });

  it('400 on event_type NOT in allowlist (prevents arbitrary audit injection)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const calls = await postAudit({
      event_type: 'arbitrary_event_injection',
      reference_table: 'token_transactions',
      reference_id: 'r',
      payload: { x: 1 },
    });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid event type');
  });

  it('400 on reference_table NOT in allowlist (prevents foreign-table injection)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const calls = await postAudit({
      event_type: 'token_award',
      reference_table: 'arbitrary_table',
      reference_id: 'r',
      payload: { x: 1 },
    });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid reference table');
  });

  it('400 on payload exceeding 50,000 JSON characters', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    const bigPayload = { data: 'A'.repeat(60_000) };
    const calls = await postAudit({
      event_type: 'token_award',
      reference_table: 'token_transactions',
      reference_id: 'r',
      payload: bigPayload,
    });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Payload too large');
  });

  it('happy path: inserts blockchain audit + writes audit_journal, returns audit_id', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    mockRpcService
      .mockResolvedValueOnce({ id: 'audit-uuid' }) // insert_record
      .mockResolvedValueOnce(undefined); // write_audit_journal

    const payload = { amount: 100, token_type: 'aisha' };
    const calls = await postAudit({
      event_type: 'token_award',
      reference_table: 'token_transactions',
      reference_id: 'tx-uuid',
      payload,
    });

    const expectedHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    expect(mockRpcService).toHaveBeenNthCalledWith(1, 'edge_blockchain_audit', expect.objectContaining({
      p_action: 'insert_record',
      p_payload: expect.objectContaining({
        created_by: 'user-uuid',
        event_type: 'token_award',
        reference_id: 'tx-uuid',
        reference_table: 'token_transactions',
        payload,
        payload_hash: expectedHash,
      }),
    }));
    expect(mockRpcService).toHaveBeenNthCalledWith(2, 'write_audit_journal', expect.objectContaining({
      p_action_type: 'integration',
      p_area: 'blockchain',
      p_entity_id: 'audit-uuid',
    }));
    expect(calls.body).toEqual({ success: true, audit_id: 'audit-uuid', status: 'pending' });
  });

  it('500 when edge_blockchain_audit returns no id (DB insert failed silently)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);
    mockRpcService.mockResolvedValueOnce({}); // no id
    const calls = await postAudit({
      event_type: 'token_award', reference_table: 'token_transactions',
      reference_id: 'r', payload: { x: 1 },
    });
    expect(calls.code).toBe(500);
    expect((calls.body as { error: string }).error).toContain('Failed to create');
  });
});

// ============================================================================
// POST /ledger-sync (ledger-sync.ts)
// ============================================================================

describe('ledgerSyncRoutes :: POST /ledger-sync', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
    mockVerifyServiceRole.mockReset();
    mockCheckCosmosHealth.mockReset();
    mockBroadcastMsgSend.mockReset();
  });

  async function postLedgerSync(body: unknown) {
    const { ledgerSyncRoutes } = await import('../routes/ledger-sync.js');
    const { app, handlers } = makeApp();
    await ledgerSyncRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('/ledger-sync')!(
      { headers: { authorization: 'Bearer svc' }, body },
      reply,
    );
    return calls;
  }

  it('401 when verifyServiceRole throws', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new Error('bad token'); });
    const calls = await postLedgerSync({ audit_record_id: 'a-1' });
    expect(calls.code).toBe(401);
  });

  it('400 when audit_record_id missing', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    const calls = await postLedgerSync({});
    expect(calls.code).toBe(400);
  });

  it('404 when record not found', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValue([]); // get_blockchain_audit_record returns nothing
    const calls = await postLedgerSync({ audit_record_id: 'missing' });
    expect(calls.code).toBe(404);
  });

  it('idempotency: already-confirmed record returns skipped (no broadcast, no status change)', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValue([{
      id: 'a-1', status: 'confirmed', cosmos_tx_hash: 'tx_existing',
      record_type: 'token_award', data: { amount: 100, user_id: 'u' },
      retry_count: 0, max_attempts: 3,
    }]);
    const calls = await postLedgerSync({ audit_record_id: 'a-1' });
    expect(calls.body).toEqual({ skipped: true, reason: 'Already confirmed', cosmos_tx_hash: 'tx_existing' });
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
  });

  it('idempotency: already-exhausted record returns skipped (no broadcast)', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValue([{
      id: 'a-2', status: 'exhausted', cosmos_tx_hash: null,
      record_type: 'token_award', data: {}, retry_count: 3, max_attempts: 3,
    }]);
    const calls = await postLedgerSync({ audit_record_id: 'a-2' });
    expect((calls.body as { skipped: boolean; reason: string }).skipped).toBe(true);
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
  });

  it('circuit breaker: Cosmos down → re-queue + 503 (status=queued)', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValueOnce([{
      id: 'a-3', status: 'queued', record_type: 'token_award',
      data: { amount: 100, user_id: 'u' }, cosmos_tx_hash: null, retry_count: 0, max_attempts: 3,
    }]);
    mockRpcService.mockResolvedValue(undefined); // update_blockchain_audit_status calls
    mockCheckCosmosHealth.mockResolvedValue(false);

    const calls = await postLedgerSync({ audit_record_id: 'a-3' });
    expect(calls.code).toBe(503);
    expect((calls.body as { circuit_breaker: boolean }).circuit_breaker).toBe(true);
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
  });

  it('token award happy path: broadcasts MsgSend, marks confirmed with cosmos_tx_hash', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService
      .mockResolvedValueOnce([{
        id: 'a-4', status: 'queued', record_type: 'token_award',
        data: { amount: 100, user_id: 'u-uuid', token_type: 'aisha', action_type: 'award' },
        cosmos_tx_hash: null, retry_count: 0, max_attempts: 3,
      }])
      .mockResolvedValueOnce(undefined) // mark processing
      .mockResolvedValueOnce({ cosmos_address: 'cosmos1user' }) // get_user_cosmos_address
      .mockResolvedValueOnce(undefined); // mark confirmed
    mockCheckCosmosHealth.mockResolvedValue(true);
    mockBroadcastMsgSend.mockResolvedValue({ success: true, txHash: 'tx_xyz' });

    const calls = await postLedgerSync({ audit_record_id: 'a-4', reference_table: 'token_transactions', reference_id: 'r-uuid' });
    expect(mockBroadcastMsgSend).toHaveBeenCalledWith(expect.objectContaining({
      fromAddress: 'cosmos1signer',
      toAddress: 'cosmos1user',
      amount: '100',
      denom: 'uaisha',
    }));
    expect(calls.body).toMatchObject({ success: true, status: 'confirmed', cosmos_tx_hash: 'tx_xyz' });
  });

  it('broadcast failure with retries remaining → status=failed + 502', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService
      .mockResolvedValueOnce([{
        id: 'a-5', status: 'queued', record_type: 'token_award',
        data: { amount: 50, user_id: 'u', action_type: 'award', token_type: 'aisha' },
        retry_count: 0, max_attempts: 3, cosmos_tx_hash: null,
      }])
      .mockResolvedValueOnce(undefined) // mark processing
      .mockResolvedValueOnce({ cosmos_address: 'cosmos1u' })
      .mockResolvedValueOnce(undefined); // mark failed
    mockCheckCosmosHealth.mockResolvedValue(true);
    mockBroadcastMsgSend.mockResolvedValue({ success: false, error: 'tendermint rejected: insufficient funds' });

    const calls = await postLedgerSync({ audit_record_id: 'a-5' });
    expect(calls.code).toBe(502);
    expect((calls.body as { status: string }).status).toBe('failed');
  });

  it('broadcast failure at last retry → status=exhausted + 410 Gone', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService
      .mockResolvedValueOnce([{
        id: 'a-6', status: 'queued', record_type: 'token_award',
        data: { amount: 50, user_id: 'u', action_type: 'award', token_type: 'aisha' },
        retry_count: 2, max_attempts: 3, cosmos_tx_hash: null,  // already 2 retries
      }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ cosmos_address: 'cosmos1u' })
      .mockResolvedValueOnce(undefined);
    mockCheckCosmosHealth.mockResolvedValue(true);
    mockBroadcastMsgSend.mockResolvedValue({ success: false, error: 'permanent error' });

    const calls = await postLedgerSync({ audit_record_id: 'a-6' });
    expect(calls.code).toBe(410);
    expect((calls.body as { status: string }).status).toBe('exhausted');
  });

  it('non-award action_type → no broadcast, marks confirmed off-chain', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService
      .mockResolvedValueOnce([{
        id: 'a-7', status: 'queued', record_type: 'governance_vote',
        data: { action_type: 'vote', user_id: 'u' },
        retry_count: 0, max_attempts: 3, cosmos_tx_hash: null,
      }])
      .mockResolvedValueOnce(undefined) // mark processing
      .mockResolvedValueOnce(undefined); // mark confirmed
    mockCheckCosmosHealth.mockResolvedValue(true);

    const calls = await postLedgerSync({ audit_record_id: 'a-7' });
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
    expect(calls.body).toMatchObject({ success: true, status: 'confirmed', cosmos_tx_hash: null });
  });
});

// ============================================================================
// POST /claim-reward (claim-reward.ts)
// ============================================================================

describe('claimRewardRoutes :: POST /claim-reward', () => {
  // A valid cosmos1 bech32-style address (38 chars after the cosmos1 prefix).
  const VALID_RECIPIENT = `cosmos1${'q'.repeat(38)}`;

  beforeEach(() => {
    mockRpcService.mockReset();
    mockVerifyToken.mockReset();
    mockBroadcastMsgSend.mockReset();
    mockConfig.cosmosSignerAddress = 'cosmos1signer';
  });

  async function postClaim(body: unknown, authHeader = 'Bearer t') {
    const { claimRewardRoutes } = await import('../routes/claim-reward.js');
    const { app, handlers } = makeApp();
    await claimRewardRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('/claim-reward')!({ headers: { authorization: authHeader }, body }, reply);
    return calls;
  }

  it('401 on auth failure', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('expired'), { name: 'AuthError', statusCode: 401 }));
    const calls = await postClaim({ recipient_address: VALID_RECIPIENT, claim_id: 'c-1' });
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
  });

  it('400 on invalid recipient address (not cosmos1...)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    // An old-prefix aisha1… address must now be rejected: the realigned guard only
    // accepts cosmos1… (the prefix of the deployed stock-simapp chain).
    const calls = await postClaim({ recipient_address: `aisha1${'q'.repeat(38)}`, claim_id: 'c-1' });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid recipient address');
    expect(mockRpcService).not.toHaveBeenCalled();
  });

  it('400 on missing claim_id', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    const calls = await postClaim({ recipient_address: VALID_RECIPIENT });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Missing claim_id');
  });

  it('500 when cosmos signer not configured', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockConfig.cosmosSignerAddress = '';
    const calls = await postClaim({ recipient_address: VALID_RECIPIENT, claim_id: 'c-1' });
    expect(calls.code).toBe(500);
    expect((calls.body as { error: string }).error).toContain('Cosmos signer not configured');
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
  });

  it('404 when claim not found (get_reward_claim → null)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockRpcService.mockResolvedValueOnce(null); // get_reward_claim
    const calls = await postClaim({ recipient_address: VALID_RECIPIENT, claim_id: 'missing' });
    expect(calls.code).toBe(404);
    expect((calls.body as { error: string }).error).toContain('Claim not found');
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
  });

  it('409 when claim already fulfilled', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockRpcService.mockResolvedValueOnce({
      id: 'c-1', user_id: 'u', amount: 100, denom: 'uaisha', status: 'fulfilled',
    });
    const calls = await postClaim({ recipient_address: VALID_RECIPIENT, claim_id: 'c-1' });
    expect(calls.code).toBe(409);
    expect((calls.body as { error: string }).error).toContain('already fulfilled');
    expect(mockBroadcastMsgSend).not.toHaveBeenCalled();
  });

  it('502 when broadcast fails', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockRpcService.mockResolvedValueOnce({
      id: 'c-1', user_id: 'u', amount: 100, denom: 'uaisha', status: 'pending',
    });
    mockBroadcastMsgSend.mockResolvedValue({ success: false, error: 'tendermint rejected' });
    const calls = await postClaim({ recipient_address: VALID_RECIPIENT, claim_id: 'c-1' });
    expect(calls.code).toBe(502);
    expect((calls.body as { error: string }).error).toContain('Broadcast failed');
    expect((calls.body as { detail: string }).detail).toBe('tendermint rejected');
  });

  it('happy path: broadcasts, fulfills claim, audits, returns fulfilled', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid', roles: ['user'], claims: {} });
    mockRpcService
      .mockResolvedValueOnce({ id: 'c-1', user_id: 'user-uuid', amount: 250, denom: 'uaisha', status: 'pending' }) // get_reward_claim
      .mockResolvedValueOnce(undefined) // fulfill_reward_claim
      .mockResolvedValueOnce(undefined); // write_audit_journal
    mockBroadcastMsgSend.mockResolvedValue({ success: true, txHash: 'tx_reward' });

    const calls = await postClaim({ recipient_address: VALID_RECIPIENT, claim_id: 'c-1' });

    expect(mockBroadcastMsgSend).toHaveBeenCalledWith(expect.objectContaining({
      fromAddress: 'cosmos1signer',
      toAddress: VALID_RECIPIENT,
      amount: '250',
      denom: 'uaisha',
    }));
    expect(mockRpcService).toHaveBeenNthCalledWith(2, 'fulfill_reward_claim', expect.objectContaining({
      p_claim_id: 'c-1',
      p_tx_hash: 'tx_reward',
    }));
    expect(mockRpcService).toHaveBeenNthCalledWith(3, 'write_audit_journal', expect.objectContaining({
      p_action_type: 'integration',
      p_area: 'blockchain',
      p_entity_id: 'c-1',
      p_summary: 'COSMOS_REWARD_CLAIM',
      p_user_id: 'user-uuid',
    }));
    expect(calls.body).toEqual({ tx_hash: 'tx_reward', claim_id: 'c-1', status: 'fulfilled' });
  });
});

// ============================================================================
// POST /governance/vote (governance-vote.ts)
// ============================================================================

describe('governanceVoteRoutes :: POST /governance/vote', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
    mockVerifyToken.mockReset();
    mockBroadcastVote.mockReset();
    mockConfig.cosmosSignerAddress = 'cosmos1signer';
  });

  async function postVote(body: unknown, authHeader = 'Bearer t') {
    const { governanceVoteRoutes } = await import('../routes/governance-vote.js');
    const { app, handlers } = makeApp();
    await governanceVoteRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('/governance/vote')!({ headers: { authorization: authHeader }, body }, reply);
    return calls;
  }

  it('401 on auth failure (auth required)', async () => {
    mockVerifyToken.mockRejectedValue(Object.assign(new Error('expired'), { name: 'AuthError', statusCode: 401 }));
    const calls = await postVote({ proposal_id: '42', vote_option: 'VOTE_OPTION_YES' });
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
    expect(mockBroadcastVote).not.toHaveBeenCalled();
  });

  it('400 on invalid proposal_id (non-numeric)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    const calls = await postVote({ proposal_id: 'not-a-number', vote_option: 'VOTE_OPTION_YES' });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid proposal_id');
  });

  it('400 on invalid vote_option (not in allowlist)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    const calls = await postVote({ proposal_id: '42', vote_option: 'VOTE_OPTION_MAYBE' });
    expect(calls.code).toBe(400);
    expect((calls.body as { error: string }).error).toContain('Invalid vote_option');
    expect(mockBroadcastVote).not.toHaveBeenCalled();
  });

  it('500 when cosmos signer not configured (missing signer)', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockConfig.cosmosSignerAddress = '';
    const calls = await postVote({ proposal_id: '42', vote_option: 'VOTE_OPTION_YES' });
    expect(calls.code).toBe(500);
    expect((calls.body as { error: string }).error).toContain('Cosmos signer not configured');
    expect(mockBroadcastVote).not.toHaveBeenCalled();
  });

  it('502 when vote broadcast fails', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'u', roles: ['user'], claims: {} });
    mockBroadcastVote.mockResolvedValue({ success: false, error: 'gas too low' });
    const calls = await postVote({ proposal_id: '42', vote_option: 'VOTE_OPTION_NO' });
    expect(calls.code).toBe(502);
    expect((calls.body as { error: string }).error).toContain('Vote broadcast failed');
    expect((calls.body as { detail: string }).detail).toBe('gas too low');
  });

  it('happy path: broadcasts vote with mapped option, audits, returns tx_hash', async () => {
    mockVerifyToken.mockResolvedValue({ userId: 'user-uuid', roles: ['user'], claims: {} });
    mockBroadcastVote.mockResolvedValue({ success: true, txHash: 'tx_vote' });
    mockRpcService.mockResolvedValueOnce(undefined); // write_audit_journal

    const calls = await postVote({ proposal_id: '42', vote_option: 'VOTE_OPTION_NO_WITH_VETO' });

    expect(mockBroadcastVote).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: '42',
      voteOption: 4, // VOTE_OPTION_NO_WITH_VETO maps to 4
      voter: 'cosmos1signer',
    }));
    expect(mockRpcService).toHaveBeenCalledWith('write_audit_journal', expect.objectContaining({
      p_action_type: 'integration',
      p_area: 'blockchain',
      p_entity_id: '42',
      p_summary: 'GOVERNANCE_VOTE',
      p_user_id: 'user-uuid',
    }));
    expect(calls.body).toEqual({ tx_hash: 'tx_vote', proposal_id: '42', vote_option: 'VOTE_OPTION_NO_WITH_VETO' });
  });
});

// ============================================================================
// GET /gov/* (gov-read.ts) — public read-only Cosmos REST proxy
// ============================================================================

describe('govReadRoutes :: GET /gov/*', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getGov(splat: string, rawUrl = `/gov/${splat}`) {
    const { govReadRoutes } = await import('../routes/gov-read.js');
    const { app, handlers } = makeApp();
    await govReadRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('/gov/*')!({ params: { '*': splat }, url: rawUrl }, reply);
    return calls;
  }

  it('403 on disallowed path prefix (SSRF/path-allowlist guard)', async () => {
    const calls = await getGov('cosmos/secret/admin/keys');
    expect(calls.code).toBe(403);
    expect((calls.body as { error: string }).error).toContain('Path not allowed');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('happy path: proxies allowed prefix and forwards upstream status + body', async () => {
    fetchSpy.mockResolvedValue(new Response('{"proposals":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const calls = await getGov(
      'cosmos/gov/v1/proposals',
      '/gov/cosmos/gov/v1/proposals?pagination.limit=10',
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('http://cosmos-node:1317/cosmos/gov/v1/proposals?pagination.limit=10');
    expect(calls.code).toBe(200);
    expect(calls.body).toBe('{"proposals":[]}');
    expect(calls.headers['Content-Type']).toBe('application/json');
    expect(calls.headers['Cache-Control']).toBe('public, max-age=5');
  });

  it('502 when upstream fetch throws (Cosmos node unreachable)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const calls = await getGov('cosmos/staking/v1beta1/validators');
    expect(calls.code).toBe(502);
    expect((calls.body as { error: string }).error).toBe('ECONNREFUSED');
  });
});

// ============================================================================
// POST /dispatch (dispatch.ts) — service-role queue → RabbitMQ publisher
// ============================================================================

describe('dispatchRoutes :: POST /dispatch', () => {
  beforeEach(() => {
    mockRpcService.mockReset();
    mockVerifyServiceRole.mockReset();
    mockPublishBlockchainSync.mockReset();
  });

  async function postDispatch(body: unknown, authHeader = 'Bearer svc') {
    const { dispatchRoutes } = await import('../routes/dispatch.js');
    const { app, handlers } = makeApp();
    await dispatchRoutes(app);
    const { reply, calls } = makeReply();
    await handlers.get('/dispatch')!({ headers: { authorization: authHeader }, body }, reply);
    return calls;
  }

  it('401 when verifyServiceRole throws (auth required)', async () => {
    mockVerifyServiceRole.mockImplementation(() => { throw new Error('bad token'); });
    const calls = await postDispatch({ batch_size: 5 });
    expect(calls.code).toBe(401);
    expect(calls.body).toEqual({ error: 'Unauthorized' });
    expect(mockRpcService).not.toHaveBeenCalled();
  });

  it('clamps batch_size into [1,100] and returns 0 when no queued records', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValue([]); // retry_pending_blockchain_syncs
    const calls = await postDispatch({ batch_size: 5000 });
    expect(mockRpcService).toHaveBeenCalledWith('retry_pending_blockchain_syncs', { p_batch_size: 100 });
    expect(calls.body).toEqual({ dispatched: 0, message: 'No queued records' });
    expect(mockPublishBlockchainSync).not.toHaveBeenCalled();
  });

  it('enqueue failure: counts failed records + surfaces errors', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValue([
      { id: 'r-1', record_type: 'token_award', reference_table: 'token_transactions', reference_id: 'tx-1' },
      { id: 'r-2', record_type: 'token_award', reference_table: 'token_transactions', reference_id: 'tx-2' },
    ]);
    mockPublishBlockchainSync
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false); // second publish fails

    const calls = await postDispatch({});
    expect(mockPublishBlockchainSync).toHaveBeenCalledTimes(2);
    expect(calls.body).toMatchObject({ dispatched: 1, failed: 1, total: 2 });
    expect((calls.body as { errors: string[] }).errors).toEqual(['Failed to publish record r-2']);
  });

  it('happy path: publishes all queued records with correct message shape', async () => {
    mockVerifyServiceRole.mockReturnValue(undefined);
    mockRpcService.mockResolvedValue([
      {
        id: 'r-1', correlation_id: 'corr-1', record_type: 'token_award',
        reference_table: 'token_transactions', reference_id: 'tx-1',
        token_transaction_id: 'ttx-1', retry_count: 2,
      },
    ]);
    mockPublishBlockchainSync.mockResolvedValue(true);

    const calls = await postDispatch({ batch_size: 10 });

    expect(mockRpcService).toHaveBeenCalledWith('retry_pending_blockchain_syncs', { p_batch_size: 10 });
    expect(mockPublishBlockchainSync).toHaveBeenCalledWith(expect.objectContaining({
      audit_record_id: 'r-1',
      correlation_id: 'corr-1',
      event_type: 'token_award',
      reference_table: 'token_transactions',
      reference_id: 'tx-1',
      token_transaction_id: 'ttx-1',
      retry_count: 2,
    }));
    expect(calls.body).toMatchObject({ dispatched: 1, failed: 0, total: 1 });
    expect((calls.body as { errors?: string[] }).errors).toBeUndefined();
  });
});
