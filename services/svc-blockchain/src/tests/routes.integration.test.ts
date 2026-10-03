/**
 * Integration test for svc-blockchain routes against a real PostgREST backend.
 *
 * This test uses the throwaway-db instance. It validates that the SQL RPC functions
 * (like edge_blockchain_audit) operate correctly and return expected results to the
 * route handlers.
 * External dependencies (auth decoding, Cosmos blockchain network) are mocked, but
 * the entire HTTP -> Fastify Route -> rpcService -> PostgREST -> Postgres chain is REAL.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import fastify, { type FastifyInstance } from 'fastify';

// Mock external systems: auth checks and Cosmos network
const {
  mockVerifyToken,
  mockIsAdminOrStaff,
  mockVerifyServiceRole,
  mockCheckCosmosHealth,
  mockBroadcastMsgSend,
} = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockIsAdminOrStaff: vi.fn(),
  mockVerifyServiceRole: vi.fn(),
  mockCheckCosmosHealth: vi.fn(),
  mockBroadcastMsgSend: vi.fn(),
}));

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn() }),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

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
}));

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return {
    config: {
      ...actual.config,
      cosmosSignerAddress: 'cosmos1signer',
      cosmosGasDenom: 'uaisha',
    },
  };
});

// Only run if the PostgREST URL is provided (i.e. running via with-throwaway-db.mjs).
//
// Two modes:
//   - Plain local run (no BLOCKCHAIN_INTEGRATION): self-skip when POSTGREST_URL is
//     absent, so `npm run test:services` / a bare `vitest` doesn't need a backend.
//   - CI integration lane (BLOCKCHAIN_INTEGRATION=1): FAIL LOUD when POSTGREST_URL
//     is missing. A mis-wired lane (e.g. the throwaway PostgREST never came up, or
//     the env didn't propagate) must NOT silently self-skip and paint hollow-green —
//     the whole point of the lane is to exercise the real DB roundtrip.
const BASE = process.env.POSTGREST_URL;
if (process.env.BLOCKCHAIN_INTEGRATION === '1' && !BASE) {
  throw new Error(
    'BLOCKCHAIN_INTEGRATION=1 but POSTGREST_URL is unset — the integration lane is mis-wired. ' +
      'Run via `npm run test:integration:blockchain` (which self-provisions a throwaway ' +
      'PG17 + PostgREST). Refusing to silently self-skip.',
  );
}
const RUN = BASE ? describe : describe.skip;

RUN('Blockchain Routes Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = fastify();
    // Register the real routes
    const { recordAuditRoutes } = await import('../routes/record-audit.js');
    const { ledgerSyncRoutes } = await import('../routes/ledger-sync.js');
    await recordAuditRoutes(app);
    await ledgerSyncRoutes(app);
    await app.ready();
  });

  beforeEach(() => {
    mockVerifyToken.mockReset();
    mockIsAdminOrStaff.mockReset();
    mockVerifyServiceRole.mockReset();
    mockCheckCosmosHealth.mockReset();
    mockBroadcastMsgSend.mockReset();
  });

  it('POST /audit: successfully writes a blockchain audit to real DB and returns audit_id', async () => {
    // Setup auth mocks for admin user
    const testUserId = '11111111-1111-1111-1111-111111111111'; // UUID format expected by Postgres
    mockVerifyToken.mockResolvedValue({ userId: testUserId, roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);

    const payload = { amount: 150, user_id: 'target-user' };
    
    // Test the route which exercises rpcService -> PostgREST -> edge_blockchain_audit
    const response = await app.inject({
      method: 'POST',
      url: '/audit',
      headers: { authorization: 'Bearer admin-token' },
      payload: {
        event_type: 'token_award',
        reference_table: 'token_transactions',
        reference_id: 'tx-integration-test',
        payload,
      },
    });

    expect(response.statusCode, `Audit failed: ${response.body}`).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.status).toBe('pending');
    // We should get a real UUID back from the DB
    expect(body.audit_id).toBeDefined();
    expect(typeof body.audit_id).toBe('string');
  });

  it('POST /ledger-sync: successfully processes a pending audit record using real DB', async () => {
    // 1. Create a real record via /audit first
    const testUserId = '11111111-1111-1111-1111-111111111111';
    mockVerifyToken.mockResolvedValue({ userId: testUserId, roles: ['admin'], claims: {} });
    mockIsAdminOrStaff.mockReturnValue(true);

    const auditResponse = await app.inject({
      method: 'POST',
      url: '/audit',
      headers: { authorization: 'Bearer admin-token' },
      payload: {
        event_type: 'token_award',
        reference_table: 'token_transactions',
        reference_id: 'tx-ledger-sync-test',
        payload: { amount: 200, user_id: testUserId, token_type: 'aisha', action_type: 'award' },
      },
    });
    expect(auditResponse.statusCode, `Audit setup failed: ${auditResponse.body}`).toBe(200);
    const auditId = auditResponse.json().audit_id;
    expect(auditId).toBeDefined();

    // 2. Setup ledger-sync mocks
    mockVerifyServiceRole.mockReturnValue(undefined); // Allow service role
    mockCheckCosmosHealth.mockResolvedValue(true);
    mockBroadcastMsgSend.mockResolvedValue({ success: true, txHash: 'real_integration_tx_hash' });

    // 3. Process the created record via /ledger-sync
    // Note: The test user has no cosmos_address in profiles, so the route takes
    // the off-chain confirmation path (no Cosmos broadcast). This validates the
    // full DB roundtrip: create → fetch → status update → confirmed response.
    const syncResponse = await app.inject({
      method: 'POST',
      url: '/ledger-sync',
      headers: { authorization: 'Bearer service-token' },
      payload: {
        audit_record_id: auditId,
        reference_table: 'token_transactions',
        reference_id: 'tx-ledger-sync-test',
      },
    });

    expect(syncResponse.statusCode, `Sync failed: ${syncResponse.body}`).toBe(200);
    const syncBody = syncResponse.json();
    
    // Off-chain confirmation: user has no cosmos_address so broadcast is skipped
    expect(syncBody.success).toBe(true);
    expect(syncBody.status).toBe('confirmed');
    expect(syncBody.audit_record_id).toBe(auditId);
    // cosmos_tx_hash is null because no Cosmos broadcast occurred
    expect(syncBody.cosmos_tx_hash).toBeNull();

    // 4. Verify idempotency: calling it again should hit the DB check and skip
    const retryResponse = await app.inject({
      method: 'POST',
      url: '/ledger-sync',
      headers: { authorization: 'Bearer service-token' },
      payload: {
        audit_record_id: auditId,
        reference_table: 'token_transactions',
        reference_id: 'tx-ledger-sync-test',
      },
    });

    expect(retryResponse.statusCode).toBe(200);
    const retryBody = retryResponse.json();
    expect(retryBody.skipped).toBe(true);
    expect(retryBody.reason).toBe('Already confirmed');
  });
});
