/**
 * Brána: deploy úloha nesmí skončit zeleně, aniž ví, jestli se nasadilo.
 *
 * PROČ (naměřeno TŘIKRÁT, pokaždé se opravil jen ten jeden výskyt)
 * ---------------------------------------------------------------
 * 2026-07-29 — job „Deploy: Web" volal `/restart` místo `/deploy`. Kontejner se
 *   recykloval na STARÉM obrazu, úloha byla zelená, web se nezměnil. Opraveno
 *   výměnou endpointu; komentář o tom v ci.yml zůstal jako varování.
 * 2026-07-30 — extranet nebyl v ŽÁDNÉ pipeline: stál na commitu z předchozí
 *   noci, zatímco kolem něj proběhly tři merge. Opraveno přidáním úlohy.
 * 2026-08-08 — po merge byly VŠECHNY deploy úlohy zelené a extranet servíroval
 *   bajtově týž bundle jako před opravou. Nasadil se až ručně spuštěným
 *   `aisha-redeploy.mjs`.
 *
 * Pokaždé se opravila příčina toho jednoho případu a NIKDY vlastnost, která je
 * spojuje: úloha končila `exit 0` ve třech různých stavech —
 *   • chybí COOLIFY_API_TOKEN        (nenasazeno)
 *   • appka v Coolify nenalezena     (nenasazeno)
 *   • POST /api/v1/deploy vrátil 2xx (jen PŘIJETÍ požadavku, ne výsledek)
 * Zelená barva tedy nenesla žádnou informaci o cíli. Úloha si to sama napsala
 * do warningu — „Měřidlo je tag běžícího obrazu, NIKDY barva téhle úlohy" — a
 * pak se podle toho neřídila.
 *
 * CO SE MĚŘÍ
 * ----------
 * Každý krok, který spustí nasazení (`POST /api/v1/deploy`), musí ve TÉŽE úloze
 * také ČEKAT na výsledek. Za čekání se uznává jedině volání
 * `coolify-deploy-watch.mjs` (nebo sdílený `scripts/ci/deploy-and-verify.sh`,
 * který ho volá) — tedy nástroj, který umí odpovědět „ne".
 *
 * ROHATKA: dluh se vyjmenuje v baseline. Není to whitelist — brána selže i
 * tehdy, když v seznamu zůstane úloha, která už přepojená JE, takže seznam může
 * jen smršťovat. Dnes je PRÁZDNÝ (viz níž).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const CI = join(ROOT, ".github/workflows/ci.yml");

/**
 * Úlohy rozsekané na (jméno, tělo). YAML se tu ZÁMĚRNĚ neparsuje knihovnou:
 * měří se text kroků, ne struktura, a plný parser by přinesl závislost kvůli
 * jedné vlastnosti.
 */
function ulohy(yml: string): Array<{ jmeno: string; telo: string }> {
  const out: Array<{ jmeno: string; telo: string }> = [];
  const re = /^ {2}([a-z0-9-]+):\s*$/gm;
  const starty: Array<{ jmeno: string; at: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(yml))) starty.push({ jmeno: m[1], at: m.index });
  starty.forEach((s, i) => {
    const konec = i + 1 < starty.length ? starty[i + 1].at : yml.length;
    out.push({ jmeno: s.jmeno, telo: yml.slice(s.at, konec) });
  });
  return out;
}

/**
 * ⭐ MĚŘÍ SE VOLÁNÍ, NE VÝSKYT CESTY. První verze téhle brány hledala jen
 * `deploy-and-verify.sh` kdekoli v úloze — a trefila se do sparse-checkout
 * seznamu, takže úloha „čekala" už tím, že si ten soubor stáhla. Brána pak
 * zůstala zelená i nad krokem, který jsem záměrně rozbil. Sonda, která nejde
 * rozsvítit doČervena, neměří nic.
 *
 * A podruhé to selhalo jemněji: `(?:bash|sh)\s+…` se trefilo do KONCE jména
 * `coolify-resolve-uuid.sh` a `\s+` přeskočilo konec řádku na další položku
 * sparse-checkoutu. Proto `[ \t]+` (nikdy přes řádek) a lookbehind, aby `sh`
 * nebylo ocasem cizí cesty.
 */
const SPOUSTI = /api\/v1\/deploy\?uuid=|(?<![\w./-])(?:bash|sh)[ \t]+scripts\/ci\/(?:deploy-and-verify|nasad-podle-vln)\.sh/;
const CEKA = /(?<![\w./-])(?:bash|sh)[ \t]+scripts\/ci\/(?:deploy-and-verify|nasad-podle-vln)\.sh|(?<![\w./-])node[ \t]+scripts\/coolify-deploy-watch\.mjs/;

