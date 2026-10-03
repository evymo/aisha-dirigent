/**
 * CI Service ↔ Compose Deployability — Integral Design Gate
 *
 * Every service image that CI builds (ci.yml strategy.matrix.service) MUST be
 * deployable: defined in at least one docker-compose.coolify*.yml, either as a
 * service key, a build.dockerfile reference (services/<name>/Dockerfile or
 * Dockerfile.<name>), or a build.context scoped to services/<name>.
 *
 * Why this gate:
 *   The 2026-06 stack audit found that the chat backend itself (svc-ai-chat,
 *   routed by the gateway on :3011) was CI-built on every push yet deployed
 *   by NO compose file — along with the realtime fabric (event-worker,
 *   ws-gateway), svc-ide-context and svc-source-broker. Historical cause:
 *   services trimmed from the core compose in the early-Coolify argv-limit
 *   era (240488b2, c2ac47f5) were never restored, and newer services copied
 *   the omission. Writing this gate then surfaced 11 MORE undeployed domain
 *   services (stripe, push, blockchain, …) hiding behind gateway URL refs.
 *
 * Why the universe is CI matrix ∪ services/ (2026-07-29):
 *   The original gate took its universe from the CI matrix alone. That let a
 *   service hide by being absent from BOTH lists: `svc-aitg-probes` shipped
 *   nine OWASP AITG runtime probe routes, a /health endpoint, unit tests and
 *   four live callers (three n8n AITG loops + the `aitg_run_test` MCP tool,
 *   all hardcoding http://svc-aitg-probes:3041) with NO Dockerfile, NO compose
 *   entry, and NO CI matrix entry. The whole AITG runtime plane dispatched
 *   into nothing, and this gate could not see it — not because the contract
 *   was wrong, but because its INPUT was itself an incomplete list. A gate
 *   seeded from another hand-maintained list inherits that list's omissions.
 *   `services/*` is the ground truth of what exists, so the universe is now
 *   seeded from the filesystem and merely widened by the CI matrix.
 *
 * Contract enforced (identity-keyed baseline, same model as
 * migration-safety / fk-relationship-gaps):
 *   1. ci.yml parses and yields a non-empty union of matrix service names.
 *   2. A service that CI builds OR that declares a `start` script under
 *      services/, with no compose definition and no baseline entry, is a HARD
 *      FAIL — new services must ship with their deployment.
 *   3. A baseline entry whose service gained a compose home (or left the
 *      universe) is a HARD FAIL too — stale debt must be removed, keeping the
 *      baseline an honest, shrinking TODO list.
 *   4. A Dockerfile a compose file builds must exist on disk — being NAMED in
 *      compose is not the same as being buildable.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
// 2026-07-14: the matrix-bearing scanner jobs (npm-audit-services, trivy) moved
// to supply-chain.yml (off-peak heavy lane). The deployability contract spans
// every CI workflow that builds/scans service images, so collect the matrix
// union across BOTH files.
const CI_WORKFLOWS = [
  join(ROOT, ".forgejo/workflows/ci.yml"),
  join(ROOT, ".forgejo/workflows/supply-chain.yml"),
];
const BASELINE = join(ROOT, "src/tests/gates/ci-service-compose-deployability.baseline.json");

type ComposeService = { build?: { dockerfile?: string; context?: string } | string; image?: string };
type ComposeDoc = { services?: Record<string, ComposeService> };

function collectMatrixServices(): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const matrix = obj["matrix"] as Record<string, unknown> | undefined;
      const services = matrix?.["service"];
      if (Array.isArray(services)) {
        for (const s of services) if (typeof s === "string") out.add(s);
      }
      Object.values(obj).forEach(walk);
    }
  };
  for (const wf of CI_WORKFLOWS) {
    walk(yaml.load(readFileSync(wf, "utf-8")) as Record<string, unknown>);
  }
  return out;
}

/**
 * Service directories that declare a `start` script — i.e. are meant to RUN.
 * Filesystem ground truth, so a service cannot escape the contract by being
 * missing from the CI matrix as well as from compose (the svc-aitg-probes
 * hole). `start` is the declaration of intent to run; a package under
 * services/ without one is a library and is out of scope.
 */
function collectRunnableServiceDirs(): Set<string> {
  const out = new Set<string>();
  const dir = join(ROOT, "services");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(dir, entry.name, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      if (typeof pkg?.scripts?.start === "string") out.add(entry.name);
    } catch {
      // No package.json / unparseable → not a runnable service.
    }
  }
  return out;
}

/** All identifiers the compose deploy surface provides for matching a CI service. */
function collectComposeIdentifiers(): Set<string> {
  const ids = new Set<string>();
  const files = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f));
  for (const file of files) {
    const doc = yaml.load(readFileSync(join(ROOT, file), "utf-8")) as ComposeDoc;
    for (const [key, svc] of Object.entries(doc.services ?? {})) {
      ids.add(key);
      const build = typeof svc?.build === "object" && svc.build !== null ? svc.build : undefined;
      for (const ref of [build?.dockerfile, build?.context]) {
        if (typeof ref !== "string") continue;
        // services/<name> | ./services/<name> | services/<name>/Dockerfile
        const byDir = ref.match(/^\.?\/?services\/([^/]+)(\/Dockerfile)?$/);
        if (byDir) ids.add(byDir[1]);
        // Root-level Dockerfile.<name> (e.g. Dockerfile.svc-aisha-kronos-shim)
        const byRoot = ref.match(/^Dockerfile\.(.+)$/);
        if (byRoot) ids.add(byRoot[1]);
      }
    }
  }
  return ids;
}

