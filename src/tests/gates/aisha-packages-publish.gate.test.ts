/**
 * AISHA packages publish gate.
 *
 * Closes the "stale Verdaccio publish" loop that surfaced in PR #73:
 *   - the runner script exists
 *   - the Forgejo workflow exists and points at the runner
 *   - the selection rule (private:false + publishConfig + build script + not-excluded)
 *     matches what the runner uses
 *   - every package that other services consume via "@aisha/<name>": "*"
 *     IS publishable so Verdaccio actually has something to resolve to
 *
 * Without this gate, a future PR could:
 *   - re-private @aisha/aitg → services using "*" silently fail next install
 *   - delete the workflow → drift returns
 *   - rename the runner without updating the workflow → workflow no-ops silently
 *
 * Each assertion has a paired "if this fails, do X" hint in the message.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import yaml from 'js-yaml';
import { isTrackedService } from './lib/tracked-services';

const ROOT = process.cwd();
const PKG_ROOT = resolve(ROOT, 'packages');
const SERVICES_ROOT = resolve(ROOT, 'services');
const RUNNER = resolve(ROOT, 'scripts/aisha-packages-publish.mjs');
const VERSION_CHECK = resolve(ROOT, 'scripts/aisha-packages-version-check.mjs');
const PRE_COMMIT_HOOK = resolve(ROOT, '.husky/pre-commit');
const WORKFLOW = resolve(ROOT, '.github/workflows/aisha-packages-publish.yml');

// Packages consumed by services via "@aisha/<name>": "*" — Verdaccio MUST have these
// for those services to install successfully outside of an installed-state-cached env.
function packagesConsumedByServicesViaWildcard(): Set<string> {
  const consumed = new Set<string>();
  for (const dir of readdirSync(SERVICES_ROOT)) {
    // Untracked leftovers are residue, not services — see lib/tracked-services.ts.
    if (!isTrackedService(dir)) continue;
    const svcDir = join(SERVICES_ROOT, dir);
    const pkgPath = join(svcDir, 'package.json');
    if (!existsSync(pkgPath) || !statSync(svcDir).isDirectory()) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
      if (name.startsWith('@aisha/') && spec === '*') {
        consumed.add(name);
      }
    }
  }
  return consumed;
}

function listPackages(): { dir: string; pkg: Record<string, unknown> }[] {
  if (!existsSync(PKG_ROOT)) return [];
  return readdirSync(PKG_ROOT)
    .map((entry) => ({ dir: join(PKG_ROOT, entry), pkg: null as null | Record<string, unknown> }))
    .filter((e) => statSync(e.dir).isDirectory())
    .filter((e) => existsSync(join(e.dir, 'package.json')))
    .map((e) => ({
      dir: e.dir,
      pkg: JSON.parse(readFileSync(join(e.dir, 'package.json'), 'utf8')) as Record<string, unknown>,
    }));
}

describe('AISHA packages auto-publish — runner + workflow', () => {
  test('runner script exists at canonical path', () => {
    expect(existsSync(RUNNER), 'scripts/aisha-packages-publish.mjs missing — restore or update WORKFLOW to point at the new path').toBe(true);
  });

  test('runner ships with the documented selection rule', () => {
    const src = readFileSync(RUNNER, 'utf8');
    // Anchor each guarantee that downstream relies on
    expect(src, 'runner must check pkg.private').toMatch(/pkg\.private/);
    expect(src, 'runner must check pkg.publishConfig').toMatch(/pkg\.publishConfig/);
    expect(src, 'runner must check pkg.scripts.build').toMatch(/pkg\.scripts\??\.build/);
    expect(src, 'runner must exclude n8n-nodes-aisha (separate release flow)').toMatch(/n8n-nodes-aisha/);
    expect(src, 'runner must read Verdaccio registry from VERDACCIO_URL').toMatch(/process\.env\.VERDACCIO_URL/);
    expect(src, 'runner must not bake the reference Verdaccio hostname').not.toMatch(/npm\.id3a\.cz/);
  });

  test('runner uses VERDACCIO_TOKEN env var (not committed credential)', () => {
    const src = readFileSync(RUNNER, 'utf8');
    expect(src, 'runner reads token from env').toMatch(/process\.env\.VERDACCIO_TOKEN/);
    // Negative: no hard-coded JWTs / sinopia URLs
    expect(src, 'runner must not hard-code legacy sinopia registry').not.toMatch(/sinopia\./);
  });

  test('runner has DRY_RUN escape hatch', () => {
    const src = readFileSync(RUNNER, 'utf8');
    expect(src).toMatch(/DRY_RUN/);
  });

  test('runner is idempotent (skips when workspace version <= published)', () => {
    const src = readFileSync(RUNNER, 'utf8');
    expect(src, 'runner must compare workspace version vs registry').toMatch(/cmpSemver/);
    expect(src, 'runner must skip when version is unchanged').toMatch(/version-unchanged|already up-to-date|skipping/);
  });
});

describe('AISHA packages auto-publish — Forgejo workflow', () => {
  test('workflow file exists at canonical path', () => {
    expect(existsSync(WORKFLOW), '.github/workflows/aisha-packages-publish.yml missing').toBe(true);
  });

  test('workflow YAML parses cleanly', () => {
    // PR #92 (commit 7461c36f) shipped a heredoc inside a `run: |` block with
    // the terminator (`JSON`) at column 0. YAML treats indent < block-indicator
    // as end-of-literal, so the workflow failed to load on Forgejo runners
    // ("Failing after 0s" — never executed). This test parses the YAML to
    // catch the same class of bug before it lands again.
    const text = readFileSync(WORKFLOW, 'utf8');
    let parsed: unknown;
    expect(() => {
      parsed = yaml.load(text);
    }, 'workflow YAML must parse — common offender is a bash heredoc terminator at column 0 inside a `run: |` literal block (use jq -nc or inline JSON instead)').not.toThrow();
    // Sanity: parsed structure has the keys we expect, not random fragments
    // from a partial parse.
    const doc = parsed as { name?: string; jobs?: Record<string, unknown> };
    expect(doc.name, 'parsed YAML must have top-level `name`').toBeDefined();
    expect(doc.jobs, 'parsed YAML must have top-level `jobs`').toBeDefined();
    expect(doc.jobs?.publish, 'parsed YAML must declare a `publish` job').toBeDefined();
  });

  test('workflow triggers on push to main when packages/** changes', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    expect(yml).toMatch(/on:\s*[\s\S]*push:/);
    expect(yml).toMatch(/branches:\s*\[main\]/);
    expect(yml).toMatch(/packages\/\*\*/);
  });

  test('workflow runs the runner script', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    expect(yml, 'workflow must `node scripts/aisha-packages-publish.mjs`').toMatch(/scripts\/aisha-packages-publish\.mjs/);
  });

  test('workflow plumbs VERDACCIO_TOKEN from secrets', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    expect(yml).toMatch(/secrets\.VERDACCIO_TOKEN/);
  });

  test('workflow has concurrency lock (no parallel publishes)', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    expect(yml).toMatch(/concurrency:/);
    expect(yml).toMatch(/cancel-in-progress:\s*false/);
  });

  test('workflow has workflow_dispatch with dry_run input (operator escape hatch)', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    expect(yml).toMatch(/workflow_dispatch:/);
    expect(yml).toMatch(/dry_run/);
  });

  test('workflow re-runs when the runner script itself changes', () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    expect(yml, 'paths must include the runner script so a runner fix triggers a re-publish sweep').toMatch(
      /scripts\/aisha-packages-publish\.mjs/,
    );
  });
});

