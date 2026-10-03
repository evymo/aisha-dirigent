/**
 * Brána: změna zdrojáku služby musí dosáhnout na stack, který ji STAVÍ.
 *
 * PROČ (naměřeno 2026-08-11)
 * -------------------------
 * PR #184 opravil `services/svc-web-artifact/src/routes/seed-default.ts`. Byl
 * zelený, sloučený — a nasadilo ho **nula** úloh. Detektor změn o tom adresáři
 * nevěděl, takže „affected apps" vyšlo prázdné a všech pět deploy úloh se
 * přeskočilo se stavem `success`.
 *
 * Pravidla přitom TŘI adresáře jmenovala natvrdo — `services/gateway/`,
 * `services/ws-gateway/`, `services/event-worker/` — a dva z nich ŠPATNĚ:
 * podle compose staví `ws-gateway` i `event-worker` stack `realtime`, ne `core`.
 * Zbylých osm stacků, které také staví ze `services/*` (ai-chat, clamav, ledger,
 * domain-services, messaging, openclaw, pki, realtime), v seznamu nebylo vůbec.
 *
 * ⭐ RUČNÍ SEZNAM STÁRNE TIŠE. Nová služba se do něj prostě nepřidá a nic to
 * neřekne — detektor odpoví „netřeba nasazovat", což je od „nic se nezměnilo"
 * k nerozeznání. Vlastník je přitom ZAPSANÝ: v `build.dockerfile` každé služby
 * v compose souboru, který manifest přiřazuje appce.
 *
 * CO SE MĚŘÍ
 * ----------
 * Ne text pravidel — ta by šla obejít komentářem, a přesně takový komentář
 * v tom skriptu roky byl, zatímco kód dělal něco jiného. Brána skript SPUSTÍ
 * nad dočasným gitem: pro KAŽDÝ build adresář z KAŽDÉHO compose souboru změní
 * soubor a ověří, že detektor vrátí appku, která z toho adresáře staví.
 *
 * Univerzum si brána HLEDÁ z manifestu + compose souborů, nepíše ho. Nová
 * služba je tím pokrytá tím, že vznikne.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const SKRIPT = join(ROOT, "scripts/aisha-changed-apps.mjs");
const MANIFEST = join(ROOT, "coolify/manifests/aisha.manifest");

/** Bez zděděných GIT_* — git hook je exportuje a dočasné repo by sáhlo na to pravé. */
const CISTE_PROSTREDI = envWithoutGitLocation();

/** app → compose soubor, z manifestu (tentýž zdroj, jaký čte skript). */
function manifestAppky(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(MANIFEST, "utf8").split("\n")) {
    const m = line.match(/^app:\s*([a-z0-9_-]+):([a-z0-9_-]+):(\S+?\.yml)/i);
    if (m) out.set(m[1], m[3]);
  }
  return out;
}

/** [buildAdresář, appka] pro každou stavěnou službu napříč manifestem. */
function ocekavaniVlastnictvi(): Array<{ dir: string; app: string; compose: string }> {
  const out: Array<{ dir: string; app: string; compose: string }> = [];
  for (const [app, compose] of manifestAppky()) {
    const p = join(ROOT, compose);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/^\s*dockerfile:\s*["']?([^"'\s#]+)/gm)) {
      const dir = m[1].includes("/") ? m[1].slice(0, m[1].lastIndexOf("/")) : "";
      if (!dir || dir === "." || dir.startsWith("..")) continue;
      out.push({ dir, app, compose });
    }
  }
  return out;
}

/**
 * Stavební vstupy přes YAML parser — NEZÁVISLE na řádkovém čtení v detektoru.
 * ⛔ NAMĚŘENO 2026-09-16: univerzum výš bralo jen `dockerfile:` s lomítkem, tedy
 * stejnou slepou skvrnu jako detektor. Dockerfile v kořeni repa (pki-init ve 22
 * stacích, keycloak, netbird-runtime, cosmos, migrate…) tak nehlídal nikdo.
 */
