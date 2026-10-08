/**
 * Brána: MinIO server a `mc` se staví ZE ZDROJE — z Go module proxy, pinovaně,
 * ověřeně, bez našeho repa a registru.
 *
 * ⛔ PROČ (plán A schválený majitelem 2026-09-25): MinIO obrazy už nikdo nevydává.
 * Docker Hub `minio/*` smazán 2026-09-11 (jádro forku tehdy 12 h mimo provoz),
 * quay.io/minio/{minio,mc} od 2026-09-24 vrací 401 i s anonymním tokenem,
 * repozitář MinIO CE je archivovaný. Hostitelé měli už jen lokální kopie — další
 * nasazení na čistém stroji by jádro nepostavilo vůbec.
 *
 * Požadavek majitele: KAŽDÝ fork musí fungovat BEZ přístupu k našemu repu i
 * registru → obraz se staví v jeho vlastní Coolify pipeline z neměnného
 * veřejného zdroje (proxy.golang.org + sum.golang.org).
 *
 * CO BRÁNA TVRDÍ (vlastnosti, ne pravopis):
 *  1. Kontext = vlastní adresář, žádný COPY/ADD z repa (jen `--from=<stage>` a heredoc).
 *     Zdroje jdou jen přes Go proxy → BuildKit cache přežije jakoukoli změnu repa.
 *  2. Každý základní obraz je připnutý DIGESTEM a jde přes VOLITELNÝ prefix
 *     `${REGISTRY_PROXY}` s prázdným výchozím (fork bez naší cache postaví z Docker Hubu).
 *  3. Go: GOPROXY je jen proxy.golang.org (bez `,direct`), checksum DB se nevypíná,
 *     `-mod=readonly`, `CGO_ENABLED=0`, `-trimpath`.
 *  4. Moduly jsou pinované pseudo-verzí a tři fakta (pseudo-verze, release tag,
 *     commit) mluví o téže revizi — build to ověří znovu, tady se to chytí dřív.
 *  5. Compose: `minio` i `minio-init` staví z docker/minio (správný cíl) a NEMAJÍ
 *     `image:` — stavěná služba s vlastním tagem se z build serveru na cíl nepřenese
 *     (naměřeno 2026-08-17, viz CORE_COMPOSE_ROZHODNUTI.md › db).
 *  6. Správa úložiště má jeden vstupní bod: služba se `storage-init` staví cíl, který
 *     ho nese.
 *  7. Nikdo netahá MinIO obraz z registru (compose, workflowy, skripty, config).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { CORE_COMPOSE, storageInit } from "./lib/storage-init";

const ROOT = process.cwd();
const KONTEXT = "docker/minio";
const DOCKERFILE = `${KONTEXT}/Dockerfile`;
const df = readFileSync(join(ROOT, DOCKERFILE), "utf8");
/** Chování bez komentářů (Dockerfile i skripty v heredocu) — zmínka v poznámce není nastavení. */
const kod = df.split("\n").filter((r) => !r.trim().startsWith("#")).join("\n");

/**
 * Instrukce Dockerfilu: bez komentářů, pokračování `\` slitá do jednoho řádku,
 * obsah heredoců vynechán (ten je DATA, ne instrukce).
 */
