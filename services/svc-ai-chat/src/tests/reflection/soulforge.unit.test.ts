/**
 * Soulforge unit tests — classifier + payload optimizer + slot model resolution.
 *
 * Covers AISHA-development variants:
 *   - Each slot pattern (spark/ember/verify/compact/semantic/webSearch/desloppify)
 *   - Length cap on spark (drops to default for long descriptions)
 *   - Empty/unknown input → default
 *   - Optimizer behavior per slot (spark trims aggressively, compact tiny system,
 *     verify trims long user, default whitespace-only)
 *   - Slot model resolution: env override > matrix > fallback
 *   - applySoulforge adapter preserves unifiedChat options + sets messages
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const resolveDefaultModelMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/defaultModel.js', () => ({ resolveDefaultModel: resolveDefaultModelMock }));

import {
  classifyTaskSlot,
  optimizePayload,
  resolveSlotModel,
  applySoulforge,
} from '../../reflection/soulforge.js';

describe('classifyTaskSlot', () => {
  it('classifies read/explore as spark when short', () => {
    expect(classifyTaskSlot('please read README.md').slot).toBe('spark');
    expect(classifyTaskSlot('open the file').slot).toBe('spark');
    expect(classifyTaskSlot('show me the config').slot).toBe('spark');
  });

  it('falls through to default when spark pattern is too long', () => {
    const longMsg = 'please read '.padEnd(500, 'x');
    const result = classifyTaskSlot(longMsg);
    expect(result.slot).not.toBe('spark');
  });

  it('classifies write/edit/create/fix as ember', () => {
    expect(classifyTaskSlot('write a function that parses JSON').slot).toBe('ember');
    expect(classifyTaskSlot('fix the bug in auth').slot).toBe('ember');
    expect(classifyTaskSlot('refactor this module').slot).toBe('ember');
    expect(classifyTaskSlot('add a new endpoint').slot).toBe('ember');
  });

  it('classifies review/test/audit as verify', () => {
    expect(classifyTaskSlot('review this PR').slot).toBe('verify');
    expect(classifyTaskSlot('audit last quarter').slot).toBe('verify');
    expect(classifyTaskSlot('verify the migration').slot).toBe('verify');
  });

  it('classifies summarize/tldr/condense as compact', () => {
    expect(classifyTaskSlot('summarize this paper').slot).toBe('compact');
    expect(classifyTaskSlot('TLDR of meeting notes').slot).toBe('compact');
    expect(classifyTaskSlot('condense the document').slot).toBe('compact');
  });

  it('classifies analyze/explain/compare as semantic', () => {
    expect(classifyTaskSlot('analyze the failure pattern').slot).toBe('semantic');
    expect(classifyTaskSlot('explain how this works').slot).toBe('semantic');
    expect(classifyTaskSlot('compare these architectures').slot).toBe('semantic');
  });

  it('classifies search/google/lookup as webSearch', () => {
    expect(classifyTaskSlot('search the web for X').slot).toBe('webSearch');
    expect(classifyTaskSlot('lookup latest CVE').slot).toBe('webSearch');
  });

  it('classifies clean/format/lint as desloppify', () => {
    expect(classifyTaskSlot('clean up the imports').slot).toBe('desloppify');
    expect(classifyTaskSlot('lint the codebase').slot).toBe('desloppify');
  });

  it('returns default for empty/unknown input', () => {
    expect(classifyTaskSlot('').slot).toBe('default');
    expect(classifyTaskSlot('lorem ipsum dolor sit').slot).toBe('default');
  });

  it('returns confidence ≥ 0.6 for pattern matches', () => {
    expect(classifyTaskSlot('write a function').confidence).toBeGreaterThanOrEqual(0.6);
    expect(classifyTaskSlot('summarize this').confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns confidence < 0.6 for unmatched', () => {
    expect(classifyTaskSlot('lorem ipsum').confidence).toBeLessThan(0.6);
  });

  it('exposes reason field for debugging', () => {
    expect(classifyTaskSlot('write code').reason).toMatch(/regex_match/);
    expect(classifyTaskSlot('lorem ipsum').reason).toMatch(/no_pattern/);
  });
});

describe('optimizePayload', () => {
  const baseRaw = {
    system: 'You are AISHA.\n\nGovernance: be helpful.\n\nPsyché: warm tone.\n\nRules: RPC-only, no any.',
    user: 'Task: read the auth module\n\nRecent learnings (3):\n 1. learning A...\n 2. learning B...\n 3. learning C...',
  };

  it('spark slot drops large system + truncates learnings', () => {
    const longSystem = 'X'.repeat(3000);
    const result = optimizePayload({ system: longSystem, user: baseRaw.user }, 'spark', 'balanced');
    expect(result.system.length).toBeLessThanOrEqual(1500);
    expect(result.reduction_pct).toBeGreaterThan(0);
    expect(result.dropped_segments.some((s) => s.startsWith('system_trimmed'))).toBe(true);
  });

  it('compact slot trims system to ≤500 chars', () => {
    const longSystem = 'X'.repeat(2000);
    const result = optimizePayload({ system: longSystem, user: 'TLDR please' }, 'compact', 'balanced');
    expect(result.system.length).toBeLessThanOrEqual(500);
  });

  it('verify slot trims overlong user', () => {
    const longUser = 'X'.repeat(10_000);
    const result = optimizePayload({ system: 'system', user: longUser }, 'verify', 'balanced');
    expect(result.user.length).toBeLessThan(longUser.length);
    expect(result.user).toContain('truncated');
  });

  it('default slot only collapses whitespace', () => {
    const raw = { system: 'a   b\n\n\n\nc', user: 'x   y\n\n\n\nz' };
    const result = optimizePayload(raw, 'default', 'balanced');
    expect(result.system).not.toContain('   '); // multi-space collapsed
    expect(result.system).not.toContain('\n\n\n'); // tripled newlines collapsed
  });

  it('produces non-negative reduction_pct', () => {
    const result = optimizePayload(baseRaw, 'ember', 'balanced');
    expect(result.reduction_pct).toBeGreaterThanOrEqual(0);
    expect(result.reduction_pct).toBeLessThanOrEqual(100);
  });

  it('returns 0% reduction when input is empty', () => {
    const result = optimizePayload({ system: '', user: '' }, 'ember', 'balanced');
    expect(result.reduction_pct).toBe(0);
  });
});

describe('resolveSlotModel — slot→capability, profile→cost, no literal matrix', () => {
  const originalEnv = process.env.AISHA_SLOT_MODELS;
  beforeEach(() => {
    delete process.env.AISHA_SLOT_MODELS;
    resolveDefaultModelMock.mockReset();
    resolveDefaultModelMock.mockResolvedValue('resolved-model');
  });
  afterEach(() => {
    if (originalEnv !== undefined) process.env.AISHA_SLOT_MODELS = originalEnv;
  });

  it('resolves LIVE — returns whatever AISHA picks, never a hardcoded matrix model', async () => {
    resolveDefaultModelMock.mockResolvedValue('claude-whatever-aisha-picks');
    expect(await resolveSlotModel('spark', 'balanced')).toBe('claude-whatever-aisha-picks');
  });

  it('ember slot → needsTools; budget profile → cheap max_cost (budget cost-class)', async () => {
    await resolveSlotModel('ember', 'budget');
    expect(resolveDefaultModelMock).toHaveBeenCalledWith(
      'soulforge:ember',
      expect.objectContaining({ needsTools: true, maxCostUsd: 0.3, skipDeriveNeeds: true }),
    );
  });

  it('webSearch slot → needsInternet; maxQuality profile → premium cost', async () => {
    await resolveSlotModel('webSearch', 'maxQuality');
    expect(resolveDefaultModelMock).toHaveBeenCalledWith(
      'soulforge:webSearch',
      expect.objectContaining({ needsInternet: true, maxCostUsd: 5.0 }),
    );
  });

  it('unknown slot → no special capability needs, balanced cost', async () => {
    await resolveSlotModel('unknown-slot', 'balanced');
    expect(resolveDefaultModelMock).toHaveBeenCalledWith(
      'soulforge:unknown-slot',
      expect.objectContaining({ maxCostUsd: 1.0 }),
    );
  });

  it('env override wins over the live resolve (slot:profile granularity)', async () => {
    process.env.AISHA_SLOT_MODELS = JSON.stringify({ 'spark:balanced': 'custom-model-x' });
    expect(await resolveSlotModel('spark', 'balanced')).toBe('custom-model-x');
    expect(resolveDefaultModelMock).not.toHaveBeenCalled();
  });

  it('env override falls back to slot-only key when slot:profile missing', async () => {
    process.env.AISHA_SLOT_MODELS = JSON.stringify({ spark: 'fallback-spark' });
    expect(await resolveSlotModel('spark', 'balanced')).toBe('fallback-spark');
  });

  it('malformed env JSON is ignored, falls back to the live resolve', async () => {
    process.env.AISHA_SLOT_MODELS = '{not valid json';
    resolveDefaultModelMock.mockResolvedValue('live-resolved');
    expect(await resolveSlotModel('spark', 'balanced')).toBe('live-resolved');
  });
});

describe('applySoulforge adapter', () => {
  it('preserves provider/model/temperature; rewrites systemPrompt + last user message', () => {
    const opts = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'X'.repeat(3000),
      messages: [
        { role: 'user', content: 'please read the auth module' },
      ],
      temperature: 0.3,
    };
    const optimized = applySoulforge(opts);
    expect(optimized.provider).toBe('anthropic');
    expect(optimized.model).toBe('claude-sonnet-4-20250514');
    expect(optimized.temperature).toBe(0.3);
    expect(optimized.messages).toHaveLength(1);
    expect(optimized._soulforge_slot).toBe('spark');
    expect(optimized._soulforge_reduction_pct).toBeGreaterThanOrEqual(0);
  });

  it('accepts explicit slotHint override', () => {
    const opts = {
      messages: [{ role: 'user', content: 'write some code' }],
    };
    const optimized = applySoulforge(opts, 'verify', 'maxQuality');
    expect(optimized._soulforge_slot).toBe('verify');
  });

  it('handles assistant-only or empty message arrays without crashing', () => {
    const opts = {
      messages: [{ role: 'assistant', content: 'prior turn' }],
    };
    const optimized = applySoulforge(opts);
    expect(optimized._soulforge_slot).toBeDefined();
  });
});
