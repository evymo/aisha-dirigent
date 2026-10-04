/**
 * CI Deploy Honesty — Integral Design Gate
 *
 * Deployment here is MANUAL by design: `node scripts/aisha-redeploy.mjs --only=<app>`
 * (with `--status` / `--plan` to look before touching anything). The Coolify
 * credentials deliberately do NOT live in CI, so the `Deploy: *` jobs in ci.yml
 * cannot deploy and are expected to no-op. That is a decision, not a defect —
 * this gate therefore does NOT demand they fail.
 *
 * What it does demand is that the no-op is ANNOUNCED. Measured 2026-07-30:
 * `Deploy: Web` and `Deploy: Extranet` reported success in 4 seconds on runs 168
 * and 178 while production sat 12 commits behind on #31, and reading the green
 * ticks as "deployed" cost half a day. A job that did nothing must say it did
 * nothing, and point at the path that actually deploys.
 *
 * Second property, the one that bit us for real: every deploy job must be
 * REACHABLE by the changes it deploys. The extranet image is built from
 * packages/surface-blocks + apps/<shell> + instances/<slug>
 * (deploy/surface-host/Dockerfile), none of which the `app` path filter matches,
 * and `services_change` (services/, plugins/) does not match apps/ either. So a
 * surfaces-only change ran NEITHER `test:surfaces` NOR `surfaces:build:all` and
 * deployed nothing — which is how #34 merged a shell that did not compile. Luck
 * is not a trigger, and an untested lane is not a lane.
 *
 * Third property, same family, measured 2026-08-02: the resolver reports two
 * different things and the caller has to tell them apart. `::notfound::` means
 * the app is not in Coolify — legitimate on an install that does not run it, so
 * skipping is right. `::error::` means the resolve itself broke (API silent, no
 * token, no JSON runtime) and NOTHING can be concluded about the app. While
 * every call site collapsed both into one warning + `exit 0`, a runner image
 * without `jq` turned every deploy job green without deploying anything, for
 * weeks. A caller that cannot distinguish "absent" from "blind" reports the
 * second as the first — which is the same green-tick lie the gate above exists
 * to stop, one layer down.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import yaml from "js-yaml";
import { duvodVynechanoSnapshotem } from "./lib/vynechano-snapshotem";

const ROOT = process.cwd();
const CI = join(ROOT, ".forgejo/workflows/ci.yml");

/**
 * Every workflow that resolves a Coolify UUID — not just ci.yml. deploy.yml is
 * the manual/dispatch lane and staging-deploy.yml the per-PR one; a fix applied
 * to ci.yml alone leaves the two lanes people actually deploy from still blind.
 */
const RESOLVER_WORKFLOWS = [
  ".forgejo/workflows/ci.yml",
  ".forgejo/workflows/deploy.yml",
  ".forgejo/workflows/staging-deploy.yml",
  ".github/workflows/deploy.yml",
];

/**
 * Workflow, které veřejný snapshot nevozí (config/public-snapshot.exclude), se
 * neměří — v tomhle stromu nejsou. Hlásí je samostatný PŘESKOČENÝ test s důvodem,
 * aby „změřeno 3 ze 4" nevypadalo jako „změřeno všechno". Upstream je má → měří.
 */
const VYNECHANE_WORKFLOWS = RESOLVER_WORKFLOWS.map((rel) => duvodVynechanoSnapshotem(rel)).filter(
  (d): d is string => d !== null,
);
const MERENE_WORKFLOWS = RESOLVER_WORKFLOWS.filter((rel) => duvodVynechanoSnapshotem(rel) === null);

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, unknown> };
type Job = { name?: string; if?: string; needs?: string[] | string; steps?: Step[] };

const wf = yaml.load(readFileSync(CI, "utf8")) as { jobs: Record<string, Job> };
const deployJobs = Object.entries(wf.jobs).filter(([, j]) =>
  String(j.name ?? "").startsWith("Deploy: ")
);

/** Guard blocks reacting to an absent Coolify token, with their bodies. */
function credentialGuards(run: string): string[] {
  const re = /if\s+\[\s+-z\s+"\$\{COOLIFY_API_TOKEN[^\n]*\n([\s\S]*?)^\s*fi\s*$/gm;
  return [...run.matchAll(re)].map((m) => m[1]!);
}

/** Every step, in every resolver workflow, that shells out to the UUID resolver. */
function resolverCallSites(): { where: string; run: string }[] {
  const sites: { where: string; run: string }[] = [];
  for (const rel of MERENE_WORKFLOWS) {
    const doc = yaml.load(readFileSync(join(ROOT, rel), "utf8")) as {
      jobs?: Record<string, Job>;
    };
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const run = step.run ?? "";
        if (run.includes("coolify-resolve-uuid.sh")) {
          sites.push({ where: `${rel} → ${id} / "${step.name ?? "<beze jména>"}"`, run });
        }
      }
    }
  }
  return sites;
}

