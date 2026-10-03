/**
 * AISHA-derived sampling temperature — a KB/document-grounded answer stays faithful to the
 * retrieved facts (low temperature); small-talk varies more naturally (higher). Pure + deterministic.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@aisha/security', () => ({
  createSafeLogger: () => ({ safeInfo: vi.fn(), safeWarn: vi.fn(), safeError: vi.fn(), safeDebug: vi.fn() }),
  createSsrfGuard: () => ({ safeFetch: vi.fn() }),
  parseHostAllowlist: (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean),
  // ⛔ Mock MUSÍ nést i `requireEnv` — config ho volá při importu. Chybějící
  // export se projeví jako pád CELÉHO souboru, ne jako chybějící hodnota.
  requireEnv: (name: string) => process.env[name] ?? `test-${name}`,
}));

import { temperatureForTaskCategory } from '../lib/orchestrationBridge.js';

describe('temperatureForTaskCategory', () => {
  it('grounded answers (knowledge/document) → low temperature, faithful to retrieved facts', () => {
    expect(temperatureForTaskCategory('chat_knowledge')).toBe(0.3);
    expect(temperatureForTaskCategory('chat_document')).toBe(0.3);
  });

  it('hybrid → balanced', () => {
    expect(temperatureForTaskCategory('chat_hybrid')).toBe(0.5);
  });

  it('small-talk → conversational (higher variance)', () => {
    expect(temperatureForTaskCategory('chat_smalltalk')).toBe(0.7);
  });

  it('a grounded answer is more deterministic than small-talk (the core dynamic)', () => {
    expect(temperatureForTaskCategory('chat_knowledge')).toBeLessThan(temperatureForTaskCategory('chat_smalltalk'));
  });
});
