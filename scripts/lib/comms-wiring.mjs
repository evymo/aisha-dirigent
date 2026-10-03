// =============================================================================
// comms-wiring.mjs — structural scan of AISHA cross-component comms bindings
// =============================================================================
// AISHA's event fabric is wired by NAME across three unrelated source trees:
//   • Postgres NOTIFY producers  — `pg_notify('<chan>', …)` in aisha/db/sql/**
//   • Postgres LISTEN consumers  — the `pgChannels: […]` array in
//                                  services/event-worker/src/config.ts (the ONLY
//                                  runtime LISTENer; worker.ts does `LISTEN ${c}`)
//   • Redis pub/sub channels     — string literals across the services
//
// Nothing type-checks these names against each other, so a channel can be
// emitted with no listener (dropped NOTIFY) or listened-for with no emitter
// (dead subscription) and every unit test still passes. That drift is exactly
// what the 2026-07 application-flow-map surfaced (docs/architecture/
// APPLICATION_FLOW_MAP.md): 8 NOTIFY channels, 5 LISTEN channels, intersection
// of only `agent_run_queued`.
//
// This module DERIVES the current binding graph from source (there is no
// machine-readable catalog — the knowledge lived only in prose Markdown). The
// comms-wiring-consistency gate intersects the sets and holds the result against
// a ratcheting baseline (config/comms-wiring.baseline.json), so a NEW orphan
// fails CI and a FIXED orphan forces the baseline to shrink.
//
// Pure + dependency-free (node:fs / node:path only) so it runs anywhere the gate
// runs. SoT only — callers MUST scan `src/`, never the compiled `dist/` (the
// event-worker dist lags src and would under-report channels).
// =============================================================================
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

/** Walk a directory tree, returning absolute paths of files matching `test`. */
function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    // never descend into build output or vendored deps — src is the SoT
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

/** Strip a SQL `--` line comment so a channel mentioned in prose isn't counted
 *  as a real producer. (Block comments `/* *​/` are not used around pg_notify in
 *  this codebase; dedup-by-name makes an incidental extra match harmless.) */
function stripSqlLineComment(line) {
  const i = line.indexOf("--");
  return i === -1 ? line : line.slice(0, i);
}

const PG_NOTIFY_RE = /pg_notify\(\s*'([a-z_][a-z0-9_]*)'/g;

/**
 * Every Postgres NOTIFY producer, keyed by channel name.
 * @returns {Map<string, Array<{file: string, line: number}>>}
 */
export function scanPgNotifyProducers(root) {
  const sqlDir = join(root, "aisha", "db", "sql");
  const files = walk(sqlDir, (f) => extname(f) === ".sql");
  /** @type {Map<string, Array<{file:string,line:number}>>} */
  const producers = new Map();
  for (const file of files) {
    const rel = file.slice(root.length + 1);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((raw, idx) => {
      const line = stripSqlLineComment(raw);
      let m;
      PG_NOTIFY_RE.lastIndex = 0;
      while ((m = PG_NOTIFY_RE.exec(line)) !== null) {
        const chan = m[1];
        if (!producers.has(chan)) producers.set(chan, []);
        producers.get(chan).push({ file: rel, line: idx + 1 });
      }
    });
  }
  return producers;
}

/**
 * Every Postgres LISTEN consumer channel (the event-worker `pgChannels` array).
 * @returns {Set<string>}
 */
export function scanPgListenConsumers(root) {
  const cfg = join(root, "services", "event-worker", "src", "config.ts");
  if (!existsSync(cfg)) return new Set();
  const src = readFileSync(cfg, "utf8");
  // capture the pgChannels array body, then pull every quoted literal from it
  const block = src.match(/pgChannels:\s*\[([\s\S]*?)\]/);
  if (!block) return new Set();
  const chans = block[1].match(/'([a-z_][a-z0-9_]*)'/g) || [];
  return new Set(chans.map((c) => c.replace(/'/g, "")));
}

/**
 * Intersect the PG NOTIFY producers with the LISTEN consumers.
 * @returns {{matched: string[], producerWithoutConsumer: string[], consumerWithoutProducer: string[], producers: Map<string, Array<{file:string,line:number}>>, consumers: Set<string>}}
 */
export function computePgOrphans(root) {
  const producers = scanPgNotifyProducers(root);
  const consumers = scanPgListenConsumers(root);
  const producerNames = new Set(producers.keys());

  const matched = [];
  const producerWithoutConsumer = [];
  const consumerWithoutProducer = [];

  for (const p of producerNames) {
    if (consumers.has(p)) matched.push(p);
    else producerWithoutConsumer.push(p);
  }
  for (const c of consumers) {
    if (!producerNames.has(c)) consumerWithoutProducer.push(c);
  }
  const sort = (a) => a.sort();
  return {
    matched: sort(matched),
    producerWithoutConsumer: sort(producerWithoutConsumer),
    consumerWithoutProducer: sort(consumerWithoutProducer),
    producers,
    consumers,
  };
}

/**
 * Which service source files reference a given Redis channel literal. Used to
 * prove a statically-named subscription (e.g. `ws:db_changes`) has NO publisher:
 * if the literal appears only under the consumer service, nobody emits it.
 * Scans services/**​/src (excluding tests), matches the literal in "…" or '…'.
 * @returns {Array<{file: string, line: number}>}
 */
export function scanRedisLiteralUsage(root, literal) {
  const svcDir = join(root, "services");
  const files = walk(
    svcDir,
    (f) =>
      /\.(ts|mjs|js)$/.test(f) &&
      !/\.(test|spec)\./.test(f) &&
      !f.includes(`${join("src", "tests")}`),
  );
  const needle = new RegExp(`['"]${literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`);
  /** @type {Array<{file:string,line:number}>} */
  const hits = [];
  for (const file of files) {
    const rel = file.slice(root.length + 1);
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, idx) => {
        if (needle.test(line)) hits.push({ file: rel, line: idx + 1 });
      });
  }
  return hits;
}

/** True if any `.publish(` call site references this Redis literal (a producer). */
export function redisLiteralHasPublisher(root, literal) {
  return scanRedisLiteralUsage(root, literal).some((h) => {
    const src = readFileSync(join(root, h.file), "utf8").split("\n")[h.line - 1] || "";
    return /\.publish\s*\(/.test(src);
  });
}
