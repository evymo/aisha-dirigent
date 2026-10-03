import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('getBackendInstanceInfo', () => {
  const originalEnv = snapshotMetaEnv();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setEnv({
      VITE_AISHA_GATEWAY_URL: undefined,
      VITE_AISHA_POSTGREST_PUBLISHABLE_KEY: undefined,
      VITE_AISHA_GATEWAY_KEY: undefined,
    });
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('považuje konfiguraci za env i když je publishable key prázdný string', async () => {
    setEnv({
      VITE_AISHA_GATEWAY_URL: 'https://abcd.aisha.test',
      VITE_AISHA_GATEWAY_KEY: 'anon',
      VITE_AISHA_POSTGREST_PUBLISHABLE_KEY: '',
    });

    const { getBackendInstanceInfo } = await import('@/integrations/db/backendInstance');
    const info = getBackendInstanceInfo();

    expect(info.source).toBe('env');
    expect(info.id).toBe('abcd.aisha.test');
    expect(info.maskedId).toBe('abcd…test');
  });
});