export function instrukce(text: string): string[] {
  const out: string[] = [];
  let heredoc: string | null = null;
  let rozepsana = "";
  for (const radek of text.split("\n")) {
    if (heredoc !== null) {
      if (radek.trim() === heredoc) heredoc = null;
      continue;
    }
    const t = radek.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.endsWith("\\")) {
      rozepsana += t.slice(0, -1).trim() + " ";
      continue;
    }
    const cela = rozepsana + t;
    rozepsana = "";
    out.push(cela);
    const h = cela.match(/<<-?['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (h) heredoc = h[1]!;
  }
  return out;
}

/** Hodnoty ARG s výchozí hodnotou (globální i ve stage). */
export function argy(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of instrukce(text)) {
    const a = t.match(/^ARG\s+([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (a) m.set(a[1]!, a[2]!.trim());
  }
  return m;
}

/** Tři piny jednoho modulu mluví o téže revizi (táž kontrola jako build-from-proxy). */
export function pinySouhlasi(verze: string, tag: string, commit: string): string | null {
  const pv = verze.match(/^v0\.0\.0-(\d{14})-([0-9a-f]{12})$/);
  if (!pv) return `${verze} není pseudo-verze v0.0.0-<14 číslic>-<12 hex>`;
  if (!/^[0-9a-f]{40}$/.test(commit)) return `${commit} není celý SHA-1 commitu`;
  if (!commit.startsWith(pv[2]!)) return `pseudo-verze ${verze} nenese commit ${commit.slice(0, 12)}`;
  const t = tag.match(/^RELEASE\.(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/);
  if (!t) return `${tag} není tag vydání RELEASE.<čas>`;
  if (t.slice(1).join("") !== pv[1]) return `vydání ${tag} neodpovídá času commitu v ${verze}`;
  return null;
}

describe("MinIO obraz ze zdroje — Dockerfile", () => {
  const ins = instrukce(df);

  it("kontext je vlastní adresář s jediným souborem (nic z repa se do buildu nedostane)", () => {
    const sledovane = execFileSync("git", ["ls-files", "--others", "--cached", "--exclude-standard", KONTEXT], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(sledovane).toEqual([DOCKERFILE]);
  });

  it("žádný COPY/ADD z kontextu — jen --from=<stage> a heredoc", () => {
    const zRepa = ins.filter((t) => /^(COPY|ADD)\b/.test(t)).filter((t) => !/--from=\S+/.test(t) && !/<<-?['"]?[A-Za-z_]/.test(t));
    expect(zRepa).toEqual([]);
    expect(ins.filter((t) => /^ADD\b/.test(t)), "ADD umí stahovat URL — zdroj jen přes Go proxy").toEqual([]);
  });

  it("každý základní obraz: volitelný ${REGISTRY_PROXY} + tag + digest", () => {
    const stage = new Set<string>();
    const vadne: string[] = [];
    let zakladu = 0;
    for (const t of ins.filter((x) => /^FROM\b/.test(x))) {
      const m = t.match(/^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$/i);
      if (!m) {
        vadne.push(t);
        continue;
      }
      const [, obraz, jmeno] = m;
      if (!stage.has(obraz!)) {
        zakladu += 1;
        if (!/^\$\{REGISTRY_PROXY\}[a-z0-9./_-]+:[\w.-]+@sha256:[0-9a-f]{64}$/.test(obraz!)) vadne.push(t);
      }
      if (jmeno) stage.add(jmeno);
    }
    expect(vadne).toEqual([]);
    expect(zakladu, "Go toolchain + běhový základ").toBeGreaterThanOrEqual(2);
    expect(df, "prefix cache musí zůstat VOLITELNÝ (prázdný výchozí)").toMatch(/^ARG REGISTRY_PROXY=\s*$/m);
  });

  it("Go bere zdroje jen z proxy, s ověřením, bez cgo a s -trimpath", () => {
    const env = ins.filter((t) => /^ENV\b/.test(t)).join(" ");
    expect(env).toMatch(/GOPROXY=https:\/\/proxy\.golang\.org(\s|$)/);
    expect(env).toMatch(/GOFLAGS=-mod=readonly(\s|$)/);
    expect(env).toMatch(/CGO_ENABLED=0(\s|$)/);
    expect(kod).not.toMatch(/GONOSUMDB|GONOSUMCHECK|GOPRIVATE|GOINSECURE|GOSUMDB|GOFLAGS=[^\n]*-insecure|,direct/);
    // `go install <modul>@<verze>`: buildinfo nese modul a verzi (SBOM ho pozná).
    expect(kod).toMatch(/go install -tags kqueue -trimpath -ldflags "\$ldflags" "\$mod@\$ver"/);
    expect(kod, "zdroj se stahuje přes `go mod download` z proxy, ne klonem").toMatch(/go mod download -json "\$mod@\$ver"/);
    expect(kod).not.toMatch(/\bgit clone\b|\b(curl|wget)\b[^\n]*https?:/);
  });

  it("moduly: pinovaná pseudo-verze a tři fakta o téže revizi", () => {
    const a = argy(df);
    for (const p of ["MINIO", "MC"]) {
      const chyba = pinySouhlasi(a.get(`${p}_MODULE_VERSION`) ?? "", a.get(`${p}_RELEASE_TAG`) ?? "", a.get(`${p}_COMMIT`) ?? "");
      expect(chyba, p).toBeNull();
    }
    expect(kod).toMatch(/build-from-proxy github\.com\/minio\/minio "\$MINIO_MODULE_VERSION"/);
    expect(kod).toMatch(/build-from-proxy github\.com\/minio\/mc "\$MC_MODULE_VERSION"/);
  });

  it("ldflags jako upstream vydání (ne DEVELOPMENT build)", () => {
    for (const x of ["Version", "CopyrightYear", "ReleaseTag", "CommitID", "ShortCommitID"]) {
      expect(kod).toMatch(new RegExp(`-X \\$pkg\\.${x}=`));
    }
  });

  it("cíle minio i mc existují; storage-init nese cíl mc", () => {
    expect(ins).toContain("FROM runtime AS minio");
    expect(ins).toContain("FROM runtime AS mc");
    const mc = df.slice(df.indexOf("FROM runtime AS mc"), df.indexOf("FROM runtime AS minio"));
    expect(mc).toMatch(/^COPY --chmod=0755 <<'EOF' \/usr\/local\/bin\/storage-init$/m);
  });
});

describe("pinovaná fakta — sebetest", () => {
  it("souhlasná trojice projde, rozjetá neprojde", () => {
    expect(pinySouhlasi("v0.0.0-20250907161309-07c3a429bfed", "RELEASE.2025-09-07T16-13-09Z", "07c3a429bfed433e49018cb0f78a52145d4bedeb")).toBeNull();
    expect(pinySouhlasi("v0.0.0-20250907161309-07c3a429bfed", "RELEASE.2025-09-08T16-13-09Z", "07c3a429bfed433e49018cb0f78a52145d4bedeb")).toMatch(/neodpovídá/);
    expect(pinySouhlasi("v0.0.0-20250907161309-07c3a429bfed", "RELEASE.2025-09-07T16-13-09Z", "7394ce0dd2a80935aded936b09fa12cbb3cb8096")).toMatch(/nenese commit/);
    expect(pinySouhlasi("latest", "RELEASE.2025-09-07T16-13-09Z", "07c3a429bfed433e49018cb0f78a52145d4bedeb")).toMatch(/pseudo-verze/);
  });

  it("obsah heredocu není instrukce, pokračování řádku je jedna instrukce", () => {
    expect(instrukce("FROM a AS b\nCOPY <<'EOF' /x\nADD http://zlo /y\nEOF\nRUN true")).toEqual(["FROM a AS b", "COPY <<'EOF' /x", "RUN true"]);
    expect(instrukce("ENV A=1 \\\n    B=2\n# komentář\nRUN x")).toEqual(["ENV A=1 B=2", "RUN x"]);
  });
});

describe("MinIO obraz ze zdroje — compose a okolí", () => {
  type Sluzba = { image?: string; build?: { context?: string; target?: string; args?: Record<string, string> } | string };
  const doc = parseYaml(readFileSync(join(ROOT, CORE_COMPOSE), "utf8")) as { services: Record<string, Sluzba> };

  it.each([
    ["minio", "minio"],
    ["minio-init", "mc"],
  ])("%s staví z docker/minio (cíl %s) a nemá vlastní image:", (jmeno, cil) => {
    const s = doc.services[jmeno]!;
    expect(s.build).toMatchObject({ context: KONTEXT, target: cil });
    expect(s.image, "stavěná služba s vlastním tagem se z build serveru na cíl nepřenese").toBeUndefined();
  });

  // FROM v Dockerfile stojí na `${REGISTRY_PROXY}` (základní obrazy z Docker Hubu přes
  // centrální cache). Coolify build-time proměnné předává sám, lokální `docker compose`
  // ne — argument proto stojí výslovně, jako u ostatních buildů (db, clamav, admin…).
  it.each(["minio", "minio-init"])("%s předává buildu REGISTRY_PROXY (FROM jde přes cache)", (jmeno) => {
    const b = doc.services[jmeno]!.build as { args?: Record<string, string> };
    expect(b.args?.REGISTRY_PROXY).toBe("${REGISTRY_PROXY:-}");
    expect(df).toMatch(/^FROM\s+(--platform=\S+\s+)?\$\{REGISTRY_PROXY\}/m);
  });

  it("storage-init spouští služba, která staví cíl mc", () => {
    const { sluzba } = storageInit(ROOT);
    expect(doc.services[sluzba]!.build).toMatchObject({ context: KONTEXT, target: "mc" });
  });

  it("integrační test AV staví týž Dockerfile, ne obraz z registru", () => {
    const av = readFileSync(join(ROOT, "scripts/test/run-av-integration.mjs"), "utf8");
    expect(av).toMatch(/'docker\/minio\/Dockerfile'/);
    expect(av).toMatch(/'--target', 'minio'/);
  });

  it("nikdo netahá MinIO obraz z registru", () => {
    const soubory = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "docker-compose*.yml", ".github/workflows", "scripts", "config"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => /\.(ya?ml|sh|mjs|cjs|js|env)$/.test(f) && !/\.test\.(mjs|cjs|js|ts)$/.test(f));
    const nalezy: string[] = [];
    for (const f of soubory) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, f), "utf8");
      } catch {
        continue;
      }
      text.split("\n").forEach((r, i) => {
        const t = r.trim();
        if (t.startsWith("#") || t.startsWith("//") || t.startsWith("*")) return;
        if (/quay\.io\/minio\/|(^|[\s"'=/])minio\/(minio|mc)(:|["'\s]|$)|\$\{IMAGE_MINIO/.test(t)) nalezy.push(`${f}:${i + 1}  ${t.slice(0, 120)}`);
      });
    }
    expect(soubory.length, "univerzum souborů je prázdné — brána by měřila nic").toBeGreaterThan(50);
    expect(nalezy).toEqual([]);
  });
});
