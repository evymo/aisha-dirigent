/**
 * Unit tests for the stable-prefix prompt-cache helper (odysseus G1b).
 */

import { describe, test, expect } from 'vitest';
import {
  isStablePrefixCacheEnabled,
  splitSystemPrompt,
  flattenSplit,
  type PromptSegment,
} from '../lib/promptCache';

describe('promptCache — stable-prefix split (G1b)', () => {
  test('flag is off by default and on only for the exact "true" string', () => {
    expect(isStablePrefixCacheEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isStablePrefixCacheEnabled({ STABLE_PREFIX_CACHE: 'false' } as never)).toBe(false);
    expect(isStablePrefixCacheEnabled({ STABLE_PREFIX_CACHE: '1' } as never)).toBe(false);
    expect(isStablePrefixCacheEnabled({ STABLE_PREFIX_CACHE: 'true' } as never)).toBe(true);
  });

  test('emits all stable segments before any dynamic one, preserving in-class order', () => {
    const segs: PromptSegment[] = [
      { text: 'PERSONA', stable: true },
      { text: 'CONTEXT', stable: false }, // dynamic sits in the middle originally
      { text: 'INSTRUCTIONS', stable: true },
      { text: 'CALLER', stable: false },
    ];
    const { stable, dynamic } = splitSystemPrompt(segs);
    expect(stable).toBe('PERSONA\n\nINSTRUCTIONS');
    expect(dynamic).toBe('CONTEXT\n\nCALLER');
  });

  test('split is lossless in content (same segments, reordered stable-first)', () => {
    const segs: PromptSegment[] = [
      { text: 'PERSONA', stable: true },
      { text: 'CONTEXT', stable: false },
      { text: 'INSTRUCTIONS', stable: true },
    ];
    const flat = flattenSplit(splitSystemPrompt(segs));
    // every original non-empty segment survives
    for (const s of segs) expect(flat).toContain(s.text);
    expect(flat).toBe('PERSONA\n\nINSTRUCTIONS\n\nCONTEXT');
  });

  test('empty/whitespace segments are dropped (no dangling separators)', () => {
    const segs: PromptSegment[] = [
      { text: '  ', stable: true },
      { text: 'ONLY', stable: true },
      { text: '', stable: false },
    ];
    const { stable, dynamic } = splitSystemPrompt(segs);
    expect(stable).toBe('ONLY');
    expect(dynamic).toBe('');
  });

  test('all-stable input yields empty dynamic (whole-prefix cacheable)', () => {
    const { stable, dynamic } = splitSystemPrompt([
      { text: 'A', stable: true },
      { text: 'B', stable: true },
    ]);
    expect(stable).toBe('A\n\nB');
    expect(dynamic).toBe('');
  });
});
