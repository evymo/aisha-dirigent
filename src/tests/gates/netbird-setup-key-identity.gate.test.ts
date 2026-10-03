/**
 * Gate: a setup key must be validated by WHICH key it is, never by its name.
 *
 * WHY THIS EXISTS (wipe-breaking defect, measured on tenant 2026-07-21)
 * ------------------------------------------------------------------
 * NetBird's GET /api/setup-keys never returns the secret `key` value, only
 * metadata. An earlier revision therefore matched on `name` and reasoned that
 * "env value should match the latest creation". That is an assumption, not a
 * check, and a wipe falsifies it:
 *
 *   1. the netbird DB is recreated, fresh keys are minted under the SAME NAMES
 *   2. the env is deliberately preserved (PRESERVE_STATEFUL_SECRETS)
 *   3. bootstrap sees a valid record with that name -> "already validated"
 *   4. the stale value stays, and every agent presenting it gets
 *      `rpc error: code = NotFound desc = couldn't add peer: setup key is invalid`
 *
 * A stack redeploy could not fix it either, because validation kept answering
 * "validated". tenant-potok and tenant-local-ingest sat exactly like this, with their
 * key showing used_times=0 on the management side.
 *
 * The ID is returned by both the create response and the list, so it identifies
 * the exact record a stored value came from. These tests drive the real bash
 * function against a stubbed API, so they assert the BEHAVIOUR — is a stale
 * value regenerated? — rather than the spelling of any line.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const BOOTSTRAP = join(ROOT, "scripts/netbird-bootstrap.sh");

// ensure_setup_key_env builds its API payload and parses responses with jq, so
// these behavioural tests need jq on the box. A runner without it (some busybox
// CI images) cannot exercise the logic — skip with a reason rather than fail and
// blame the code for the environment. The netbird_env_stacks tests below are
// grep-only and run regardless. The scripts themselves require jq at runtime, so
// this only ever skips where the script could not run anyway.
const HAS_JQ = spawnSync("jq", ["--version"]).status === 0;

let workdir: string;

type Run = {
  stdout: string;
  /** env file contents after the run, parsed */
  env: Record<string, string>;
  /** did it mint a new key (POST /api/setup-keys)? */
  created: boolean;
};

/**
 * `listed` is what the stubbed GET /api/setup-keys returns — i.e. what NetBird
 * currently holds. `stored` is what our env claims to have.
 */
