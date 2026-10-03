/**
 * Gate: every JVM-backed compose service caps its container memory.
 *
 * WHY THIS EXISTS (incident 2026-07-24 — Giah host-wide OOM)
 * ---------------------------------------------------------
 * Keycloak 26 is a Quarkus app. WITHOUT a container `mem_limit`, its cgroup sees
 * the ENTIRE host, so the JVM's default `-XX:MaxRAMPercentage` grows the heap
 * toward ~70% of HOST RAM. On a shared 25 GB backend host running more than one
 * instance (aisha + a fork), two uncapped Keycloaks alone exhausted RAM →
 * OOM-killer fired → `npm ci` in an in-flight build hung, containers were killed,
 * even systemd-journald failed to start, and Coolify lost the host
 * (unreachable_count climbing). The whole backend went dark from ONE uncapped JVM.
 *
 * THE RULE. A JVM is only as bounded as the smaller of (heap cap, container cap).
 * A heap cap alone still lets off-heap/direct/metaspace grow; a container cap
 * alone is what actually stops the host-wide blast. So every JVM service must
 * declare a `mem_limit` (Elasticsearch already capped its heap; it gets a
 * container cap here too, since its off-heap + mmap RSS exceeds the heap).
 *
 * Structural: JVM services are DETECTED (keycloak/elasticsearch image, or a
 * JAVA_OPTS / ES_JAVA_OPTS knob), not listed — add another JVM service and it is
 * required to cap memory automatically. Hard-fails: this class took down a
 * production host, so CI must say it first next time.
 */

import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** A compose file's text + the per-service slices we can cheaply reason about. */
function composeFiles(): { file: string; body: string }[] {
  return readdirSync(ROOT)
    .filter((f) => f.startsWith("docker-compose.coolify-") && f.endsWith(".yml"))
    .map((f) => ({ file: f, body: readFileSync(join(ROOT, f), "utf-8") }));
}

/**
 * Split a compose body into top-level service blocks (name → block text).
 * Services are 4-space-indented keys under a `services:` map in these files.
 */
function serviceBlocks(body: string): { name: string; block: string }[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^services:\s*$/.test(l));
  if (start < 0) return [];
  const out: { name: string; block: string }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim() !== "") break; // dedent to top-level (e.g. networks:)
    const m = l.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
    if (m) {
      if (cur) out.push({ name: cur.name, block: cur.lines.join("\n") });
      cur = { name: m[1], lines: [l] };
    } else if (cur) {
      cur.lines.push(l);
    }
  }
  if (cur) out.push({ name: cur.name, block: cur.lines.join("\n") });
  return out;
}

function isJvmService(block: string): boolean {
  return (
    /image:\s*\S*keycloak/i.test(block) ||
    /dockerfile:\s*\S*[Kk]eycloak/.test(block) ||
    /image:\s*\S*elasticsearch/i.test(block) ||
    /\bES_JAVA_OPTS\b/.test(block) ||
    /\bJAVA_OPTS(_KC_HEAP)?\b/.test(block) ||
    /\bJAVA_TOOL_OPTIONS\b/.test(block)
  );
}

function hasMemLimit(block: string): boolean {
  // service-level `mem_limit:` or a deploy.resources.limits.memory
  return /\n\s{4}mem_limit:\s*\S/.test(block) || /limits:\s*\n\s*memory:\s*\S/.test(block);
}

describe("JVM services must cap container memory (Giah OOM 2026-07-24)", () => {
  test("every JVM-backed service declares a mem_limit", () => {
    const offenders: string[] = [];
    for (const { file, body } of composeFiles()) {
      for (const { name, block } of serviceBlocks(body)) {
        if (isJvmService(block) && !hasMemLimit(block)) {
          offenders.push(`${file} → ${name}`);
        }
      }
    }
    expect(
      offenders,
      `JVM services without a mem_limit (one uncapped JVM can OOM the whole host): ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  test("Keycloak also pins an explicit heap (MaxRAMPercentage off a shared host is unsafe)", () => {
    const kc = readFileSync(join(ROOT, "docker-compose.coolify-keycloak.yml"), "utf-8");
    expect(kc, "keycloak must set JAVA_OPTS_KC_HEAP with an explicit -Xmx").toMatch(
      /JAVA_OPTS_KC_HEAP:[^\n]*-Xmx/,
    );
  });
});
