#!/usr/bin/env node
/**
 * compose-env-refs.mjs — které proměnné compose v daném souboru INTERPOLUJE.
 *
 * ⛔ PROČ EXISTUJE (naměřeno 2026-08-19)
 * Do té doby se reference extrahovaly TEXTOVĚ: `grep -v '^\s*#'` a regex.
 * Jenže hranici komentáře určuje YAML, ne začátek řádku:
 *
 *     # upstream *.${INTERNAL_TLD} …      ← uvnitř `entrypoint: |` block-scalaru
 *
 * je pro YAML součást HODNOTY (a compose ji interpoluje — při nasazení edge
 * padlo varování „INTERNAL_TLD is not set … blank string"), zatímco textový
 * extraktor řádek zahodil jako komentář, takže sync-envs klíč NEDORUČIL.
 * A obráceně: trailing komentář `key: v  # ${KEYCLOAK_DOMAIN}` YAML zahodí,
 * compose nic neinterpoluje — ale textový extraktor ho viděl a doručoval
 * mrtvý klíč (langfuse). Tři soubory, sedm dvojic, oba směry chyby.
 *
 * Jediný způsob, jak se s compose shodnout, je číst soubor STEJNĚ jako on:
 * YAML parse, interpolace jen nad řetězcovými HODNOTAMI, `$$` je escape.
 *
 * Použití:
 *   node compose-env-refs.mjs <compose.yml>            # všechny reference
 *   node compose-env-refs.mjs <compose.yml> --required # jen ${VAR:?…} / ${VAR?…}
 *   node compose-env-refs.mjs <compose.yml> --silent   # jen holé ${VAR} / $VAR
 *   node compose-env-refs.mjs <compose.yml> --bez-defaultu  # obojí: compose nemá
 *                                                      # čím mezeru zaplnit
 *
 * Jako knihovna: `referenceCompose(text)` / `referenceSouboru(cesta)` vrátí
 * reference, `jmenaReferenci(reference, rezim)` z nich jména. Kdo potřebuje
 * vědět, CO z toho musí být doručeno, ptá se `povinne-promenne.mjs`.
 *
 * Výstup: jména po řádcích, seřazená, unikátní. Žádný filtr SERVICE_* —
 * to je politika volajícího (bash obálka), ne vlastnost interpolace.
 * Nevalidní YAML = tvrdý pád s hláškou; takový soubor nejde ani nasadit,
 * takže tichý prázdný výstup by byl fail-open.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";

// yaml balík z kořene repa — lib žije v scripts/lib/, kořen je o dvě výš.
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { parse } = createRequire(import.meta.url)(join(KOREN, "node_modules/yaml/dist/index.js"));


/**
 * Projde řetězec přesně podle interpolace compose:
 *   $$        → literál `$`, nic se neinterpoluje
 *   ${NAME}   → holá (tichá) reference — chybí-li, compose doplní PRÁZDNO
 *   ${NAME:-d}/${NAME-d}  → explicitní default (vědomé rozhodnutí)
 *   ${NAME:?m}  → povinná a NEPRÁZDNÁ — nenastavená i prázdná = compose SPADNE
 *   ${NAME?m}   → povinná, prázdná hodnota projde — spadne jen nenastavená
 *   ${NAME:+a}/${NAME+a}  → alternativa při nastavení
 *   $NAME     → holá reference bez závorek
 * Jména podle compose spec: [A-Za-z_][A-Za-z0-9_]* — VČETNĚ malých písmen
 * (pki placeholdery `${cert_profile}` compose interpoluje úplně stejně).
 */
export function referenceZRetezce(text) {
  const ven = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue;
    if (text[i + 1] === "$") { i++; continue; }
    if (text[i + 1] === "{") {
      const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)([:}?+-])/.exec(text.slice(i));
      if (!m) continue; // nevalidní zápis — compose ho nechá literálem
      const op = m[2] === ":" ? text[i + 2 + m[1].length + 1] ?? "" : m[2];
      ven.push({
        jmeno: m[1],
        ticha: m[2] === "}",
        povinna: m[2] === "?" || (m[2] === ":" && op === "?"),
        // Dvojtečka je v interpolaci otázka „prázdné se počítá jako chybějící?".
        neprazdna: m[2] === ":" && op === "?",
      });
      i += m[1].length + 1;
    } else {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i));
      if (m) { ven.push({ jmeno: m[1], ticha: true, povinna: false, neprazdna: false }); i += m[1].length; }
    }
  }
  return ven;
}

export function projdi(uzel, ven) {
  if (typeof uzel === "string") { ven.push(...referenceZRetezce(uzel)); return; }
  if (Array.isArray(uzel)) { for (const u of uzel) projdi(u, ven); return; }
  if (uzel && typeof uzel === "object") for (const v of Object.values(uzel)) projdi(v, ven);
}

/**
 * Všechny reference v compose TEXTU (YAML nebo JSON — JSON je podmnožina YAML,
 * takže projde i vygenerovaný `docker-compose.local.generated.json`).
 * Nevalidní dokument = výjimka: soubor, který nejde přečíst, nejde ani nasadit,
 * a prázdný výsledek by se tvářil jako „nic nechybí".
 */
