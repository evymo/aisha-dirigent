/**
 * Unit tests for svc-health-ai PII redaction helpers.
 *
 * Health data goes through these helpers before reaching the LLM.
 * Any leak = PII exposure to a third-party model. Strict standards:
 *   - Email pattern catches common shapes
 *   - Phone pattern catches international + national formats
 *   - SSN-style ID pattern
 *   - Custom terms are length-capped (no DoS via giant regex compile)
 *   - Custom terms are regex-escaped (no injection through "." → ".*")
 *   - Custom terms case-insensitive
 *   - Custom terms dedup + cap at 50 (no quadratic blowup)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({ config: {} }));

describe('redactText — email pattern', () => {
  it('redacts standard email', async () => {
    const { redactText } = await import('../helpers.js');
    expect(redactText('contact alice@example.com today')).toBe('contact [EMAIL-REDACTED] today');
  });

  it('redacts email with subdomain + numbers', async () => {
    const { redactText } = await import('../helpers.js');
    expect(redactText('bob+test123@a.b.example.co.uk')).toBe('[EMAIL-REDACTED]');
  });
});

describe('redactText — phone pattern', () => {
  it('redacts CZ-style phone with spaces', async () => {
    const { redactText } = await import('../helpers.js');
    expect(redactText('call 123 456 789 now')).toBe('call [PHONE-REDACTED] now');
  });

  it('redacts international format with +', async () => {
    const { redactText } = await import('../helpers.js');
    expect(redactText('contact +420 123 456 789 please')).toContain('[PHONE-REDACTED]');
  });
});

describe('redactText — ID pattern (SSN-style)', () => {
  it('redacts xxx-xx-xxxx format', async () => {
    const { redactText } = await import('../helpers.js');
    expect(redactText('SSN: 123-45-6789')).toContain('[ID-REDACTED]');
  });

  it('leaves non-SSN dashes alone', async () => {
    const { redactText } = await import('../helpers.js');
    expect(redactText('product code A-B-C')).toBe('product code A-B-C');
  });
});

describe('parseCustomRedactions — input validation', () => {
  it('returns [] for non-array input (no crash on string/number/null)', async () => {
    const { parseCustomRedactions } = await import('../helpers.js');
    expect(parseCustomRedactions('not array')).toEqual([]);
    expect(parseCustomRedactions(42)).toEqual([]);
    expect(parseCustomRedactions(null)).toEqual([]);
  });

  it('filters out non-string elements + too-short + too-long', async () => {
    const { parseCustomRedactions } = await import('../helpers.js');
    const input = ['ok', 'x', 42, null, 'A'.repeat(121), 'good'];
    const out = parseCustomRedactions(input);
    expect(out).toEqual(['ok', 'good']);
  });

  it('lowercases + dedups (case-insensitive set)', async () => {
    const { parseCustomRedactions } = await import('../helpers.js');
    const out = parseCustomRedactions(['Foo', 'foo', 'FOO', 'bar']);
    expect(out.sort()).toEqual(['bar', 'foo']);
  });

  it('caps at 50 entries (DoS protection on giant regex compile)', async () => {
    const { parseCustomRedactions } = await import('../helpers.js');
    const input = Array.from({ length: 200 }, (_, i) => `term_${i}_padded`);
    expect(parseCustomRedactions(input).length).toBe(50);
  });
});

describe('applyCustomRedactions — regex injection safety', () => {
  it('replaces literal term (not regex pattern)', async () => {
    const { applyCustomRedactions } = await import('../helpers.js');
    // ".+" is a regex meta — without escaping it would match anything.
    expect(applyCustomRedactions('Hello world, foo.+bar test', ['foo.+bar'])).toContain('[CUSTOM-REDACTED]');
    expect(applyCustomRedactions('Hello world, fooXbar test', ['foo.+bar'])).not.toContain('[CUSTOM-REDACTED]');
  });

  it('case-insensitive replacement', async () => {
    const { applyCustomRedactions } = await import('../helpers.js');
    expect(applyCustomRedactions('My Name Is John', ['john'])).toContain('[CUSTOM-REDACTED]');
  });

  it('empty terms list → unchanged input (no-op)', async () => {
    const { applyCustomRedactions } = await import('../helpers.js');
    expect(applyCustomRedactions('unchanged', [])).toBe('unchanged');
  });
});
