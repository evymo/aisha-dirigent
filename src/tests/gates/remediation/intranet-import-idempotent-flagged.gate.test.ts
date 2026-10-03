/**
 * REMEDIATION GATE — W4-03: intranet Appsmith import must be consolidated,
 * idempotent, and single-flag gated end-to-end.
 *
 * CONTRACT (post-fix — assert the CORRECT state, not today's bug)
 * ---------------------------------------------------------------
 * The "Story Intra" Appsmith surface is wired by three moving parts. For it to
 * be a real, re-runnable, single-switch feature, ALL THREE must hold:
 *
 *   (1) RENDER-ONLY BUILDER, NO DEAD IMPORTER
 *       scripts/build-aisha-appsmith.mjs must be a clean render-only builder:
 *       it must NOT carry the standing "follow-up A.2" import TODO nor a
 *       half-wired / stubbed "actual Appsmith API import" comment left as dead
 *       code. Either the import is implemented, or the TODO is gone — but the
 *       standing `A.2` marker must not remain.
 *
 *   (2) IDEMPOTENT PROVISIONER
 *       scripts/provision-intranet.sh must be safe to run twice with ZERO
 *       duplicate applications. That requires BOTH:
 *         (2a) an application-level existence guard before create — either an
 *              update-by-appId import (`?applicationId=…`) or a GET/existing-app
 *              check before POST /applications/import (the workspace + datasource
 *              steps already do this; the app-import step does not), AND
 *         (2b) a datasource reconnect call — Appsmith import returns an
 *              unconfigured-datasource list that must be reconnected, else the
 *              re-imported app has dead datasources.
 *
 *   (3) SINGLE COLD-START FEATURE FLAG GOVERNS BOTH SIDES
 *       ONE flag name must single-source BOTH the Appsmith/intranet app deploy
 *       (config/services.json or a compose / *.env) AND the gateway `/intranet`
 *       route registration (services/gateway/src/server.ts, where intranetRoutes
 *       is registered). The same token must appear on both sides so the intranet
 *       cannot be half-deployed (app up, gateway route ungated, or vice versa).
 *
 * KNOWN-RED (why this gate exists — verified against feat/remediation HEAD)
 *   • Builder still carries the `A.2` import TODO (lines ~34 and ~642).
 *   • provision-intranet.sh imports every template unconditionally with no
 *     existing-app check / applicationId update and no datasource reconnect —
 *     a second run duplicates every application.
 *   • Gateway registers intranetRoutes UNCONDITIONALLY; no intranet-enable flag
 *     exists in server.ts or in services.json → no shared flag gates both sides.
 *
 * Applying the fix (drop the A.2 TODO; add app-existence guard + datasource
 * reconnect; introduce one shared INTRANET_ENABLED-style flag on both sides)
 * turns each sub-contract GREEN.
 *
 * Run (offline, deterministic, no new deps):
 *   AISHA_SKIP_ONLINE=1 npx vitest run --config vitest.gates.config.ts \
 *     src/tests/gates/remediation/intranet-import-idempotent-flagged.gate.test.ts
 *
 * @module
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const BUILDER = path.resolve(ROOT, "scripts/build-aisha-appsmith.mjs");
const PROVISIONER = path.resolve(ROOT, "scripts/provision-intranet.sh");
const GATEWAY_SERVER = path.resolve(ROOT, "services/gateway/src/server.ts");
const SERVICES_JSON = path.resolve(ROOT, "config/services.json");

function read(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** Root-level docker-compose*.y{a,}ml files (deploy-side flag surface). */
function composeFiles(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT)
    .filter((n) => /^docker-compose.*\.ya?ml$/.test(n))
    .map((n) => path.join(ROOT, n));
}

/** *.env under config/ (deploy-side flag surface). */
function configEnvFiles(): string[] {
  const dir = path.resolve(ROOT, "config");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".env") || n.endsWith(".env.example"))
    .map((n) => path.join(dir, n));
}

/**
 * Extract intranet-enable-shaped flag tokens from a blob: SCREAMING_SNAKE
 * identifiers that mention INTRANET and an enable/feature/flag qualifier.
 * Deliberately excludes plumbing like INTRANET_API_KEY / INTRANET_PROXY_URL.
 */
function intranetEnableFlags(blob: string): Set<string> {
  const out = new Set<string>();
  const tokens = blob.match(/\b[A-Z][A-Z0-9_]{3,}\b/g) || [];
  for (const t of tokens) {
    if (/INTRANET/.test(t) && /(ENABLE|ENABLED|FEATURE|FLAG)/.test(t)) {
      out.add(t);
    }
  }
  return out;
}