/**
 * Bodies of `if`-blocks whose condition tests for the `::error::` marker.
 * Brace-free shell, so the close is found by matching `fi` at the same or lower
 * indent — enough for these hand-written guards and it fails loud, not silent,
 * if one ever gets nested deeper.
 */
function errorBranchBodies(run: string): string[] {
  const lines = run.split("\n");
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^\s*(el)?if\b/.test(line) || !line.includes("::error::")) continue;
    const indent = line.match(/^\s*/)![0].length;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const cur = lines[j]!;
      if (/^\s*(fi|elif|else)\b/.test(cur) && cur.match(/^\s*/)![0].length <= indent) break;
      body.push(cur);
    }
    bodies.push(body.join("\n"));
  }
  return bodies;
}

/**
 * Every `*_CACHEBUST` build ARG any Dockerfile actually declares. The universe
 * is READ, not hand-kept: a new overlay added to a Dockerfile shows up here by
 * itself, which is the whole point — a hand-kept list is what let the KC theme
 * overlay go stale unnoticed.
 */
function declaredCachebustArgs(): { key: string; where: string }[] {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/^Dockerfile/.test(e.name)) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/^ARG\s+([A-Z0-9_]*_CACHEBUST)\b/gm)) {
        if (!found.has(m[1]!)) found.set(m[1]!, p.slice(ROOT.length + 1));
      }
    }
  };
  walk(ROOT);
  return [...found].map(([key, where]) => ({ key, where }));
}

