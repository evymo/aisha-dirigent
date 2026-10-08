/**
 * Cold-Start Doctor Gate
 *
 * End-to-end smoke test pro `scripts/cold-start-doctor.sh`. Bez real Coolify
 * staging dostupnosti je tohle "best alternative" pro integration test cold-
 * start flow:
 *
 *   1. Doctor must be executable a proběhnout bez crash
 *   2. Bez creds (typický CI) → exit code 1 s jasnými error messages
 *   3. Phase filter (--phase B,E) — vrací exit 0 (jen file/manifest checks)
 *   4. Manifest má 13 apps, všechny compose existují
 *
 * Tohle nezachytí runtime chyby v cold-startu samém, ale zajistí, že:
 *   - Doctor se nerozbije při refaktoru
 *   - Manifest ↔ compose match je vždy aktuální
 *   - Critical files se nesmaží (cold-start by failnul na missing scripts)
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, test, expect } from "vitest";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Izolace identity, kterou sdílí OBĚ dveře.
 *
 * ⛔ NAMĚŘENO 2026-09-12 na forku <fork>. `runDoctor` pouští doktora
 * s NEDEKLAROVANOU identitou (prázdný `AISHA_IDENTITY_ROOT`, oba operátorské
 * soubory na /dev/null) — a doktor tam správně vydá upstreamový default:
 * `aisha.manifest`, 36 aplikací. Jenže `manifestRelFor` se ptal TÉHOŽ resolveru
 * BEZ té izolace, tedy v reálném checkoutu, kde identita deklarovaná JE —
 * a dostal `<fork>.manifest`, 17 aplikací. Brána pak porovnávala odpověď
 * na jinou otázku, než jakou položila doktorovi.
 *
 * V čistém upstreamu to nevyplave: tam obě strany vrátí `aisha.manifest`, takže
 * se ta neshoda projeví AŽ ve forku — a vypadá jako vada doktora, přestože
 * doktor odpovídá správně. Táž třída jako všechno ostatní kolem identity:
 * jedny dveře, ne druhý názor.
 */
const IZOLACE_IDENTITY = {
  AISHA_PROD_BACKUP_FILE: "/dev/null",
  AISHA_ENV_LOCAL_FILE: "/dev/null",
  AISHA_IDENTITY_ROOT: mkdtempSync(join(tmpdir(), "doctor-bez-identity-")),
} as const;

/**
 * Which manifest does THIS checkout target? Ask the shared resolver — the same
 * scripts/lib/coolify-instance-scope.mjs the doctor, story-init and drift-check
 * use — instead of assuming the upstream default.
 *
 * Both assertions below depend on it: the manifest PATH the doctor prints, and
 * the app COUNT it reports. Pinning either to aisha.manifest made a correct
 * doctor run fail in any checkout that declares its own instance, and turned a
 * legitimate per-instance app set into a test failure.
 *
 * Falling back to the upstream default keeps a checkout that declares nothing —
 * plain upstream CI — behaving exactly as before.
 */
function manifestRelFor(root: string): string {
  try {
    const abs = execFileSync(
      process.execPath,
      [join(root, "scripts/lib/coolify-instance-scope.mjs"), "--manifest-path", "--allow-default"],
      { encoding: "utf-8", cwd: root, env: { ...process.env, ...IZOLACE_IDENTITY } },
    ).trim();
    return abs ? abs.replace(`${root}/`, "") : "coolify/manifests/aisha.manifest";
  } catch {
    return "coolify/manifests/aisha.manifest";
  }
}

const ROOT = process.cwd();
const DOCTOR = join(ROOT, "scripts/cold-start-doctor.sh");

type DoctorRun = { stdout: string; stderr: string; exitCode: number };

/** Prostředí izolovaného doktora — jeden domov pro synchronní i asynchronní běh. */
function prostrediDoktora(extraEnv: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    // Federation is opt-in; default it OFF so unrelated phases are no-ops.
    SOURCE_API_URL: "",
    BROKER_DEV_ALLOW_UNAUTHED_SYNC: "",
    // Strip credentials so test is reproducible (CI shouldn't have them anyway)
    COOLIFY_API_KEY: "",
    COOLIFY_API_TOKEN: "",
    FORGEJO_TOKEN: "",
    FORGEJO_API_TOKEN: "",
    COOLIFY_URL: "",
    COOLIFY_SERVER_UUID_FRONTEND: "",
    COOLIFY_SERVER_UUID_BACKEND: "",
    COOLIFY_SERVER_UUID_EXPERIMENTAL: "",
    // Server identity is DYNAMIC (hostname → /servers discovery). Strip the
    // hostname + target-server inputs too so the empty-env case is truly
    // "no identity at all", regardless of the test runner's own env.
    FRONTEND_HOSTNAME: "",
    BACKEND_HOSTNAME: "",
    EXPERIMENTAL_HOSTNAME: "",
    AISHA_TARGET_SERVER: "",
    // Isolate from real .env-prod-backup (which exists in main repo)
    AISHA_PROD_BACKUP_FILE: IZOLACE_IDENTITY.AISHA_PROD_BACKUP_FILE,
    // …a od .env.local, druhého operátorského souboru, který doktor od
    // 2026-09-02 načítá. Bez něj se šablona config/coolify-environments.env
    // rozvine do prázdna a preflight lže do červena (viz komentář v doktoru).
    // Jenže .env.local nese i identitu instance: bez téhle izolace se do testu
    // vlije APP_NAME_PREFIX=<fork> a doktor pak měří CIZÍ instanci — hlásil
    // <fork>.manifest tam, kde brána čeká aisha.manifest.
    AISHA_ENV_LOCAL_FILE: IZOLACE_IDENTITY.AISHA_ENV_LOCAL_FILE,
    // …a kořen deklarace identity. Rozcestník si kanály (.env.local, .env.coolify)
    // čte PŘÍMO Z DISKU, takže vyprázdnit prostředí nestačí: na vývojářském stroji
    // určil instanci `<fork>`, jejíž manifest správně žije v overlayi — a ten tu
    // není. Doktor pak umřel hned za hlavičkou (exit 2) a padlo všech osm testů,
    // aniž se cokoli změřilo. Prázdný kořen = nedeklarovaná identita, což je přesně
    // ten případ, na který má doktor `--allow-default`. Týž postup jako
    // coolify-instance-scope.gate.test.ts.
    AISHA_IDENTITY_ROOT: IZOLACE_IDENTITY.AISHA_IDENTITY_ROOT,
    // Per-test overrides (e.g. enabling federation for the Phase H checks).
    ...extraEnv,
  };
}

