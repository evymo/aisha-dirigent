/**
 * config-env-files.mjs — the canonical on-disk config chain, in ONE place.
 *
 * WHY: cold-start writes its resolved configuration and credentials to
 * .env.coolify (and mirrors a subset into .env-prod-backup only when the
 * operator takes a vault snapshot). Orchestration tools, however, historically
 * read whichever single file their author happened to pick — scripts/
 * aisha-redeploy.mjs read .env-prod-backup ONLY, coolify-deploy-watch.mjs read a
 * five-file chain, lib/coolify-project-scope.mjs read process.env ONLY. Same
 * toolchain, same stack, three different answers to "where does config live".
 *
 * The practical cost is not theoretical: on a stack that has never been
 * snapshotted, `aisha-redeploy` aborts with "COOLIFY_API_TOKEN not found" while
 * its sibling tools work fine, and the obvious shortcut — exporting the vars by
 * hand — is itself a trap, because a Coolify Sanctum token is `id|secret` and
 * the `|` does not survive naive shell sourcing. That combination is what makes
 * operators write a throwaway launcher per session, which is the very thing the
 * "use the prepared tools" rule exists to prevent.
 *
 * So: the chain lives here, every tool consults the same files in the same
 * order, and no per-operator launcher is needed to run any of them.
 *
 * ORDER: later files win, matching coolify-deploy-watch.mjs:loadEnv(). Callers
 * layer process.env ON TOP of whatever this returns — an explicitly exported
 * variable always beats a file.
 */

import { odUvozovkuj } from "./env-hodnota.mjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Canonical config files, lowest precedence first. */
export const CONFIG_ENV_FILES = [
  join(ROOT, "config/domains.env"),
  join(ROOT, ".env.coolify"),
  join(ROOT, ".env.local"),
  join(ROOT, ".env-prod-backup"),
  join(ROOT, ".env.aisha"),
];

/**
 * Read one KEY from the canonical chain. Returns "" when absent everywhere.
 *
 * Values are taken verbatim after the FIRST `=`, so secrets containing `=` or
 * `|` (Coolify Sanctum tokens are `id|secret`) survive intact; only wrapping
 * quotes are stripped. No `${VAR}` interpolation is performed — this is a
 * credential/identity lookup, not a template renderer, and expanding here would
 * silently resolve a placeholder to the empty string.
 *
 * @param {string} key
 * @param {{ files?: string[] }} [opts] - override the chain (tests)
 * @returns {string}
 */
