/**
 * Phase 12 WP 2.1 — Redis cache layer for embedding + query results.
 *
 * Consumes @aisha/cache-redis DB index 1 (per Phase 12 §-1.12 R2
 * — reuses aisha-shared-redis container, no new Redis).
 *
 * Caches:
 *   - Embeddings: hash(text + model) → vector blob, TTL 24 h
 *     Reuse across users for identical input text. Embeddings are
 *     deterministic per (text, model), so same vector for same input.
 *   - Query results: hash(query + profile + story_id + filter) → ranked
 *     chunks JSON, TTL 1 h. Per-tenant scoped via story_id in key.
 *
 * Invalidation: pub/sub channel `kb:invalidate:<story_id>` published
 * on knowledge_items INSERT/UPDATE/DELETE (server-side trigger or
 * application-level publish). Subscribers flush matching cache entries.
 *
 * Fail-open semantics (mirror of @aisha/cache-redis revocation):
 *   - Redis down → wrapper passes through to live computation
 *   - No mass failure when Redis hiccups
 *   - Cache miss is invisible to caller (returns null + lets caller fall back)
 */
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createNamespacedRedis } from '@aisha/cache-redis/client';

const KEY_EMB_PREFIX = 'emb:';
const KEY_QRY_PREFIX = 'q:';
const INVALIDATE_CHANNEL_PREFIX = 'kb:invalidate:';
const TTL_EMBEDDING_SEC = 86_400; // 24 h
const TTL_QUERY_SEC = 3_600; // 1 h

/** Cached embedding shape: vector + meta for cache-hit observability. */
export interface CachedEmbedding {
  vector: number[];
  model: string;
  cached_at: string;
}

/** Cached query result shape: chunks ranked by score + meta. */
export interface CachedQueryResult {
  chunks: Array<Record<string, unknown>>;
  count: number;
  cached_at: string;
}

/**
 * Stable hash of input(s) for cache key generation. Uses SHA-256 truncated
 * to 16 hex chars — enough entropy to avoid collisions at our scale
 * (~10^7 distinct keys would need ~10^11 collision probability).
 */
function hashKey(...inputs: ReadonlyArray<string | number | boolean | null>): string {
  const h = createHash('sha256');
  for (const input of inputs) {
    h.update(String(input));
    h.update('|'); // separator avoids `["a","bc"]` colliding with `["ab","c"]`
  }
  return h.digest('hex').slice(0, 16);
}

let cachedClient: Redis | null = null;
let clientInitialized = false;

/**
 * Lazy-init the Redis client. Returns null if AISHA_SHARED_REDIS_DISABLED
 * (per @aisha/cache-redis env contract) — callers must handle null
 * gracefully via the fail-open helpers below.
 */
function getRedis(): Redis | null {
  if (!clientInitialized) {
    cachedClient = createNamespacedRedis({
      db: 1,
      connectionName: 'svc-mcp-knowledge-cache',
    });
    clientInitialized = true;
  }
  return cachedClient;
}

/** Build the embedding cache key. */
export function buildEmbeddingKey(text: string, model: string): string {
  return KEY_EMB_PREFIX + hashKey(text, model);
}

/** Build the query result cache key. */
export function buildQueryKey(args: {
  query: string;
  profile: string;
  storyId: string | null;
  filter?: string | null;
}): string {
  return (
    KEY_QRY_PREFIX +
    hashKey(args.query, args.profile, args.storyId ?? '', args.filter ?? '')
  );
}

/**
 * Try to read a cached embedding. Returns null on miss, Redis error, or
 * disabled cache.
 */
export async function getCachedEmbedding(
  text: string,
  model: string,
): Promise<CachedEmbedding | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(buildEmbeddingKey(text, model));
    if (!raw) return null;
    return JSON.parse(raw) as CachedEmbedding;
  } catch {
    return null; // fail-open: pretend cache miss
  }
}

/**
 * Cache an embedding for 24 h. Best-effort — failure to cache is logged
 * but doesn't propagate (caller already has the vector).
 */
