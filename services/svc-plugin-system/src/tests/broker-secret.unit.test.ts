import { afterEach, describe, expect, it, vi } from 'vitest';

async function importBrokerSecret(secret: string) {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { brokerTokenSecret: secret },
  }));
  return import('../broker-secret.js');
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../config.js');
});

describe('broker secret contract', () => {
  it('fails closed when BROKER_TOKEN_SECRET is missing', async () => {
    const { getBrokerSecretBytes } = await importBrokerSecret('');
    expect(() => getBrokerSecretBytes()).toThrow('BROKER_TOKEN_SECRET is required');
  });

  it('rejects short broker secrets', async () => {
    const { getBrokerSecretBytes } = await importBrokerSecret('short-secret');
    expect(() => getBrokerSecretBytes()).toThrow('at least 32 characters');
  });

  it('returns bytes for a configured broker secret', async () => {
    const secret = 'x'.repeat(32);
    const { getBrokerSecretBytes, assertBrokerSecretConfigured } = await importBrokerSecret(secret);
    expect(() => assertBrokerSecretConfigured()).not.toThrow();
    expect(new TextDecoder().decode(getBrokerSecretBytes())).toBe(secret);
  });
});
