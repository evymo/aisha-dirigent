/**
 * Dockerignore vs Dockerfile COPY Contract Gate
 *
 * Detekuje regresi typu commit aec728a7 / 6041d983: `.dockerignore` excluduje
 * cestu, kterou nějaký `Dockerfile*` v repo používá v `COPY` instrukci.
 *
 * Důsledek bez tohoto gatu (skutečný incident 2026-04-28 11:30):
 *   `.dockerignore:9 openxpki-config/`
 *   `Dockerfile.pki-init: COPY openxpki-config/ /template/`
 *   → Coolify klonuje fresh repo → BuildKit context filter vyřeže
 *     openxpki-config/ → docker build padá s
 *     "failed to compute cache key: ... not found"
 *   → wave 2 (core+pki) fail, kaskádově 8 apps gate-aborted.
 *
 * Strategie:
 *   - Najdi všechny `Dockerfile*` v repu (ne v node_modules / .venv / trash)
 *   - Parsuj `COPY <src> <dest>` instrukce (skip --from=stage, env vars)
 *   - Cross-check src path vs EFEKTIVNÍ `.dockerignore` pro daný Dockerfile:
 *     sourozenecký `<dockerfile>.dockerignore` má přednost před root
 *     `.dockerignore` (přesně jako BuildKit u `docker build -f`) — sourozenec
 *     root soubor pro daný build NEnahrazuje mergem, ale celý. Viz PR #117
 *     e2e/Dockerfile.staging-parity.dockerignore (re-includuje playwright
 *     config, který root `.dockerignore` strhává).
 *   - Match = hard fail s důkazem
 *
 * Out of scope:
 *   - `ADD` instrukce (use-case: HTTP fetch, archive extract; různá sémantika)
 *   - Builds s --build-arg COPY context override (rare, manual review)
 */

import { describe, test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename, dirname, normalize } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = process.cwd();

interface CopyInstruction {
  dockerfile: string;
  line: number;
  src: string;
  raw: string;
}

interface DockerIgnorePattern {
  line: number;
  pattern: string; // normalized, no leading ./, no trailing comment
}

function findDockerfiles(): string[] {
  // Use git ls-files to respect repo membership (no node_modules / trash etc.)
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return out
    .split("\n")
    .filter((p) => p && /(?:^|\/)Dockerfile[^/]*$/.test(p))
    .filter((p) => !p.includes("node_modules") && !p.includes("/.venv/") && !p.includes("/trash/"));
}

