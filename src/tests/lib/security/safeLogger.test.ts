import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Override the global mock from setup.ts so dynamic imports get the REAL module.
vi.unmock('@/lib/security/safeLogger');

const snapshotMetaEnv = () => ({ ...import.meta.env } as Record<string, unknown>);

const setEnv = (next: Record<string, unknown>) => {
  const env = import.meta.env as Record<string, unknown>;

  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) {
      try {
        delete env[key];
      } catch {
        // ignore
      }
      continue;
    }

    try {
      env[key] = value;
    } catch {
      // ignore
    }
  }
};

describe('safeLogger (security)', () => {
  const originalEnv = snapshotMetaEnv();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('v test prostředí neloguje nic (fail-safe proti úniku sensitive data)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { safeError, safeWarn, safeInfo } = await import('@/lib/security/safeLogger');

    safeError('ctx', new Error('user@test.com'));
    safeWarn('ctx', 'bearer secret-token-1234567890');
    safeInfo('ctx', 'hello');

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('v DEV mimo test loguje a rediguje citlivá data', async () => {
    setEnv({
      DEV: true,
      MODE: 'development',
      VITEST: undefined,
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { safeError } = await import('@/lib/security/safeLogger');

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const jwt = 'eyJabcdefghijklmno.pqrstuvwxyzABCDE.FGHIJKLMNopqrstuv';
    const msg = `Email test@example.com id ${uuid} token bearer supersecret_1234567890 jwt ${jwt}`;

    safeError('ctx', new Error(msg));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, payload] = errorSpy.mock.calls[0] as [unknown, { context: string; message: string }];
    expect(payload.context).toBe('ctx');
    expect(payload.message).toContain('[redacted-email]');
    expect(payload.message).toContain('[redacted-id]');
    expect(payload.message).toContain('[redacted-token]');
    expect(payload.message).toContain('[redacted-jwt]');

    expect(payload.message).not.toContain('test@example.com');
    expect(payload.message).not.toContain(uuid);
  });

  it('unknown error typ mapuje na "Unknown error" (bez detailů)', async () => {
    setEnv({
      DEV: true,
      MODE: 'development',
      VITEST: undefined,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { safeWarn } = await import('@/lib/security/safeLogger');

    safeWarn('ctx', { foo: 'bar' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, payload] = warnSpy.mock.calls[0] as [unknown, { context: string; message: string }];
    expect(payload.message).toBe('Unknown error');
  });
});