function stavebniVstupy(): Array<{ app: string; dockerfile: string; ctx: string }> {
  const out: Array<{ app: string; dockerfile: string; ctx: string }> = [];
  for (const [app, compose] of manifestAppky()) {
    const p = join(ROOT, compose);
    if (!existsSync(p)) continue;
    const d = parse(readFileSync(p, "utf8"), { merge: true }) as { services?: Record<string, { build?: unknown }> };
    for (const sluzba of Object.values(d.services ?? {})) {
      const b = sluzba.build as string | { context?: string; dockerfile?: string; dockerfile_inline?: string } | undefined;
      if (!b) continue;
      const ctx = typeof b === "string" ? b : (b.context ?? ".");
      if (typeof b !== "string" && b.dockerfile_inline) continue;
      const df = typeof b === "string" ? "Dockerfile" : (b.dockerfile ?? "Dockerfile");
      if (ctx.includes("$") || df.includes("$")) continue;
      out.push({ app, ctx: posix.normalize(ctx), dockerfile: posix.normalize(posix.join(ctx, df)) });
    }
  }
  return out;
}

/** Zdroje COPY/ADD (existující soubory v repu) — tytéž výjimky, jaké detektor zdůvodňuje měřením. */
function zdrojeKopii(): Array<{ app: string; soubor: string }> {
  const out: Array<{ app: string; soubor: string }> = [];
  for (const { app, ctx, dockerfile } of stavebniVstupy()) {
    const cesta = join(ROOT, dockerfile);
    if (!existsSync(cesta)) continue;
    for (const radek of readFileSync(cesta, "utf8").replace(/\\\r?\n/g, " ").split("\n")) {
      const m = /^\s*(?:COPY|ADD)\s+(.*)$/i.exec(radek);
      if (!m || /(^|\s)--from=/.test(m[1]) || m[1].includes("<<") || m[1].trim().startsWith("[")) continue;
      const tokeny = m[1].trim().split(/\s+/).filter((t) => !t.startsWith("--")).slice(0, -1);
      for (const t of tokeny) {
        if (t.includes("$") || t.includes("*")) continue;
        const zdroj = posix.normalize(posix.join(ctx, t)).replace(/\/+$/, "");
        if (zdroj === "." || zdroj === "scripts" || zdroj.startsWith("..")) continue;
        // Jen SOUBOR — adresářová kopie se měří sondou pod ním (viz níž).
        try {
          if (readFileSync(join(ROOT, zdroj)).length >= 0) out.push({ app, soubor: zdroj });
        } catch { /* adresář nebo neexistuje */ }
      }
    }
  }
  return out;
}

let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "vlastnik-sluzby-"));
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });
  git("init", "-q");
  git("config", "user.email", "gate@test");
  git("config", "user.name", "gate");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "coolify/manifests"), { recursive: true });
  copyFileSync(SKRIPT, join(repo, "scripts/aisha-changed-apps.mjs"));
  copyFileSync(MANIFEST, join(repo, "coolify/manifests/aisha.manifest"));
  // ⚠️ SKUTEČNÉ compose soubory, ne atrapy: mapa vlastnictví se z nich odvozuje,
  // takže fixtura bez nich by měřila prázdno a tvrzení by byla vakuová.
  for (const f of readdirSync(ROOT).filter((x) => /^docker-compose\.coolify.*\.ya?ml$/.test(x))) {
    copyFileSync(join(ROOT, f), join(repo, f));
  }
  writeFileSync(join(repo, "zaklad.txt"), "x\n");
  git("add", "-A");
  git("commit", "-qm", "zaklad");
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