describe("W4-03 — intranet Appsmith import: consolidated, idempotent, single-flag", () => {
  it("(1) build-aisha-appsmith.mjs is render-only with NO standing A.2 import TODO / stubbed importer", () => {
    const src = read(BUILDER);
    expect(src, `${path.relative(ROOT, BUILDER)} must exist`).not.toBe("");

    // Dead-importer markers that must be gone in the post-fix state.
    const markers: Array<{ label: string; re: RegExp }> = [
      { label: "standing `A.2` import TODO", re: /\bA\.2\b/ },
      { label: "`follow-up A.2` reference", re: /follow-?up\s+A\.2/i },
      { label: "`until A.2 lands` reference", re: /until\s+A\.2\s+lands/i },
      {
        label: "stubbed 'actual Appsmith API import' TODO comment",
        re: /actual Appsmith API import[\s\S]{0,120}(TODO|follow-?up|remains|until)/i,
      },
    ];

    const hits = markers.filter((m) => m.re.test(src)).map((m) => m.label);

    expect(
      hits,
      `build-aisha-appsmith.mjs must be render-only with no half-wired import ` +
        `left as dead code. Found dead-importer marker(s): ${hits.join("; ")}. ` +
        `Remove the A.2 import TODO (or actually implement + wire the import).`,
    ).toHaveLength(0);
  });

  it("(2) provision-intranet.sh is idempotent — app-existence guard AND datasource reconnect (zero dup apps on re-run)", () => {
    const src = read(PROVISIONER);
    expect(src, `${path.relative(ROOT, PROVISIONER)} must exist`).not.toBe("");

    // (2a) application-level idempotency: update-by-appId import OR an
    // existing-app check before POST /applications/import.
    const hasAppExistenceGuard =
      /applicationId=/.test(src) || // update-by-appId import query param
      /\/applications\/import\/[^"'\s]*\?[^"'\s]*application/i.test(src) ||
      /EXISTING_APP/.test(src) || // pre-check variable (mirrors EXISTING_WS pattern)
      /GET\s+"?\/api\/v1\/applications/i.test(src); // list-then-skip existing app

    // (2b) datasource reconnect after import (Appsmith unconfiguredDatasourceList).
    const hasDatasourceReconnect =
      /reconnect/i.test(src) ||
      /unconfiguredDatasource/i.test(src) ||
      /import\/[^"'\s]*\/datasources/i.test(src);

    const missing: string[] = [];
    if (!hasAppExistenceGuard)
      missing.push(
        "application existence guard (update-by-appId `?applicationId=…` or a GET /api/v1/applications existing-app check before POST /applications/import)",
      );
    if (!hasDatasourceReconnect)
      missing.push("datasource reconnect call after import");

    expect(
      missing,
      `provision-intranet.sh must be idempotent so a second run creates ZERO ` +
        `duplicate applications. Missing: ${missing.join(" AND ")}. Today the ` +
        `template-import loop POSTs /applications/import for every template on ` +
        `every run with no existence check and never reconnects datasources.`,
    ).toHaveLength(0);
  });

  it("(3) a SINGLE feature flag governs BOTH the Appsmith/intranet app deploy AND the gateway /intranet route registration", () => {
    const server = read(GATEWAY_SERVER);
    expect(server, `${path.relative(ROOT, GATEWAY_SERVER)} must exist`).not.toBe(
      "",
    );

    // Gateway side: the flag(s) that appear where /intranet is wired.
    const gatewayFlags = intranetEnableFlags(server);

    // Deploy side: services.json + root compose files + config/*.env.
    const deployBlob = [
      read(SERVICES_JSON),
      ...composeFiles().map(read),
      ...configEnvFiles().map(read),
    ].join("\n");
    const deployFlags = intranetEnableFlags(deployBlob);

    // The SAME token must appear on both sides.
    const shared = [...gatewayFlags].filter((f) => deployFlags.has(f));

    expect(
      shared,
      `No single feature flag single-sources both the intranet app deploy and ` +
        `the gateway /intranet route registration.\n` +
        `  gateway (services/gateway/src/server.ts) intranet-enable flag(s): ` +
        `${gatewayFlags.size ? [...gatewayFlags].join(", ") : "(none — intranetRoutes is registered unconditionally)"}\n` +
        `  deploy (config/services.json + compose + config/*.env) flag(s): ` +
        `${deployFlags.size ? [...deployFlags].join(", ") : "(none)"}\n` +
        `Introduce one INTRANET_ENABLED-style flag and gate BOTH sides with it ` +
        `so the intranet cannot be half-deployed.`,
    ).not.toHaveLength(0);
  });
});
