/**
 * GATE: AISHA governs ragnarok's model — no hardcoded model defaults on the RAG path.
 *
 * Owner mandate (2026-06-27, stated twice): "zadne defaulty ani u ragnaroku — vse
 * musi jit pres aishu podle toho co a jak se ptame." Every ragnarok/insight call's
 * model must be chosen by the ONE resolver (aisha_resolve_clow_backend), per task,
 * from the live serviceable pool — NEVER ragnarok's compose DEFAULT_MODEL_*.
 *
 * ragnarok's /nlp/rag/ exposes a per-request `settings` override (rag.py honors
 * settings.retrieval.model + settings.generation), so AISHA-side callers MUST resolve
 * the model and inject it. This gate enforces that on the primary AISHA-facing RAG
 * path (orchestrationBridge story-consult enrichment) and on the resolver helper.
 *
 * NOTE (step 2, tracked separately): the kronos-shim (Maestro RAG) and svc-mcp-knowledge
 * paths are wired in a follow-up; until then ragnarok keeps a compose default for those
 * un-wired callers. This gate covers the path wired in step 1.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const read = (rel: string): string => {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
};

const BRIDGE = 'services/svc-ai-chat/src/lib/orchestrationBridge.ts';
const HELPER = 'services/svc-ai-chat/src/lib/ragnarokModelSelection.ts';

describe('GATE: AISHA-governed ragnarok model selection (no defaults)', () => {
  const bridge = read(BRIDGE);
  const helper = read(HELPER);

  it('the resolver helper exists', () => {
    expect(helper, `${HELPER} must exist`).not.toBe('');
  });

  it('orchestrationBridge resolves AISHA selection before the ragnarok RAG call', () => {
    expect(bridge).toMatch(/resolveRagnarokRetrievalSettings\(/);
  });

  it('orchestrationBridge injects the AISHA-resolved settings into the ragnarok request body', () => {
    expect(bridge).toMatch(/settings:\s*ragSettings/);
  });

  it('orchestrationBridge does NOT pin a model name on the ragnarok path (no default)', () => {
    // Scope to the ragnarok enrichment block; it must carry no hardcoded provider
    // model string — the model can ONLY arrive via the AISHA-resolved settings.
    const start = bridge.indexOf('routingDecision.useRagnarok');
    const end = bridge.indexOf('return bundle;', start);
    const ragBlock = start >= 0 && end > start ? bridge.slice(start, end) : bridge;
    expect(ragBlock, 'ragnarok block must not hardcode a model id').not.toMatch(
      /["'](gpt-[0-9o]|text-embedding-|claude-|gemini-)[^"']*["']/i,
    );
  });

  it('the resolver helper selects via the one resolver, by the embedding capability', () => {
    expect(helper).toMatch(/aisha_resolve_clow_backend/);
    expect(helper).toMatch(/task_kind:\s*["']embedding["']/);
  });

  it('the helper threads the live serviceable pool (key-truth), not an allow-list', () => {
    expect(helper).toMatch(/selectServiceableSlugs\(\)/);
  });

  it('the helper fails loud (returns null to skip) instead of a hardcoded default', () => {
    expect(helper).toMatch(/return null/);
    // and never names a concrete model as a fallback
    expect(helper).not.toMatch(/["'](gpt-[0-9o]|text-embedding-|claude-)[^"']*["']/i);
  });
});
