/**
 * Brána: překlad jméno→UUID aplikace se ptá PROJEKTU instance — a každé místo,
 * odkud se volá, mu dá, co k tomu potřebuje.
 *
 * ⛔ NAMĚŘENO 2026-09-13
 *   - CI běh #3639 nad main a89882dfd (Deploy: Core, Extranet, Infra): každá úloha
 *     vypsala `::warning::coolify-resolve-uuid: COOLIFY_PROJECT_UUID chybí —
 *     /applications vrací i CIZÍ nájemníky a prefix jména není identita`
 *     a POKRAČOVALA. Oprava z 2026-08-16 (rozsah podle projektu) v CI nikdy
 *     neplatila: rozsah se bral jen z COOLIFY_PROJECT_UUID a to CI nemá.
 *   - GET /api/v1/applications: `aisha-registry` nesou dvě aplikace; cizí (projekt
 *     a1sh4) stojí v odpovědi před naší (projekt aisha). `first`/`find` = cizí UUID.
 *   - GET /api/v1/projects: právě jeden projekt jménem instance (`aisha`), jeho UUID
 *     je shodné s tím, které zapsal cold-start. UUID projektu tedy NENÍ chybějící
 *     tajemství CI, ale odvozenina identity — cold-start (generate-coolify-context.mjs)
 *     i createProjectScope() ho zjišťují jménem.
 *
 * VLASTNOSTI (chování resolveru proti falešnému Coolify měří
 * scripts/lib/coolify-resolve-uuid.test.mjs; tahle brána je bez podprocesů):
 *   1. bashový resolver sám globální `/applications` NEČTE — ptá se jediného domova
 *      hranice (coolify-project-scope.mjs --list-apps --json) a jeho selhání je chyba;
 *   2. každý checkout v každém workflow, který nese resolver, nese i CELÝ graf
 *      importů toho domova (odvozený ze zdrojů, ne vyjmenovaný) — jinak by resolver
 *      v řídkém checkoutu spadl na chybějící soubor;
 *   3. každý krok, který resolver volá (přímo nebo přes deploy-and-verify.sh), má
 *      v prostředí identitu instance (APP_NAME_PREFIX) nebo připnutý projekt;
 *   4. node resolver (coolify-resolve-uuid.mjs) si rozsah bere z createProjectScope.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import yaml from "js-yaml";

const ROOT = process.cwd();
const cti = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DOMOV = "scripts/lib/coolify-project-scope.mjs";
const RESOLVER_SH = "scripts/lib/coolify-resolve-uuid.sh";
const RESOLVER_MJS = "scripts/lib/coolify-resolve-uuid.mjs";

/** Řádky bez komentářů — zmínka v poznámce není zapojení. */
const bezKomentaru = (text: string) => text.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

/** Relativní importy — statické I dynamické (`await import("./x.mjs")` v CLI domova), rekurzivně. */
function grafImportu(start: string, videno = new Set<string>()): Set<string> {
  if (videno.has(start)) return videno;
  videno.add(start);
  const zdroj = cti(start);
  const vzory = [
    /^import\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["'];/gm,
    /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];
  for (const re of vzory) {
    for (const m of zdroj.matchAll(re)) grafImportu(normalize(join(dirname(start), m[1]!)), videno);
  }
  return videno;
}

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, unknown>; with?: Record<string, unknown> };
type Job = { steps?: Step[]; env?: Record<string, unknown> };
type Workflow = { env?: Record<string, unknown>; jobs?: Record<string, Job> };

/** Workflow soubory — univerzum čtené z disku, ne seznam. */
function workflowy(): string[] {
  const out: string[] = [];
  for (const dir of [".forgejo/workflows", ".github/workflows"]) {
    if (!existsSync(join(ROOT, dir))) continue;
    for (const f of readdirSync(join(ROOT, dir))) if (/\.ya?ml$/.test(f)) out.push(`${dir}/${f}`);
  }
  return out.sort();
}

const volaResolver = (run: string) =>
  /coolify-resolve-uuid\.sh/.test(bezKomentaru(run)) ||
  /(?<![\w./-])bash[ \t]+scripts\/ci\/deploy-and-verify\.sh/.test(bezKomentaru(run));

/** Nálezy vlastnosti 2 a 3 nad jedním workflow (čistá funkce — i negativní sondy jdou tudy). */
function nalezyWorkflow(jmeno: string, text: string, graf: string[]) {
  const wf = (yaml.load(text) ?? {}) as Workflow;
  const chybiVCheckoutu: string[] = [];
  const bezIdentity: string[] = [];
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    for (const s of steps) {
      if (!String(s.uses ?? "").startsWith("actions/checkout")) continue;
      const sparse = String((s.with ?? {})["sparse-checkout"] ?? "");
      const polozky = sparse.split("\n").map((r) => r.trim()).filter(Boolean);
      if (!polozky.includes(RESOLVER_SH)) continue; // plný checkout nese všechno
      for (const soubor of graf) if (!polozky.includes(soubor)) chybiVCheckoutu.push(`${jmeno} → ${id}: ${soubor}`);
    }
    for (const s of steps) {
      if (!volaResolver(s.run ?? "")) continue;
      const prostredi = { ...(wf.env ?? {}), ...(job.env ?? {}), ...(s.env ?? {}) };
      if (!("APP_NAME_PREFIX" in prostredi) && !("COOLIFY_PROJECT_UUID" in prostredi)) {
        bezIdentity.push(`${jmeno} → ${id} / "${s.name ?? "<beze jména>"}"`);
      }
    }
  }
  return { chybiVCheckoutu, bezIdentity };
}