function runDoctor(args: string[], extraEnv: Record<string, string> = {}): DoctorRun {
  try {
    const stdout = execFileSync("bash", [DOCTOR, ...args], {
      cwd: ROOT,
      env: prostrediDoktora(extraEnv),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || "",
      exitCode: err.status ?? 1,
    };
  }
}

describe("cold-start-doctor.sh — smoke gate", () => {
  test("doctor script exists and is executable", () => {
    expect(existsSync(DOCTOR)).toBe(true);
  });

  test("Phase B+E (files only) — exit 0 + manifest references resolve", () => {
    const r = runDoctor(["--phase", "B,E", "--no-network"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Required files/);
    expect(r.stdout).toMatch(/Manifest has \d+ apps/);
    expect(r.stdout).toMatch(/All \d+ manifest compose refs exist/);
    expect(r.stdout).toMatch(/READY/);
  });

  test("Phase A hlásí ROZVINUTOU doménu, nikdy text šablony", () => {
    // ⛔ PŮVODNÍ ZNĚNÍ TOHOTO TESTU KODIFIKOVALO VADU. Tvrdilo, že se běží proti
    // „the real repo domains.env (which should have real values or the test
    // would be flaky on forks)" — jenže `config/domains.env` je od iterace 14
    // ŠABLONA a žádné reálné hodnoty nenese. Doktor z ní četl syrový řádek přes
    // `cut -d= -f2-`, dostal literál `${APP_DOMAIN:-}` — neprázdný, bez slova
    // „example" — a hlásil `present and non-placeholder`. Test na ten řetězec
    // čekal, takže zelenal PRÁVĚ PROTO, že kontrola nemohla selhat.
    //
    // Následek (2026-09-04, produkce forku): `netbird.aisha.example.com` a
    // `pki.backend.internal.example.com` prošly až do nasazení, doktor u toho
    // hlásil 38 pass / 0 fails.
    //
    // Test proto nově měří INVARIANT, ne konkrétní veselou hlášku: ať doktor
    // doménu přijme nebo odmítne, NIKDY ji nesmí přijmout jako nerozvinutou
    // šablonu. Konkrétní verdikt závisí na prostředí (na holém forku bez
    // operátorského env resolver spadne na `.example` referenční hodnoty a
    // odmítnutí je SPRÁVNÁ odpověď), takže na verdikt se tu nesázíme.
    const r = runDoctor(["--phase", "A", "--no-network"]);
    expect(r.stdout).toMatch(/config\/domains\.env exists/);
    for (const klic of ["APP_DOMAIN", "PUBLIC_TLD", "KEYCLOAK_DOMAIN"]) {
      expect(r.stdout, `doktor o ${klic} vůbec nereferuje`).toMatch(
        new RegExp(`domains: ${klic}\\b`),
      );
      expect(
        r.stdout,
        `doktor přijal ${klic} jako NEROZVINUTOU šablonu — přesně ta vada, ` +
          `kvůli které kontrola nemohla selhat (naměřeno 2026-09-04).`,
      ).not.toMatch(new RegExp(`domains: ${klic} = \\$\\{`));
    }
  });

  // ⛔ VLASTNÍ STROP 360 s, ne zděděných 120 s. NAMĚŘENO 2026-08-17: samostatně
  // 22 s, v plné sadě 40 s, pod pre-push hookem (souběžný test:run + tsc +
  // eslint) 133 s → globální testTimeout 120 s ho zabil a brána hlásila pád,
  // který NEBYL naměřením vlastnosti — timeout tvrzení o exit kódu nic neříká.
  // Dva pushe po sobě padly na zátěži stroje, ne na kódu. Tvrzení samo je
  // časově necitlivé (exit 1 + jmenovité chyby kontraktu), proto ČAS, ne
  // oslabení: 360 s = naměřené maximum × ~2,7 rezervy.
  test("Full doctor with empty env — exits 1 with explicit env contract errors", { timeout: 360_000 }, () => {
    const r = runDoctor(["--no-network"]);
    expect(r.exitCode).toBe(1);
    // Doctor message contract: "COOLIFY_API_KEY (alias COOLIFY_API_TOKEN) empty".
    // Tight match na alias annotation — pokud někdo refaktoruje formát, test
    // upozorní (záměrně). `.*` by skrylo regresi typu "COOLIFY_API_KEY foo bar empty".
    expect(r.stdout).toMatch(/COOLIFY_API_KEY \(alias COOLIFY_API_TOKEN\) empty/);
    expect(r.stdout).toMatch(/FORGEJO_TOKEN empty/);
    expect(r.stdout).toMatch(/COOLIFY_URL not set/);
    // Server identity is DYNAMIC: cold-start auto-discovers per-slot UUIDs from
    // Coolify /servers by matching ${SLOT}_HOSTNAME (generate-coolify-context.mjs
    // "Iter 19") — UUIDs are NEVER hardcoded. With no hostnames + no UUID
    // override + no AISHA_TARGET_SERVER (this empty-env case) the doctor must
    // still fail, but the message must guide to the dynamic INPUT (hostnames →
    // auto-discovery), not demand a pasted UUID. This asserts the corrected
    // contract; the old `/COOLIFY_SERVER_UUID_FRONTEND not set/` enshrined the
    // pre-discovery requirement and was rewritten, not weakened.
    expect(r.stdout).toMatch(/No server identity/);
    expect(r.stdout).toMatch(/auto-discovered from Coolify/);
    expect(r.stdout).toMatch(/NOT READY for cold-start/);
  });

  // + 1 local model serving (model, tier=optional opt-in): svc-model — OpenAI-compat
  //   local serving (tuned chat + embeddings), provisioned only when CHAT_GGUF_URL is set.
  test("Manifest contains all 29 apps from production architecture", () => {
    const r = runDoctor(["--phase", "B", "--no-network"]);
    // Expected app count from manifest: 13 core + 2 Phase 2 autopilot
    // (llm-gateway + openclaw, tier=optional opt-in) + 1 Phase 12
    // observability stack (Loki/Prometheus/Grafana behind OAuth2 Proxy)
    // + 1 shared clamav AV sidecar (tier=optional, flow-through upload scan)
    // + 2 stack-revival sibling extractions (ai-chat = svc-ai-chat main AI
    // orchestration; realtime = event-worker + ws-gateway + svc-ide-context) —
    // core compose sits at the ARG_MAX ceiling, so new services land as
    // sibling stacks per the coolify-compose-compliance gate's canonical fix
    // + 1 shared-redis ACL instance (Phase 1, 2026-06-13): designed-but-never-
    // shipped Redis 7 + ACL users, now deployed in wave 1 and carrying the WS
    // db_changes fabric + @aisha/cache-redis consumers (moved off core redis)
    // + 1 federation broker (source-broker, tier=optional opt-in): svc-source-
    // broker, provisioned only when SOURCE_API_URL is set (federation onboarding)
    // (− 2 fleet connectors, 2026-07-26: webdispecink retired — Eurowag is its
    // newer version — and tcars became plugins/tcars-fleet. Neither is an app
    // any more: a vendor connector is a plugin, so an install that does not
    // use it never builds it either.)
    // + 1 domain-services fleet (domain-services, tier=optional): svc-stripe/
    // push/blockchain/fio-bank/homeassistant/github-app/health-ai/livekit/
    // communications/packeta + storage-auth — extracted to a sibling stack
    // (core is at the ARG_MAX ceiling); the core gateway reaches each
    // cross-stack by its ROUTE_TABLE-default alias.
    // + 1 monitoring/Dozzle log viewer (tier=optional ops surface, 2026-07-13):
    // aisha-monitoring = dozzle + dozzle-auth (Keycloak OIDC via studio-proxy),
    // wired into the manifest + redeploy wave 6 so cold-start creates it and the
    // resolver's logs.* domain has a real deploy target (was excluded pending this).
    // + 1 pgadmin admin stack (2026-07-15): pgadmin + pgadmin-auth (Keycloak OIDC
    // via studio-proxy) — extracted from core to a sibling to keep core compose
    // under the ARG_MAX gate; deploys in wave 4 alongside aisha-admin.
    // − 2 fleet connectors (2026-07-26): webdispecink retired (Eurowag is its
    // newer version) and tcars moved to plugins/, so neither is a deployed app
    // any more. A plugin is not in the manifest at all — that is the point of
    // the move: optional at BUILD time, not just at deploy time.
    // + 1 extranet (2026-07-29, tier=optional opt-in via EXTRANET_ENABLED): the
    // customer surface. It had been running in Coolify for weeks as a hand-made
    // "dockerfile app" — outside every registry, so NOTHING deployed it and it
    // stood on a commit from the previous night while three PRs merged past it.
    // No gate noticed, because no gate knew it should exist. It is now a stack
    // like the others: own container + compose, edge routes its public host.
    // ODVOZENO, ne připíchnuté (2026-08-11). Číslo tu stálo natvrdo a rostlo
    // s každým novým stackem — tři warmup aplikace ho posunuly z 28 na 31 a
    // brána spadla na změně, kterou měla pustit. Chráněná vlastnost není
    // KOLIK aplikací manifest má, ale že doctor napočítá TOLIK, KOLIK jich
    // v manifestu je: měřidlo souhlasí s pramenem.
    //
    // (Fork dospěl k témuž souboru z druhé strany: přidával `+1 livekit` k
    // připíchnuté 29. LiveKit byl „wave orphan" — compose se z repa STAVĚL,
    // appka v Coolify BĚŽELA, ale manifest o ní nevěděl, takže byla neviditelná
    // pro cold-start, doctor i drift-check a `--only` na ni nedosáhlo. Odhalila
    // to brána `stack-bez-deploy-ulohy`, jejíž univerzum je DISK: compose
    // s `build:` musí být v manifestu. Odvozený počet takové přidání pustí sám —
    // proto tady zůstává odvození, ne nové pevné číslo.)
    // Count the manifest the doctor ACTUALLY resolved, not the upstream
    // default's. An instance legitimately deploys a different set: it may
    // exclude an app whose fixed host ports collide with a co-tenant (measured
    // 2026-08-12 — livekit publishes 3478/5349 and lost that race on a shared
    // host). Pinned to aisha.manifest, this gate turned every such decision into
    // a test failure while the doctor was reporting its own count correctly.
    // Same correction as the manifest PATH below and as coolify-drift-check:
    // one resolver, not a second opinion.
    const vManifestu = (readFileSync(join(ROOT, manifestRelFor(ROOT)), "utf-8")
      .match(/^app:\s*\S+/gm) || []).length;
    expect(vManifestu, "manifest musí nést aplikace, jinak brána nemá co měřit").toBeGreaterThan(13);
    expect(r.stdout).toMatch(new RegExp(`Manifest has ${vManifestu} apps`));
  });

  test("Federation readiness (Phase H) is a clean no-op when SOURCE_API_URL is unset", () => {
    const r = runDoctor(["--phase", "H", "--no-network"]);
    // Opt-in safety: a non-federated fork must see a PASS no-op, never a failure.
    expect(r.stdout).toMatch(/Federation readiness/);
    expect(r.stdout).toMatch(/Federation disabled \(SOURCE_API_URL unset\)/);
    expect(r.stdout).not.toMatch(/MISSING/);
  });

  test("Federation readiness (Phase H) validates the wiring when SOURCE_API_URL is set", () => {
    const r = runDoctor(["--phase", "H", "--no-network"], {
      SOURCE_API_URL: "https://api.example.test",
    });
    // With federation enabled the doctor confirms the canonical broker component
    // + its manifest registration are present (correct-by-construction).
    expect(r.stdout).toMatch(/Broker compose present/);
    expect(r.stdout).toMatch(/Broker registered in the manifest/);
    expect(r.stdout).not.toMatch(/dev \/sync bypass is ON/);
  });

  test("Federation readiness (Phase H) flags the dev /sync bypass as a prod risk", () => {
    const r = runDoctor(["--phase", "H", "--no-network"], {
      SOURCE_API_URL: "https://api.example.test",
      BROKER_DEV_ALLOW_UNAUTHED_SYNC: "true",
    });
    // Security: if the dev bypass leaks into a federated env, the doctor warns.
    expect(r.stdout).toMatch(/BROKER_DEV_ALLOW_UNAUTHED_SYNC=true/);
    expect(r.stdout).toMatch(/must be unset in prod/);
  });

  test("All required cold-start scripts present", () => {
    const r = runDoctor(["--phase", "B", "--no-network"]);
    // Manifest path is story-aware (config/tenant.env → AISHA_STORY; default
    // `aisha` upstream). Mirrors aisha-cold-start.sh:63 + the doctor's own STORY.
    // Ask the SHARED resolver which manifest this checkout targets — the same
    // scripts/lib/coolify-instance-scope.mjs the doctor, story-init and
    // drift-check use. Re-deriving it here from one file was the defect: the
    // regex read config/tenant.env only, so a checkout that declares its
    // instance any OTHER way (APP_NAME_PREFIX, .env.coolify) fell back to the
    // upstream default and the gate demanded `aisha.manifest` while the doctor
    // correctly reported its own (measured 2026-08-12 on a fork whose instance
    // layer had moved out of the repo: doctor said <fork>.manifest,
    // gate insisted on aisha.manifest, and the disagreement was the gate's).
    //
    // Same correction coolify-drift-check.mjs already got: one resolver, not a
    // second opinion. Falling back to the upstream default keeps a checkout
    // that declares nothing (plain upstream CI) passing exactly as before.
    const manifestRel = manifestRelFor(ROOT);
    const expected = [
      manifestRel,
      "scripts/aisha-cold-start.sh",
      "scripts/aisha-redeploy.mjs",
      "scripts/coolify-story-init.sh",
      "scripts/coolify-deploy-init.sh",
      "scripts/coolify-sync-envs.sh",
      "scripts/aisha-env-doctor.mjs",
      "scripts/preflight-compose.sh",
      "infra/postgres/set-passwords.sh",
      "infra/postgres/entrypoint-wrapper.sh",
    ];
    for (const f of expected) {
      expect(r.stdout).toContain(f);
    }
  });

  test("coolify-story-init retries app creation on transient API failure", () => {
    // Cold-start creates 13 apps sequentially; a single transient
    // unparseable response from Coolify aborted the whole orchestration
    // before we hardened it. The retry+server-side-recheck pattern lets
    // a hiccup self-heal without manual intervention.
    const storyInit = readFileSync(
      join(ROOT, "scripts/coolify-story-init.sh"),
      "utf8",
    );

    // Retry loop with bounded attempts
    expect(
      storyInit,
      "Application create MUST retry on unparseable response — single transient curl/jq failure must not abort cold-start.",
    ).toMatch(/for\s+create_attempt\s+in\s+1\s+2\s+3/);

    // Server-side idempotency recheck after empty response (response may
    // have been truncated even though server completed the create)
    expect(
      storyInit,
      "Retry path MUST recheck /applications GET — Coolify may have completed create even if response body was truncated.",
    ).toMatch(/Created on retry-recheck/);

    // Failure message clearly states retry attempts exhausted
    expect(
      storyInit,
      "Final failure must mention 3 attempts so logs are diagnostic.",
    ).toMatch(/Failed to create[^\n]+after\s+3\s+attempts/);
  });

  test("coolify-story-init reconciles partial state on re-run (heals broken creates)", () => {
    // 2026-05-24: Cold-start wipe stopped at 15/16 apps because Coolify v4
    // POST /applications/public returned a UUID for aisha-exec but corrupted
    // the body (git_repository=bare path instead of full URL, raw=NULL). The
    // follow-up PATCH had no `|| warn` soft-fail wrapper, so a transient
    // API stall killed the whole script via `set -euo pipefail`.
    //
    // Worse: re-running cold-start hit "Already exists" branch which `continue`s
    // without reconciling — so the half-broken app would never self-heal.
    //
    // Fix: extract PATCH-git + PATCH-raw + drift-verify into reconcile_app_config()
    // helper, called from BOTH the create-path AND the already-exists-path.
    // Idempotent reconcile heals partial state on every re-run.
    const storyInit = readFileSync(
      join(ROOT, "scripts/coolify-story-init.sh"),
      "utf8",
    );

    // 1. Helper must exist
    expect(
      storyInit,
      "reconcile_app_config() helper MUST be defined — encapsulates PATCH-git + PATCH-raw + drift-verify with soft-fail on transient API errors.",
    ).toMatch(/^reconcile_app_config\(\)\s*\{/m);

    // 2. Helper called from "Already exists" path (heals partial state on re-run)
    expect(
      storyInit,
      "'Already exists' branch MUST call reconcile_app_config — otherwise partial creates from a prior aborted cold-start never self-heal.",
    ).toMatch(/Already exists[\s\S]+?reconcile_app_config "\$existing_uuid"/);

    // 3. Helper called after fresh create (replaces inline PATCH that died via set -e)
    expect(
      storyInit,
      "Post-create path MUST call reconcile_app_config — replaces inline PATCH that lacked soft-fail.",
    ).toMatch(/Created: \$\{APP_NAME\}[\s\S]+?reconcile_app_config "\$uuid"/);

    // 4. PATCH calls inside the helper must soft-fail (warn-on-error, not abort)
    //    Otherwise a single transient API stall kills the whole script.
    expect(
      storyInit,
      "Git PATCH inside reconcile_app_config MUST have soft-fail branch ('Git PATCH failed' warn) — set -euo pipefail kills the whole script on hard exit.",
    ).toMatch(/Git PATCH failed[^|]*will retry/);

    // 5. Drift verification must record git-config-drift as failure (poll-with-
    //    backoff, then FAIL if still empty) — Coolify v4 has a PATCH→GET cache
    //    race (~5-15s) for git_repository.
    expect(
      storyInit,
      "Reconcile MUST verify final state and record `:git-config-drift` in FAILURES — otherwise broken apps surface silently at deploy time.",
    ).toMatch(/FAILURES\+=\(['"]\$\{role\}:git-config-drift['"]\)/);

    // 5b. docker_compose_raw is a Coolify v4 READ-ONLY field — populated by
    // Coolify's background git-fetcher after app creation (PATCH returns
    // HTTP 422 "field not allowed"). Story-init polls until populated; if
    // still empty after the poll, it's logged as transient warning (NOT
    // FAILURE) since deploy will trigger Coolify to read git regardless.
    // The check below catches accidental regression — if FAILURE is ever
    // recorded for compose-raw-empty, that's the iter 22e bug coming back.
    expect(
      storyInit,
      "Reconcile MUST poll docker_compose_raw (Coolify v4 cache race) and treat empty as transient, NOT FAILURE — see iter 22e for context.",
    ).toMatch(/docker_compose_raw populated by Coolify/);
    expect(
      storyInit,
      "compose-raw-empty must NOT be recorded as a FAILURE (iter 22e finding: Coolify v4 docker_compose_raw is read-only via PATCH, auto-populated from git).",
    ).not.toMatch(/FAILURES\+=\(['"]\$\{role\}:compose-raw-empty['"]\)/);
  });

  test("cold-start --skip-create still reconciles existing apps' config", () => {
    // Sister-fix to story-init reconcile: --skip-create now also calls
    // story-init.sh so existing apps
    // get their git+compose+raw reconciled to manifest desired state.
    // Without this, a re-run after a partial wipe-failure couldn't heal
    // broken apps without going through a full --wipe again.
    const coldStart = readFileSync(
      join(ROOT, "scripts/aisha-cold-start.sh"),
      "utf8",
    );

    // The --skip-create path must invoke story-init.sh for reconcile
    expect(
      coldStart,
      "--skip-create MUST invoke coolify-story-init.sh to reconcile existing apps' git+compose+raw (idempotent heal-on-rerun).",
    ).toMatch(/Reconciling git config[\s\S]+?coolify-story-init\.sh[\s\S]+?--manifest/);
  });

  test("coolify-deploy-init validates JSON before piping to jq (errexit safety)", () => {
    // Under `set -euo pipefail`, a jq parse error on truncated Coolify
    // response makes the pipe return non-zero, which makes errexit
    // abort the entire deploy-init script. Verification reads must
    // gate JSON parseability with a `jq -e 'type == "object"'` check
    // BEFORE piping to a value-extracting jq, otherwise a single
    // truncated /applications/{uuid} GET aborts the cold-start.
    const deployInit = readFileSync(
      join(ROOT, "scripts/coolify-deploy-init.sh"),
      "utf8",
    );

    // The verify-domains loop must validate JSON shape first
    expect(
      deployInit,
      "set_coolify_domains verification MUST gate jq with `type == \"object\"` parse check — otherwise truncated GET aborts deploy-init via errexit+pipefail.",
    ).toMatch(/jq -e 'type == "object"'/);

    // The value-extracting jq must redirect stderr (so even on parse
    // failure it does not propagate via pipefail).
    expect(
      deployInit,
      "Value-extracting jq calls in domain verification must redirect stderr to /dev/null and have || fallback to avoid errexit on transient parse failures.",
    ).toMatch(/jq -r '\.docker_compose_domains[^\n]*2>\/dev\/null \|\| echo/);
  });

  test("set_coolify_domains retries PATCH when Coolify silently drops the write", () => {
    // Coolify v4 quirk: PATCH /applications/{uuid} with docker_compose_domains
    // can return 200 + uuid in body but the value is NOT persisted. A naive
    // implementation that only checks the PATCH response would return success
    // even though the route is broken. The verify+retry loop must re-issue
    // the PATCH (not just warn) when the GET shows null afterward.
    const deployInit = readFileSync(
      join(ROOT, "scripts/coolify-deploy-init.sh"),
      "utf8",
    );

    // The retry loop must re-PATCH on silent drop, not just warn-and-continue.
    expect(
      deployInit,
      "set_coolify_domains MUST re-issue the PATCH if GET shows null after a 'successful' PATCH — Coolify v4 silently drops some writes.",
    ).toMatch(/PATCH \$\{attempt\}\/3 was silently dropped[^\n]*retrying PATCH/);

    // The function must distinguish persisted vs silently-dropped state.
    expect(
      deployInit,
      "Function must track 'persisted' state explicitly so the final return reflects whether the write actually stuck.",
    ).toMatch(/persisted=1/);
  });

  test("cold-start runs domain-doctor --apply after step 4 to recover silent drops", () => {
    // After deploy-init's 3-retry PATCH, persistent silent-drops still happen
    // under sustained Coolify load. domain-doctor --apply runs as a final
    // recovery pass BEFORE wave deploy (step 5). This catches anything
    // set_coolify_domains missed and ensures wave deploys get correct
    // Traefik labels baked in on first build.
    const coldStart = readFileSync(
      join(ROOT, "scripts/aisha-cold-start.sh"),
      "utf8",
    );

    // Look for the recovery pass between coolify-sync-envs success and
    // step 4b (network verification).
    expect(
      coldStart,
      "cold-start must run `coolify-domain-doctor.mjs --apply` after step 4 (env+domains) and BEFORE step 5 (wave deploy) — recovers silent-drop PATCHes that set_coolify_domains' retry loop missed.",
    ).toMatch(/coolify-domain-doctor\.mjs --apply[^\n]*<\/dev\/null/);

    // Comment must explain why this exists (so future maintainers don't
    // remove it as redundant with the post-deploy doctor pass).
    expect(
      coldStart,
      "Pre-deploy domain-doctor block must include the 'silent-drop' rationale comment so the second invocation (post-deploy) isn't deleted as duplicate.",
    ).toMatch(/silent-drop[\s\S]{0,800}coolify-domain-doctor\.mjs --apply/);
  });
});

/**
 * Doktor pouštěný ASYNCHRONNĚ — kvůli testům, které mu podstrčí místní HTTP server.
 * `execFileSync` by zablokoval smyčku událostí a server by doktorovi nikdy neodpověděl.
 */
function runDoctorAsync(args: string[], extraEnv: Record<string, string> = {}): Promise<DoctorRun> {
  return new Promise((vysledek) => {
    execFile(
      "bash",
      [DOCTOR, ...args],
      { cwd: ROOT, env: prostrediDoktora(extraEnv), encoding: "utf-8", timeout: 300_000 },
      (err, stdout, stderr) =>
        vysledek({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        }),
    );
  });
}

/** Výstup doktora bez ANSI barev — tvrzení míří na text, ne na escape sekvence. */
// ESC se skládá z kódu znaku — regex literál s řídicím znakem odmítá lint (no-control-regex).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const bezBarev = (t: string) => t.replace(ANSI, "");

// ============================================================================
// Fáze D: počet stacků se čte BEZ BAREV a proti celku, který ohlásil preflight
// ============================================================================
// ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci: „Compose validuje proti ČERSTVĚ sestavenému envu
// (0 stacku)" nad během, kde prošlo 34 souborů. Doktor počítal `grep -cE "^   .*OK$"`
// nad výstupem `echo -e "${G}OK${N}"` — řádek končí `ESC[0m`, kotva netrefila nic.
describe("cold-start-doctor.sh — fáze D počítá stacky", () => {
  const PRAVIDLO = join(ROOT, "scripts/lib/preflight-compose-pocet.awk");
  const E = "\x1b";
  const obarveny = [
    `   ${E}[1;33mSkipping 1 overlay file(s) (not standalone-valid):${E}[0m`,
    "     - docker-compose.coolify.netseg.yml",
    `${E}[0;34mℹ${E}[0m preflight-compose: 3 file(s) (3 with env, 0 structure-only)`,
    `   docker-compose.coolify-admin.yml                 ${E}[0;32mOK${E}[0m`,
    `   docker-compose.coolify-ai-chat.yml               ${E}[0;31mFAIL${E}[0m`,
    '            time="…" level=warning msg="The \\"note\\" variable is not set."',
    `   docker-compose.coolify.yml                       ${E}[0;32mOK${E}[0m`,
    "",
  ].join("\n");

  const spocitej = (vstup: string) => {
    const r = spawnSync("awk", ["-f", PRAVIDLO], { input: vstup, encoding: "utf8", timeout: 30_000 });
    expect(r.status, `awk selhal: ${r.stderr}`).toBe(0);
    return r.stdout.trim();
  };

  test("pravidlo počítá obarvený výstup a vydá i celek, který preflight ohlásil", () => {
    expect(spocitej(obarveny)).toBe("ok=2 fail=1 celkem=3");
  });

  test("sonda jde rozsvítit — dřívější `grep -cE \"^   .*OK$\"` nad týmž výstupem napočítá NULU", () => {
    // Tentýž výraz, jaký doktor používal (grep -E ≙ JS regex pro tenhle tvar).
    const stareMeridlo = obarveny.split("\n").filter((r) => /^ {3}.*OK$/.test(r)).length;
    expect(stareMeridlo, "staré měřidlo už obarvený řádek vidí — fixtura přestala měřit vadu").toBe(0);
    expect(spocitej(obarveny)).not.toBe("ok=0 fail=1 celkem=3");
  });

  test("bez řádku s celkem pravidlo celek NEVYMÝŠLÍ", () => {
    expect(spocitej(`   a.yml  ${E}[0;32mOK${E}[0m\n`)).toBe("ok=1 fail=0 celkem=");
  });

  test("doktor počítá přes pravidlo a nesoulad s celkem hlásí jako NEZMĚŘENO, ne jako číslo", () => {
    const kod = readFileSync(DOCTOR, "utf8")
      .split("\n")
      .filter((r) => !/^\s*#/.test(r))
      .join("\n");
    const d = kod.slice(kod.indexOf('phase D "'), kod.indexOf("Phase E"));
    expect(d, "fáze D v doktorovi nenalezena").not.toBe("");
    expect(d, "fáze D musí počítat přes lib/preflight-compose-pocet.awk").toMatch(/preflight-compose-pocet\.awk/);
    expect(d, "obarvený výstup se nesmí počítat kotvou `OK$`").not.toMatch(/grep -cE "\^ {3}\.\*(OK|FAIL)\$"/);
    expect(d, "nesoulad počtu s ohlášeným celkem musí být nález (NEZMĚŘEN)").toMatch(/NEZMĚŘEN/);
  });
});

// ============================================================================
// Fáze K: servíruje Keycloak realm instance?
// ============================================================================
// ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci: kontejner Keycloaku healthy, veřejná
// tvář 404 na /realms/<realm>/.well-known/openid-configuration — a doktor to neměřil vůbec.
// Brána pouští SKUTEČNOU fázi K proti místnímu serveru (KEYCLOAK_PUBLIC_URL je
// výslovný operátorský override adresy, týž jako v netbird-peer-discover.mjs).
describe("cold-start-doctor.sh — fáze K měří realm", () => {
  async function sServerem(stav: (cesta: string) => number, args: string[], env: Record<string, string>) {
    const cesty: string[] = [];
    const server = createServer((req, res) => {
      cesty.push(req.url ?? "");
      res.statusCode = stav(req.url ?? "");
      res.end("{}");
    });
    await new Promise<void>((hotovo) => server.listen(0, "127.0.0.1", () => hotovo()));
    const adresa = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const r = await runDoctorAsync(args, { KEYCLOAK_PUBLIC_URL: adresa, ...env });
      return { ...r, stdout: bezBarev(r.stdout), cesty };
    } finally {
      server.close();
    }
  }
  const REALM = "zkusebni-realm";
  const DISCOVERY = `/realms/${REALM}/.well-known/openid-configuration`;

  test("realm, který Keycloak neservíruje (404) → VAROVÁNÍ s vysvětlením, exit 2, ne fail", { timeout: 300_000 }, async () => {
    const r = await sServerem(() => 404, ["--phase", "K"], { KEYCLOAK_REALM: REALM });
    expect(r.cesty, "doktor se na realm vůbec neptal").toContain(DISCOVERY);
    expect(r.stdout).toMatch(new RegExp(`Keycloak NESERVÍRUJE realm '${REALM}' \\(HTTP 404`));
    expect(r.stdout, "vysvětlení, proč to cold-start neblokuje, chybí").toMatch(/Cold-start to NEBLOKUJE/);
    expect(r.stdout).not.toMatch(/NOT READY/);
    expect(r.exitCode).toBe(2);
  });

  test("sonda jde rozsvítit i opačně — realm servírovaný (200) → OK, exit 0", { timeout: 300_000 }, async () => {
    const r = await sServerem((c) => (c === DISCOVERY ? 200 : 404), ["--phase", "K"], { KEYCLOAK_REALM: REALM });
    expect(r.stdout).toMatch(new RegExp(`Keycloak servíruje realm '${REALM}'`));
    expect(r.exitCode).toBe(0);
  });

  test("--no-network: realm NEZMĚŘEN a na síť se nesahá", { timeout: 300_000 }, async () => {
    const r = await sServerem(() => 200, ["--phase", "K", "--no-network"], { KEYCLOAK_REALM: REALM });
    expect(r.cesty, "--no-network přesto sáhl na síť").toEqual([]);
    expect(r.stdout).toMatch(/realm instance NEZMĚŘEN/);
    expect(r.stdout).not.toMatch(/servíruje realm/);
  });

  test("nedeklarovaný realm se NEDOSAZUJE — NEZMĚŘEN a žádný dotaz", { timeout: 300_000 }, async () => {
    const r = await sServerem(() => 200, ["--phase", "K"], { KEYCLOAK_REALM: "" });
    expect(r.cesty.filter((c) => c.startsWith("/realms/"))).toEqual([]);
    expect(r.stdout).toMatch(/KEYCLOAK_REALM není deklarovaná/);
  });
});

// ============================================================================
// Fáze N: „shoda pohledů NEZMĚŘENA" musí nést PŘÍČINU, ne první řádek výstupu
// ============================================================================
// ⛔ NAMĚŘENO 2026-09-13: doktor hlásil „mesh: shoda pohledů NEZMĚŘENA — [netbird-peer-
// discover] sonda Keycloaku přeskočena: KEYCLOAK_REALM není deklarovaná". Bral `head -1`
// sloučeného stdout+stderr, tedy řádek, který discovery napsala PRVNÍ — ne verdikt ani
// příčinu (ta stojí v `[netbird-peer-discover] fetch failed: …`). Po doručení realmu
// by `head -1` ukázal zase jen jiný mezikrok.
function vetevNezmereno(doktor: string): string {
  const kod = doktor
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");
  const i = kod.indexOf("scripts/mesh-self-vs-peers.mjs");
  if (i < 0) return "";
  const blok = kod.slice(i, kod.indexOf("esac", i));
  const j = blok.search(/\n\s*\*\)/);
  return j < 0 ? "" : blok.slice(j);
}
const hlasiPricinu = (vetev: string) =>
  /fetch failed:/.test(vetev) && !/warn "[^"\n]*NEZMĚŘENA — \$\(echo "\$_msvp" \| head -1\)"/.test(vetev);

describe("cold-start-doctor.sh — fáze N hlásí příčinu nezměřené shody", () => {
  test("větev NEZMĚŘENO hlásí příčinu z discovery (`fetch failed:`), ne první řádek výstupu", () => {
    const vetev = vetevNezmereno(readFileSync(DOCTOR, "utf8"));
    expect(vetev, "větev `*)` sondy mesh-self-vs-peers v doktorovi nenalezena").not.toBe("");
    expect(hlasiPricinu(vetev)).toBe(true);
  });

  test("sonda jde rozsvítit — tvar do 2026-09-13 by chytila", () => {
    const stary = [
      '  _msvp="$(node "$REPO_ROOT/scripts/mesh-self-vs-peers.mjs" 2>&1)"; _msvp_rc=$?',
      '  case "$_msvp_rc" in',
      '    0) ok "mesh: pohled zevnitř a pohled managementu se SHODUJÍ" ;;',
      '    *) warn "mesh: shoda pohledů NEZMĚŘENA — $(echo "$_msvp" | head -1)" ;;',
      "  esac",
    ].join("\n");
    expect(hlasiPricinu(vetevNezmereno(stary))).toBe(false);
  });
});

// ============================================================================
// Existující stack bez minulého souboru prostředí (revize dávky 2026-10-03)
// ============================================================================
//
// Minulý soubor prostředí je vlastnost STROMU (není v gitu), ne instance: v čerstvém klonu,
// v jiném pracovním stromu nebo na jiném stroji chybí. Nad existujícím stackem je to přitom
// VSTUP kroku 2 — kontinuita držených hodnot (major databáze) a pinů operátora. Do 2026-10-03
// krok 2 kontrolu při chybějícím souboru tiše přeskočil a doktor hlásil jen varování.
describe("Phase C — existující stack bez minulého souboru prostředí", () => {
  test("⛔ --stack-exists a soubor chybí nebo je prázdný → FAIL; bez existujícího stacku jen varování", () => {
    const dir = mkdtempSync(join(tmpdir(), "doktor-kontinuita-"));
    const chybi = join(dir, "neni.env");
    const prazdny = join(dir, "prazdny.env");
    writeFileSync(prazdny, "");
    for (const soubor of [chybi, prazdny]) {
      const r = runDoctor(["--phase", "C", "--no-network", "--stack-exists"], { ENV_FILE: soubor });
      expect(r.exitCode, `${soubor}\n${r.stdout}`).toBe(1);
      expect(r.stdout).toMatch(/kontinuita držených hodnot a pinů NEMĚŘENA/);
    }
    // KOTVA: první založení — soubor ještě být nemá (krok 2 ho vyrobí), FAIL kontinuity nesmí přijít.
    const prvni = runDoctor(["--phase", "C", "--no-network"], { ENV_FILE: chybi });
    expect(prvni.stdout).not.toMatch(/kontinuita držených hodnot/);
    expect(prvni.stdout).toMatch(/missing — cold-start ji vygeneruje/);
  });

  test("doktor měří TUTÉŽ zálohu, kterou cold-start předává kroku 2 (ENV_PROD_BACKUP)", () => {
    // Cold-start exportuje ENV_PROD_BACKUP; doktor ji do 2026-10-03 nečetl a měřil záložní soubor
    // v kořeni stromu — u ne-produkčního prostředí nebo běhu z jiného pracovního stromu jiný soubor,
    // než ze kterého krok 2 bere vstupy. Výslovný přepis (izolace testů) má dál přednost.
    const doktor = readFileSync(DOCTOR, "utf8");
    expect(doktor).toMatch(
      /^PROD_BACKUP_FILE="\$\{AISHA_PROD_BACKUP_FILE:-\$\{ENV_PROD_BACKUP:-\$REPO_ROOT\/\.env-prod-backup\}\}"$/m,
    );
    const cs = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
    expect(cs).toMatch(/^export ENV_FILE="\$ENV_COOLIFY" ENV_PROD_BACKUP$/m);
  });

  test("⛔ zálohu doktor ČTE, nevykonává — hodnota s `|`, mezerou nebo `$(…)` nic nespustí (týž čtenář jako krok 2)", () => {
    // NAMĚŘENO 2026-10-04: `set -a; . zaloha` vykonal holou hodnotu `a|touch <soubor>` (soubor vznikl)
    // a do logu poslal kus jiné hodnoty jako „command not found“. Záloha vzniká i stažením env
    // z Coolify, takže hodnota aplikace by se vykonala na stroji operátora.
    const dir = mkdtempSync(join(tmpdir(), "doktor-zaloha-"));
    const znacky = [join(dir, "z-roura"), join(dir, "z-substituce")];
    const zaloha = join(dir, "zaloha.env");
    writeFileSync(
      zaloha,
      [
        `HODNOTA_S_ROUROU=a|touch ${znacky[0]}`,
        "HOLA_S_MEZEROU=prvni druhe-slovo-ktere-nesmi-byt-prikaz",
        `HODNOTA_SE_SUBSTITUCI=$(touch ${znacky[1]})`,
        // řídicí proměnnou běhu čtenář cold-startu přeskočí a ohlásí — kotva, že čte on
        "DRY_RUN=0",
        "",
      ].join("\n"),
    );
    const r = spawnSync("bash", [DOCTOR, "--phase", "C", "--no-network"], {
      cwd: ROOT,
      env: prostrediDoktora({ AISHA_PROD_BACKUP_FILE: zaloha }),
      encoding: "utf8",
    });
    const vystup = `${r.stdout}\n${r.stderr}`;
    expect(znacky.filter((z) => existsSync(z)), vystup).toEqual([]);
    expect(vystup).not.toMatch(/command not found/);
    expect(vystup).not.toMatch(/druhe-slovo-ktere-nesmi-byt-prikaz/);
    expect(vystup, "zálohu nečte čtenář cold-startu (load_env_file_keys)").toMatch(/nese řídicí proměnnou DRY_RUN — ignoruji/);
  });
});
