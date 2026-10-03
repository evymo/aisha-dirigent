/**
 * Gate: `${VAR:-http://jméno:port}` musí mít jméno, které z TOHO compose jde rozřešit.
 *
 * PROČ (2026-07-29)
 * ----------------
 * V openclawu stálo `${POSTGREST_URL:-http://postgrest:3000}`. Vypadá neškodně,
 * ale `postgrest` je compose SERVICE NAME — docker ho rozlišuje jen uvnitř téhož
 * projektu, a `postgrest` patří do core. Z openclawu se nerozřeší vůbec.
 *
 * Fallback tak neplnil svou jedinou roli: kdyby proměnná chyběla, služba
 * nespadne na funkční adresu, ale na ŽÁDNOU. A protože proměnná se dodává,
 * projeví se to teprve ve chvíli, kdy se dodávat přestane — tedy v nejhorší
 * možný okamžik a bez souvislosti s příčinou.
 *
 * Nalezeno 7 takových míst, mezi nimi `keycloak:8080`, kde bylo špatně
 * i JMÉNO i PORT (keycloak vystavuje 80; 16 jiných míst používá aisha-keycloak:80).
 *
 * CO SE POVAŽUJE ZA ROZŘEŠITELNÉ
 * ------------------------------
 *   1. compose service name TÉHOŽ souboru  — docker to uvnitř projektu umí
 *   2. container_name kdekoli v instalaci   — globálně jednoznačné
 *   3. network alias kdekoli v instalaci    — totéž
 *   4. doménové jméno (obsahuje tečku)      — řeší DNS/mesh, ne docker
 *
 * Kontrola vznikla jako jednorázový `node -e` při analýze. Tady je proto, aby
 * se příště nemuselo hádat — a aby se ten tvar nemohl vrátit.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Univerzum se seeduje ze SKUTEČNOSTI (soubory na disku), ne z ručního výčtu. */
function composeFiles(): string[] {
  return readdirSync(ROOT)
    .filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f))
    .map((f) => resolve(ROOT, f));
}

/** container_name + network aliasy — jména jednoznačná napříč celou instalací. */
function globallyResolvableNames(): Set<string> {
  const names = new Set<string>();
  for (const file of composeFiles()) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*container_name:\s*([^\s#]+)/gm)) names.add(m[1]);
    for (const m of text.matchAll(/aliases:\s*\n((?:\s+-\s+[^\n]+\n)+)/g)) {
      for (const line of m[1].trim().split("\n")) {
        names.add(line.trim().replace(/^-\s*/, "").replace(/^["']|["']$/g, ""));
      }
    }
    for (const m of text.matchAll(/aliases:\s*\[([^\]]+)\]/g)) {
      for (const a of m[1].split(",")) names.add(a.trim().replace(/^["']|["']$/g, ""));
    }
  }
  return names;
}

/**
 * Compose service names JEDNOHO souboru. Čte se řádkově: `\Z` v JS regexu
 * neexistuje (je to písmeno Z), takže varianta přes lookahead končila předčasně,
 * blok `services:` vyšel prázdný a `minio` v core se tvářilo jako cizí jméno —
 * 12 „nálezů", z nichž 5 bylo falešných.
 */
function localServiceNames(file: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(file)) return names;
  let inServices = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (inServices && /^[a-zA-Z]/.test(line)) break;
    // ` {2}` not two literal spaces: same match, but the count is readable and
    // no-regex-spaces stops failing lint (this shipped red on the fork).
    const m = inServices && line.match(/^ {2}([a-z0-9][a-z0-9._-]*):\s*$/);
    if (m) names.add(m[1]);
  }
  return names;
}

type Finding = { file: string; variable: string; fallback: string; host: string };

function unresolvableFallbacks(): Finding[] {
  const global = globallyResolvableNames();
  const found: Finding[] = [];
  for (const file of composeFiles()) {
    const text = readFileSync(file, "utf8");
    const local = localServiceNames(file);
    for (const m of text.matchAll(
      /\$\{([A-Z_][A-Z0-9_]*):-(https?:\/\/([a-zA-Z0-9._-]+)(?::\d+)?[^}]*)\}/g,
    )) {
      const [, variable, fallback, host] = m;
      if (host.includes(".")) continue;      // doménové jméno — řeší DNS, ne docker
      if (local.has(host) || global.has(host)) continue;
      found.push({ file: file.replace(`${ROOT}/`, ""), variable, fallback, host });
    }
  }
  return found;
}

describe("compose fallbacky", () => {
  it("univerzum se seeduje ze skutečnosti a není prázdné", () => {
    expect(composeFiles().length).toBeGreaterThan(10);
    expect(globallyResolvableNames().size).toBeGreaterThan(20);
  });

  it("každý ${VAR:-http://…} fallback míří na jméno rozřešitelné z toho compose", () => {
    const findings = unresolvableFallbacks();
    const detail = findings
      .map((f) => `${f.file}: \${${f.variable}:-${f.fallback}} — '${f.host}' odsud nejde rozřešit`)
      .join("\n  ");
    expect(findings, `Fallback, který nemůže fungovat:\n  ${detail}`).toEqual([]);
  });
});
