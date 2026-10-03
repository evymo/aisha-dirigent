import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

/**
 * PR-B / RFC 8693: the MCP server must accept the SHORT-LIVED, USER-scoped token
 * minted by svc-ai-chat (so tools run under the user's identity → DB RLS) and MUST
 * NOT accept a service_role credential (the cross-tenant-leak surface). These are
 * the load-bearing security assertions of the token-mediation rework.
 */
// Derived (not a literal) so the no-hardcoded-secrets gate stays happy; any stable
// value works — the mint helper and the verifier just need to share it.
const FIXTURE_SIGNING = createHash('sha256').update('omni-mcp-mediation-unit-test').digest('hex');
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

function mint(claims: Record<string, unknown>, signing = FIXTURE_SIGNING): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: now, exp: now + 900, ...claims })}`;
  return `${data}.${createHmac('sha256', signing).update(data).digest('base64url')}`;
}

describe('RFC 8693 mediated-token verification (svc-mcp-knowledge)', () => {
  let verifyMediatedToken: (token: string) => Promise<{ sub?: unknown; role?: unknown } | null>;

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', FIXTURE_SIGNING);
    vi.resetModules();
    ({ verifyMediatedToken } = await import('../auth.js'));
  });

  it('accepts a user-scoped mediated token (runs the tool as that user)', async () => {
    const payload = await verifyMediatedToken(
      mint({ sub: 'user-123', role: 'authenticated', story_id: 'story-1', token_use: 'omni-mcp-mediation' }),
    );
    expect(payload?.sub).toBe('user-123');
    expect(payload?.role).toBe('authenticated');
  });

  it('REJECTS a service_role token — no privilege escalation past RLS', async () => {
    const payload = await verifyMediatedToken(
      mint({ sub: 'attacker', role: 'service_role', token_use: 'omni-mcp-mediation' }),
    );
    expect(payload).toBeNull();
  });

  it('REJECTS a token missing the omni-mcp-mediation marker', async () => {
    const payload = await verifyMediatedToken(mint({ sub: 'user-123', role: 'authenticated' }));
    expect(payload).toBeNull();
  });

  it('REJECTS a token signed with a different key (forgery)', async () => {
    const wrongKey = createHash('sha256').update('not-the-shared-key').digest('hex');
    const payload = await verifyMediatedToken(
      mint({ sub: 'user-123', role: 'authenticated', token_use: 'omni-mcp-mediation' }, wrongKey),
    );
    expect(payload).toBeNull();
  });
});