describe("překladač UUID se ptá projektu instance", () => {
  const graf = [...grafImportu(DOMOV)].sort();

  test("univerzum není prázdné — jinak jsou tvrzení níž vakuová", () => {
    expect(existsSync(join(ROOT, RESOLVER_SH))).toBe(true);
    expect(graf, "graf importů domova přestal sedět na parser").toEqual(
      expect.arrayContaining([DOMOV, "scripts/lib/coolify-instance-scope.mjs", "scripts/lib/coolify-http.mjs"]),
    );
    const volajici = workflowy().filter((w) => volaResolver(cti(w)));
    expect(volajici.length, "žádné workflow nevolá resolver — brána by neměřila nic").toBeGreaterThan(2);
  });

  test("1. bashový resolver nečte globální /applications a rozsah bere z domova hranice", () => {
    const kod = bezKomentaru(cti(RESOLVER_SH));
    expect(kod, "resolver znovu čte seznam VŠECH nájemníků").not.toMatch(/api\/v1\/applications["'\s]/);
    expect(kod).toMatch(/coolify-project-scope\.mjs/);
    expect(kod).toMatch(/--list-apps --json/);
    // Selhání domova je chyba (rc≥2), ne návrat k jménu.
    const blok = kod.slice(kod.indexOf("_coolify_apps_cache_load() {"), kod.indexOf("coolify_resolve_uuid() {"));
    expect(blok, "selhání rozsahu projektu nekončí chybou").toMatch(/rozsah projektu instance se nezjistil[\s\S]{0,400}return 2/);
    expect(blok, "zbylo tiché varování místo odmítnutí").not.toMatch(/::warning::[^\n]*COOLIFY_PROJECT_UUID chybí/);
  });

  test("2+3. každý checkout s resolverem nese graf domova a každý volající krok nese identitu", () => {
    const chybi: string[] = [];
    const bez: string[] = [];
    for (const w of workflowy()) {
      const n = nalezyWorkflow(w, cti(w), graf);
      chybi.push(...n.chybiVCheckoutu);
      bez.push(...n.bezIdentity);
    }
    expect(
      chybi,
      "řídký checkout nese resolver bez souborů, které jeho domov hranice importuje —\n" +
        "node spadne na import a každý deploy skončí chybou rozsahu:\n  " + chybi.join("\n  "),
    ).toEqual([]);
    expect(
      bez,
      "krok volá resolver bez identity instance — projekt nejde odvodit jako v cold-startu:\n  " + bez.join("\n  "),
    ).toEqual([]);
  });

  test("4. node resolver bere rozsah z createProjectScope a dvojznačné jméno odmítá", () => {
    const kod = cti(RESOLVER_MJS);
    expect(kod).toMatch(/createProjectScope\(/);
    expect(kod, "první shoda jména napříč nájemníky se vrátila").not.toMatch(/apps\.find\(\(a\) => a\?\.name === name\)/);
    expect(kod).toMatch(/dvojznačný/);
  });

  test("4b. čekání v CI deploy úloze sleduje jen aplikace projektu (ne jmenovce cizích nájemníků)", () => {
    // deploy-and-verify.sh krok 5 volá coolify-deploy-watch.mjs --only=<suffix> --strict;
    // nad globálním seznamem by `--only=registry` sledoval i cizí aisha-registry.
    const kod = cti("scripts/coolify-deploy-watch.mjs");
    const fetchApps = kod.slice(kod.indexOf("async function fetchApps()"), kod.indexOf("function deploymentList"));
    expect(fetchApps, "fetchApps nebere rozsah z projektu").toMatch(/createProjectScope\(coolify\)/);
    expect(fetchApps, "rozsah projektu se na seznam neaplikuje").toMatch(/\.filter\(_rozsahProjektu\.inProject\)/);
  });

  // ── negativní sondy detektoru ──────────────────────────────────────────────
  test("sonda: checkout s resolverem bez souboru grafu je nález", () => {
    const wf = `
jobs:
  deploy:
    steps:
      - uses: actions/checkout@v4
        with:
          sparse-checkout: |
            ${RESOLVER_SH}
      - name: Nasazení
        env:
          APP_NAME_PREFIX: x
        run: bash ${RESOLVER_SH} x-core
`;
    const n = nalezyWorkflow("sonda.yml", wf, graf);
    expect(n.chybiVCheckoutu.length).toBe(graf.length);
    expect(n.bezIdentity).toEqual([]);
  });

  test("sonda: krok volající resolver (i přes deploy-and-verify) bez identity je nález; plný checkout nález není", () => {
    const wf = `
jobs:
  a:
    steps:
      - uses: actions/checkout@v4
      - name: Přímo
        env:
          COOLIFY_URL: u
        run: UUID=$(bash ${RESOLVER_SH} x-admin 2>&1 || true)
  b:
    env:
      APP_NAME_PREFIX: x
    steps:
      - name: Přes sdílený krok, identita z úlohy
        run: bash scripts/ci/deploy-and-verify.sh core
  c:
    steps:
      - name: Přes sdílený krok bez identity
        run: bash scripts/ci/deploy-and-verify.sh core
      - name: Jen zmínka v komentáři
        run: |
          # bash ${RESOLVER_SH} neni volani
          echo ok
`;
    const n = nalezyWorkflow("sonda.yml", wf, graf);
    expect(n.chybiVCheckoutu).toEqual([]);
    expect(n.bezIdentity).toEqual(['sonda.yml → a / "Přímo"', 'sonda.yml → c / "Přes sdílený krok bez identity"']);
  });
});
