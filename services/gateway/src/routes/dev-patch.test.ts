// dev-patch — commit navrženého patche přes GitHub REST API, fail-closed bez repa.
// LLM, PostgREST i GitHub jsou podstrčené přes globální fetch; SSRF guard je
// nahrazený záznamníkem, aby test viděl, KAM by guard pustil (bez DNS).
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { guardOptions } = vi.hoisted(() => {
  process.env.INTERNAL_API_KEY = 'svc-key-fixture';
  return { guardOptions: [] as Array<Record<string, unknown>> };
});

vi.mock('@aisha/security', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@aisha/security')>()),
  createSsrfGuard: (opts: Record<string, unknown>) => {
    guardOptions.push(opts);
    return { safeFetch: (url: string, init?: RequestInit) => fetch(url, init) };
  },
}));

const { devPatchRoutes } = await import('./dev-patch.js');

const LLM_URL = 'http://test-llm.invalid:8100';
const GITHUB_KEYS = ['GITHUB_API_URL', 'GITHUB_TOKEN', 'GITHUB_REPOSITORY', 'LOCAL_LLM_URL'] as const;
const saved: Record<string, string | undefined> = {};

type Call = { body?: unknown; headers: Record<string, string>; method: string; url: string };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

/** Podstrčený fetch: LLM vrátí jeden soubor, PostgREST přijme cokoli, GitHub podle `putStatus`. */
function installFetch(putStatus = 201): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ body, headers: { ...(init.headers as Record<string, string>) }, method, url });
    if (url.startsWith(LLM_URL)) {
      const content = JSON.stringify({
        commit_message: 'feat(x): navržená změna',
        files: [{ action: 'create', content: 'export const x = 1;\n', path: 'src/lib/x.ts' }],
        reasoning: 'proposal',
      });
      return jsonResponse(200, { choices: [{ message: { content } }] });
    }
    if (url.includes('/rpc/')) return jsonResponse(200, null);
    if (method === 'GET') return jsonResponse(404, { message: 'Not Found' });
    if (method === 'PUT') return jsonResponse(putStatus, putStatus < 300 ? { commit: { sha: 'abc123' } } : { message: 'boom' });
    return jsonResponse(500, {});
  }));
  return calls;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(devPatchRoutes);
  return app;
}

async function post(app: FastifyInstance, authorization = 'Bearer svc-key-fixture') {
  return app.inject({
    headers: { authorization },
    method: 'POST',
    payload: { branch: 'aisha/dev-patch-1', category: 'code', description: 'd', proposal_id: 'p-1', title: 'T' },
    url: '/dev-patch',
  });
}

function traceStatus(calls: Call[]): unknown {
  const trace = calls.find((c) => c.url.endsWith('/rpc/fn_log_ai_trace_event'));
  return (trace?.body as { p_status?: unknown } | undefined)?.p_status;
}

beforeEach(() => {
  for (const k of GITHUB_KEYS) saved[k] = process.env[k];
  process.env.LOCAL_LLM_URL = LLM_URL;
  guardOptions.length = 0;
});

afterEach(() => {
  for (const k of GITHUB_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('POST /dev-patch — GitHub commit', () => {
  it('bez GITHUB_REPOSITORY nic nezapíše: status not_configured, trace skipped, žádné volání GitHubu', async () => {
    delete process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_TOKEN = 'gh-token-fixture';
    const calls = installFetch();
    const app = await buildApp();
    try {
      const res = await post(app);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ commit_sha: '', status: 'not_configured' });
      expect(calls.filter((c) => c.url.includes('/repos/'))).toHaveLength(0);
      expect(guardOptions).toHaveLength(0);
      expect(traceStatus(calls)).toBe('skipped');
    } finally {
      await app.close();
    }
  });

  it('s deklarovaným repem zapíše přes contents API deklarovaného hostitele a vrátí sha commitu', async () => {
    process.env.GITHUB_REPOSITORY = 'octo-org/octo-repo';
    process.env.GITHUB_TOKEN = 'gh-token-fixture';
    process.env.GITHUB_API_URL = 'https://ghe.example.test/api/v3';
    const calls = installFetch();
    const app = await buildApp();
    try {
      const res = await post(app);
      expect(res.json()).toMatchObject({ commit_sha: 'abc123', status: 'applied' });
      const put = calls.find((c) => c.method === 'PUT');
      expect(put?.url).toBe('https://ghe.example.test/api/v3/repos/octo-org/octo-repo/contents/src/lib/x.ts');
      expect(put?.headers.Authorization).toBe('Bearer gh-token-fixture');
      expect(put?.headers.Accept).toBe('application/vnd.github+json');
      expect(put?.body).toMatchObject({ branch: 'aisha/dev-patch-1', message: 'feat(x): navržená změna' });
      expect(guardOptions).toEqual([
        expect.objectContaining({ allowedSchemes: ['https:'], hostAllowlist: ['ghe.example.test'] }),
      ]);
      expect(traceStatus(calls)).toBe('success');
    } finally {
      await app.close();
    }
  });

  it('neúspěšný zápis přizná: status commit_failed, trace error', async () => {
    process.env.GITHUB_REPOSITORY = 'octo-org/octo-repo';
    process.env.GITHUB_TOKEN = 'gh-token-fixture';
    delete process.env.GITHUB_API_URL;
    const calls = installFetch(500);
    const app = await buildApp();
    try {
      const res = await post(app);
      expect(res.json()).toMatchObject({ commit_sha: '', status: 'commit_failed' });
      expect(calls.find((c) => c.method === 'PUT')?.url).toBe(
        'https://api.github.com/repos/octo-org/octo-repo/contents/src/lib/x.ts',
      );
      expect(traceStatus(calls)).toBe('error');
    } finally {
      await app.close();
    }
  });

  it('bez interního klíče odmítne 403 a na nic nesáhne', async () => {
    process.env.GITHUB_REPOSITORY = 'octo-org/octo-repo';
    process.env.GITHUB_TOKEN = 'gh-token-fixture';
    const calls = installFetch();
    const app = await buildApp();
    try {
      const res = await post(app, 'Bearer wrong');
      expect(res.statusCode).toBe(403);
      expect(calls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});