describe('AISHA packages auto-publish — consumer / producer parity', () => {
  // The point of this gate: if any service declares "@aisha/X": "*", then
  // packages/X must be publishable (private:false + publishConfig + build).
  // Otherwise the service will fail to install outside of an installed-state-cached env.

  const consumed = packagesConsumedByServicesViaWildcard();
  const localPackages = listPackages();
  const localByName = new Map(localPackages.map((e) => [e.pkg.name as string, e]));

  test('every consumed @aisha/* exists as a local package', () => {
    for (const name of consumed) {
      expect(localByName.has(name), `service depends on ${name} via "*" but packages/ has no matching package`).toBe(true);
    }
  });

  test('every consumed @aisha/* is publishable (private:false)', () => {
    for (const name of consumed) {
      const entry = localByName.get(name);
      if (!entry) continue; // Covered by previous test
      const isPrivate = entry.pkg.private === true;
      expect(isPrivate, `${name} is private:true but at least one service depends on it via "*". Either set private:false or remove the service dep.`).toBe(false);
    }
  });

  test('every consumed @aisha/* has publishConfig', () => {
    for (const name of consumed) {
      const entry = localByName.get(name);
      if (!entry) continue;
      expect(entry.pkg.publishConfig, `${name} has no publishConfig — set { "access": "restricted" } (registry comes from VERDACCIO_URL at publish time; do NOT hardcode a host)`).toBeDefined();
    }
  });

  test('every consumed @aisha/* has a build script', () => {
    for (const name of consumed) {
      const entry = localByName.get(name);
      if (!entry) continue;
      const build = (entry.pkg.scripts as Record<string, string> | undefined)?.build;
      expect(build, `${name} has no scripts.build — auto-publish has no artifact to ship. Add tsc-based build.`).toBeTruthy();
    }
  });
});