describe("CI service ↔ compose deployability", () => {
  const matrixServices = collectMatrixServices();
  const runnableDirs = collectRunnableServiceDirs();
  // Universe = anything CI builds ∪ anything that declares it runs. Neither
  // list alone is complete; see the header note on svc-aitg-probes.
  const universe = new Set([...matrixServices, ...runnableDirs]);
  const composeIds = collectComposeIdentifiers();
  const baseline = JSON.parse(readFileSync(BASELINE, "utf-8")) as { orphans: string[] };
  const baselineSet = new Set(baseline.orphans);

  test("ci.yml yields a non-empty service build matrix", () => {
    expect(matrixServices.size).toBeGreaterThan(10);
  });

  test("services/ yields a non-empty set of runnable service dirs", () => {
    // Guards the new half of the universe against becoming a silent no-op —
    // a mis-typed path here would restore exactly the blind spot this widening
    // was written to close.
    expect(runnableDirs.size).toBeGreaterThan(10);
  });

  test("compose deploy surface resolves identifiers", () => {
    expect(composeIds.size).toBeGreaterThan(20);
  });

  test.each([...universe].sort().map((s) => [s] as const))(
    "service %s is deployed or baselined",
    (service) => {
      const deployed = composeIds.has(service);
      const baselined = baselineSet.has(service);
      const origin = matrixServices.has(service)
        ? "built by CI (matrix)"
        : "declares a `start` script under services/";
      expect(
        deployed || baselined,
        `Service "${service}" ${origin} but no ` +
          `docker-compose.coolify*.yml defines it and it is not in the ` +
          `deployability baseline. New services must ship WITH their compose ` +
          `deployment — core stack for db/redis-coupled services, an opt-in ` +
          `stack for tenant-specific connectors ` +
          `(see docker-compose.coolify-source-broker.yml).`,
      ).toBe(true);
    },
  );

  test.each([...baselineSet].sort().map((s) => [s] as const))(
    "baseline entry %s is still a real orphan (no stale debt)",
    (service) => {
      expect(
        universe.has(service),
        `Baseline entry "${service}" is no longer a CI-built or runnable ` +
          `service — remove it from ci-service-compose-deployability.baseline.json.`,
      ).toBe(true);
      expect(
        composeIds.has(service),
        `Baseline entry "${service}" now HAS a compose deployment — remove it ` +
          `from ci-service-compose-deployability.baseline.json (debt repaid).`,
      ).toBe(false);
    },
  );

  // Nor is being NAMED the same as having the file you claim to build. A
  // compose block pointing at a Dockerfile that does not exist fails at deploy
  // time, on the server, with the stack half-up — the most expensive place to
  // learn it. Resolution is relative to the block's own `context:`, NOT the
  // repo root: `context: infra/postgres` + `dockerfile: Dockerfile` means
  // infra/postgres/Dockerfile, and resolving against the root instead reports both
  // pg17 blocks as missing — a bug in the measurement, not a finding.
  test("every Dockerfile a compose file builds exists on disk", () => {
    const missing: string[] = [];
    for (const file of readdirSync(ROOT).filter((f) => /^docker-compose.*\.yml$/.test(f))) {
      const doc = yaml.load(readFileSync(join(ROOT, file), "utf-8")) as ComposeDoc;
      for (const [name, svc] of Object.entries(doc.services ?? {})) {
        const build =
          typeof svc?.build === "object" && svc.build !== null ? svc.build : undefined;
        const dockerfile = build?.dockerfile;
        if (typeof dockerfile !== "string") continue;
        const context = typeof build?.context === "string" ? build.context : ".";
        // Interpolated paths resolve only at deploy time — not checkable here.
        if (dockerfile.includes("${") || context.includes("${")) continue;
        const resolved = join(context, dockerfile);
        if (!existsSync(join(ROOT, resolved))) {
          missing.push(`${file} → ${name}: ${resolved}`);
        }
      }
    }
    expect(
      missing,
      `compose builds a Dockerfile that does not exist:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  // Being NAMED in a compose file is not the same as being buildable from it.
  // docker-compose.coolify-source-broker.yml declared `build.args:` with nothing
  // under it but comments — valid YAML (the value parses as null), invalid
  // compose, and every build died at validation with "build.args must be a
  // mapping". It shipped in the same commit that made the broker a first-class
  // stack (cc2e40e7) and survived until 2026-07-20, because that commit's
  // provisioning gate meant the app was never created and this file was
  // therefore never built.
  //
  // A structural key written with no content under it is always a mistake — an
  // author meant to fill it in. Checking the shape turns a deploy-time failure
  // into a CI one.
  test("no compose declares a structural key with an empty value", () => {
    const MAPPING_OR_LIST = ["environment", "labels", "volumes", "networks", "depends_on", "ports"];
    const offenders: string[] = [];
    for (const file of readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.yml$/.test(f))) {
      const doc = yaml.load(readFileSync(join(ROOT, file), "utf-8")) as ComposeDoc;
      for (const [name, svc] of Object.entries(doc.services ?? {})) {
        const s = svc as unknown as Record<string, unknown>;
        const build =
          typeof s?.build === "object" && s.build !== null ? (s.build as Record<string, unknown>) : undefined;
        if (build && "args" in build && build.args == null) offenders.push(`${file} → ${name}.build.args`);
        for (const key of MAPPING_OR_LIST) {
          if (key in s && s[key] == null) offenders.push(`${file} → ${name}.${key}`);
        }
      }
    }
    expect(
      offenders,
      `declared but empty (remove the key, or give it content):\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