describe("CI deploy honesty (gate)", () => {
  test("every overlay cachebust a Dockerfile consumes has a producer on the REDEPLOY path", () => {
    // 2026-08-02: `KC_THEME_OVERLAY_CACHEBUST` was computed ONLY by
    // aisha-cold-start.sh, and there only `if [ -z ... ]`. A redeploy therefore
    // shipped whatever the overlay repo contained on the day of the FIRST
    // build — green, silent, and invisible until someone looked at the page.
    //
    // The rule: if a Dockerfile declares `ARG *_CACHEBUST`, some deploy path
    // must recompute it every run. Cold start alone does not count — it runs
    // once; deploys run forever.
    const args = declaredCachebustArgs();
    expect(args.length, "no ARG *_CACHEBUST found — has the overlay mechanism moved?")
      .toBeGreaterThan(0);

    // The produced set is EXTRACTED, not substring-matched. A mention in a
    // comment must not satisfy this gate, and `FOO_DISABLED` must not pass as
    // `FOO` — both of which a plain `includes()` happily accepted when this
    // gate was first written (caught by its own probe, 2026-08-02).
    //
    // ONLY aisha-redeploy.mjs counts. A provisioner that computes the value on
    // its own path (provision-surfaces.sh does, correctly) does NOT make the
    // value available when the deploy is triggered any other way — and that is
    // the hole this gate exists to close. Measured 2026-08-02: an instance extranet
    // failed to deploy three times on an empty SURFACE_OVERLAY_CACHEBUST while
    // provision-surfaces.sh sat in the repo computing it perfectly well.
    const produced = new Set<string>();
    const redeploy = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");
    for (const m of redeploy.matchAll(/\bbustKey:\s*"([A-Z0-9_]+)"/g)) produced.add(m[1]!);

    const orphans = args.filter((a) => !produced.has(a.key));
    expect(
      orphans,
      `A Dockerfile consumes these cachebusts, but no deploy path recomputes them —\n` +
      `BuildKit will reuse the cached clone and ship the overlay from the first build:\n` +
      orphans.map((o) => `  ${o.key}  (declared in ${o.where})`).join("\n") +
      `\n\nAdd it to OVERLAY_CACHEBUSTS in scripts/aisha-redeploy.mjs (or to the` +
      ` provisioning script that owns that image).`,
    ).toEqual([]);
  });

  test("the redeploy path expands config/domains.env, not just cold start", () => {
    // `config/domains.env` is a TEMPLATE: `ALLOWED_ORIGINS=https://${APP_DOMAIN},…`.
    // Only aisha-cold-start.sh expands it into .env.coolify, and
    // coolify-sync-envs.sh then pushes ONLY what .env.coolify already contains.
    // So a template edit never reaches a running service.
    //
    // Measured 2026-08-03: PR #113 added the auth origin to ALLOWED_ORIGINS, it
    // landed on main, and the gateway never saw it — the sign-in page sat on
    // "checking service status" because its preflight kept getting 403.
    //
    // Same family as the overlay cachebust above: a value with a producer on
    // exactly one path.
    const tmpl = readFileSync(join(ROOT, "config/domains.env"), "utf8");
    const composites = [...tmpl.matchAll(/^([A-Z0-9_]+)=[^\n]*\$\{/gm)].map((m) => m[1]!);
    expect(
      composites.length,
      "config/domains.env declares no composites — has the template moved?",
    ).toBeGreaterThan(0);

    const redeploy = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");
    expect(
      redeploy,
      "scripts/aisha-redeploy.mjs must expand config/domains.env before env-sync " +
      "(scripts/deploy/derive-composites.sh) — otherwise a domain/origin change " +
      "stays in git and never reaches the running service.",
    ).toContain("derive-composites.sh");
  });

  test("look-only modes win over every deploy path in aisha-redeploy.mjs", () => {
    // `--plan` exists to look without touching. On 2026-08-02 it did not:
    // `--plan --canary=keycloak` was run as a dry run DURING an outage and went
    // straight to a real force-redeploy, because the canary branch returned
    // before PLAN_ONLY was ever consulted. It stopped only because an unrelated
    // env-sync error happened to fire first.
    //
    // Measured structurally: inside main(), the canary dispatch must not be
    // reachable without PLAN_ONLY/STATUS_ONLY having been decided first.
    const src = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");
    const main = src.slice(src.indexOf("async function main()"));

    const iStatus = main.indexOf("if (STATUS_ONLY)");
    const iCanaryRun = main.indexOf("runCanary(");
    const iPlanInCanary = main.indexOf("if (PLAN_ONLY)");

    expect(iStatus, "main() no longer guards STATUS_ONLY").toBeGreaterThan(-1);
    expect(iCanaryRun, "main() no longer dispatches to runCanary").toBeGreaterThan(-1);
    expect(
      iStatus,
      "--status must be honoured BEFORE the canary path can deploy",
    ).toBeLessThan(iCanaryRun);
    expect(
      iPlanInCanary,
      "--plan must be honoured BEFORE runCanary() is called — a dry run must never deploy",
    ).toBeLessThan(iCanaryRun);
  });

  /**
   * Univerzum není prázdné — tvrzení níž by jinak byla vakuová.
   *
   * ⚠️ NEPŘIPÍNAT POČET. Do 2026-08-08 tu stálo `toBeGreaterThan(4)`, a když se
   * tři úlohy nad TOUŽ appkou `-core` (Web/Core/Keycloak) sloučily do jedné,
   * brána zčervenala nad ZLEPŠENÍM: jobů ubylo, tvrzení padlo, ačkoli měřená
   * vlastnost — „je co zkoumat" — platila dál. Pevné číslo měří pravopis
   * pipeline, ne to, co má chránit; navíc svádí opravit ho zpět rozmnožením
   * úloh. Stačí, že nějaké deploy úlohy JSOU a parser je našel.
   */
  test("ci.yml yields Deploy jobs to reason about", () => {
    expect(
      deployJobs.length,
      "v ci.yml nebyla nalezena ANI JEDNA deploy úloha — parser přestal sedět na tvar YAML",
    ).toBeGreaterThan(0);
  });

  test("every Deploy job is main-only", () => {
    for (const [id, job] of deployJobs) {
      expect(String(job.if ?? ""), `${id} must be gated on refs/heads/main`).toContain(
        "refs/heads/main"
      );
    }
  });

  test("a deploy job that cannot deploy ANNOUNCES it and names the manual path", () => {
    let guards = 0;
    for (const [id, job] of deployJobs) {
      for (const step of job.steps ?? []) {
        for (const body of credentialGuards(step.run ?? "")) {
          guards++;
          const where = `${id} / "${step.name}"`;
          // An annotation, so the no-op is visible in the run summary rather than
          // hiding behind a green tick.
          expect(body, `${where}: the no-op must raise an annotation, not pass in silence`)
            .toMatch(/::(warning|error)/);
          // …and it must point at what DOES deploy, or the reader is left to guess.
          expect(body, `${where}: say where deploys actually happen (aisha-redeploy.mjs)`)
            .toContain("aisha-redeploy.mjs");
        }
      }
    }
    // ⚠️ NEPŘIPÍNAT POČET (viz test výš). 2026-09-16 odešlo pět inline kopií
    // téhož kroku (deploy-infra: integration, langfuse, admin, llm-gateway,
    // openclaw) do sdíleného `nasad-podle-vln.sh` → `deploy-and-verify.sh`,
    // který bez pověření PADÁ (brána deploy-job-nesmi-lhat). Počet klesl
    // zlepšením; vlastnost „je co měřit" platí, dokud je aspoň jeden guard.
    expect(guards, "no COOLIFY_API_TOKEN guard found — gate lost its subject").toBeGreaterThan(0);
  });

  test("Deploy: Extranet triggers on the paths its image is actually built from", () => {
    const extranet = deployJobs.find(([, j]) => j.name === "Deploy: Extranet");
    expect(extranet, "Deploy: Extranet must exist").toBeTruthy();
    expect(
      String(extranet![1].if ?? ""),
      "gated on `app` alone, the extranet deploys only when a change happens to also touch src/ or aisha/db/sql/"
    ).toContain("detect.outputs.surfaces");

    // Směrování podle cest = jeden domov mimo ci.yml (scripts/ci/zmenene-cesty.sh); detect ho volá.
    const smerovani = readFileSync(join(ROOT, "scripts/ci/zmenene-cesty.sh"), "utf8");
    const rule = smerovani.split("\n").find((l) => l.includes("SURFACES=true"));
    expect(rule, "zmenene-cesty.sh must set SURFACES from a path filter").toBeTruthy();
    // extranet-sdk-ui + design-language joined the list in #152, when the extranet
    // shell was switched onto the SDK: it declares both as `dependencies` and imports
    // them at main.tsx (styles) and App.tsx (components), so `COPY . .` → `npm ci` →
    // `vite build -w apps/$SHELL_APP` bakes their source into the artifact exactly as
    // it does surface-blocks'. Until then an SDK-only PR skipped test:surfaces and
    // surfaces:build:all yet still redeployed a changed shell.
    for (const input of [
      "apps/",
      "packages/surface-blocks/",
      // SDK je od 2026-10-04 submodul (gitlink + obsah), ne adresář balíku.
      "packages/extranet-sdk/",
      "packages/design-language/",
      "deploy/surface-host/",
      "instances/",
    ]) {
      expect(rule, `surfaces filter must cover ${input} (built by deploy/surface-host/Dockerfile)`)
        .toContain(input);
    }
  });

  test.skipIf(VYNECHANE_WORKFLOWS.length > 0)(
    `všechny resolver workflow jsou ve stromu a měří se${VYNECHANE_WORKFLOWS.length ? ` — NEZMĚŘENO: ${VYNECHANE_WORKFLOWS.join("; ")}` : ""}`,
    () => {
      expect(MERENE_WORKFLOWS).toEqual(RESOLVER_WORKFLOWS);
    },
  );

  test("every resolver call site tells 'app absent' apart from 'resolve broke'", () => {
    const sites = resolverCallSites();
    // ⚠️ NEPŘIPÍNAT POČET — tentýž případ jako u guardů výš (2026-09-16: pět
    // inline volání resolveru nahradil sdílený skript).
    expect(
      sites.length,
      "no step calls coolify-resolve-uuid.sh — gate lost its subject"
    ).toBeGreaterThan(0);

    const blind = sites.filter((s) => !s.run.includes("::notfound::")).map((s) => s.where);
    expect(
      blind,
      `these steps branch on the resolver without ever testing ::notfound::, so a broken ` +
        `resolve is indistinguishable from an app that simply is not installed:\n  ` +
        blind.join("\n  ")
    ).toEqual([]);
  });

  test("no call site turns an ::error:: into a green skip", () => {
    const offenders: string[] = [];
    for (const site of resolverCallSites()) {
      for (const body of errorBranchBodies(site.run)) {
        // `exit 0` / `return 0` / an output flag that makes the caller skip: all
        // three end the step green while nothing was deployed and nothing is known.
        if (/\b(exit|return)\s+0\b|skip=true/.test(body)) offenders.push(site.where);
      }
    }
    expect(
      offenders,
      `an ::error:: branch must fail the job — infrastructure broke, so the app's state ` +
        `is unknown and "skipped" is a claim nobody measured:\n  ` + offenders.join("\n  ")
    ).toEqual([]);
  });

  /**
   * ⛔ NAMĚŘENO 2026-08-09 přímo v Coolify: `GIT_SHA` mělo u <fork>-edge i <fork>-core
   * hodnotu `'main'` — VĚTEV, ne commit. Zapsal ji provisioning jednou a žádné
   * nasazení ji nepřepsalo, protože `deploy-and-verify.sh` revizi jen VYPSAL.
   * `vite.config.ts` ji přes `define __GIT_SHA__` zapeče do bundlu, takže se
   * uživateli v build-info ukazovala větev jako verze.
   *
   * Měří se POŘADÍ, ne výskyt: Coolify čte env při STARTU buildu, takže zápis
   * po `POST /api/v1/deploy` by se projevil až v NÁSLEDUJÍCÍM nasazení —
   * artefakt by nesl revizi toho předchozího, což je hůř než žádná.
   */
  test("deploy zapíše revizi PŘED spuštěním buildu, ne po něm", () => {
    const skript = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
    // ⚠️ Hledá se VOLÁNÍ (`-X PATCH` / `-X POST`), ne cesta. Řetězec
    // `/api/v1/deploy` je i v úvodním komentáři, takže `indexOf` na samotnou
    // cestu vrací pozici PROZY o pár set řádků výš — a tenhle test pak měřil
    // pořadí komentáře vůči kódu. Chyceno při psaní téhle brány: spadla na
    // správném skriptu. Táž třída, jakou hlídá `stack-bez-deploy-ulohy`
    // (zmínka v `printf` není nasazení).
    const iZapis = skript.indexOf('-X PATCH "${COOLIFY_URL}/api/v1/applications/${UUID}/envs/bulk"');
    const iSpust = skript.indexOf('-X POST "${COOLIFY_URL}/api/v1/deploy');
    expect(
      iZapis,
      "deploy revizi nikam nezapisuje — `GIT_SHA` v Coolify pak zůstane, co tam kdysi dal provisioning"
    ).toBeGreaterThan(-1);
    expect(iSpust, "gate ztratil svůj předmět: POST /api/v1/deploy ve skriptu není").toBeGreaterThan(-1);
    expect(
      iZapis,
      "zápis revize je AŽ ZA spuštěním buildu — build ji tedy nepřečte a artefakt ponese tu předchozí"
    ).toBeLessThan(iSpust);
    // Coolify v4 drží per klíč DVA záznamy (production + preview) a při duplicitě
    // VYHRÁVÁ preview. Zápis jedné varianty proto neudělá nic — přesně proto
    // posílá `set_coolify_env` v coolify-deploy-init.sh tentýž klíč dvakrát.
    // Měří se, že se iteruje přes OBĚ hodnoty; samotný výskyt `is_preview`
    // nestačí, ten zůstane i když se cyklus zúží na jednu (chyceno mutací).
    expect(
      skript,
      "payload nenese is_preview — Coolify by nevěděl, kterou z dvojice záznamů přepsat"
    ).toMatch(/is_preview/);
    expect(
      skript,
      "zapisuje se jen JEDNA varianta; při duplicitě klíče vyhrává preview, takže samotný " +
        "production zápis se do buildu nepromítne"
    ).toMatch(/JE_PREVIEW in false true/);
    expect(
      skript,
      "prázdné GIT_SHA musí být PÁD — jinak se tiše nasadí artefakt, který nejde přiřadit ke commitu"
    ).toMatch(/GIT_SHA[^\n]*\n[^\n]*::error title=deploy nezná revizi/);
  });

  /**
   * ⛔ NAMĚŘENO 2026-08-10: `Deploy: Edge` skončil ZELENĚ za pár sekund a web dál
   * servíroval bundle ze 7. srpna — `last-modified`, etag i hashe bundlů beze
   * změny. Příčina: `POST /api/v1/deploy?…&force=false`. Coolify při něm nasazení
   * NEZALOŽÍ, když usoudí, že není co dělat; vrátí 2xx a nic nezařadí. Krok
   * „počkej na terminální stav" pak uvidí „deploys 0 active, 0 latest failed"
   * a ohlásí HOTOVO — nerozlišitelně od „nic se nenasadilo".
   *
   * Ruční `aisha-redeploy.mjs` tutéž appku nasadil na první pokus, protože posílá
   * `force=true`. Dva nástroje, dvě různá volání, jedno tiše nedělalo nic.
   *
   * Měří se VOLÁNÍ, ne výskyt řetězce: `force=false` smí zůstat v komentáři,
   * který tuhle vadu popisuje.
   */
  test("deploy se spouští s force=true a ověří, že se nasazení ZAŘADILO", () => {
    const skript = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
    const volani = skript
      .split("\n")
      .filter((r) => /-X POST "\$\{COOLIFY_URL\}\/api\/v1\/deploy/.test(r));
    expect(volani.length, "ve skriptu není ANI JEDNO volání POST /api/v1/deploy — gate ztratil předmět")
      .toBeGreaterThan(0);
    for (const r of volani) {
      expect(
        r,
        "deploy se spouští s force=false — Coolify pak nasazení nemusí vůbec založit, " +
          "vrátí 2xx a čekání na výsledek skončí zeleně, aniž se cokoli nasadilo"
      ).toContain("force=true");
    }
    // ⚠️ Měří se KONTROLA, ne slovo. `toContain("deployment_uuid")` by prošlo
    // i nad komentářem, který tuhle vadu jen POPISUJE — a takový komentář je
    // hned nad ní. Táž past jako u `indexOf("/api/v1/deploy")` výš: text není čin.
    expect(
      skript,
      "2xx je jen PŘIJETÍ; bez `deployment_uuid` z odpovědi se nepozná, že Coolify " +
        "požadavek přijal a zahodil — a není ani na co čekat"
    ).toMatch(/deployment_uuid/);

    // ⛔ Čekat se musí na TO nasazení, které jsme spustili. Globální
    // `/api/v1/deployments` vrací jen AKTIVNÍ; spadlé z něj zmizí a ještě
    // nezařazené se v něm neobjeví — obojí vypadá jako „0 active" = zeleno.
    // Naměřeno 2026-08-10: CI úloha skončila zeleně nad nasazením 07:04:35,
    // které mělo status `failed`. Seznam je navíc sdílený s CIZÍ instancí.
    expect(
      skript,
      "krok se neptá na KONKRÉTNÍ nasazení (`/api/v1/deployments/<uuid>`) — " +
        "globální seznam aktivních nasazení pád ani nezařazení nerozliší"
    ).toMatch(/\/api\/v1\/deployments\/\$\{NASAZENI\}/);
    expect(
      skript,
      "stav nasazení `failed` musí krok POLOŽIT; jinak se zeleně projde přes pád"
    ).toMatch(/failed\|cancelled\|canceled\|error\)/);

    // ⚠️ JSON se PARSUJE, negrepuje: odpověď je jednořádková a `"status"` je v ní
    // třikrát (mimo jiné vnořený stav APLIKACE `running:healthy`). Hladový výraz
    // vrací poslední výskyt — dnes náhodou správně, po přeházení polí ne.
    expect(
      skript,
      "stav nasazení se tahá textově; použij JSON parser a top-level pole, " +
        "jinak se dřív nebo později přečte zdraví aplikace místo výsledku nasazení"
    ).not.toMatch(/sed[^\n]*"status"/);
  });

  test("the surfaces lane runs the shell suites the web lane never touches", () => {
    const job = Object.values(wf.jobs).find((j) => j.name === "Surfaces: Contract & Overlays");
    expect(job, "the shells need a lane of their own — Web: Build builds the SPA, not them").toBeTruthy();
    expect(String(job!.if ?? "")).toContain("detect.outputs.surfaces");
    const runs = (job!.steps ?? []).map((s) => s.run ?? "").join("\n");
    expect(runs).toContain("npm run test:surfaces");
    expect(runs).toContain("npm run surfaces:build:all");
  });

  /**
   * SONDA ZA DVEŘMI — tři testy k jedné vadě (2026-09-05).
   *
   * CO SE STALO: `Deploy: Extranet` i `Deploy: Core` padaly na mainu, ačkoli
   * nasazení proběhlo správně (`apps 1/1 running, 0 bad`, u Core dokonce
   * `nasazená revize 814c8f37ca28 = 814c8f37ca28 ✓`, kontejnery healthy).
   * Sonda dostala 6/6 × HTTP 403.
   *
   * PROČ: 403 neposílá aplikace ani oauth2-proxy — posílá ho VRÁTNÝ.
   * `forward_auth http://svc-knock:3017 { uri /dvere }` visí na celém `:80`
   * edge-proxy a `EDGE_DOOR_MODE=enforce`. V logu svc-knock je KAŽDÝ dotaz
   * na /dvere 403; jediné 200 jsou jeho vlastní /health po loopbacku.
   *
   * ⛔ Hypotéza, která se NABÍZELA a byla ŠPATNĚ: že jde o `SKIP_PROVIDER_BUTTON`
   * v oauth2-proxy, který prohlížeči odpoví 302 a skriptu 403. Vyvrátil ji jeden
   * pokus — `curl` na týž povrch s `Accept: text/html` i bez něj dal SHODNĚ 403.
   * Proto se tu dveře NEODVOZUJÍ z odpovědi: věrohodné vysvětlení není důkaz.
   *
   * ⭐ Za dveře se z CI dostat NELZE a nemá se: „ťuká vždy jen člověk".
   * A vnitřní cestou to taky nejde — krok 7 skriptu si to zakazuje sám
   * („runner do meshe nevidí; pustit ho tam by dalo kódu z libovolného PR
   * přístup k vnitřním službám"). Zbývají tedy TŘI výsledky, ne dva:
   * dokázáno / NEMĚŘENO (dveře) / pád.
   *
   * ⭐ Táž úvaha už v repu jednou proběhla — u `--verify-url`, který je proto
   * jen DOPLŇKOVÝ důkaz („ostré dveře … měřidlo tiše měří DVEŘE místo
   * artefaktu"). U `--health-url` zůstala nedotažená. Tohle je druhá půlka.
   */
  test("každá úloha se sondou VYSLOVILA, jestli povrch stojí za dveřmi", () => {
    // Týž `wf`, který čtou ostatní testy — jedno parsování, jeden tvar.
    const nalezene: { job: string; krok: string; zaDvermi: unknown }[] = [];
    for (const [jmeno, job] of Object.entries(wf.jobs ?? {})) {
      for (const krok of job.steps ?? []) {
        const env = krok.env;
        if (!env || !("HEALTH_URL" in env)) continue;
        nalezene.push({ job: jmeno, krok: krok.name ?? "(bez jména)", zaDvermi: env.HEALTH_ZA_DVERMI });
      }
    }

    // Univerzum se ČTE. Kdyby parser přestal sedět na tvar YAML, tenhle
    // řádek to řekne — brána, která nic nenajde, jinak mlčí jako zelená.
    expect(
      nalezene.length,
      "v ci.yml nebyl nalezen ANI JEDEN krok s HEALTH_URL — parser přestal sedět na tvar YAML",
    ).toBeGreaterThan(0);

    const nevyslovene = nalezene.filter((n) => n.zaDvermi !== "ano" && n.zaDvermi !== "ne");
    expect(
      nevyslovene,
      `kroky, které měří veřejnou cestu a neřekly, jestli na ní stojí vrátný:\n` +
        nevyslovene.map((n) => `  ${n.job} → ${n.krok} (HEALTH_ZA_DVERMI=${JSON.stringify(n.zaDvermi)})`).join("\n") +
        `\n\nNevyplněno NENÍ 'ne'. Povrch za dveřmi by červenal navždy, povrch před nimi\n` +
        `by naopak toleroval 403, které je vada. Vyslov to v env kroku.`,
    ).toEqual([]);
  });

  test("skript ODMÍTNE sondu, u které vztah ke dveřím nikdo nevyslovil", () => {
    // Chováním, ne textem: kdyby stráž kdokoli oslabil, tenhle test spadne,
    // i kdyby v souboru dál stálo něco, co jako stráž VYPADÁ.
    const skript = join(ROOT, "scripts/ci/deploy-and-verify.sh");
    const spust = (env: Record<string, string>) =>
      spawnSync("bash", [skript, "testovaci-app"], {
        encoding: "utf8",
        timeout: 60_000,
        // Prázdné prostředí: bez pověření skript stejně nic nenasadí, takže
        // tenhle test NEMÁ vedlejší účinek. Kontrola dveří je ale PŘED ním.
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", ...env },
      });

    const bez = spust({ HEALTH_URL: "https://priklad.invalid/" });
    expect(bez.status, "HEALTH_URL bez vysloveného HEALTH_ZA_DVERMI musí skript odmítnout").not.toBe(0);
    expect(`${bez.stdout}${bez.stderr}`).toContain("nevyslovený vztah ke dveřím");

    // A nesmí stačit cokoli — jen 'ano' nebo 'ne'.
    const nesmysl = spust({ HEALTH_URL: "https://priklad.invalid/", HEALTH_ZA_DVERMI: "mozna" });
    expect(nesmysl.status, "jiná hodnota než 'ano'/'ne' se nesmí brát jako vyslovení").not.toBe(0);
    expect(`${nesmysl.stdout}${nesmysl.stderr}`).toContain("nevyslovený vztah ke dveřím");

    // Vyslovené 'ne' projde DÁL — do kontroly pověření. Kdyby stráž zabíjela
    // i platný vstup, byla by to jiná vada se stejně zelenou bránou.
    const platne = spust({ HEALTH_URL: "https://priklad.invalid/", HEALTH_ZA_DVERMI: "ne" });
    expect(`${platne.stdout}${platne.stderr}`).toContain("COOLIFY_API_TOKEN");
  });

  test("dveře se poznají podle TŘÍ znaků naráz, ne podle samotného kódu", () => {
    const zdroj = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
    const vetev = zdroj
      .split("\n")
      .find((r) => r.includes("dvere=1") || (r.includes("HEALTH_ZA_DVERMI") && r.includes("403")));
    expect(vetev, "větev, která uznává dveře, ve skriptu není").toBeTruthy();

    // Podmínka musí stát na VŠECH třech: deklaraci volajícího, kódu 403
    // a PRÁZDNÉM těle. Kdyby stačil kód, spolkla by sonda i aplikační 403 —
    // tedy skutečnou vadu. Prázdné tělo je podpis vrátného, ne náhoda:
    // „kdo neťukal, nemá se dozvědět ani to, co je za dveřmi."
    const podminka = zdroj
      .split("\n")
      .filter((r) => r.includes('HEALTH_ZA_DVERMI" = "ano"'))
      .join("\n");
    expect(podminka, "uznání dveří se neváže na deklaraci volajícího").toContain('HEALTH_ZA_DVERMI" = "ano"');
    expect(podminka, "uznání dveří se neváže na kód 403").toContain('"403"');
    expect(podminka, "uznání dveří se neváže na PRÁZDNÉ tělo — pak by spolklo i aplikační 403").toMatch(
      /delka" -eq 0|delka" = "0"/,
    );
  });

  /*
    KAŽDÁ INSTALACE JDE PŘES OBAL, KTERÝ PŘEŽIJE ROZBITOU CACHE.

    ⛔ NAMĚŘENO 2026-09-05. Runner sdílí `/ci-cache/npm` a vedle běží uklízeč,
    který při málo místě dělá `rm -rf /ci-cache/npm/*` — i té cache, kterou
    právě běžící job POUŽÍVÁ. Podpis je `ENOENT`/`EEXIST` v `_cacache`.
    `scripts/ci/npm-ci.sh` to řeší druhým pokusem přes SOUKROMOU cache.

    ⭐ Jenže obal se 2026-09-03 nasadil jen tam, kde to zrovna padalo:
    11 volání obalených, ŠEST holých, a pět úloh mělo OBOJÍ — tedy krytí
    jen zčásti. Úloha `Mobile` na tom spadla 2026-09-05 v 22:29 na tom
    jednom nekrytém volání. Opravil se PŘÍPAD, ne TŘÍDA, takže koroze cache
    dál shazovala náhodné úlohy a vypadalo to jako šest různých vad.

    Tenhle test měří vlastnost „žádná instalace není nekrytá", ne „obal
    někde existuje". Univerzum si HLEDÁ: čte příkazové řádky z ci.yml.
  */
  test("⛔ v ci.yml není holé `npm ci` — každá instalace jde přes obal", () => {
    const zdroj = readFileSync(CI, "utf8");
    const holé: string[] = [];
    zdroj.split("\n").forEach((radek, i) => {
      if (radek.includes("npm-ci.sh")) return;
      // Jen PŘÍKAZOVÉ řádky. Komentář `# … npm ci …` je dokumentace, ne volání.
      const bezOdsazeni = radek.trim();
      if (bezOdsazeni.startsWith("#")) return;
      // Jen PŘÍKAZOVÁ POZICE: začátek řádku (případně za `run:`) nebo za
      // spojkou. Bez toho brána chytá i `echo "… failed at npm ci or earlier"`,
      // tedy TEXT — a brána, která hlásí neexistující vady, se přestane číst
      // stejně rychle jako ta, co mlčí. (Naměřeno na sobě při psaní: r. 795.)
      if (!/^(run:\s*)?npm ci(\s|$)/.test(bezOdsazeni) && !/(&&|\|\||;)\s*npm ci(\s|$)/.test(bezOdsazeni)) return;
      holé.push(`ci.yml:${i + 1}  ${bezOdsazeni.slice(0, 80)}`);
    });
    // ⛔ Zpráva do POROVNÁVANÉ hodnoty — dvouargumentový `expect` padá na TS2554.
    expect(holé).toEqual([]);
  });

  test("obal existuje a umí druhý pokus — jinak je předchozí test kult", () => {
    // Test, který vymáhá volání neexistujícího nebo hloupého skriptu, by byl
    // horší než žádný: zelená by znamenala jen „všichni voláme totéž".
    const obal = readFileSync(join(ROOT, "scripts/ci/npm-ci.sh"), "utf8");
    expect(obal).toContain("npm ci");
    expect(obal, ).toMatch(/--cache/);
    expect(obal.split("npm ci").length - 1).toBeGreaterThanOrEqual(2);
  });
});