describe('AISHA packages auto-publish — version-bump pre-commit guard', () => {
  // The auto-publish runner is idempotent on package version. Without a
  // pre-commit guard, a contributor can land src/** changes without bumping
  // package.json version → workflow runs but no-ops → Verdaccio stays
  // stale. That's the exact PR #73 failure mode. This describe block
  // asserts the guard exists and is wired into the hook chain.

  test('version-check script exists at canonical path', () => {
    expect(existsSync(VERSION_CHECK), 'scripts/aisha-packages-version-check.mjs missing').toBe(true);
  });

  test('version-check reads staged files via git diff --cached', () => {
    const src = readFileSync(VERSION_CHECK, 'utf-8');
    expect(src, 'must read staged files').toMatch(/git diff --cached --name-only|diff.*--cached.*--name-only/);
  });

  test('version-check uses argv-based subprocess API (no shell-string risk)', () => {
    const raw = readFileSync(VERSION_CHECK, 'utf-8');
    // Strip comments so JSDoc mentioning the banned pattern is documentation,
    // not code. Same strip-comments-before-scan technique used in
    // ai-static-validation.test.ts.
    //
    // ⛔ JEDEN PRŮCHOD, NE DVA (naměřeno 2026-09-01). Dřív se nejdřív mazaly
    // blokové komentáře a teprve pak řádkové. Jenže řádkový komentář smí
    // obsahovat `/*` — a v tomhle skriptu jich je osm, protože dokumentuje
    // cesty jako `packages/<pkg>/src/**`. Nepárový počet takových „otvíračů"
    // pak nechal `/\* … *\/` spolknout kus SKUTEČNÉHO kódu: po přidání
    // jednoho řádku prózy zmizely z výsledku všechny importy a brána hlásila,
    // že skript nepoužívá execFileSync — přestože ho používá třikrát.
    //
    // Alternace v jednom průchodu to řeší tím, že rozhoduje POZICE: na indexu
    // `//` větev pro blokový komentář nesedne, takže se spotřebuje řádek celý
    // i s tím `/*` uvnitř. Táž třída jako `extractServiceBlock`, který četl
    // komentář jako kód — próza nesmí měnit verdikt.
    const src = raw.replace(
      /\/\*[\s\S]*?\*\/|(^|[^:'"])\/\/[^\n]*/gm,
      (_m, pred) => pred ?? '',
    );
    // Must use the argv-form variant — file paths derived from git output
    // can't inject shell metacharacters through it.
    expect(/execFileSync/.test(src), 'must use execFileSync (argv-form)').toBe(true);
    // And must NOT use the shell-form variant in code (lookbehind excludes
    // the safe `execFileSync` from matching).
    const shellForm = src.match(/(?<!File)execSync\s*\(/);
    expect(shellForm, 'shell-form subprocess in code is banned (use argv-form)').toBeNull();
  });

  test('version-check has documented override env var', () => {
    const src = readFileSync(VERSION_CHECK, 'utf-8');
    expect(src).toMatch(/ALLOW_STALE_PACKAGE_VERSION/);
  });

  test('version-check uses same publishable rule as the runner (private:false + publishConfig)', () => {
    const src = readFileSync(VERSION_CHECK, 'utf-8');
    expect(src, 'must check pkg.private').toMatch(/pkg\.private/);
    expect(src, 'must check pkg.publishConfig').toMatch(/pkg\.publishConfig/);
  });

  test('version-check is wired into .husky/pre-commit', () => {
    const hook = readFileSync(PRE_COMMIT_HOOK, 'utf-8');
    expect(hook, 'pre-commit must invoke the version-check script').toMatch(
      /scripts\/aisha-packages-version-check\.mjs/,
    );
    // And it must FAIL the commit on non-zero exit (i.e. the line has `|| { exit 1 }`
    // pattern, not soft-fail).
    expect(hook, 'pre-commit must fail the commit on version-check failure').toMatch(
      /aisha-packages-version-check\.mjs[\s\S]{0,200}exit 1/,
    );
  });
});

describe('AISHA packages auto-publish — CVE-recovery force input (E)', () => {
  // The workflow + runner expose a `force` escape hatch for the case
  // where a prior workflow run left Verdaccio in a half-published state
  // (workspace pkg.json bumped, but registry never received the tarball).
  // A normal re-trigger would skip on "workspace == published"; force=true
  // bypasses that one optimization. NOT a merge bypass — see
  // docs/security/CVE_RESPONSE_RUNBOOK.md for the canonical flow.

  test('workflow declares workflow_dispatch.inputs.force', () => {
    const yml = readFileSync(WORKFLOW, 'utf-8');
    // Both inputs (dry_run + force) must coexist; we already check dry_run
    // earlier. Here we add the force assertion.
    expect(yml, 'workflow must expose `force` input').toMatch(/^\s+force:\s*$/m);
    // Allow long inline doctrine comments between `force:` and `type:` — the
    // workflow intentionally documents the rationale at the input site so a
    // future reader sees it without leaving the file.
    expect(yml, 'force input must be type: boolean').toMatch(/force:[\s\S]{0,1500}type:\s*boolean/);
    expect(yml, 'force input must default to false').toMatch(/force:[\s\S]{0,1500}default:\s*false/);
  });

  test('workflow plumbs inputs.force to runner via FORCE env var', () => {
    const yml = readFileSync(WORKFLOW, 'utf-8');
    expect(yml, 'workflow must pass FORCE=1 to the runner when inputs.force is true').toMatch(
      /FORCE:\s*\$\{\{\s*inputs\.force\s*==\s*true\s*&&\s*'1'\s*\|\|\s*''\s*\}\}/,
    );
  });

  test('runner reads FORCE env var', () => {
    const src = readFileSync(RUNNER, 'utf-8');
    expect(src).toMatch(/process\.env\.FORCE\s*===\s*'1'/);
  });

  test('runner bypasses version-skip when FORCE=1', () => {
    const src = readFileSync(RUNNER, 'utf-8');
    // The version-skip branch must be guarded by `if (FORCE)` so the operator
    // can ship the same version twice during stuck-workflow recovery.
    expect(src, 'runner must check FORCE before skipping on version-unchanged').toMatch(
      /if\s*\(\s*FORCE\s*\)/,
    );
    expect(src, 'runner must log a clearly-visible warning when FORCE is active').toMatch(
      /FORCE=1[\s\S]{0,80}(republishing|version-skip|recovery)/,
    );
  });

  test('runner passes --force to npm publish when FORCE=1', () => {
    const src = readFileSync(RUNNER, 'utf-8');
    // npm refuses to overwrite an existing version by default. The publishPkg
    // helper must conditionally include --force in argv when running in
    // CVE-recovery mode.
    expect(src, 'publishPkg must conditionally add --force').toMatch(
      /if\s*\(\s*FORCE\s*\)\s*args\.push\s*\(\s*['"]--force['"]\s*\)/,
    );
  });

  test('docs/security/CVE_RESPONSE_RUNBOOK.md exists + references force input', () => {
    const doc = resolve(ROOT, 'docs/security/CVE_RESPONSE_RUNBOOK.md');
    expect(existsSync(doc), 'CVE runbook must ship beside the workflow').toBe(true);
    const text = readFileSync(doc, 'utf-8');
    expect(text).toMatch(/`force`|FORCE=1|workflow_dispatch/);
    // Doctrine: the runbook must explicitly state that force is NOT a
    // merge bypass — defensive against future doc rot.
    expect(text, 'runbook must clarify force is not a merge bypass').toMatch(
      /NOT a merge bypass|not a merge bypass|not legitimate use/i,
    );
  });

  test('PR template for CVE response ships', () => {
    const tpl = resolve(ROOT, '.github/PULL_REQUEST_TEMPLATE/cve-response.md');
    expect(existsSync(tpl), 'CVE PR template must exist').toBe(true);
    const text = readFileSync(tpl, 'utf-8');
    // Required fields per the runbook
    for (const field of ['CVE ID', 'CVSS', 'Affected packages', 'Operator action']) {
      expect(text, `template missing required field: ${field}`).toContain(field);
    }
  });
});
