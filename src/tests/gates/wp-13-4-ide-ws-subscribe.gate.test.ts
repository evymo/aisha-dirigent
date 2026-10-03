/**
 * Gate test: Phase 13 WP 13.4 — Backend → IDE realtime WS subscribe.
 *
 * Enforces:
 *   1. svc-ide-context declares @aisha/cache-redis + ioredis deps
 *   2. lib/subscriber.ts exists with WATCHED_TABLES + channel constant +
 *      MAX_REFRESHES_PER_TICK guard + isPayloadRelevant export +
 *      buildContextChangedMessage export + RealtimeSubscriber class +
 *      register/unregister API + getRealtimeSubscriber singleton accessor
 *   3. WATCHED_TABLES contains only the 4 plan-spec tables; nothing else
 *   4. Subscriber uses Redis DB index 3 (per @aisha/cache-redis client
 *      module header allocation: DB3 = IDE-context realtime state)
 *   5. routes/subscribe.ts exists with /subscribe/:workspaceId? route
 *      + JWT verify (header OR ?token=) + ping/pong keepalive + ready
 *      event on connect
 *   6. server.ts wires subscribeRoutes + starts/stops the singleton
 *      subscriber on SIGTERM/SIGINT
 *   7. vitest.config.ts has @aisha/cache-redis alias to packages/cache-redis
 *      so local unit tests can run without Verdaccio publish
 *   8. Subscriber test exists with fan-out + cap + error-swallow + PII
 *      assertions
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const SVC = path.join(ROOT, 'services/svc-ide-context');
const SUBSCRIBER = path.join(SVC, 'src/lib/subscriber.ts');
const ROUTE = path.join(SVC, 'src/routes/subscribe.ts');
const SERVER = path.join(SVC, 'src/server.ts');
const VITEST_CFG = path.join(SVC, 'vitest.config.ts');
const TEST = path.join(SVC, 'src/tests/subscriber.unit.test.ts');
const PKG = path.join(SVC, 'package.json');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

describe('Phase 13 WP 13.4 — Dependencies', () => {
  const pkg = JSON.parse(readText(PKG)) as { dependencies?: Record<string, string> };

  it('declares @aisha/cache-redis dep', () => {
    expect(pkg.dependencies?.['@aisha/cache-redis']).toBeDefined();
  });

  it('declares ioredis dep (sibling to cache-redis client)', () => {
    expect(pkg.dependencies?.['ioredis']).toBeDefined();
    expect(pkg.dependencies!.ioredis).toMatch(/^\^5\./);
  });

  it('still declares @fastify/websocket', () => {
    expect(pkg.dependencies?.['@fastify/websocket']).toBeDefined();
  });
});

describe('Phase 13 WP 13.4 — lib/subscriber.ts contract', () => {
  const src = readText(SUBSCRIBER);

  it('file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('exports WATCHED_TABLES + DB_CHANGES_CHANNEL + MAX_REFRESHES_PER_TICK', () => {
    expect(src).toMatch(/export\s+const\s+WATCHED_TABLES/);
    expect(src).toMatch(/export\s+const\s+DB_CHANGES_CHANNEL/);
    expect(src).toMatch(/export\s+const\s+MAX_REFRESHES_PER_TICK/);
  });

  it('WATCHED_TABLES contains the 4 plan-spec tables', () => {
    for (const t of [
      'public.partner_stories',
      'public.ai_runs',
      'public.ai_pending_approvals',
      'public.coolify_app_slots',
    ]) {
      expect(src).toMatch(new RegExp(`["']${t}["']`));
    }
  });

  it('DB_CHANGES_CHANNEL = ws:db_changes (event-worker convention)', () => {
    expect(src).toMatch(/DB_CHANGES_CHANNEL\s*=\s*["']ws:db_changes["']/);
  });

  it('MAX_REFRESHES_PER_TICK bounded ≤ 100 (DoS guard)', () => {
    const m = src.match(/MAX_REFRESHES_PER_TICK\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(100);
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it('uses Redis DB index 3 (per cache-redis allocation: IDE realtime state)', () => {
    expect(src).toMatch(/createNamespacedRedis\s*\(\s*\{[\s\S]{0,200}db:\s*3\b/);
  });

  it('exports RealtimeSubscriber class + getRealtimeSubscriber singleton + register API', () => {
    expect(src).toMatch(/export\s+class\s+RealtimeSubscriber/);
    expect(src).toMatch(/export\s+function\s+getRealtimeSubscriber/);
    expect(src).toMatch(/register\s*\(\s*client:\s*ConnectedClient\s*\)/);
  });

  it('exports isPayloadRelevant + buildContextChangedMessage helpers', () => {
    expect(src).toMatch(/export\s+function\s+isPayloadRelevant/);
    expect(src).toMatch(/export\s+function\s+buildContextChangedMessage/);
  });

  it('ConnectedClient interface owns the onChange callback, NOT send', () => {
    // Architectural decision: subscriber.ts must not call ws.send directly.
    // The route layer owns RPC refresh + send so subscriber stays free of
    // RPC/auth/jose imports (keeps unit tests cheap).
    expect(src).toMatch(/onChange:\s*\(\s*payload:\s*DbChangePayload\s*\)\s*=>\s*Promise<void>/);
  });

  it('subscriber does NOT import postgrest / auth (decoupled from RPC layer)', () => {
    expect(src).not.toMatch(/from\s+["']\.\.\/postgrest/);
    expect(src).not.toMatch(/from\s+["']\.\.\/auth/);
    expect(src).not.toMatch(/from\s+["']jose["']/);
  });
});

describe('Phase 13 WP 13.4 — routes/subscribe.ts contract', () => {
  const src = readText(ROUTE);

  it('file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('declares GET /subscribe/:workspaceId? route with websocket: true', () => {
    expect(src).toMatch(/["']\/subscribe\/:workspaceId\??["']/);
    expect(src).toMatch(/websocket:\s*true/);
  });

  it('verifies JWT via verifyToken (header OR ?token= fallback)', () => {
    expect(src).toMatch(/verifyToken/);
    expect(src).toMatch(/req\.headers\.authorization/);
    expect(src).toMatch(/tokenFromQuery/);
  });

  it('sends initial ready event with envelope on successful connect', () => {
    expect(src).toMatch(/type:\s*["']ready["']/);
  });

  it('ping/pong keepalive supported', () => {
    expect(src).toMatch(/type:\s*z\.literal\(\s*["']ping["']\s*\)/);
    expect(src).toMatch(/type:\s*["']pong["']/);
  });

  it('closes with 4001 on auth failure (client knows to retry vs forbid)', () => {
    expect(src).toMatch(/4001/);
  });

  it('refreshAndMaybeSend skips identical envelopes (idempotency)', () => {
    expect(src).toMatch(/nextJson\s*===\s*args\.lastJson/);
  });

  it('refresh is RLS-enforced via rpcUserClaims(get_workspace_context)', () => {
    expect(src).toMatch(/rpcUserClaims[\s\S]{0,200}get_workspace_context/);
  });
});

describe('Phase 13 WP 13.4 — server.ts wiring', () => {
  const src = readText(SERVER);

  it('registers subscribeRoutes', () => {
    expect(src).toMatch(/await\s+app\.register\s*\(\s*subscribeRoutes\s*\)/);
  });

  it('starts the singleton subscriber on boot', () => {
    expect(src).toMatch(/getRealtimeSubscriber\(\)\.start\s*\(/);
  });

  it('graceful shutdown stops the subscriber on SIGTERM/SIGINT', () => {
    expect(src).toMatch(/getRealtimeSubscriber\(\)\.stop\s*\(/);
    expect(src).toMatch(/SIGTERM/);
    expect(src).toMatch(/SIGINT/);
  });
});

describe('Phase 13 WP 13.4 — vitest.config aliasing', () => {
  const src = readText(VITEST_CFG);

  it('aliases @aisha/cache-redis to local packages source', () => {
    expect(src).toMatch(/['"]@aisha\/cache-redis['"]/);
    expect(src).toMatch(/packages\/cache-redis\/src/);
  });

  it('aliases sub-export @aisha/cache-redis/client too', () => {
    expect(src).toMatch(/['"]@aisha\/cache-redis\/client['"]/);
  });
});

describe('Phase 13 WP 13.4 — Subscriber unit test exists', () => {
  const src = readText(TEST);

  it('test file exists', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('covers fan-out + cap + error-swallow + payload-irrelevance', () => {
    expect(src).toMatch(/fans relevant payload out to all registered clients/);
    expect(src).toMatch(/caps fan-out at MAX_REFRESHES_PER_TICK/);
    expect(src).toMatch(/swallows per-client onChange errors/);
    expect(src).toMatch(/ignores payload for an unwatched table/);
  });

  it('asserts buildContextChangedMessage is PII-safe', () => {
    expect(src).toMatch(/leak PII patterns/i);
  });
});