/** Změní soubor v dočasném repu, zacommituje a vrátí appky, které detektor označil. */
function appkyPro(soubor: string): string[] {
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });
  const cesta = join(repo, soubor);
  mkdirSync(dirname(cesta), { recursive: true });
  writeFileSync(cesta, `// ${soubor} ${process.hrtime.bigint()}\n`);
  git("add", "-A");
  git("commit", "-qm", `zmena ${soubor}`);
  const out = execFileSync(
    process.execPath,
    [join(repo, "scripts/aisha-changed-apps.mjs"), "--base=HEAD~1", "--head=HEAD", "--json"],
    { cwd: repo, encoding: "utf8", env: CISTE_PROSTREDI },
  );
  return Object.keys(JSON.parse(out).affected_apps).sort();
}

/** Změní VŠECHNY soubory jedním commitem a vrátí celý JSON detektoru. */
function detektorPro(soubory: string[]): { nasadit: Record<string, string[]>; jen_kontrakt: Record<string, string[]>; affected_apps: Record<string, string[]> } {
  const git = (...a: string[]) =>
    execFileSync("git", a, { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });
  for (const soubor of soubory) {
    const cesta = join(repo, soubor);
    mkdirSync(dirname(cesta), { recursive: true });
    writeFileSync(cesta, `# ${soubor} ${process.hrtime.bigint()}\n`);
  }
  git("add", "-A");
  git("commit", "-qm", `zmena ${soubory.length} souboru`);
  const out = execFileSync(
    process.execPath,
    [join(repo, "scripts/aisha-changed-apps.mjs"), "--base=HEAD~1", "--head=HEAD", "--json"],
    { cwd: repo, encoding: "utf8", env: CISTE_PROSTREDI },
  );
  return JSON.parse(out);
}

const OCEKAVANI = ocekavaniVlastnictvi();

