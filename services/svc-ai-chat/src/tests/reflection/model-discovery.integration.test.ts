/**
 * Model discovery — REAL-environment integration. discoverModels drives the real
 * upsert_discovered_model RPC over throwaway pg17 + PostgREST: a backend's live model
 * list lands in ai_model_registry with eval_status='pending' (immediately usable as
 * chat, refined later by self-test) — the discover→registry loop, no static roster.
 *
 * Run: npm run test:reflection:fullenv (skips offline).
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

import { discoverModels, type DiscoveryRpc } from '../../lib/modelDiscovery.js';

const BASE = process.env.POSTGREST_URL;
const TOKEN = process.env.POSTGREST_SERVICE_TOKEN;
const RUN = BASE && TOKEN ? describe : describe.skip;

async function q<T = unknown>(p: string): Promise<T> {
  const res = await fetch(`${BASE}/${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET ${p} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

const callRpc: DiscoveryRpc = async (fn, args) => {
  const res = await fetch(`${BASE}/rpc/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`POST rpc/${fn} → ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

RUN('model discovery — discover→registry over real DB', () => {
  it('a backend\'s live model list lands in ai_model_registry as discovered (eval_status=pending, chat-capable)', async () => {
    const newModel = 'discovered-test-model-zzz';
    const before = await q<Array<unknown>>(`ai_model_registry?model_id=eq.${newModel}&select=id`);
    expect(before, 'test model must not pre-exist').toHaveLength(0);

    const res = await discoverModels(callRpc, [
      { id: 'openai', healthCheck: async () => ({ models: [newModel, 'gpt-4o'] }) },
      { id: 'google', healthCheck: async () => ({ models: ['gemini-2.5-flash'] }) },
    ]);
    expect(res.discovered).toBe(3);
    expect(res.errors).toEqual([]);

    // The brand-new model is now DISCOVERED in the registry, pending eval, chat-usable.
    const row = await q<Array<{ eval_status: string; is_available: boolean; is_chat_capable: boolean; provider: string }>>(
      `ai_model_registry?model_id=eq.${newModel}&select=eval_status,is_available,is_chat_capable,provider`,
    );
    expect(row).toHaveLength(1);
    expect(row[0].eval_status).toBe('pending');
    expect(row[0].is_chat_capable).toBe(true);
    expect(row[0].is_available).toBe(true);
  });

  it('is idempotent — re-discovering the same model does not duplicate rows', async () => {
    const m = 'discovered-test-model-zzz';
    await discoverModels(callRpc, [{ id: 'openai', healthCheck: async () => ({ models: [m] }) }]);
    const rows = await q<Array<unknown>>(`ai_model_registry?model_id=eq.${m}&provider=eq.openai&select=id`);
    expect(rows).toHaveLength(1);
  });
});
