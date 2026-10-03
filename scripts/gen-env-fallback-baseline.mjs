#!/usr/bin/env node
/**
 * gen-env-fallback-baseline.mjs — snímek dluhu „fallback nad env".
 *
 * PRAVIDLO (majitel, 2026-08-12): „žádné fallbacky, vše musí být nastaveno jen
 * správně." Hodnota popisující SVĚT — kdo je instance, jaký je tvar nasazení,
 * kde co běží — se nesmí dosazovat literálem. Chybějící hodnota selže na
 * správném místě; dosazená tiše trefí něco jiného.
 *
 * Dluh je velký (naměřeno 2026-08-12: 542 výskytů ve 120 souborech), takže se
 * NEVYNUCUJE nulou, ale BASELINE, která smí jen klesat — týž vzor, jaký repo
 * používá pro snímek dluhu značek (src/tests/gates/*-markers.gate.test.ts).
 * Nic nového neprojde; staré ubývá.
 *
 * (Jméno té sesterské brány se tu schválně nepíše celé: ona sama skenuje
 *  komentáře a její vlastní název by v próze počítala jako nález.)
 *
 * Spuštění po legitimním úbytku:
 *   node scripts/gen-env-fallback-baseline.mjs
 *
 * @module
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./lib/cli-entry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/tests/gates/env-fallback.baseline.json");

/** `process.env.KLIC || "literál"` / `?? "literál"` s NEPRÁZDNÝM literálem. */
export const FALLBACK_RE =
  /process\.env\.([A-Z][A-Z0-9_]*)\s*(?:\|\||\?\?)\s*(['"`])([^'"`]+)\2/g;

/**
 * Shell: `${KLIC:-literál}` s NEPRÁZDNÝM literálem, který NENÍ odkaz na jinou
 * proměnnou. Táž věta jako u JS regexu o řádek výš, jen v druhém jazyce.
 *
 * ⛔ NAMĚŘENO 2026-08-22: tenhle sběrač uměl jen JS/TS, takže račna NEVIDĚLA
 * shell — a v `scripts/aisha-cold-start.sh` je heredoc, který vyrábí celé
 * `.env.coolify`. Tedy přesně to místo, kde se instance konfiguruje, bylo
 * z měření vynechané: 150 dosazení tam žilo mimo jakoukoli hranici. Jedno
 * z nich (`AISHA_INSTANCE:-_default`) postavilo povrch z referenční šablony
 * a majitel skončil na cizím IdP.
 *
 * Nechytá se schválně:
 *   · `${X:-}`      — prázdné je NORMALIZACE „nenastaveno", ne dosazená hodnota,
 *   · `${X:-${Y}}`  — řetěz deklarací, ne vymyšlený literál (jako `env.X || env.Y`),
 *   · `${X:?zpráva}` — to je STRÁŽ, tedy pravý opak fallbacku.
 */
export const FALLBACK_SH_RE = /\$\{([A-Z][A-Z0-9_]*):-([^}$][^}]*)\}/g;

/** Prázdný literál je NORMALIZACE („nenastaveno"), ne dosazená hodnota — regex ho už nechytá. */
/**
 * Compose je TŘETÍ OSA téže vady (2026-09-10). `docker-compose*.yml` nese
 * `${X:-literál}` v téže syntaxi jako shell — a `$${X:-literál}` (escapované pro
 * shell UVNITŘ kontejneru) je tentýž dosazený literál o vrstvu níž; regex ho
 * chytí, protože nekotví na začátek. Do 2026-09-10 tuhle osu račna NEVIDĚLA:
 * 350 dosazení ve 28 compose souborech žilo mimo měření.
 */
export function pocetVSouboru(text, soubor = "") {
  const shell = /\.sh$/.test(soubor) || /(^|\/)docker-compose[^/]*\.ya?ml$/.test(soubor);
  const re = shell ? FALLBACK_SH_RE : FALLBACK_RE;
  let n = 0;
  for (const radek of text.split("\n")) {
    const orez = radek.trim();
    // Komentář není kód: jinak brána hlásí vlastní vysvětlující text.
    if (shell ? orez.startsWith("#") : orez.startsWith("//") || orez.startsWith("*") || orez.startsWith("/*")) continue;
    n += [...radek.matchAll(re)].length;
  }
  return n;
}

/** Sledované soubory podle gitu — co není v repu, není náš dluh. */
export function sledovaneZdroje(root = ROOT) {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|js|cjs|sh)$/.test(f) || /(^|\/)docker-compose[^/]*\.ya?ml$/.test(f))
    .filter((f) => !f.includes("/node_modules/") && !f.startsWith("dist/"))
    // Testy a baseline samy nesou ukázky vzoru; hlídá se PROVOZNÍ kód.
    .filter((f) => !/\.(test|spec)\.[a-z]+$/.test(f))
    .filter((f) => !/\.baseline\.json$/.test(f));
}

export function sesbirej(root = ROOT) {
  const perFile = {};
  let total = 0;
  for (const f of sledovaneZdroje(root)) {
    // Nečitelný SLEDOVANÝ soubor není "nula nálezů" — je to díra v pokrytí.
    // Mlčky ho přeskočit by znamenalo tvrdit čisto o něčem, co jsme nepřečetli.
    let text;
    try {
      text = readFileSync(path.join(root, f), "utf-8");
    } catch (err) {
      throw new Error(
        `nelze přečíst sledovaný soubor ${f}: ${err instanceof Error ? err.message : String(err)}\n` +
          "  Snímek dluhu musí pokrýt celý strom, jinak tvrdí čisto o nepřečteném.",
      );
    }
    const n = pocetVSouboru(text, f);
    if (n > 0) {
      perFile[f] = n;
      total += n;
    }
  }
  return {
    // Proč čísla 2026-08-22 skokem povyrostla: NEPŘIBYL dluh, přibylo VIDĚNÍ.
    // Sběrač uměl do té doby jen JS/TS, takže shell — a v něm heredoc
    // cold-startu, který vyrábí celé `.env.coolify` — ležel mimo hranici.
    // Univerzum se tedy rozšířilo o `.sh`; 537 → 1066 je cena za to, že se
    // konečně měří i tam, kde se instance konfiguruje. Hranice smí zase jen
    // klesat. Táž věta jako u rozšíření univerza mesh-conformance.
    $comment_univerzum:
      "2026-09-10: sledované soubory rozšířeny o docker-compose*.yml (osa compose). 2026-08-22: o *.sh (dřív jen JS/TS). " +
      "Skok v číslech = nově VIDĚNÝ dluh, ne nově vzniklý.",
    totalFallbacks: total,
    totalFiles: Object.keys(perFile).length,
    perFile,
  };
}

// Strážce vstupu má jeden domov: lib/cli-entry.mjs. Dřív tu stálo porovnání
// `import.meta.url === `file://${process.argv[1]}`` — to je ale porovnání
// ZÁPISU cesty: URL je percent-enkódovaná, argv[1] syrový. Na cestě s
// diakritikou se rozejdou a blok se TIŠE přeskočí (naměřeno 2026-08-14:
// resolver vydal 0 bajtů s kódem 0 a shodil tím dvanáct bran).
if (isDirectRun(import.meta.url)) {
  const snapshot = sesbirej();
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stdout.write(
    `baseline zapsána: ${snapshot.totalFallbacks} výskytů v ${snapshot.totalFiles} souborech\n` +
      `  ${path.relative(ROOT, OUT)}\n`,
  );
}
