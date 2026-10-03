/**
 * Comms-wiring structural self-consistency gate
 *
 * AISHA's event fabric is wired by NAME across three unrelated source trees —
 * Postgres NOTIFY producers (aisha/db/sql/**), the event-worker LISTEN set
 * (services/event-worker/src/config.ts), and Redis channel literals. Nothing
 * type-checks those names against each other, so a channel can be emitted with
 * no listener (dropped NOTIFY) or listened-for with no emitter (dead
 * subscription) while every unit test stays green. That is the whole class of
 * "silently dead wire" the 2026-07 application-flow-map surfaced.
 *
 * This gate makes that invariant enforceable. It DERIVES the current binding
 * graph from source (scripts/lib/comms-wiring.mjs) and intersects it, then holds
 * the orphan set against a ratcheting baseline (config/comms-wiring.baseline.json):
 *
 *   • a NEW orphan not in the baseline FAILS — wire it, or record it in the
 *     baseline with a tracking reference (drift caught by a script, not a
 *     reviewer's attention span);
 *   • a baselined orphan that is no longer orphaned FAILS — it got wired, so the
 *     baseline must shrink (the debt ratchets DOWN, never silently lingers);
 *   • every binding the baseline names must still resolve to real source (no
 *     stale file paths / renamed channels).
 *
 * The one healthy channel (agent_run_queued) is asserted wired end-to-end, which
 * proves the scanner actually detects wiring — so fixing any orphan really does
 * trip the ratchet. Inspired by Forge's forge_lint.py structural check; adapted
 * to AISHA's own comms graph, not copied.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  computePgOrphans,
  scanRedisLiteralUsage,
  redisLiteralHasPublisher,
} from "../../../scripts/lib/comms-wiring.mjs";

const ROOT = process.cwd();
const BASELINE_PATH = "config/comms-wiring.baseline.json";

interface PgEntry {
  channel: string;
  producer?: string;
  consumer?: string;
  tracking: string;
  reason: string;
}
interface RedisEntry {
  channel: string;
  consumer: string;
  tracking: string;
  reason: string;
}
interface Baseline {
  pg_event_fabric: {
    producer_without_consumer: PgEntry[];
    consumer_without_producer: PgEntry[];
  };
  redis_channels: { subscriber_without_publisher: RedisEntry[] };
}

const baseline: Baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), "utf8"));
const sorted = (a: string[]) => [...a].sort();
const REGEN =
  "update config/comms-wiring.baseline.json — wire the channel, or record it there with a tracking reference";

describe("comms-wiring: Postgres event fabric has no undocumented orphan", () => {
  const orphans = computePgOrphans(ROOT);
  const baseProducers = sorted(baseline.pg_event_fabric.producer_without_consumer.map((e) => e.channel));
  const baseConsumers = sorted(baseline.pg_event_fabric.consumer_without_producer.map((e) => e.channel));

  test("scan finds the expected producer/consumer trees (SoT, not dist)", () => {
    // If either tree scans empty the gate is blind — fail loud rather than green.
    expect(orphans.producers.size, "no pg_notify producers found — did aisha/db/sql move?").toBeGreaterThan(0);
    expect(orphans.consumers.size, "no LISTEN channels found — did event-worker config.ts move?").toBeGreaterThan(0);
  });

  test("every NOTIFY producer with no LISTENer is a KNOWN orphan (no new drift)", () => {
    const isNew = orphans.producerWithoutConsumer.filter((c) => !baseProducers.includes(c));
    expect(
      isNew,
      `NEW producer-without-consumer channel(s) — a pg_notify('${isNew[0] ?? "…"}') with no LISTENer. ${REGEN}.`,
    ).toEqual([]);
  });

  test("every LISTEN channel with no producer is a KNOWN orphan (no new drift)", () => {
    const isNew = orphans.consumerWithoutProducer.filter((c) => !baseConsumers.includes(c));
    expect(
      isNew,
      `NEW consumer-without-producer channel(s) — event-worker LISTENs '${isNew[0] ?? "…"}' but nothing emits it. ${REGEN}.`,
    ).toEqual([]);
  });

  test("baselined orphans are STILL orphaned — fixed ones must be removed (ratchet down)", () => {
    const fixedProducers = baseProducers.filter((c) => !orphans.producerWithoutConsumer.includes(c));
    const fixedConsumers = baseConsumers.filter((c) => !orphans.consumerWithoutProducer.includes(c));
    expect(
      [...fixedProducers, ...fixedConsumers],
      `channel(s) are now wired — remove them from ${BASELINE_PATH} so the baseline ratchets down`,
    ).toEqual([]);
  });

  test("agent_run_queued is genuinely wired end-to-end (proves the scanner detects wiring)", () => {
    expect(orphans.matched, "the one known-good channel is missing — the scan is broken").toContain("agent_run_queued");
    expect(baseProducers).not.toContain("agent_run_queued");
    expect(baseConsumers).not.toContain("agent_run_queued");
  });

  test("every baselined PG orphan resolves to real source (no stale entry)", () => {
    const stale: string[] = [];
    for (const e of baseline.pg_event_fabric.producer_without_consumer) {
      const p = e.producer && join(ROOT, e.producer);
      if (!p || !existsSync(p) || !readFileSync(p, "utf8").includes(`pg_notify('${e.channel}'`)) {
        stale.push(`producer ${e.channel} → ${e.producer}`);
      }
    }
    for (const e of baseline.pg_event_fabric.consumer_without_producer) {
      const c = e.consumer && join(ROOT, e.consumer);
      if (!c || !existsSync(c) || !readFileSync(c, "utf8").includes(`'${e.channel}'`)) {
        stale.push(`consumer ${e.channel} → ${e.consumer}`);
      }
    }
    expect(stale, `stale baseline entr(ies) — the cited site no longer emits/listens the channel: ${stale.join("; ")}`).toEqual([]);
  });

  test("every baselined orphan carries a tracking reference and a reason", () => {
    const all = [
      ...baseline.pg_event_fabric.producer_without_consumer,
      ...baseline.pg_event_fabric.consumer_without_producer,
    ];
    const bare = all.filter((e) => !e.tracking || !e.reason).map((e) => e.channel);
    expect(bare, `baseline entr(ies) missing tracking/reason: ${bare.join(", ")} — silencing a break without a reason defeats the gate`).toEqual([]);
  });
});

describe("comms-wiring: statically-named Redis subscriptions have a publisher", () => {
  const baseRedis = baseline.redis_channels.subscriber_without_publisher;

  test("each baselined subscriber-without-publisher is STILL publisher-less (ratchet)", () => {
    const nowWired = baseRedis
      .filter((e) => redisLiteralHasPublisher(ROOT, e.channel))
      .map((e) => e.channel);
    expect(
      nowWired,
      `Redis channel(s) now have a publisher — remove from ${BASELINE_PATH} so the baseline ratchets down`,
    ).toEqual([]);
  });

  test("each baselined Redis subscription still resolves to its consumer source", () => {
    const stale: string[] = [];
    for (const e of baseRedis) {
      const sites = scanRedisLiteralUsage(ROOT, e.channel);
      if (!sites.some((s) => s.file === e.consumer)) {
        stale.push(`${e.channel} → ${e.consumer}`);
      }
    }
    expect(stale, `stale Redis baseline entr(ies): ${stale.join("; ")}`).toEqual([]);
  });
});
