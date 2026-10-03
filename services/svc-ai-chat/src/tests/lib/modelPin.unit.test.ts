/**
 * Unit tests for the model-pin axis: `isModelServable` vs `resolveAvailableModel`.
 *
 * These two functions answer deliberately different questions about the same
 * input, and the difference is the whole point of the `/generate` model
 * override:
 *
 *   resolveAvailableModel("x")  →  "give me SOMETHING that can answer"
 *                                  (remaps to another backend's model when no
 *                                  configured backend serves x — correct for
 *                                  routed traffic, which must not dead-end)
 *
 *   isModelServable("x")        →  "can x ITSELF answer?"
 *                                  (false when it would be remapped — the only
 *                                  safe basis for honouring a caller's pin)
 *
 * Why it matters: an AITG conformance run files a verdict against a named
 * model. If a pin were resolved through the remap path, a probe could report
 * "gpt-4o-mini failed AITG-APP-01" on the strength of an answer produced by a
 * completely different model. That is not a flaky test — it is a fabricated
 * compliance claim, and it would look exactly like a real one in the DB.
 *
 * So `/generate` refuses (422) rather than remapping whenever the caller pins.
 * These tests pin BOTH behaviours together, because the value is in the
 * contrast: if someone later "simplifies" the override to reuse
 * resolveAvailableModel, the remap assertion below still passes while the
 * servability one starts lying.
 */
import { describe, it, expect } from 'vitest';
import { isModelServable, resolveAvailableModel } from '../../lib/llmRouter.js';

/** Minimal backend double — only `id` + `canServe` are consulted. */
const backend = (id: string, serves: string[]) => ({
  id,
  canServe: (model: string) => serves.includes(model),
});

describe('isModelServable', () => {
  it('is true when a configured backend serves the exact model', () => {
    const backends = [backend('openai', ['gpt-4o-mini', 'gpt-4o'])];
    expect(isModelServable('gpt-4o-mini', backends)).toBe(true);
  });

  it('is FALSE when no configured backend serves it — even though a remap exists', () => {
    const backends = [backend('anthropic', ['claude-sonnet-4'])];
    expect(isModelServable('gpt-4o-mini', backends)).toBe(false);
  });

  it('is true with no backends registered at all (cold process — fail downstream, not here)', () => {
    // resolveAvailableModel passes this case through untouched so the dispatch
    // surfaces a clear backend error. This helper must not invent a stricter
    // policy than the path it guards, or a cold start would 422 every pin.
    expect(isModelServable('gpt-4o-mini', [])).toBe(true);
  });

  it('does not match on prefix or substring — a pin is an exact claim', () => {
    const backends = [backend('openai', ['gpt-4o'])];
    expect(isModelServable('gpt-4o-mini', backends)).toBe(false);
  });
});

describe('isModelServable ↔ resolveAvailableModel — the contrast the override relies on', () => {
  it('resolveAvailableModel SILENTLY substitutes exactly where isModelServable says false', () => {
    const backends = [backend('anthropic', ['claude-sonnet-4'])];
    const discovered = (id: string) => (id === 'anthropic' ? ['claude-sonnet-4'] : []);

    // The routed path: something answers, and it is NOT what was asked for.
    const resolved = resolveAvailableModel('gpt-4o-mini', backends, discovered);
    expect(resolved.model).toBe('claude-sonnet-4');
    expect(resolved.model).not.toBe('gpt-4o-mini');

    // The pinned path: refuse instead. Same input, opposite obligation.
    expect(isModelServable('gpt-4o-mini', backends)).toBe(false);
  });

  it('agree when the model IS servable — pinning costs nothing in the normal case', () => {
    const backends = [backend('openai', ['gpt-4o-mini'])];
    const discovered = () => ['gpt-4o-mini'];

    expect(resolveAvailableModel('gpt-4o-mini', backends, discovered).model).toBe('gpt-4o-mini');
    expect(isModelServable('gpt-4o-mini', backends)).toBe(true);
  });
});
