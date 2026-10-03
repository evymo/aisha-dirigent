import { afterEach, describe, expect, it, vi } from 'vitest';

async function importBrokerModules(secret: string) {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { brokerTokenSecret: secret },
  }));
  const brokerSecret = await import('../broker-secret.js');
  const brokerToken = await import('../broker-token.js');
  return { ...brokerSecret, ...brokerToken };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../config.js');
});

describe('broker token contract', () => {
  it('signs and verifies broker tokens with the configured secret', async () => {
    const { issueBrokerToken, verifyBrokerToken } = await importBrokerModules('x'.repeat(32));
    const token = await issueBrokerToken({
      sub: 'run-1',
      kind: 'plugin_run',
      source_ref: 'sample-plugin',
      user_id: 'user-1',
      tenant_id: '77777777-7777-4777-8777-777777777777',
    }, 30_000);

    const payload = await verifyBrokerToken(token);
    expect(payload).toMatchObject({
      sub: 'run-1',
      tenant_id: '77777777-7777-4777-8777-777777777777',
      kind: 'plugin_run',
      source_ref: 'sample-plugin',
      user_id: 'user-1',
      aud: 'aisha-plugin-broker',
    });
  });

  it('fails closed when BROKER_TOKEN_SECRET is missing', async () => {
    const { getBrokerSecretBytes } = await importBrokerModules('');
    expect(() => getBrokerSecretBytes()).toThrow('BROKER_TOKEN_SECRET is required');
  });

  it('rejects short broker secrets', async () => {
    const { getBrokerSecretBytes } = await importBrokerModules('short-secret');
    expect(() => getBrokerSecretBytes()).toThrow('at least 32 characters');
  });
});