function parseDockerfileCopies(path: string): CopyInstruction[] {
  if (!existsSync(join(ROOT, path))) return [];
  const lines = readFileSync(join(ROOT, path), "utf-8").split("\n");
  const result: CopyInstruction[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    // Skip comments + empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Match COPY (case-sensitive Dockerfile spec, but tools accept both)
    const m = trimmed.match(/^COPY\s+(.+)$/i);
    if (!m) continue;
    let args = m[1];
    // Skip --from=<stage> (multi-stage build, src is from another stage, not context)
    if (/--from=/i.test(args)) continue;
    // Strip --chown=, --chmod= flags
    args = args.replace(/--chown=\S+\s+/g, "").replace(/--chmod=\S+\s+/g, "");
    // Split by whitespace, last arg is dest, rest are sources
    const parts = args.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const sources = parts.slice(0, -1);
    for (const src of sources) {
      // Skip absolute paths (rare, would mean WORKDIR-based — out of scope)
      if (src.startsWith("/")) continue;
      // Skip glob/wildcards (fnmatch matching is too permissive — manual review)
      if (src.includes("*") || src.includes("?")) continue;
      // Strip ./ prefix
      const normalized = src.replace(/^\.\//, "");
      result.push({ dockerfile: path, line: i + 1, src: normalized, raw: trimmed });
    }
  }
  return result;
}

function parseDockerignore(ignorePath: string): DockerIgnorePattern[] {
  if (!existsSync(ignorePath)) return [];
  const lines = readFileSync(ignorePath, "utf-8").split("\n");
  const result: DockerIgnorePattern[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let trimmed = raw.trim();
    // Skip comments + empty + negation (we only check inclusive excludes)
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    // Strip inline comment (rare in dockerignore but possible)
    const hashIdx = trimmed.indexOf(" #");
    if (hashIdx > -1) trimmed = trimmed.slice(0, hashIdx).trim();
    // Normalize: strip leading ./ and trailing /
    const pattern = trimmed.replace(/^\.\//, "").replace(/\/$/, "");
    if (!pattern) continue;
    result.push({ line: i + 1, pattern });
  }
  return result;
}

/**
 * Resolve the .dockerignore that BuildKit would apply to a given Dockerfile.
 *
 * BuildKit precedence (`docker build -f <dockerfile>`): a sibling
 * `<dockerfile>.dockerignore` — when present — fully REPLACES the context-root
 * `.dockerignore` for that build (no merge). We mirror that so a Dockerfile
 * shipping its own ignore override (e.g. e2e/Dockerfile.staging-parity.dockerignore
 * from PR #117, which re-includes the playwright config the root ignore strips)
 * is validated against the patterns BuildKit would actually apply — not against
 * the root patterns it deliberately overrides.
 *
 * @param dockerfileRel - repo-relative Dockerfile path (e.g. "e2e/Dockerfile.staging-parity")
 * @returns absolute path to the effective .dockerignore + a repo-relative label for diagnostics
 */
function effectiveDockerignore(dockerfileRel: string): { path: string; source: string } {
  const perFileRel = `${dockerfileRel}.dockerignore`;
  const perFileAbs = join(ROOT, perFileRel);
  if (existsSync(perFileAbs)) return { path: perFileAbs, source: perFileRel };
  return { path: join(ROOT, ".dockerignore"), source: ".dockerignore" };
}

/**
 * Check zda dockerignore pattern matchuje COPY src.
 *
 * Dockerignore semantika (Docker docs):
 *   - `foo` matches `foo` and `foo/bar/baz` (path prefix on first segment)
 *   - `foo/` same as `foo`
 *   - `foo/bar` matches `foo/bar` and `foo/bar/baz`
 *   - `**` glob — out of scope (manual review)
 *
 * COPY src cesta je relativní k build context root.
 */
function matchesDockerignorePattern(src: string, pattern: string): boolean {
  // Normalize both — strip trailing slash, leading ./
  const normSrc = src.replace(/^\.\//, "").replace(/\/$/, "");
  const normPattern = pattern.replace(/^\.\//, "").replace(/\/$/, "");
  if (normPattern.includes("**")) return false; // skip glob — manual
  // Exact match: foo == foo
  if (normSrc === normPattern) return true;
  // Prefix match: pattern `foo` matches src `foo/bar/baz`
  if (normSrc.startsWith(normPattern + "/")) return true;
  // Reverse: src `foo` is parent of pattern `foo/bar` → COPY foo/ would include foo/bar (which dockerignore would strip).
  // To keep gate strict (catch the openxpki-config case), we DON'T treat this as match.
  // Reason: COPY of parent dir + .dockerignore of child dir is legit (e.g. COPY . . + .dockerignore node_modules)
  return false;
}

/**
 * Kontexty, ve kterých se daný Dockerfile skutečně staví — ODVOZENÉ z compose
 * (`build.context` + `build.dockerfile`), ne vyjmenované.
 *
 * Jeden Dockerfile může sloužit víc službám s RŮZNÝM kontextem (pg17 staví `db`
 * i `pgbackrest` přes kotvu), takže výsledkem je množina, ne jedna hodnota.
 * Kořen a vlastní adresář se přidávají vždy: Dockerfile se staví i mimo compose
 * (CI, `docker build -f`). Zdroj, který neexistuje pod ŽÁDNÝM z nich, nemůže
 * existovat v žádném kontextu — a právě to je jediné, co brána tvrdí.
 */
let KONTEXTY_CACHE: Map<string, Set<string>> | null = null;

function nactiKontextyZCompose(): Map<string, Set<string>> {
  if (KONTEXTY_CACHE) return KONTEXTY_CACHE;
  const mapa = new Map<string, Set<string>>();
  // ⛔ Univerzum si brána HLEDÁ, a v CELÉM repu. Když jsem ho poprvé omezil na
  // kořenový adresář, ohlásila jako závadu `mock-backend/` — a přitom kontext
  // deklaruje `tests/e2e-dirigent/docker-compose.yml`, jen o patro níž. Zúžené
  // univerzum vyrábí falešné nálezy úplně stejně spolehlivě jako děravý parser.
  const soubory = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
    .split("\n")
    .filter((p) => /(?:^|\/)docker-compose[^/]*\.ya?ml$/.test(p));
  for (const f of soubory) {
    let dok: { services?: Record<string, { build?: unknown } | null> };
    try {
      dok = parseYaml(readFileSync(join(ROOT, f), "utf8")) as typeof dok;
    } catch {
      continue; // nevalidní YAML řeší jiná brána
    }
    // ⛔ `context:` je relativní k ADRESÁŘI COMPOSE SOUBORU, ne ke kořeni repa.
    // `context: .` v tests/e2e-dirigent/docker-compose.yml znamená
    // `tests/e2e-dirigent/`. Bez tohohle základu brána hlásila `mock-backend/`
    // jako neexistující, přestože leží přesně tam, kam context ukazuje.
    const zaklad = dirname(f).replace(/^\.$/, "");
    for (const sluzba of Object.values(dok?.services ?? {})) {
      const build = sluzba?.build;
      if (!build) continue;
      const ctxRaw = typeof build === "string" ? build : ((build as { context?: string }).context ?? ".");
      const df = typeof build === "string" ? "Dockerfile" : ((build as { dockerfile?: string }).dockerfile ?? "Dockerfile");
      const ctx = normalize(join(zaklad, ctxRaw)).replace(/^\.\//, "").replace(/^\.$/, "");
      // Cesta k Dockerfilu je relativní ke KONTEXTU — tak ji čte i docker compose.
      const klic = normalize(join(ctx, df)).replace(/^\.\//, "");
      if (!mapa.has(klic)) mapa.set(klic, new Set());
      mapa.get(klic)!.add(ctx);
    }
  }
  KONTEXTY_CACHE = mapa;
  return mapa;
}

function buildKontextyPro(dockerfile: string): string[] {
  const z = nactiKontextyZCompose().get(dockerfile.replace(/^\.\//, ""));
  const vlastni = dirname(dockerfile).replace(/^\.$/, "");
  return [...new Set(["", vlastni, ...(z ?? [])])];
}

/**
 * Kořeny, pod kterými git něco eviduje. Slouží k rozlišení dvou tvarů
 * neexistujícího zdroje, které vypadají stejně a znamenají opak:
 *
 *   packages/extranet-sdk-ui/adapter.css  → `packages/` git ZNÁ ⇒ soubor tam
 *                                            MĚL být a zmizel = VADA
 *   .artifacts/aisha-dirigent.vsix        → pod `.artifacts/` git nezná NIC
 *                                            ⇒ celý strom se VYRÁBÍ (tady
 *                                            tests/e2e-dirigent/scripts/
 *                                            build-extension-vsix.mjs) = mlčet
 *
 * Je to odvození, ne seznam výjimek: nový generovaný adresář se pod bránu
 * dostane sám a nikdo ji nemusí učit jeho jméno.
 */
let SLEDOVANE: { cesty: Set<string>; koreny: Set<string> } | null = null;

function sledovane(): { cesty: Set<string>; koreny: Set<string> } {
  if (SLEDOVANE) return SLEDOVANE;
  const vse = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" }).split("\n").filter(Boolean);
  SLEDOVANE = { cesty: new Set(vse), koreny: new Set(vse.map((p) => p.split("/")[0])) };
  return SLEDOVANE;
}

/**
 * Vyrábí se ten zdroj až za běhu?
 *
 * ⛔ Ptát se na PRVNÍ SEGMENT samotného `src` NESTAČÍ a je to fail-open: u
 * `COPY entrypoint-wrapper.sh …` je prvním segmentem jméno souboru, které jako
 * KOŘEN v `git ls-files` pochopitelně není — a celý soubor by se tím utišil.
 * Změřeno mutací: odstranění `infra/postgres/entrypoint-wrapper.sh` brána nenahlásila.
 *
 * Rozhoduje se proto nad ROZVINUTOU cestou v každém kandidátském kontextu:
 *   - git tu cestu ZNÁ  ⇒ soubor tam patří a chybí = VADA (i když je to jen jméno)
 *   - nezná ji nikde, a ani její kořen ⇒ celý strom se generuje = mlčet
 */
function jeVyrabeny(src: string, konteksty: string[]): boolean {
  const { cesty } = sledovane();
  const kandidati = konteksty.map((ctx) => normalize(join(ctx, src)).replace(/^\.\//, "").replace(/\/$/, ""));
  if (kandidati.some((k) => cesty.has(k))) return false; // git ji zná TEĎ ⇒ má existovat

  // Rozhoduje HISTORIE, ne tvar cesty. Cokoli, co v gitu KDY bylo, tam patří —
  // zmizení je vada. Co tam nebylo nikdy, se vyrábí (`.artifacts/*.vsix` staví
  // tests/e2e-dirigent/scripts/build-extension-vsix.mjs) a brána o tom mlčí.
  //
  // Pokusy rozhodnout to z tvaru cesty selhaly OBĚMA směry a mutace to ukázala:
  // podle prvního segmentu se utišil `entrypoint-wrapper.sh` (jméno souboru není
  // kořen), podle kořene kandidáta zase svítil `.artifacts` (jeho sourozenci pod
  // `tests/` kořen mají). Historie je jediné měřidlo, které tu odpovídá na
  // otázku, na kterou se ptáme.
  for (const k of kandidati) {
    const log = execFileSync("git", ["log", "--oneline", "-1", "--", k], { cwd: ROOT, encoding: "utf-8" }).trim();
    if (log) return false; // někdy tam byl ⇒ zmizel ⇒ vada
  }
  return true;
}

describe("Dockerignore vs Dockerfile COPY Contract Gate", () => {
  test("no Dockerfile COPY src is excluded by .dockerignore", () => {
    const dockerfiles = findDockerfiles();
    expect(dockerfiles.length).toBeGreaterThan(0); // sanity — repo has Dockerfiles

    // Parse each distinct .dockerignore at most once (root + any per-Dockerfile
    // overrides). Each Dockerfile is checked against ITS effective ignore file,
    // matching BuildKit's `<dockerfile>.dockerignore`-wins precedence.
    const ignoreCache = new Map<string, DockerIgnorePattern[]>();
    const violations: string[] = [];
    for (const dockerfile of dockerfiles) {
      const { path: ignPath, source } = effectiveDockerignore(dockerfile);
      let ignorePatterns = ignoreCache.get(ignPath);
      if (!ignorePatterns) {
        ignorePatterns = parseDockerignore(ignPath);
        ignoreCache.set(ignPath, ignorePatterns);
      }
      for (const copy of parseDockerfileCopies(dockerfile)) {
        for (const ign of ignorePatterns) {
          if (matchesDockerignorePattern(copy.src, ign.pattern)) {
            violations.push(
              `  ${copy.dockerfile}:${copy.line}\n` +
                `    COPY src:        ${copy.src}\n` +
                `    excluded by:     ${source}:${ign.line}  →  ${ign.pattern}\n` +
                `    raw:             ${copy.raw}`,
            );
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} Dockerfile COPY path(s) excluded by .dockerignore:\n\n${violations.join("\n\n")}\n\n` +
          `BuildKit context filter would strip these paths → docker build would fail with\n` +
          `  "failed to compute cache key: ... not found"\n\n` +
          `Fix: remove the offending pattern from .dockerignore, OR change Dockerfile COPY src.`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  /**
   * DRUHÁ POLOVINA TÉŽE VADY — zdroj, který NEEXISTUJE.
   *
   * Test výš se ptá „je ten zdroj vyloučený `.dockerignore`em?". To je jen JEDNA
   * ze dvou cest, jak může COPY zdroj v kontextu chybět. Druhá je, že ho někdo
   * smazal nebo přesunul — a BuildKit na ni odpoví BAJT PO BAJTU touž hláškou,
   * kterou cituje hlavička tohohle souboru:
   *
   *     failed to compute cache key: "/packages/extranet-sdk-ui/adapter.css": not found
   *
   * Naměřeno 2026-08-18: PR #195 přesunul ESDK z workspace balíku na npm
   * závislost a `packages/extranet-sdk-ui/` smazal, ale `Dockerfile.keycloak`
   * zůstal na staré cestě (ř. 143 i 146). Nikdo si toho nevšiml, protože
   * Keycloak se od toho mergu NESTAVĚL — až ve vlně 4, tedy v produkci. Padl
   * a jako hard-gate za sebou zavřel 21 aplikací.
   *
   * Brána tu vadu mít měla: parser i seznam souborů tu byly, chybělo jedno
   * tvrzení. Producent se smí zrušit jedině tehdy, když se odvodí, kdo ho
   * spotřebovává — a Dockerfile není typovaný, takže ho `tsc` nikdy neprohlédne.
   */
  test("no Dockerfile COPY src is missing from the build context", () => {
    const dockerfiles = findDockerfiles();
    const violations: string[] = [];
    let overeno = 0;
    let promenne = 0;
    let vyrabene = 0;

    for (const dockerfile of dockerfiles) {
      // Kontext se ODVOZUJE z compose (`build.context`), ne hádá. Kořen a vlastní
      // adresář jsou přidány jako univerzálně platné možnosti — Dockerfile může
      // být stavěn i mimo compose (CI, `docker build -f`). Zdroj, který
      // neexistuje pod ŽÁDNÝM z nich, nemůže existovat v žádném kontextu.
      const konteksty = buildKontextyPro(dockerfile);
      for (const copy of parseDockerfileCopies(dockerfile)) {
        // `${VAR}` se rozvine až build argem — staticky o něm nic netvrdíme.
        // Mlčet je správně; hádat by vyrábělo falešné nálezy.
        if (/\$\{?[A-Za-z_]/.test(copy.src)) {
          promenne++;
          continue;
        }
        overeno++;
        // NEJDŘÍV existence, teprve pak výmluvy. Opačné pořadí utišilo 31× `COPY . .`
        // a soubory ležící v kořeni pod-kontextu (entrypoint-wrapper.sh,
        // postgresql.conf, pgbackrest.conf) — tedy přesně to, co má brána hlídat:
        // jejich první segment je jméno souboru, které v `git ls-files` jako
        // KOŘEN pochopitelně není. Výmluva se smí uplatnit až na zdroj, který
        // se nikde nenašel.
        if (konteksty.some((ctx) => existsSync(join(ROOT, ctx, copy.src)))) continue;
        // Strom, který git vůbec nezná, se vyrábí až za běhu — o tom brána mlčí.
        if (jeVyrabeny(copy.src, konteksty)) {
          overeno--;
          vyrabene++;
          continue;
        }
        violations.push(
          `  ${copy.dockerfile}:${copy.line}\n` +
            `    COPY src:        ${copy.src}\n` +
            `    hledáno v:       ${konteksty.map((c) => c || ".").join(", ")}\n` +
            `    raw:             ${copy.raw}`,
        );
      }
    }

    // Sonda musí umět odpovědět „ne" — a doložit, že vůbec měřila. Regrese
    // parseru by jinak udělala z prázdné množiny zelenou zprávu.
    expect(overeno, "žádný COPY zdroj se neověřoval — parser je rozbitý a verdikt by nic neznamenal").toBeGreaterThan(20);

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} Dockerfile COPY path(s) that do not exist:\n\n${violations.join("\n\n")}\n\n` +
          `(přeskočeno: ${promenne}× ${"$"}{VAR}, ${vyrabene}× generovaný strom — o těch brána nic netvrdí.)\n\n` +
          `docker build by padl na\n` +
          `  "failed to compute cache key: ... not found"\n\n` +
          `Fix: obnovit cestu, NEBO COPY přepsat na zdroj, který existuje. Zmizel-li\n` +
          `producent (přesun do balíku), musí se dohledat VŠICHNI jeho spotřebitelé —\n` +
          `Dockerfile není typovaný, takže tsc na něj nikdy nesáhne.`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  test("baseline: at least 5 Dockerfile* files scanned (sanity)", () => {
    const dockerfiles = findDockerfiles();
    // Sanity check — repo has Dockerfile.pki-init, pki-db, plus services/* etc.
    // Guard against accidental misconfiguration that finds 0 files (= test passes vacuously).
    expect(dockerfiles.length).toBeGreaterThanOrEqual(5);
  });
});
