/**
 * Unit tests for per-model prompt variants (odysseus G5).
 */

import { describe, test, expect } from 'vitest';
import {
  deriveModelFamily,
  familyLookupChain,
  selectPromptVariant,
  resolvePromptForModel,
  type PromptVariant,
} from '../lib/promptVariants';

describe('promptVariants — family derivation (G5)', () => {
  test('derives coarse family from registry family or model id', () => {
    expect(deriveModelFamily('claude-3-opus-20240229')).toBe('anthropic-opus');
    expect(deriveModelFamily('claude-3-5-sonnet')).toBe('anthropic-sonnet');
    expect(deriveModelFamily('claude-3-haiku')).toBe('anthropic-haiku');
    expect(deriveModelFamily('claude-x')).toBe('anthropic');
    expect(deriveModelFamily('gpt-4o')).toBe('openai');
    expect(deriveModelFamily('o3-mini')).toBe('openai');
    expect(deriveModelFamily('gemini-1.5-pro')).toBe('google');
    expect(deriveModelFamily('llama-3.1-70b')).toBe('local');
    expect(deriveModelFamily('qwen2.5')).toBe('local');
    expect(deriveModelFamily('')).toBe('default');
    expect(deriveModelFamily(null, null)).toBe('default');
  });

  test('registry family takes precedence and still buckets correctly', () => {
    expect(deriveModelFamily('some-internal-id', 'Claude Opus')).toBe('anthropic-opus');
    expect(deriveModelFamily('mystery', 'openai')).toBe('openai');
  });

  test('lookup chain broadens specific → base → default', () => {
    expect(familyLookupChain('anthropic-opus')).toEqual(['anthropic-opus', 'anthropic', 'default']);
    expect(familyLookupChain('openai')).toEqual(['openai', 'default']);
    expect(familyLookupChain('default')).toEqual(['default']);
  });
});

describe('promptVariants — selection + fallback (G5)', () => {
  const variants: Record<string, PromptVariant> = {
    default: { system: 'DEFAULT', fewShot: 'DEF_FS' },
    anthropic: { system: 'ANTHROPIC' },
    'anthropic-opus': { system: 'OPUS', fewShot: 'OPUS_FS' },
  };

  test('exact family match wins', () => {
    expect(selectPromptVariant(variants, 'anthropic-opus')?.system).toBe('OPUS');
  });

  test('broadens to base family when no exact match', () => {
    // sonnet has no exact entry → falls to 'anthropic'
    expect(selectPromptVariant(variants, 'anthropic-sonnet')?.system).toBe('ANTHROPIC');
  });

  test('falls back to default when neither specific nor base matches', () => {
    expect(selectPromptVariant(variants, 'openai')?.system).toBe('DEFAULT');
  });

  test('missing variant map never throws — returns undefined for the caller default', () => {
    expect(selectPromptVariant(null, 'anthropic-opus')).toBeUndefined();
    expect(selectPromptVariant({}, 'openai')).toBeUndefined();
  });

  test('resolvePromptForModel inherits unset fields from the code fallback', () => {
    const fallback: PromptVariant = { system: 'CODE_SYS', fewShot: 'CODE_FS' };
    // anthropic variant only overrides system → fewShot inherits from fallback
    const r = resolvePromptForModel(variants, 'claude-3-5-sonnet', null, fallback);
    expect(r.system).toBe('ANTHROPIC');
    expect(r.fewShot).toBe('CODE_FS');
  });

  test('resolvePromptForModel returns the code fallback when nothing matches', () => {
    const fallback: PromptVariant = { system: 'CODE_SYS' };
    const r = resolvePromptForModel({}, 'gpt-4o', null, fallback);
    expect(r.system).toBe('CODE_SYS');
  });
});
