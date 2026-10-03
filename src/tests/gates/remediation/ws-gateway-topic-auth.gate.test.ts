/**
 * Remediation gate: GW-01 — the WebSocket gateway must authorize topic
 * subscriptions, cap subscriptions per client, guard Redis-message parsing,
 * and heartbeat dead sockets.
 *
 * CONTEXT
 *   services/ws-gateway/src/server.ts fans out Redis pub/sub events to
 *   authenticated WebSocket clients. The handshake authenticates the socket
 *   (4001 on bad JWT), but AFTER the handshake the client can subscribe to any
 *   topic string it likes, and the server trusts every Redis payload blindly.
 *
 * DEFECT (KNOWN-RED at HEAD)
 *   1) subscribe() performs NO authorization — any authenticated client can
 *      `{"type":"subscribe","topic":"ws:db:<anything>"}` and receive another
 *      user's / another tenant's event stream. There is no per-topic ACL keyed
 *      on the JWT sub / roles, and no default-deny for privileged topics.
 *   2) No MAX_TOPICS-per-client cap — a client can subscribe to unbounded
 *      topics (memory / Redis SUBSCRIBE amplification DoS).
 *   3) The Redis message handler does `JSON.parse(message)` with NO try/catch —
 *      a single malformed payload on any channel throws inside the ioredis
 *      'message' emitter and crashes the process.
 *   4) No server-side heartbeat — dead/half-open sockets are never pinged or
 *      terminated, so `clients` / `topicSubscribers` leak forever.
 *
 * CONTRACT (post-fix GREEN) — all four markers MUST be present in the
 * ws-gateway shipping source (server.ts and/or a sibling topic-auth module):
 *   A) A topic-authorization check keyed on the authenticated identity
 *      (sub / roles) is invoked in the subscribe path, and it default-denies
 *      privileged topics (ws:db:* / per-user topics).
 *   B) A MAX_TOPICS (or equivalent) per-client subscription cap is enforced.
 *   C) The Redis-message JSON.parse is wrapped in try/catch (parse failures
 *      are swallowed/logged, not fatal).
 *   D) A server-side heartbeat exists: a setInterval that pings sockets and
 *      terminates unresponsive ones.
 *
 * PATTERN gate: it walks the whole services/ws-gateway/src tree (excluding
 * tests) so the authorization logic may live in server.ts or a dedicated
 * topic-auth.ts module; the gate passes once all four markers exist anywhere
 * in shipping source.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const WS_SRC = path.join(ROOT, 'services/ws-gateway/src');

/** Recursively collect non-test TypeScript source files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (/\.(test|spec)\.ts$/.test(entry.name)) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

interface ScannedFile {
  rel: string;
  src: string;
}

const files: ScannedFile[] = collectSourceFiles(WS_SRC).map((f) => ({
  rel: path.relative(ROOT, f),
  src: fs.readFileSync(f, 'utf8'),
}));

/** Concatenated shipping source — markers may live in any ws-gateway module. */
const ALL = files.map((f) => f.src).join('\n');

