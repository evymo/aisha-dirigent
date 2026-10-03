/**
 * shared-redis ACL freshness — unit gate for detectStaleAcl.
 *
 * Guards the decision core of scripts/verify-shared-redis-acl-fresh.mjs, which
 * catches the 2026-07-05 incident: REDIS_PASSWORD_CORE rotated in the Coolify
 * env but aisha-shared-redis not redeployed → its baked ACL kept the old
 * password → every consumer NOAUTH crash-looped silently.
 *
 * The rule: after a secret rotates, only apps redeployed SINCE the rotation
 * carry the new value; any carrier (producer or consumer) whose last deploy
 * predates the rotation — or whose deploy time is unknown — is a straggler.
 *
 * Spouští se přes: npm run test:gates -- shared-redis-acl-freshness
 */

import { describe, test, expect } from "vitest";
import { resolve } from "path";
import { pathToFileURL } from "url";

const MOD = resolve(process.cwd(), "scripts", "verify-shared-redis-acl-fresh.mjs");
const load = () => import(pathToFileURL(MOD).href);

describe("detectStaleAcl", () => {
  test("all carriers deployed AFTER rotation → fresh", async () => {
    const { detectStaleAcl } = await load();
    const r = detectStaleAcl({
      secret: "REDIS_PASSWORD_CORE",
      updatedAt: "2026-07-05T06:01:00Z",
      apps: [
        { name: "aisha-shared-redis", deployedAt: "2026-07-05T14:37:00Z" },
        { name: "aisha-realtime", deployedAt: "2026-07-05T14:38:00Z" },
        { name: "aisha-core", deployedAt: "2026-07-05T13:05:00Z" },
      ],
    });
    expect(r.stale).toBe(false);
    expect(r.stragglers).toEqual([]);
  });

  test("the incident: producer redeployed BEFORE the rotation → stale, producer is the straggler", async () => {
    const { detectStaleAcl } = await load();
    const r = detectStaleAcl({
      secret: "REDIS_PASSWORD_CORE",
      updatedAt: "2026-07-05T06:01:00Z",
      apps: [
        // shared-redis last deployed at 00:30 — BEFORE the 06:01 rotation → ACL stale
        { name: "aisha-shared-redis", deployedAt: "2026-07-05T00:30:00Z" },
        { name: "aisha-realtime", deployedAt: "2026-07-05T14:38:00Z" },
      ],
    });
    expect(r.stale).toBe(true);
    expect(r.stragglers).toEqual(["aisha-shared-redis"]);
  });

  test("a consumer redeployed before rotation is also a straggler", async () => {
    const { detectStaleAcl } = await load();
    const r = detectStaleAcl({
      secret: "REDIS_PASSWORD_CORE",
      updatedAt: "2026-07-05T06:01:00Z",
      apps: [
        { name: "aisha-shared-redis", deployedAt: "2026-07-05T07:00:00Z" },
        { name: "aisha-realtime", deployedAt: "2026-07-04T23:00:00Z" }, // stale consumer
      ],
    });
    expect(r.stale).toBe(true);
    expect(r.stragglers).toEqual(["aisha-realtime"]);
  });

  test("unknown deploy time is treated as a straggler (fail-loud on uncertainty)", async () => {
    const { detectStaleAcl } = await load();
    const r = detectStaleAcl({
      secret: "REDIS_PASSWORD_CORE",
      updatedAt: "2026-07-05T06:01:00Z",
      apps: [{ name: "aisha-shared-redis", deployedAt: null }],
    });
    expect(r.stale).toBe(true);
    expect(r.stragglers).toEqual(["aisha-shared-redis"]);
  });

  test("no rotation timestamp → not stale (nothing to compare)", async () => {
    const { detectStaleAcl } = await load();
    const r = detectStaleAcl({ secret: "REDIS_PASSWORD_CORE", updatedAt: "", apps: [{ name: "x", deployedAt: null }] });
    expect(r.stale).toBe(false);
    expect(r.reason).toMatch(/rotation timestamp/);
  });

  test("boundary: deploy exactly at rotation time is NOT stale (>= is fresh)", async () => {
    const { detectStaleAcl } = await load();
    const r = detectStaleAcl({
      secret: "REDIS_PASSWORD_CORE",
      updatedAt: "2026-07-05T06:01:00Z",
      apps: [{ name: "aisha-shared-redis", deployedAt: "2026-07-05T06:01:00Z" }],
    });
    expect(r.stale).toBe(false);
  });
});
