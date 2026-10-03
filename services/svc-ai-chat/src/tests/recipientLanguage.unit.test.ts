/**
 * Recipient-language helpers (master-plan Brick 7) — locks the "answer in the RECIPIENT's
 * language" principle that routes/chat.ts relies on:
 *   - universal BCP47 (any locale, NOT a cs/en allowlist),
 *   - Intl-DERIVED language names (no hardcoded language map),
 *   - the cross-lingual instruction: knowledge may be in OTHER languages, answer in the
 *     recipient's (knowledge ≠ language).
 * The logic was inline in chat.ts (unreachable by a unit test); extracting it to
 * lib/recipientLanguage.ts makes the real behavior assertable here and reusable by the
 * multilanguage proof harness.
 */
import { describe, it, expect } from 'vitest';
import {
  assertValidLocale,
  languageDisplayName,
  buildLanguageInstruction,
} from '../lib/recipientLanguage.js';

describe('assertValidLocale — universal BCP47, not an allowlist', () => {
  it.each(['en', 'cs', 'ru', 'th', 'fr', 'de', 'pt-BR', 'zh-Hant'])('accepts %s', (loc) => {
    expect(assertValidLocale(loc)).toBe(loc);
  });

  it('accepts a structurally-valid but non-curated tag (proves there is NO allowlist)', () => {
    expect(assertValidLocale('xx')).toBe('xx');
  });

  it.each([undefined, null, 123, {}, []])('rejects non-string %s', (bad) => {
    expect(() => assertValidLocale(bad)).toThrow(/string locale code/);
  });

  it.each(['', 'a', '!!!'])('rejects malformed %s', (bad) => {
    expect(() => assertValidLocale(bad)).toThrow(/BCP47/);
  });
});

describe('languageDisplayName — Intl-derived, never a hardcoded map', () => {
  it.each([
    ['cs', 'Czech'],
    ['de', 'German'],
    ['th', 'Thai'],
    ['fr', 'French'],
    ['ru', 'Russian'],
  ])('%s → %s', (loc, name) => {
    expect(languageDisplayName(loc)).toBe(name);
  });

  it('falls back to the tag when the runtime cannot name it', () => {
    expect(languageDisplayName('xx')).toBe('xx');
  });
});

describe('buildLanguageInstruction — answer in recipient language, understand OTHER languages', () => {
  it.each([
    ['cs', 'Czech'],
    ['th', 'Thai'],
    ['fr', 'French'],
    ['ru', 'Russian'],
  ])('names the recipient language (%s → %s), Intl-derived not cs/en', (loc, name) => {
    const out = buildLanguageInstruction(loc);
    expect(out).toContain(name);
    expect(out).toContain(`locale "${loc}"`);
  });

  it('tells the model to understand OTHER-language context but answer in the recipient language (knowledge ≠ language)', () => {
    const out = buildLanguageInstruction('th');
    expect(out).toMatch(/OTHER languages/);
    expect(out).toMatch(/idiomatically/);
    expect(out).toMatch(/Do not leave source-language fragments|mix languages/);
  });

  it('works for a language that is neither the cs default nor the en fallback (universal, no per-language branch)', () => {
    expect(buildLanguageInstruction('de')).toContain('German');
  });
});