function runEnsure(opts: {
  storedKey: string;
  storedId?: string;
  listed: Array<{ id: string; name: string; revoked?: boolean; state?: string }>;
}): Run {
  const scen = mkdtempSync(join(workdir, "scen-"));
  const envFile = join(scen, "env.coolify");

  const lines = [
    "KEYCLOAK_DOMAIN=auth.invalid",
    "KEYCLOAK_REALM=test",
    "NETBIRD_API_URL=http://netbird.invalid",
    "NETBIRD_AUTH_SCHEME=Token",
    "NETBIRD_API_TOKEN=stub",
    `NETBIRD_STACK_KEY_FRONTEND=${opts.storedKey}`,
  ];
  if (opts.storedId) lines.push(`NETBIRD_STACK_KEY_FRONTEND_ID=${opts.storedId}`);
  writeFileSync(envFile, lines.join("\n") + "\n");

  const listJson = JSON.stringify(
    opts.listed.map((k) => ({ id: k.id, name: k.name, revoked: k.revoked ?? false, state: k.state ?? "valid" })),
  );

  const harness = join(scen, "h.sh");
  writeFileSync(
    harness,
    `#!/usr/bin/env bash
set -euo pipefail
export ENV_FILE="${envFile}"
export SKIP_KEYCLOAK_GATE=1
export DRY_RUN=0
export SYNC_COOLIFY=0
export NETBIRD_BOOTSTRAP_LIB_ONLY=1

source "${BOOTSTRAP}"

# --- stub the NetBird API (defined after sourcing, so it wins) ---------------
netbird_api() {
  local method="$1" path="$2"
  if [ "$method" = "GET" ] && [ "$path" = "/api/setup-keys" ]; then
    printf '%s' '${listJson}'
    return 0
  fi
  if [ "$method" = "POST" ] && [ "$path" = "/api/setup-keys" ]; then
    echo CREATED >> "${scen}/created.log"
    printf '%s' '{"id":"newly-minted-id","key":"NEWKEY-0000-0000","name":"aisha-frontend-core"}'
    return 0
  fi
  printf '%s' '[]'
}

ensure_setup_key_env NETBIRD_STACK_KEY_FRONTEND "aisha-frontend-core" "grp-frontend"
`,
    { mode: 0o755 },
  );

  const r = spawnSync("bash", [harness], { encoding: "utf-8", timeout: 30_000 });
  const env: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return {
    stdout: (r.stdout ?? "") + (r.stderr ?? ""),
    env,
    created: existsSync(join(scen, "created.log")),
  };
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "nb-setupkey-gate-"));
});
afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("netbird setup key: identity, not name", () => {
  test("bootstrap passes bash -n", () => {
    const r = spawnSync("bash", ["-n", BOOTSTRAP], { encoding: "utf-8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  /**
   * THE REGRESSION TEST — the post-wipe shape.
   * NetBird holds a key with the SAME NAME but a DIFFERENT id: exactly what a
   * recreated management DB looks like. The stored value is dead and must go.
   */
  test.skipIf(!HAS_JQ)("same name, different id (post-wipe) → regenerates", () => {
    const r = runEnsure({
      storedKey: "STALE-KEY-FROM-DESTROYED-DB",
      storedId: "old-id-from-destroyed-db",
      listed: [{ id: "fresh-id-after-wipe", name: "aisha-frontend-core" }],
    });

    expect(r.created).toBe(true);
    expect(r.env.NETBIRD_STACK_KEY_FRONTEND).toBe("NEWKEY-0000-0000");
    expect(r.env.NETBIRD_STACK_KEY_FRONTEND_ID).toBe("newly-minted-id");
  });

  /**
   * The value cannot be tied to any record, so its validity is UNKNOWN — and
   * unknown must not be treated as good. This is the upgrade path for installs
   * written before the id was recorded.
   */
  test.skipIf(!HAS_JQ)("no stored id → cannot verify which key it is → regenerates", () => {
    const r = runEnsure({
      storedKey: "UNVERIFIABLE-LEGACY-KEY",
      listed: [{ id: "some-id", name: "aisha-frontend-core" }],
    });

    expect(r.created).toBe(true);
    expect(r.stdout).toMatch(/cannot verify WHICH key/i);
    expect(r.env.NETBIRD_STACK_KEY_FRONTEND_ID).toBe("newly-minted-id");
  });

  /**
   * Negative control: the no-needless-churn behaviour must survive. Without it,
   * "always regenerate" would pass both tests above and re-enrol every agent on
   * every bootstrap run.
   */
  test.skipIf(!HAS_JQ)("stored id matches a live, unrevoked key → keeps it, no churn", () => {
    const r = runEnsure({
      storedKey: "GOOD-KEY",
      storedId: "live-id",
      listed: [{ id: "live-id", name: "aisha-frontend-core" }],
    });

    expect(r.created).toBe(false);
    expect(r.env.NETBIRD_STACK_KEY_FRONTEND).toBe("GOOD-KEY");
    expect(r.stdout).toMatch(/already present \+ validated/i);
  });

  /** A revoked key is not a usable key, even though its id still lists. */
  test.skipIf(!HAS_JQ)("stored id exists but is revoked → regenerates", () => {
    const r = runEnsure({
      storedKey: "REVOKED-KEY",
      storedId: "live-id",
      listed: [{ id: "live-id", name: "aisha-frontend-core", revoked: true }],
    });
    expect(r.created).toBe(true);
  });

  /**
   * The trap the old code fell into, stated directly: a matching NAME must not
   * be able to rescue a value whose id is absent.
   */
  test.skipIf(!HAS_JQ)("name matches but the stored id is nowhere → name alone must not validate", () => {
    const r = runEnsure({
      storedKey: "STALE",
      storedId: "id-that-no-longer-exists",
      listed: [
        { id: "other-1", name: "aisha-frontend-core" },
        { id: "other-2", name: "aisha-frontend-core" },
      ],
    });
    expect(r.created).toBe(true);
  });
});

/**
 * A regenerated key is useless to a stack that never receives it. The set of
 * stacks to sync used to be a hand-written roster and had silently drifted:
 * svc-local-ingest and svc-potok consume NETBIRD_STACK_KEY_* but were in neither
 * branch, so their agents kept a key from a previous management DB forever.
 */
describe("netbird env stacks are derived, not rostered", () => {
  /** Independently recompute the expected set straight from the manifest. */
  function expectedStacks(): string[] {
    const manifest = readFileSync(join(ROOT, "coolify/manifests/aisha.manifest"), "utf-8");
    const out = new Set<string>();
    for (const line of manifest.split("\n")) {
      if (!line.startsWith("app:")) continue;
      const [name, , compose] = line.slice(4).trim().split(":");
      if (!name || !compose) continue;
      const path = join(ROOT, compose.trim());
      if (!existsSync(path)) continue;
      if (readFileSync(path, "utf-8").includes("NETBIRD_")) out.add(name.trim());
    }
    return [...out].sort();
  }

  function actualStacks(): string[] {
    const scen = mkdtempSync(join(workdir, "stacks-"));
    const envFile = join(scen, "env");
    writeFileSync(
      envFile,
      "KEYCLOAK_DOMAIN=x\nKEYCLOAK_REALM=t\nNETBIRD_API_URL=http://x\nNETBIRD_AUTH_SCHEME=Token\nNETBIRD_API_TOKEN=t\n",
    );
    const h = join(scen, "h.sh");
    writeFileSync(
      h,
      `#!/usr/bin/env bash
set -euo pipefail
export ENV_FILE="${envFile}"
export SKIP_KEYCLOAK_GATE=1
export NETBIRD_BOOTSTRAP_LIB_ONLY=1
# Od fáze D (2026-09-26) čte netbird_env_stacks manifest INSTANCE (sdílený
# resolver); tady se výslovně předává týž manifest, ze kterého počítá expectedStacks.
export MANIFEST_FILE="${join(ROOT, "coolify/manifests/aisha.manifest")}"
source "${BOOTSTRAP}"
netbird_env_stacks
`,
      { mode: 0o755 },
    );
    const r = spawnSync("bash", [h], { encoding: "utf-8", timeout: 30_000 });
    return (r.stdout ?? "").split("\n").map((x) => x.trim()).filter(Boolean).sort();
  }

  test("every stack whose compose references NETBIRD_ is included", () => {
    expect(actualStacks()).toEqual(expectedStacks());
  });

  test("the mesh consumers that were missing from the old roster are covered", () => {
    // Named explicitly because these two are the ones that actually broke, and a
    // future refactor that reintroduces a roster would most likely drop them again.
    const stacks = actualStacks();
    for (const s of ["local-ingest", "potok"]) {
      expect(stacks, `${s} consumes NETBIRD_STACK_KEY_* and must receive it`).toContain(s);
    }
  });

  test("the set is computed, not written down", () => {
    const src = readFileSync(BOOTSTRAP, "utf-8");
    expect(
      src,
      "coolify-sync-envs.sh must be called with the derived set, never a literal stack roster",
    ).not.toMatch(/coolify-sync-envs\.sh"?\s+[a-z-]+\s+[a-z-]+\s+[a-z-]+/);
  });
});