describe("změna služby dosáhne na stack, který ji staví (brána)", () => {
  test("univerzum si brána HLEDÁ a není prázdné", () => {
    expect(
      OCEKAVANI.length,
      "z manifestu + compose souborů se nenašel ANI JEDEN build adresář — " +
        "parser přestal sedět a všechna tvrzení níž by byla vakuová",
    ).toBeGreaterThanOrEqual(8);
  });

  test("každý build adresář vede na appku, která z něj staví", () => {
    const chybi: string[] = [];
    for (const { dir, app, compose } of OCEKAVANI) {
      const appky = appkyPro(`${dir}/gate-sonda.ts`);
      if (!appky.includes(app)) {
        chybi.push(`${dir}/  →  očekáváno '${app}' (staví ho ${compose}), detektor vrátil [${appky.join(", ") || "nic"}]`);
      }
    }
    expect(
      chybi,
      "změna v těchhle adresářích NEDOSÁHNE na stack, který je staví.\n" +
        "Přesně tak se 2026-08-11 stalo, že PR #184 (services/svc-web-artifact) byl\n" +
        "zelený, sloučený a nasadilo ho NULA úloh — detektor vrátil prázdno a všech\n" +
        "pět deploy úloh se přeskočilo se stavem `success`.\n\n" +
        "Vlastnictví se ODVOZUJE z `build.dockerfile` v compose; ruční seznam v\n" +
        "aisha-changed-apps.mjs není potřeba doplňovat — pokud tohle padá, rozešel\n" +
        "se odvozovací krok, ne seznam.",
    ).toEqual([]);
  });

  test("src/tests/ NEVEDE na nasazení — testy se do bundlu nedostanou", () => {
    // ⛔ NAMĚŘENO 2026-08-11. Merge, který sáhl jen na `ci.yml` a dva soubory
    // bran, poslal na nasazení edge i core — a `Deploy: Extranet` pak spadl na
    // tvrzení „artefakt se musí změnit". Změnit se nemohl: `vite build` testy
    // neimportuje. Nadbytečné nasazení není neutrální: restartuje provoz
    // a znehodnotí měřidlo, které má hlídat starý artefakt.
    expect(
      appkyPro("src/tests/gates/nejaka.gate.test.ts"),
      "změna v testech poslala na nasazení. Testy se do žádného bundlu nedostanou,\n" +
        "takže artefakt změnit NEMOHOU — a deploy verifikace pak hlásí falešnou červenou.",
    ).toEqual([]);
  });

  test("zdroj SPA na nasazení VEDE — zúžení výš nesmí zabít pravidlo", () => {
    // Bez tohohle by test výš splnil i skript, který `src/` ignoruje úplně.
    expect(appkyPro("src/hooks/useNeco.ts")).toContain("edge");
  });

  test("každý Dockerfile — i v kořeni repa — vede na KAŽDOU appku, která z něj staví", () => {
    const vstupy = stavebniVstupy();
    const koren = vstupy.filter((v) => !v.dockerfile.includes("/"));
    expect(koren.length, "žádný Dockerfile v kořeni — parser přestal sedět a tvrzení by bylo vakuové").toBeGreaterThan(10);
    // Detektor čte compose V DOČASNÉM repu — Dockerfily tam být nemusí, soubor
    // se jen změní (vznikne), a vlastník se odvozuje z compose.
    const j = detektorPro([...new Set(vstupy.map((v) => v.dockerfile))]);
    const chybi = vstupy
      .filter(({ app, dockerfile }) => !(j.nasadit[app] ?? []).includes(dockerfile))
      .map(({ app, dockerfile }) => `${dockerfile} → '${app}'`);
    expect([...new Set(chybi)], "změna Dockerfilu nedosáhne na stack, který z něj staví").toEqual([]);
  });

  test("zdroj COPY vede na appku, jejíž obraz ho kopíruje", () => {
    // Detektor čte COPY z Dockerfilu — do dočasného repa se proto zkopírují
    // i skutečné Dockerfily (bez nich by zdroje neznal a tvrzení bylo vakuové).
    for (const { dockerfile } of stavebniVstupy()) {
      const src = join(ROOT, dockerfile);
      if (!existsSync(src)) continue;
      mkdirSync(dirname(join(repo, dockerfile)), { recursive: true });
      copyFileSync(src, join(repo, dockerfile));
    }
    execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });
    execFileSync("git", ["commit", "-qm", "dockerfily", "--allow-empty"], { cwd: repo, stdio: "pipe", env: CISTE_PROSTREDI });

    const dockerfily = new Set(stavebniVstupy().map((v) => v.dockerfile));
    const zdroje = zdrojeKopii().filter((z) => !dockerfily.has(z.soubor));
    expect(zdroje.length, "nenašel se jediný souborový zdroj COPY — tvrzení by bylo vakuové").toBeGreaterThan(20);
    const j = detektorPro([...new Set(zdroje.map((z) => z.soubor))]);
    const chybi = zdroje
      .filter(({ app, soubor }) => !(j.nasadit[app] ?? []).includes(soubor))
      .map(({ app, soubor }) => `${soubor} → '${app}'`);
    expect([...new Set(chybi)], "soubor kopírovaný do obrazu nevede na nasazení jeho stacku").toEqual([]);
  });

  test("⛔ celoplošná kopie `scripts/` NENASAZUJE (měřeno: +77 zbytečných nasazení za 60 merge)", () => {
    const j = detektorPro(["scripts/nejaky-novy-orchestracni-skript.sh"]);
    expect(Object.keys(j.nasadit)).toEqual([]);
  });

  test("kontrakt proměnných CI nenasazuje, ale ohlásí ho k dorovnání cold-startem", () => {
    const j = detektorPro(["config/domains.env"]);
    expect(Object.keys(j.nasadit), "kontrakt se doručuje z trezoru, CI ho nemá").toEqual([]);
    expect(Object.keys(j.jen_kontrakt).length, "kontrakt se týká všech appek manifestu").toBe(manifestAppky().size);
  });

  test("cizí adresář NEVEDE nikam — detektor nesmí nasazovat na potkání", () => {
    // Bez tohohle tvrzení by bránu splnil skript, který na každou změnu vrátí
    // všechny appky. Nadměrné nasazování je jiná vada, ne řešení téhle.
    expect(appkyPro("docs/nejaka-poznamka.md")).toEqual([]);
  });
});
