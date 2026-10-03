/**
 * redeploy-wave-coverage.gate.test.ts
 *
 * Manifest ↔ WAVES parity gate (wave-orphan prevention).
 *
 * Incident 2026-06-12: coolify/manifests/aisha.manifest defined ai-chat,
 * realtime and clamav, but scripts/aisha-redeploy.mjs never listed them in
 * WAVES. Cold-start created the Coolify apps (story-init) and then ended
 * "green" while leaving them exited:unhealthy with ZERO deployments — and
 * `--only=ai-chat` could not reach them either, because --only filters
 * WITHIN wave.apps (filterWaveApps), it cannot select an app no wave owns.
 *
 * Invariant: every app in coolify/manifests/aisha.manifest must be either
 *   (a) present in some WAVES entry of scripts/aisha-redeploy.mjs, or
 *   (b) explicitly tier=optional in config/services.json (conscious opt-in
 *       service — story-init creates it only when its provider keys/config
 *       exist; documents the decision instead of silently orphaning).
 * Note that (a) is ALWAYS safe, even for tier=optional apps: filterWaveApps
 * only targets apps that actually exist in Coolify, so the conditional
 * semantic lives at app-creation time, not in WAVES. Prefer (a).
 *
 * Additionally the known 2026-06-12 orphans (+ observability-stack, which
 * was already waved but is the same class) are PINNED into WAVES so they can
 * never regress to the (b) escape hatch: services.json marks them
 * tier=optional, yet the platform is not usable without ai-chat/realtime
 * (gateway routes /functions/v1/ai-* → svc-ai-chat:3011 and proxies
 * ws-gateway:3002), and clamav consumers fail-closed.
 *
 * String-level (no shell exec, no network) — portable across CI, same style
 * as cold-start-hardening.gate.test.ts.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

// ── Manifest parsing (same line grammar as manifest-tags.gate.test.ts) ──────
type ManifestApp = { name: string; placement: string; composeFile: string };

function parseManifestApps(rel: string): ManifestApp[] {
  const apps: ManifestApp[] = [];
  for (const line of read(rel).split("\n")) {
    const m = line.match(/^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)(?::(\S+))?\s*$/i);
    if (!m) continue;
    apps.push({ name: m[1], placement: m[2], composeFile: m[3] });
  }
  return apps;
}

// ── WAVES parsing (string-level slice of the orchestrator source) ───────────
type Wave = { num: number; apps: string[]; hardGates: string[]; softGates: string[] };

function parseWaves(source: string): Wave[] {
  const start = source.indexOf("const WAVES = [");
  expect(start, "scripts/aisha-redeploy.mjs must define `const WAVES = [`").toBeGreaterThan(-1);
  const end = source.indexOf("\n];", start);
  expect(end, "WAVES array must close with `];`").toBeGreaterThan(start);
  const block = source.slice(start, end);

  const waves: Wave[] = [];
  // Each wave object carries `num: <n>` followed (after name/comments) by its
  // own `apps: [...]`; gates come after apps within the same object literal.
  const waveRe = /num:\s*(\d+)[\s\S]*?apps:\s*\[([^\]]*)\]/g;
  const chunks = block.split(/\n {2}\},/);
  for (const chunk of chunks) {
    waveRe.lastIndex = 0;
    const m = waveRe.exec(chunk);
    if (!m) continue;
    const apps = [...m[2].matchAll(/"([^"]+)"/g)].map((q) => q[1]);
    const hardGates = [...chunk.matchAll(/\{\s*app:\s*"([^"]+)",\s*hard:\s*true/g)].map((q) => q[1]);
    const softGates = [...chunk.matchAll(/\{\s*app:\s*"([^"]+)",\s*hard:\s*false/g)].map((q) => q[1]);
    waves.push({ num: parseInt(m[1], 10), apps, hardGates, softGates });
  }
  return waves;
}

// ── services.json tier lookup (by key, fallback by compose filename) ────────
type ServiceEntry = { tier?: string; compose?: string };

function tierOf(manifestApp: ManifestApp, services: Record<string, ServiceEntry>): string | null {
  const byName = services[manifestApp.name];
  if (byName?.tier) return byName.tier;
  const byCompose = Object.values(services).find((s) => s.compose === manifestApp.composeFile);
  return byCompose?.tier ?? null;
}

const MANIFEST = "coolify/manifests/aisha.manifest";
const REDEPLOY = "scripts/aisha-redeploy.mjs";
const SERVICES = "config/services.json";

describe("Redeploy wave coverage (manifest ↔ WAVES parity gate)", () => {
  const manifestApps = parseManifestApps(MANIFEST);
  const redeploySrc = read(REDEPLOY);
  const waves = parseWaves(redeploySrc);
  const wavedApps = new Set(waves.flatMap((w) => w.apps));
  const services = (JSON.parse(read(SERVICES)) as { services: Record<string, ServiceEntry> }).services;

  test("manifest and WAVES both parse to a sane size", () => {
    // Guard the parsers themselves: if either regex rots, the coverage test
    // below would vacuously pass on empty sets.
    expect(manifestApps.length, `no app: lines parsed from ${MANIFEST}`).toBeGreaterThanOrEqual(16);
    expect(waves.length, `no waves parsed from ${REDEPLOY}`).toBeGreaterThanOrEqual(7);
    expect(wavedApps.size, "no apps parsed out of WAVES").toBeGreaterThanOrEqual(16);
  });

  test("every manifest app is in WAVES, or explicitly tier=optional in services.json", () => {
    const orphans: string[] = [];
    for (const app of manifestApps) {
      const fullName = `aisha-${app.name}`;
      if (wavedApps.has(fullName)) continue;
      if (tierOf(app, services) === "optional") continue;
      orphans.push(fullName);
    }
    expect(
      orphans,
      `wave-orphan app(s): ${orphans.join(", ")} — defined in ${MANIFEST} but never deployed by any ` +
        `WAVES entry in ${REDEPLOY} (and not tier=optional in ${SERVICES}). Cold-start will leave them ` +
        `exited with zero deployments and --only cannot select them. Add them to the dependency-correct ` +
        `wave (filterWaveApps skips apps that don't exist in Coolify, so this is safe even for ` +
        `conditionally-created apps), or consciously mark them tier=optional in ${SERVICES}.`,
    ).toEqual([]);
  });

  test("2026-06-12 orphan regression pin: ai-chat, realtime, clamav, observability-stack stay waved", () => {
    // These are tier=optional in services.json, so the escape hatch (b) of the
    // coverage test would let them silently fall out of WAVES again. Pin them:
    // the platform is not usable without ai-chat/realtime, clamav consumers
    // fail-closed, and obs-stack is the SRE surface for everything else.
    for (const name of ["aisha-ai-chat", "aisha-realtime", "aisha-clamav", "aisha-observability-stack"]) {
      expect(wavedApps.has(name), `${name} must stay in WAVES (wave-orphan regression, 2026-06-12)`).toBe(true);
    }
  });

  test("WAVES references only apps that exist in the manifest (no rename drift)", () => {
    const manifestNames = new Set(manifestApps.map((a) => `aisha-${a.name}`));
    const ghosts = [...wavedApps].filter((n) => !manifestNames.has(n));
    expect(
      ghosts,
      `WAVES deploys app(s) absent from ${MANIFEST}: ${ghosts.join(", ")} — manifest rename/removal must ` +
        `update ${REDEPLOY} in the same change.`,
    ).toEqual([]);
  });

  test("shared-redis přijde AŽ ZA meshem, ale ne po svých konzumentech", () => {
    // ⛔ TENHLE TEST DŘÍV PINOVAL „wave 1 (pure infra, no deps)". Premisa
    // „nulové závislosti" padla 2026-08-22 konverzí na mesh peera: dostal
    // netbird-agent, takže na mesh závisí. Ve vlně 1 mesh NEEXISTUJE, a tím
    // vznikl cyklus `mesh ← netbird ← … ← shared-redis ← mesh` — agent se
    // neměl kam zapojit a stack zůstal unhealthy.
    //
    // ZÁMĚR ale platí dál a měří se teď PŘÍMO: být za meshem a před konzumenty.
    const wave = waves.find((w) => w.apps.includes("aisha-shared-redis"));
    expect(wave, "aisha-shared-redis missing from WAVES").toBeDefined();

    const genesis = waves.find((w) => w.apps.includes("aisha-netbird"));
    expect(genesis, "aisha-netbird musí být ve WAVES — bez něj mesh nevzniká").toBeDefined();
    expect(
      wave!.num,
      "shared-redis je mesh peer, takže NESMÍ startovat dřív než mesh — jinak se\n" +
        "jeho agent nemá kam zapojit a stack zůstane unhealthy (naměřeno 2026-08-22).",
    ).toBeGreaterThan(genesis!.num);

    // Konzumenti: kdo v compose čte adresu sdíleného Redisu.
    for (const konzument of ["aisha-realtime", "aisha-edge"]) {
      // ⛔ POSLEDNÍ výskyt, ne první (2026-08-24). `aisha-edge` je ve vlnách
      // TŘIKRÁT: vlna 4 = jen DVEŘE pro bootstrap auth (operátor sahá na
      // Keycloak zvenčí, mesh ještě není), vlna 6 = zapojení do meshe,
      // vlna 10 = otevření dveří naostro. První výskyt tvrdil, že edge už
      // ve vlně 4 potřebuje cache — a tím postavil dvě podmínky proti sobě:
      //   shared-redis PO meshi (vlna >5, je to peer)  ×  NEJPOZDĚJI s edge (≤4)
      // Nesplnitelné. Během bootstrapu ale žádný uživatel nechodí; kontrola
      // odvolání tokenu má smysl teprve tam, kde edge obsluhuje provoz.
      const vyskyty = waves.filter((w) => w.apps.includes(konzument));
      const kw = vyskyty[vyskyty.length - 1];
      if (!kw) continue;
      expect(
        wave!.num,
        `shared-redis musí být nejpozději s ${konzument} — konzument bez cache\n` +
          "spadne do retry smyčky nad nedostupnou adresou.",
      ).toBeLessThanOrEqual(kw.num);
    }
  });

  test("ai-chat + realtime are placed after Keycloak with the wave-4 KC hard gate", () => {
    // Both need aisha-db + redis (core, cross-stack alias) and KC JWKS.
    // Deploying them before wave 3 (Keycloak) would recreate the restart-loop
    // the wave order exists to prevent.
    const kcWave = waves.find((w) => w.apps.includes("aisha-keycloak"));
    expect(kcWave, "a wave must deploy aisha-keycloak").toBeDefined();
    for (const name of ["aisha-ai-chat", "aisha-realtime"]) {
      const wave = waves.find((w) => w.apps.includes(name));
      expect(wave, `${name} missing from WAVES`).toBeDefined();
      expect(wave!.num, `${name} must deploy AFTER Keycloak (wave ${kcWave!.num})`).toBeGreaterThan(kcWave!.num);
      expect(wave!.hardGates, `${name}'s wave must hard-gate on aisha-keycloak`).toContain("aisha-keycloak");
    }
  });

  test("the orphaned trio is soft-deploy (failure must not cascade-halt later waves)", () => {
    // Nothing container-level depends on ai-chat/realtime/clamav, so their
    // deploy failure must not skip waves 5-7 (mesh warmup, integration,
    // messaging) — it is surfaced in the summary and exits 1 regardless.
    const softStart = redeploySrc.indexOf("const SOFT_DEPLOY_APPS = new Set([");
    expect(softStart, "SOFT_DEPLOY_APPS set must exist").toBeGreaterThan(-1);
    const softBlock = redeploySrc.slice(softStart, redeploySrc.indexOf("]);", softStart));
    for (const name of ["aisha-ai-chat", "aisha-realtime", "aisha-clamav"]) {
      expect(softBlock, `${name} missing from SOFT_DEPLOY_APPS`).toContain(`"${name}"`);
    }
  });
});