export function referenceCompose(text, jmenoSouboru = "compose") {
  let dokument;
  try {
    dokument = parse(text);
  } catch (e) {
    throw new Error(`compose-env-refs: ${jmenoSouboru} není validní YAML — ${e.message.split("\n")[0]}`);
  }
  const reference = [];
  projdi(dokument, reference);
  // `secrets: <jméno>: environment: VAR` — compose tu proměnnou čte z prostředí
  // stejně jako `${VAR}`, jen ne interpolací, takže ji průchod hodnotami nevidí.
  //
  // ⛔ NAMĚŘENO 2026-09-14: FORGEJO_TOKEN (build secret overlaye Keycloaku
  // i zdrojových adaptérů brokeru) neměla v Coolify ani jedna z těch aplikací —
  // sync doručuje jen klíče, které tahle funkce vrátí. Klon soukromého overlaye
  // pak selže a fail-closed build spadne.
  //
  // Odkaz je VOLITELNÝ (ne tichý, ne povinný): Dockerfile ho montuje
  // `required=false` a instalace bez soukromého overlaye token mít nemusí.
  for (const def of Object.values(dokument?.secrets ?? {})) {
    if (def && typeof def === "object" && typeof def.environment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(def.environment)) {
      reference.push({ jmeno: def.environment, ticha: false, povinna: false, neprazdna: false });
    }
  }
  return reference;
}

/**
 * Jména podle režimu: `required` = `${X:?}`/`${X?}`, `silent` = holé `${X}`/`$X`,
 * `bez-defaultu` = obojí (compose nemá vlastní hodnotu, kterou by mezeru zaplnil),
 * `vse` = všechno. Seřazená, unikátní.
 */
export function jmenaReferenci(reference, rezim = "vse") {
  let vybrane = reference;
  if (rezim === "required") vybrane = reference.filter((r) => r.povinna);
  else if (rezim === "silent") vybrane = reference.filter((r) => r.ticha);
  else if (rezim === "bez-defaultu") vybrane = reference.filter((r) => r.ticha || r.povinna);
  else if (rezim !== "vse") throw new Error(`compose-env-refs: neznámý režim '${rezim}'`);
  return [...new Set(vybrane.map((r) => r.jmeno))].sort();
}

export function referenceSouboru(cesta) {
  return referenceCompose(readFileSync(cesta, "utf8"), cesta);
}

/**
 * Pole `x-aisha-povinne-za-behu: [JMÉNO, …]` v kořeni compose: proměnné, které
 * compose interpoluje HOLÉ (`${X}`), ale bez kterých služba NENASTARTUJE.
 *
 * ⛔ PROČ (2026-09-26, klíč trezoru relací brokeru, ADR-004): `${X:?}` by předlet
 * uviděl — jenže tatáž pojistka vtáhne X do build-time množiny a Coolify ho
 * zapeče do `docker history` (brána build-time-mnozina-vsech-compose, rohatka).
 * Holé `${X}` do buildu nejde, ale předlet (povinne-promenne) ho za povinné
 * nepovažoval: nasazení na instanci bez klíče prošlo zeleně a služba po výměně
 * kontejneru spadla. Tohle pole je prosté jméno, žádná interpolace — build-time
 * množina ho nevidí, předlet ano (povinné a NEPRÁZDNÉ, jako `:?`).
 *
 * Deklarace musí jmenovat proměnnou, kterou compose OPRAVDU interpoluje: jinak ji
 * sync aplikaci nedoručí (per-app filtr bere reference) a deklarace je mrtvá.
 * Obojí je výjimka — tichý prázdný seznam by znamenal „nic není povinné".
 */
export const POLE_POVINNE_ZA_BEHU = "x-aisha-povinne-za-behu";

export function povinneZaBehu(text, jmenoSouboru = "compose") {
  let dokument;
  try {
    dokument = parse(text);
  } catch (e) {
    throw new Error(`compose-env-refs: ${jmenoSouboru} není validní YAML — ${e.message.split("\n")[0]}`);
  }
  const pole = dokument?.[POLE_POVINNE_ZA_BEHU];
  if (pole === undefined || pole === null) return [];
  if (!Array.isArray(pole) || pole.some((j) => typeof j !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(j))) {
    throw new Error(`compose-env-refs: ${jmenoSouboru}: ${POLE_POVINNE_ZA_BEHU} musí být seznam jmen proměnných`);
  }
  const interpolovane = new Set(referenceCompose(text, jmenoSouboru).map((r) => r.jmeno));
  const mrtve = pole.filter((j) => !interpolovane.has(j));
  if (mrtve.length > 0) {
    throw new Error(
      `compose-env-refs: ${jmenoSouboru}: ${POLE_POVINNE_ZA_BEHU} jmenuje ${mrtve.join(", ")}, ` +
        "které compose neinterpoluje — sync je aplikaci nedoručí, deklarace je mrtvá",
    );
  }
  return [...new Set(pole)].sort();
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// Jen při přímém spuštění; importem se nic nečte ani neukončuje.
if (isDirectRun(import.meta.url)) {
  const [, , soubor, prepinac] = process.argv;
  const REZIMY = { "--required": "required", "--silent": "silent", "--bez-defaultu": "bez-defaultu" };
  if (!soubor || (prepinac !== undefined && !REZIMY[prepinac])) {
    console.error("použití: compose-env-refs.mjs <compose.yml> [--required|--silent|--bez-defaultu]");
    process.exit(2);
  }
  const rezim = prepinac === undefined ? "vse" : REZIMY[prepinac];
  let reference;
  try {
    reference = referenceSouboru(soubor);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  process.stdout.write(jmenaReferenci(reference, rezim).map((j) => j + "\n").join(""));
}