export async function setCachedEmbedding(
  text: string,
  model: string,
  vector: number[],
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const payload: CachedEmbedding = {
    vector,
    model,
    cached_at: new Date().toISOString(),
  };
  try {
    await redis.set(
      buildEmbeddingKey(text, model),
      JSON.stringify(payload),
      'EX',
      TTL_EMBEDDING_SEC,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to read a cached query result. Returns null on miss, Redis error,
 * or disabled cache.
 */
export async function getCachedQueryResult(args: {
  query: string;
  profile: string;
  storyId: string | null;
  filter?: string | null;
}): Promise<CachedQueryResult | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(buildQueryKey(args));
    if (!raw) return null;
    return JSON.parse(raw) as CachedQueryResult;
  } catch {
    return null;
  }
}

/**
 * Cache a query result for 1 h. Best-effort.
 */
export async function setCachedQueryResult(
  args: {
    query: string;
    profile: string;
    storyId: string | null;
    filter?: string | null;
  },
  chunks: ReadonlyArray<Record<string, unknown>>,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  const payload: CachedQueryResult = {
    chunks: [...chunks],
    count: chunks.length,
    cached_at: new Date().toISOString(),
  };
  try {
    await redis.set(
      buildQueryKey(args),
      JSON.stringify(payload),
      'EX',
      TTL_QUERY_SEC,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish an invalidation event for a story. Subscribers flush matching
 * query-result entries. Embedding entries are NOT invalidated (they're
 * deterministic per text+model and harmless to keep).
 *
 * Should be called by knowledge_items INSERT/UPDATE/DELETE triggers OR
 * by the upsert/delete RPCs from WP 8 (StoryKnowledgeTab).
 */
export async function publishInvalidation(storyId: string): Promise<boolean> {
  if (!storyId || typeof storyId !== 'string') return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    await redis.publish(INVALIDATE_CHANNEL_PREFIX + storyId, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to invalidation events for ALL stories. Calls back with the
 * story_id of each event so caller can flush matching cache entries.
 *
 * The returned function unsubscribes when called (graceful shutdown).
 * Subscriber uses a SEPARATE Redis connection (psubscribe blocks the
 * connection for other commands).
 */
export async function subscribeToInvalidations(
  onInvalidate: (storyId: string) => void,
): Promise<() => Promise<void>> {
  // Separate client — psubscribe blocks the connection
  const subscriber = createNamespacedRedis({
    db: 1,
    connectionName: 'svc-mcp-knowledge-cache-sub',
  });
  if (!subscriber) {
    // Cache disabled — return no-op unsubscribe
    return async () => {};
  }
  const pattern = INVALIDATE_CHANNEL_PREFIX + '*';
  await subscriber.psubscribe(pattern);
  subscriber.on('pmessage', (_pattern, channel) => {
    const storyId = channel.slice(INVALIDATE_CHANNEL_PREFIX.length);
    if (storyId) onInvalidate(storyId);
  });
  return async () => {
    try {
      await subscriber.punsubscribe(pattern);
    } catch {
      /* ignore */
    }
    subscriber.disconnect();
  };
}

/**
 * Flush all query-result cache entries for a story. Called by the
 * invalidation subscriber (or directly post-write for self-invalidation).
 *
 * Uses SCAN + DEL to avoid blocking Redis on large keyspaces (KEYS is O(N)).
 * Returns count of deleted entries.
 */
export async function invalidateStoryQueries(storyId: string): Promise<number> {
  const redis = getRedis();
  if (!redis || !storyId) return 0;
  // Story id is embedded inside the hash; we can't reverse-lookup by storyId
  // from the key alone. Pragmatic approach: maintain a secondary index set
  // `qry-index:<storyId>` → Set<cache-key> so we can flush precisely.
  //
  // BUT for v1 simplicity (this WP), we flush ALL query-result entries
  // on any invalidation — cache miss penalty is ~200ms per query and TTL
  // is only 1 h, so blast-radius is acceptable. WP 2.1b can add precise
  // indexing if cache-hit ratio drops too low.
  void storyId; // currently unused; reserved for v2 precise invalidation
  let deleted = 0;
  const stream = redis.scanStream({
    match: KEY_QRY_PREFIX + '*',
    count: 200,
  });
  for await (const keys of stream) {
    const k = keys as string[];
    if (k.length === 0) continue;
    await redis.del(...k);
    deleted += k.length;
  }
  return deleted;
}

/**
 * Cache stats for /metrics surface (Prometheus counters). Each value is
 * the latest snapshot — caller can poll periodically + publish to Grafana.
 */
export async function getCacheStats(): Promise<{
  embedding_keys: number;
  query_keys: number;
  enabled: boolean;
}> {
  const redis = getRedis();
  if (!redis) {
    return { embedding_keys: 0, query_keys: 0, enabled: false };
  }
  try {
    let embCount = 0;
    let qryCount = 0;
    const embStream = redis.scanStream({ match: KEY_EMB_PREFIX + '*', count: 500 });
    for await (const keys of embStream) embCount += (keys as string[]).length;
    const qryStream = redis.scanStream({ match: KEY_QRY_PREFIX + '*', count: 500 });
    for await (const keys of qryStream) qryCount += (keys as string[]).length;
    return { embedding_keys: embCount, query_keys: qryCount, enabled: true };
  } catch {
    return { embedding_keys: 0, query_keys: 0, enabled: true };
  }
}

/**
 * Test-only utility: clear ALL cache entries + dispose client. Called by
 * unit tests between runs. DO NOT call in production.
 */
export async function _resetCacheForTests(): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.flushdb();
      redis.disconnect();
    } catch {
      /* ignore */
    }
  }
  cachedClient = null;
  clientInitialized = false;
}