export function readConfigKey(key, { files = CONFIG_ENV_FILES } = {}) {
  let found = "";
  const prefix = `${key}=`;
  for (const file of files) {
    if (!existsSync(file)) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch (err) {
      // unreadable (perms) — treat as absent, never abort a lookup, but surface why
      console.warn(`[config-env-files] skipping unreadable ${file}: ${err?.message ?? err}`);
      continue;
    }
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trimStart();
      if (line.startsWith("#")) continue;
      if (line.startsWith(prefix)) {
        // Last NON-EMPTY occurrence wins. Last-wins matches `set -a; source`,
        // but an empty assignment carries no information — and a later empty one
        // erasing an earlier real value is a live failure mode here, not a
        // hypothetical: a heal pass appended `FORGEJO_URL=` after the real URL,
        // this lookup returned "", and deploy-init fell through to deriving a
        // hostname that does not exist. A lookup wants a VALUE; the toolchain's
        // own convention agrees (generate-secrets.mjs:firstNonEmpty skips empty).
        const candidate = stripInlineComment(line.slice(prefix.length)).trim().replace(/^["']|["']$/g, "");
        // Nerozvinutá šablona NENÍ hodnota — viz isUnexpandedTemplate().
        if (candidate !== "" && !isUnexpandedTemplate(candidate)) found = candidate;
      }
    }
  }
  return found;
}

/**
 * Nerozvinutá shellová šablona NENÍ hodnota.
 *
 * Soubory v tomhle řetězu se píšou tak, aby je uměl `source` z bashe — a proto
 * v nich stojí sebe-defaulty jako `KEYCLOAK_DOMAIN=${KEYCLOAK_DOMAIN:-}` nebo
 * `CORE_MESH_HOST=${CORE_MESH_HOST:-core.${MESH_TLD}}`. Pro bash je to pokyn
 * („nech, co je v prostředí, jinak tohle"); pro každého jiného čtenáře je to
 * jen text. A text je pravdivostně PRAVDA — takže projde každou kontrolou typu
 * `if (domains.KEYCLOAK_DOMAIN)` a doputuje až do adresy.
 *
 * Naměřeno 2026-08-14, aisha i riq, v každé vlně nasazení:
 *   [netbird-peer-discover] fetch failed: Failed to parse URL from
 *   https://${KEYCLOAK_DOMAIN:-}/realms/aisha/protocol/openid-connect/token
 * V config/domains.env je takových sebe-defaultů 48 a `readConfigKey` je do
 * dneška vracel jako hodnoty (změřeno: CORE_MESH_HOST → "${CORE_MESH_HOST:-…}").
 *
 * Rozpoznává se `${` následované začátkem identifikátoru — tvar, který v žádném
 * generovaném tajemství vzniknout nemůže (mintují se jako hex/base64/base64url,
 * `{` v té abecedě není). Osamocené `$` ani `${` uprostřed hesla se netrefí.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isUnexpandedTemplate(value) {
  return /\$\{[A-Za-z_]/.test(String(value ?? ""));
}

/**
 * Přečti CELÝ env soubor jako mapu — jediný domov pro tenhle parser.
 *
 * V repu jich žilo deset (netbird-peer-discover, generate-secrets, env-doctor,
 * operator-setup, generate-coolify-context, setup-cockpit/host, eval-capabilities,
 * keycloak/×2, subnet-drift) a lišily se v každém detailu: povolené znaky klíče,
 * odstranění uvozovek, komentáře na konci řádku. Deset odpovědí na jednu otázku
 * znamená, že se jedna z nich mýlí a nikdo to nepozná.
 *
 * Pravidla jsou tatáž jako u readConfigKey(): poslední NEPRÁZDNÁ hodnota vyhrává
 * (jako `set -a; source`), komentář na konci řádku padá podle stripInlineComment,
 * obalující uvozovky se odstraní a nerozvinutá šablona se nebere jako hodnota.
 *
 * @param {string} path
 * @param {{ keepTemplates?: boolean, keepEmpty?: boolean }} [opts] — obojí jen
 *        pro nástroje, které soubor ANALYZUJÍ (hledají duplicity, kontrolují tvar),
 *        ne pro ty, které z hodnot něco staví. `keepEmpty` nechá `KEY=` v mapě
 *        jako "" — rozdíl „klíč tam není" × „klíč tam je, ale prázdný" je pro
 *        kontrolu doručení podstatný (`${X:?}` padá na obojí, `${X?}` jen na první).
 *        Poslední NEPRÁZDNÁ hodnota vyhrává i tak; prázdný řádek ji nepřepíše.
 * @returns {Record<string,string>}
 */
export function parseEnvFile(path, { keepTemplates = false, keepEmpty = false } = {}) {
  const out = {};
  if (!path || !existsSync(path)) return out;
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    console.warn(`[config-env-files] skipping unreadable ${path}: ${err?.message ?? err}`);
    return out;
  }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trimStart();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // Hodnota, jak ji přečte `source` — ne odříznuté uvozovky (viz env-hodnota.odUvozovkuj:
    // `AISHA_OPERATORS` tak dorazil do Coolify jako `{\"email\":…}`).
    const value = odUvozovkuj(stripInlineComment(line.slice(eq + 1)).trim());
    if (value === "") {
      if (keepEmpty && !(key in out)) out[key] = "";
      continue;
    }
    if (!keepTemplates && isUnexpandedTemplate(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Strip a trailing `# comment` — leading or whitespace-preceded, and only when
 * the `#` is followed by whitespace. A `#` glued to text stays literal, which
 * matters for real values in these files: a git ref (`…instance-data.git#main`),
 * a brand colour (`#FF6A1A`), or a token that happens to contain one.
 *
 * Semantics are deliberately IDENTICAL to generate-secrets.mjs:stripInlineComment
 * — that file documents the incident this guards against: a commented example
 * line (`export KEY=   # https://…`) sourced from domains.env.example shadowed a
 * derived URL with the comment text. Reading the same files with different
 * comment rules would resurrect exactly that class of bug in a new place, so
 * generate-secrets.mjs should import this rather than keep its own copy.
 *
 * Tradeoff, stated plainly: a value that legitimately contains " # " gets
 * truncated. That is already true everywhere else in this toolchain, and a
 * silent leading-comment leak is the failure that actually happened.
 *
 * @param {string} value
 * @returns {string}
 */
export function stripInlineComment(value) {
  return String(value ?? "").replace(/(^|\s)#\s.*$/, "");
}

/**
 * First non-empty value among several keys — for the alias pairs this toolchain
 * carries (COOLIFY_URL / COOLIFY_BASE_URL, COOLIFY_API_TOKEN / COOLIFY_API_KEY,
 * COOLIFY_PROJECT_UUID / COOLIFY_PROD_PROJECT_UUID).
 *
 * @param {string[]} keys
 * @param {{ files?: string[] }} [opts]
 * @returns {string}
 */
export function readConfigKeyAny(keys, opts) {
  for (const key of keys) {
    const value = readConfigKey(key, opts);
    if (value) return value;
  }
  return "";
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// `node scripts/lib/config-env-files.mjs --get KEY [KEY...]` prints the first
// non-empty value, so the ~22 shell scripts that hand-roll a
// `grep ^KEY= .env-prod-backup` lookup can delegate here (via
// lib/coolify-credentials.sh) instead of re-implementing the chain per language
// — the same cross-language delegation lib/coolify-project-scope.mjs uses for
// the project boundary. Prints nothing and exits 1 when unresolved, so callers
// can branch on the exit status rather than string-comparing the output.
// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření.
if (isDirectRun(import.meta.url)) {
  const args = process.argv.slice(2);
  const getIdx = args.indexOf("--get");
  const keys = getIdx === -1 ? [] : args.slice(getIdx + 1).filter((a) => !a.startsWith("--"));
  if (!keys.length) {
    process.stderr.write("usage: config-env-files.mjs --get KEY [KEY...]\n");
    process.exit(2);
  }
  const value = readConfigKeyAny(keys);
  if (!value) process.exit(1);
  process.stdout.write(`${value}\n`);
}
