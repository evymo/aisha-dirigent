import { describe, expect, it } from 'vitest';

import { aishaConfig } from './client';

describe('aisha client env resolution', () => {
  it('aishaConfig has correct shape with gateway URL', () => {
    expect(aishaConfig).toMatchObject({
      source: expect.stringMatching(/^(env|dev-fallback)$/),
      url: expect.any(String),
      key: 'postgrest-no-anon-key',
    });
    expect(aishaConfig.url.length).toBeGreaterThan(0);
  });
});