/**
 * ROHATKA JE PRÁZDNÁ — a to je cíl, ne opomenutí.
 *
 * Při vzniku téhle brány (2026-08-08) v ní bylo pět úloh. Tři z nich
 * (deploy-web, deploy-core, deploy-keycloak) ale nasazovaly TUTÉŽ appku
 * `-core`, takže je nešlo přepojit jednu po druhé — tři striktní čekání by si
 * šlapala po sobě. Sloučily se proto do jedné úlohy odvozené ZE ZMĚNY a dluh
 * tím zmizel celý.
 *
 * CO TAHLE BRÁNA ZÁMĚRNĚ NEMĚŘÍ: úlohy, které nasazení nespouštějí přes
 * `POST /api/v1/deploy`. `deploy-n8n` volá `/restart` a je to SPRÁVNĚ —
 * entrypoint kontejneru si při startu instaluje novou verzi z Verdaccia, takže
 * restart je tam mechanismus, ne zkratka (má to u sebe napsané). Kdyby se
 * měřily i restarty, brána by hlásila poplach nad kódem, který je v pořádku,
 * a umlčela by se výjimkou — čímž by se ztratily i pravé nálezy.
 */
const BASELINE: ReadonlySet<string> = new Set<string>([]);

describe("brána: deploy úloha nesmí lhát o nasazení", () => {
  const yml = readFileSync(CI, "utf8");
  const vsechny = ulohy(yml);

  it("měřidlo vůbec něco našlo", () => {
    expect(vsechny.length, "z ci.yml se nepřečetla ani jedna úloha — parser přestal sedět").toBeGreaterThan(10);
    expect(
      vsechny.filter((u) => SPOUSTI.test(u.telo)).length,
      "žádná úloha nespouští nasazení — brána by neměřila nic",
    ).toBeGreaterThan(0);
  });

  it("kdo spustí nasazení, musí počkat na výsledek", () => {
    const hresi: string[] = [];
    for (const u of vsechny) {
      const spousti = SPOUSTI.test(u.telo);
      if (!spousti) continue;
      const ceka = CEKA.test(u.telo);
      if (!ceka && !BASELINE.has(u.jmeno)) hresi.push(u.jmeno);
    }
    expect(
      hresi,
      "tyhle úlohy spustí nasazení a NEČEKAJÍ na výsledek:\n" +
        hresi.map((h) => `  ${h}`).join("\n") +
        "\n\nCO TO ZNAMENÁ: zelená úloha pak neříká nic o tom, jestli se nasadilo — a\n" +
        "přesně tenhle stav třikrát skončil starým artefaktem na produkci.\n\n" +
        "CO S TÍM: přepojit krok na `bash scripts/ci/deploy-and-verify.sh <suffix>`\n" +
        "(a doplnit ho do sparse-checkout spolu se scripts/coolify-deploy-watch.mjs).",
    ).toEqual([]);
  });

  it("rohatka se smí jen utahovat — co je přepojené, ze seznamu zmizí", () => {
    const uzHotove = [...BASELINE]
      .filter((jmeno) => {
        const u = vsechny.find((x) => x.jmeno === jmeno);
        return u && CEKA.test(u.telo);
      })
      .sort();
    expect(
      uzHotove,
      "tyhle úlohy jsou v baseline jako dluh, ale už na výsledek čekají:\n" +
        uzHotove.map((h) => `  ${h}`).join("\n") +
        "\n\nCO S TÍM: vyškrtnout je z BASELINE v tomhle souboru.",
    ).toEqual([]);
  });

  it("nasazení po vlnách čeká PROTO, že deleguje na deploy-and-verify (ne na vlastní curl)", () => {
    // Bez tohohle by `nasad-podle-vln.sh` v CEKA byl jen jméno: skript, který by
    // sám poslal POST /deploy a nečekal, by bránou prošel.
    const sh = readFileSync(join(ROOT, "scripts/ci/nasad-podle-vln.sh"), "utf8");
    expect(sh).toMatch(/bash scripts\/ci\/deploy-and-verify\.sh "\$app"/);
    expect(sh, "skript nesmí nasazovat mimo deploy-and-verify").not.toMatch(/api\/v1\/(deploy|applications\/[^/]+\/restart)/);
  });

  it("sdílený krok neskončí zeleně bez pověření", () => {
    // Vlastnost, kvůli které ten skript vznikl: chybějící token je ROZBITÁ
    // pipeline, ne legitimní přeskočení. Kdyby se sem vrátil `exit 0`,
    // nasazovalo by se měsíce nikam a úloha by o tom mlčela.
    const sh = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8");
    const vetev = sh.match(/if \[ -z "\$\{COOLIFY_API_TOKEN:-\}"[\s\S]{0,1400}?\nfi/);
    expect(vetev, "ve skriptu chybí větev nad chybějícím COOLIFY_API_TOKEN").not.toBeNull();
    expect(vetev![0], "chybějící pověření nekončí pádem").toMatch(/exit 1/);
    expect(sh, "chybí čekání na terminální stav").toMatch(/coolify-deploy-watch\.mjs/);
    expect(sh, "chybí --strict, takže by se pád nasazení nepoznal").toMatch(/--strict/);
  });
});
