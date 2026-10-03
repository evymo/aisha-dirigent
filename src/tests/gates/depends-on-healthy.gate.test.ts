/**
 * depends_on Healthy Gate
 *
 * Pokud služba A má `healthcheck:` block a služba B má `depends_on: A`,
 * potom B `condition:` MUSÍ být `service_healthy` — nikoli `service_started`.
 * Důvod: `service_started` zaručí jen, že kontejner běží (ENTRYPOINT/CMD je
 * spuštěn), ale aplikace ještě nemusí přijímat trafic. To způsobuje race
 * conditions ve startup orderu (typicky synapse → element-web).
 *
 * Init kontejnery (`restart: no` nebo `service_completed_successfully`
 * dependency) jsou výjimkou — ty se ze své povahy spouští krátce a
 * `service_completed_successfully` na jejich straně je správně.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function getComposeFiles(): { relPath: string; content: string }[] {
  const out: { relPath: string; content: string }[] = [];
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith("docker-compose") && name.endsWith(".yml")) {
      if (name.includes("local")) continue;
      out.push({ relPath: name, content: readFileSync(join(ROOT, name), "utf-8") });
    }
  }
  return out;
}

interface Service {
  name: string;
  block: string;
  hasHealthcheck: boolean;
  isInitContainer: boolean;
}

/**
 * Does this service's healthcheck report READINESS — "I will answer requests" —
 * rather than mere liveness or membership of some external network?
 *
 * A readiness probe interrogates the service over its OWN loopback, or pings it
 * with the protocol's client. Anything else (pgrep, an interface address, a file
 * test) tells you the container is running, not that it is usable.
 */
function probesReadiness(block: string): boolean {
  const m = block.match(/healthcheck:\s*\n(?:\s+(?!test:)\S.*\n)*\s+test:\s*(.*(?:\n\s+[^\s].*)*)/);
  const test = m?.[1] ?? "";
  if (!test) return false;
  if (/127\.0\.0\.1|localhost|0\.0\.0\.0/.test(test)) return true;
  if (/\b(pg_isready|mysqladmin\s+ping|nc\s+-z)\b/.test(test)) return true;
  if (/redis-cli[^\n]*\bping\b/.test(test)) return true;
  return false;
}

function parseServices(content: string): Service[] {
  const out: Service[] = [];
  const lines = content.split("\n");
  let inServices = false;
  let currentName: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentName && currentLines.length > 0) {
      const block = currentLines.join("\n");
      const hasHealthcheck = /healthcheck:\s*\n\s+test:/.test(block) ||
                             /healthcheck:\s*\n\s+disable:\s*true/.test(block);
      const hasActualHealthcheck = /healthcheck:\s*\n\s+test:/.test(block);
      const isInitContainer = /restart:\s*["']?no["']?/.test(block);
      out.push({ name: currentName, block, hasHealthcheck: hasActualHealthcheck, isInitContainer });
    }
    currentName = null;
    currentLines = [];
  };

  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^[a-z][\w-]*:/i.test(line) && !line.startsWith(" ")) {
      flush();
      inServices = false;
      continue;
    }
    const svcMatch = line.match(/^ {2}([a-zA-Z][\w-]*):/);
    if (svcMatch) {
      flush();
      currentName = svcMatch[1];
      currentLines.push(line);
      continue;
    }
    if (currentName) currentLines.push(line);
  }
  flush();
  return out;
}

interface Dependency {
  consumer: string;
  producer: string;
  condition: string;
  file: string;
}

function parseDependencies(content: string, services: Service[]): Dependency[] {
  const out: Dependency[] = [];

  for (const svc of services) {
    // Match `depends_on:` block (multi-line dict form)
    const depsMatch = svc.block.match(/^\s+depends_on:\s*\n((?:\s+[a-zA-Z][\w-]*:\s*\n\s+condition:\s*\w+\s*\n?)+)/m);
    if (depsMatch) {
      const depsBody = depsMatch[1];
      const re = /\s+([a-zA-Z][\w-]*):\s*\n\s+condition:\s*(\w+)/g;
      for (const m of depsBody.matchAll(re)) {
        out.push({ consumer: svc.name, producer: m[1], condition: m[2], file: "" });
      }
    }

    // Also match list form (no condition specified — implicit service_started in Compose v2.1+)
    const listMatch = svc.block.match(/^\s+depends_on:\s*\n((?:\s+-\s+[a-zA-Z][\w-]*\s*\n?)+)/m);
    if (listMatch && !depsMatch) {
      for (const dep of listMatch[1].matchAll(/-\s+([a-zA-Z][\w-]*)/g)) {
        out.push({ consumer: svc.name, producer: dep[1], condition: "service_started", file: "" });
      }
    }
  }

  return out;
}

describe("Compose depends_on — service_healthy enforcement", () => {
  test("any depends_on referencing a service with healthcheck must use condition: service_healthy", () => {
    const violations: string[] = [];

    for (const f of getComposeFiles()) {
      const services = parseServices(f.content);
      const svcByName = new Map(services.map((s) => [s.name, s]));
      const deps = parseDependencies(f.content, services);

      for (const dep of deps) {
        const producer = svcByName.get(dep.producer);
        if (!producer) continue; // Reference to external service (different stack)
        if (!producer.hasHealthcheck) continue; // No healthcheck → service_started is the only valid option
        if (producer.isInitContainer) continue; // Init containers use service_completed_successfully
        // Having a healthcheck is not the same as having a READINESS check, and
        // only readiness makes `service_healthy` a promise worth waiting on.
        //
        // This rule and dirigent-domain looked contradictory: that gate pins
        // edge-proxy → mesh-router to service_started because "service_healthy
        // with short start_period killed the previous deploy when NetBird took
        // >60s to enroll". Both are right, about different kinds of probe:
        //   nocodb        wget http://127.0.0.1:8080/api/v1/health   → readiness
        //   netbird-agent ip addr show wt0 | grep 'inet 100.'        → enrolled in a foreign network
        //   mesh-router   pgrep -x netbird || pgrep -f 'sleep …'     → the process is alive
        // Waiting on the first is what you want; waiting on the other two makes
        // your start-up hostage to an external enrollment that may never come —
        // and their `exit 0` short-circuits mean "healthy" does not even imply
        // the feature is on. Derived from the probe itself, so a new service is
        // classified the day it is written, with no list to maintain.
        if (!probesReadiness(producer.block)) continue;

        if (dep.condition !== "service_healthy" && dep.condition !== "service_completed_successfully") {
          violations.push(
            `${f.relPath} ${dep.consumer} → ${dep.producer}: condition=${dep.condition}, but ${dep.producer} has healthcheck — use service_healthy`,
          );
        }
      }
    }

    expect(
      violations,
      "depends_on must use service_healthy when producer has a healthcheck:",
    ).toEqual([]);
  });
});
