/**
 * TtlCache — minimal in-process freshness cache for the live source-read path.
 *
 * Default backing for source-read.ts: read-through with a short TTL sized to the
 * source's real cadence (minutes for KPIs/engagement, not per-request). A
 * deployment that needs cross-replica caching + event-driven invalidation swaps
 * this for @aisha/cache-redis behind the same get/set/invalidate shape (the
 * dormant svc-mcp-knowledge cacheLayer read-through + kb:invalidate pattern),
 * at which point /webhook/source publishes an invalidation on source change.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  /** Event-driven invalidation hook (called on /webhook/source change). */
  invalidate(prefix: string): number {
    let n = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        n += 1;
      }
    }
    return n;
  }
}