describe('GW-01 — ws-gateway topic subscriptions are authorized, capped, guarded, and heartbeated', () => {
  it('sanity: ws-gateway src tree is present and scannable', () => {
    expect(fs.existsSync(WS_SRC), `${WS_SRC} must exist`).toBe(true);
    expect(files.length, 'expected ws-gateway .ts source files to scan').toBeGreaterThan(0);
  });

  it('MARKER A: topic subscriptions are AUTHORIZED against the JWT identity (default-deny)', () => {
    // An authorization decision function that (a) is named for topic auth and
    // (b) takes the caller identity (roles/userId/sub) into account. Accept a
    // range of reasonable names so the fix is free to choose its own module.
    const hasAuthzFn =
      /\b(authoriz|authoris)e?\w*[Tt]opic\b/.test(ALL) ||
      /\bcanSubscribe\b/.test(ALL) ||
      /\bassert(?:Can)?Subscribe\b/.test(ALL) ||
      /\bisTopicAllowed\b/.test(ALL) ||
      /\btopic[-_]?[Aa]uth\b/.test(ALL);
    expect(
      hasAuthzFn,
      'ws-gateway subscribe() must call a topic-authorization check (e.g. ' +
        'authorizeTopic / canSubscribe / isTopicAllowed) keyed on the ' +
        "authenticated identity. None found — any authenticated client can " +
        "subscribe to any topic (ws:db:* / another user's stream). Add a " +
        'topic-auth check (default-deny for privileged topics) and invoke it ' +
        'in subscribe().',
    ).toBe(true);

    // The check must actually consider the caller identity — roles or the JWT
    // subject — not just the topic string. Look for identity being passed to /
    // consulted by the authz logic.
    const usesIdentity = /\broles\b/.test(ALL) && /\b(userId|sub)\b/.test(ALL);
    expect(
      usesIdentity,
      'The topic-authorization decision must be keyed on the JWT identity ' +
        '(roles + sub/userId). The scanned source does not reference both, so ' +
        'authorization cannot be identity-aware.',
    ).toBe(true);
  });

  it('MARKER B: a MAX_TOPICS per-client subscription cap is enforced', () => {
    const hasCapConst = /\bMAX_?TOPICS\b|\bMAX_?SUBSCRIPTIONS\b/i.test(ALL);
    // The cap must be compared against the client's current subscription count,
    // i.e. a size/length guard exists near the subscribe path.
    const hasCapGuard =
      /subscriptions\.(size|length)\s*>=?/.test(ALL) ||
      /\.(size|length)\s*>=?\s*MAX_?TOPICS/i.test(ALL) ||
      /MAX_?TOPICS\s*<=?\s*/i.test(ALL);
    expect(
      hasCapConst && hasCapGuard,
      'ws-gateway must enforce a MAX_TOPICS-per-client cap (a MAX_TOPICS/' +
        'MAX_SUBSCRIPTIONS constant compared against the client subscription ' +
        'count in subscribe()). Not found — a client can subscribe to unbounded ' +
        'topics (memory / Redis SUBSCRIBE DoS).',
    ).toBe(true);
  });

  it('MARKER C: the Redis-message JSON.parse is wrapped in try/catch', () => {
    // Find the Redis 'message' handler and assert a try/catch guards the parse.
    // Cheap-but-robust proxy: the file that parses the Redis message must
    // contain a try/catch, and JSON.parse of the message must not sit at the
    // top level of the handler unguarded. We assert on structure: a try block
    // co-locates with the JSON.parse of the broadcast payload.
    const parsesRedisMessage = files.find((f) =>
      /redisSub\.on\(\s*['"]message['"]/.test(f.src) ||
      /\.on\(\s*['"]message['"]/.test(f.src),
    );
    expect(
      parsesRedisMessage,
      'Expected a ws-gateway module that handles the Redis pub/sub ' +
        "'message' event. None found.",
    ).toBeTruthy();

    const src = parsesRedisMessage!.src;
    // Isolate JUST the message-handler callback body: from `.on('message'` up to
    // the first `});` that closes the callback. Bounding to the callback avoids
    // false-passing on an unrelated try/catch elsewhere in the file (e.g.
    // verifyToken's try/catch further down).
    const handlerMatch = src.match(/\.on\(\s*['"]message['"][\s\S]*?\n\s*\}\);/);
    const handlerSlice = handlerMatch ? handlerMatch[0] : '';
    const parsesPayload = /JSON\.parse\s*\(/.test(handlerSlice);
    const hasTryCatch = /\btry\s*\{/.test(handlerSlice) && /\bcatch\b/.test(handlerSlice);
    expect(
      parsesPayload,
      'sanity: the Redis message handler is expected to JSON.parse the payload.',
    ).toBe(true);
    expect(
      hasTryCatch,
      "The Redis 'message' handler JSON.parse(message) is UNGUARDED — a single " +
        'malformed payload on any channel throws inside the ioredis emitter and ' +
        'crashes the gateway. Wrap the parse (and broadcast) in try/catch and ' +
        'log-and-drop on failure.',
    ).toBe(true);
  });

  it('MARKER D: a server-side heartbeat pings and terminates dead sockets', () => {
    const hasInterval = /\bsetInterval\s*\(/.test(ALL);
    const pings = /\.ping\s*\(/.test(ALL) || /isAlive\b/.test(ALL);
    const terminates = /\.terminate\s*\(/.test(ALL);
    expect(
      hasInterval && pings && terminates,
      'ws-gateway must run a server-side heartbeat: a setInterval that pings ' +
        '(ws.ping / isAlive flag) and terminates (ws.terminate) unresponsive ' +
        'sockets. Not found — dead/half-open sockets leak in clients / ' +
        'topicSubscribers forever.',
    ).toBe(true);
  });
});
