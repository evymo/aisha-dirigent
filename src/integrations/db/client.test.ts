import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeError: vi.fn(),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

import { validateAishaConfig } from './client';

describe('validateAishaConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns provided values when both env vars exist', () => {
    const result = validateAishaConfig(
      'https://example.aisha.test',
      'public-key',
      'production'
    );

    expect(result).toEqual({
      url: 'https://example.aisha.test',
      key: 'public-key',
      source: 'env',
    });
  });

  it('returns gateway fallback when URL is missing', () => {
    const result = validateAishaConfig(undefined, 'public-key', 'development');

    expect(result.url).toBeTruthy();
    expect(result.key).toBe('postgrest-no-anon-key');
    expect(result.missing).toContain('VITE_AISHA_GATEWAY_URL');
  });

  it('uses placeholder key when key argument is undefined', () => {
    const result = validateAishaConfig(
      'https://example.aisha.test',
      undefined,
      'production'
    );

    expect(result).toEqual({
      url: 'https://example.aisha.test',
      key: 'postgrest-no-anon-key',
      source: 'env',
    });
  });

  it('returns consistent shape regardless of mode', () => {
    const dev = validateAishaConfig(undefined, undefined, 'development');
    const prod = validateAishaConfig(undefined, undefined, 'production');

    expect(dev.url).toBe(prod.url);
    expect(dev.key).toBe(prod.key);
    expect(dev.missing).toEqual(prod.missing);
  });
});
