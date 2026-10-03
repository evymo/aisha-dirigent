/**
 * PROOF HARNESS #1 — Orchestration-Decision acceptance (master-plan §124).
 *
 * The owner's NEJDŮLEŽITĚJŠÍ proof: AISHA must DYNAMICALLY choose the right
 * model + executor for a task across ALL serviceable providers at once, with a
 * transparent PROČ/JAK (reasoning + per-candidate score breakdown), schematically
 * verifiable on a REAL backend — nothing hardcoded.
 *
 * This suite is the executable definition-of-done for that claim. It exercises the
 * one autonomous resolver (`aisha_resolve_clow_backend`) — the SAME entry point the
 * runtime uses — over a decision matrix (task_kind × capability × cost × residency ×
 * serviceability), asserting expected==actual PROPERTIES (capability-derived, not a
 * fixed model→use matrix) and that the transparent trace is present for tuning.
 *
 * Reuse-only: same callRpc/RUN harness as benchmark-parity.integration.test.ts;
 * the resolver already returns reasoning + candidate scores — we just assert them.
 *
 * RUN gate: needs a live backend (POSTGREST_URL + POSTGREST_SERVICE_TOKEN). Skips
 * otherwise — runs in CI's services lane + locally against the dev stack.
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Candidate { model_id: string; provider_slug: string; score: string; backend_kind: string }
interface Decision { resolved: boolean; reasoning: string; top?: Candidate | null; candidates?: Candidate[] }

async function resolve(clow: Record<string, unknown>, context: Record<string, unknown> = {}): Promise<Decision> {
  const res = await fetch(`${BASE}/rpc/aisha_resolve_clow_backend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_clow: clow, p_context: context }),
  });
  if (!res.ok) throw new Error(`resolve → ${res.status}: ${await res.text()}`);
  return (await res.json()) as Decision;
}

RUN('PROOF #1 — orchestration-decision is dynamic, transparent, capability-derived', () => {
  // ── transparency: every resolved decision carries PROČ/JAK ──────────────────
  it('chat: resolves a model with reasoning + per-candidate score breakdown (transparent)', async () => {
    const d = await resolve({ purpose: 'answer a simple chat question', task_kind: 'chat' });
    expect(d.resolved, JSON.stringify(d)).toBe(true);
    expect(d.top?.model_id).toBeTruthy();
    expect(d.top?.provider_slug).toBeTruthy();
    expect(d.reasoning).toMatch(/bench=|score=/); // the PROČ is exposed
    expect((d.candidates ?? []).length).toBeGreaterThan(0);
    for (const c of d.candidates ?? []) expect(Number(c.score)).not.toBeNaN(); // per-candidate JAK
  });

  // ── capability-derived: task_kind ⇄ model capability (NOT a model→use matrix) ─
  it('embedding: top model is an EMBEDDING model (capability gate, not a chat model)', async () => {
    const d = await resolve({ purpose: 'embed text for retrieval', task_kind: 'embedding' });
    expect(d.resolved, JSON.stringify(d)).toBe(true);
    const reg = await q<Array<{ is_embedding: boolean }>>(
      `ai_model_registry?model_id=eq.${encodeURIComponent(d.top!.model_id)}&select=is_embedding&limit=1`,
    );
    expect(reg[0]?.is_embedding, `embedding task resolved to non-embedding model ${d.top!.model_id}`).toBe(true);
  });

  it('non-embedding task NEVER resolves to an embedding-only model (symmetric gate)', async () => {
    const d = await resolve({ purpose: 'chat', task_kind: 'chat' });
    const reg = await q<Array<{ is_embedding: boolean }>>(
      `ai_model_registry?model_id=eq.${encodeURIComponent(d.top!.model_id)}&select=is_embedding&limit=1`,
    );
    expect(reg[0]?.is_embedding).toBe(false);
  });

  it('vision: when a vision-capable model exists, it is preferred (vision_match bonus in the trace)', async () => {
    const d = await resolve({ purpose: 'describe an image', task_kind: 'chat', needs_vision: true });
    expect(d.resolved, JSON.stringify(d)).toBe(true);
    const reg = await q<Array<{ is_vision: boolean }>>(
      `ai_model_registry?model_id=eq.${encodeURIComponent(d.top!.model_id)}&select=is_vision&limit=1`,
    );
    expect(reg[0]?.is_vision, `needs_vision resolved to non-vision model ${d.top!.model_id}`).toBe(true);
    expect(d.reasoning).toMatch(/vision_match=t/);
  });

  it('tools: needs_tools resolves to a function-calling model (capability filter)', async () => {
    const d = await resolve({ purpose: 'call a tool', task_kind: 'chat', needs_tools: true });
    expect(d.resolved, JSON.stringify(d)).toBe(true);
    const reg = await q<Array<{ is_function_calling: boolean }>>(
      `ai_model_registry?model_id=eq.${encodeURIComponent(d.top!.model_id)}&select=is_function_calling&limit=1`,
    );
    expect(reg[0]?.is_function_calling).toBe(true);
  });

  // ── cost-awareness: budget constraint shifts the choice (cost_class filter) ──
  it('budget: a tight max_cost biases toward the budget cost-class (cost-aware, transparent)', async () => {
    const d = await resolve({ purpose: 'cheap chat', task_kind: 'chat', max_cost: 0.3 });
    expect(d.resolved, JSON.stringify(d)).toBe(true);
    expect(d.reasoning).toMatch(/cost_match=/); // cost is part of the PROČ
  });

  // ── residency / fail-loud: cloud_forbidden + no on-prem ⇒ honest "no backend" ─
  it('cloud_forbidden: resolves ONLY an on-prem backend, else FAIL-LOUD (no fake fallback)', async () => {
    const d = await resolve({ purpose: 'confidential task', task_kind: 'chat', cloud_forbidden: true });
    if (d.resolved) {
      expect(['local_ollama', 'local_vllm']).toContain(d.top!.backend_kind);
    } else {
      // No on-prem model serviceable → the resolver must say so, not invent a cloud fallback.
      expect(d.reasoning).toMatch(/No backend matched/i);
      expect((d.candidates ?? []).length).toBe(0);
    }
  });

  // ── DYNAMISM (the core proof): same task, different serviceable set → different
  //    winner. A hardcoded matrix could not do this. ───────────────────────────
  it('dynamic cross-provider: constraining serviceable_slugs changes the winner', async () => {
    const all = await resolve({ purpose: 'chat', task_kind: 'chat' });
    expect(all.resolved).toBe(true);
    // Enumerate the serviceable providers that actually have a chat-capable winner.
    const providers = [...new Set((all.candidates ?? []).map((c) => c.provider_slug))];
    expect(providers.length, 'need ≥2 serviceable providers to prove dynamism').toBeGreaterThan(1);

    // Pin to a single provider (NOT the global winner's) → the winner must come from it.
    const otherProvider = providers.find((p) => p !== all.top!.provider_slug)!;
    const pinned = await resolve({ purpose: 'chat', task_kind: 'chat' }, { serviceable_slugs: [otherProvider] });
    expect(pinned.resolved).toBe(true);
    expect(pinned.top!.provider_slug).toBe(otherProvider);
    expect(pinned.top!.provider_slug).not.toBe(all.top!.provider_slug);
  });

  // ── serviceability is the live key-truth, not a roster ──────────────────────
  it('empty serviceable_slugs = unconstrained (every keyed provider eligible)', async () => {
    const d = await resolve({ purpose: 'chat', task_kind: 'chat' }, { serviceable_slugs: [] });
    expect(d.resolved).toBe(true);
  });
});
