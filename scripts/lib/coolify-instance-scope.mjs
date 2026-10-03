/**
 * coolify-instance-scope.mjs — confine Coolify orchestration to ONE instance.
 *
 * Sibling of coolify-project-scope.mjs. That module answers "which PROJECT may
 * this run touch"; this one answers "which INSTANCE is this run, and does the
 * manifest in front of me belong to it".
 *
 * WHY (measured 2026-08-08): tooling resolved the instance by hardcoding the
 * reference story. coolify-drift-check.mjs pinned
 * `coolify/manifests/aisha.manifest` and filtered live apps with
 * `name.startsWith("aisha-")`, so on a differently-named instance it reported all
 * 27 aisha apps as MISSING, all 21 real apps as invisible, and then printed
 *
 *     Action: bash scripts/coolify-story-init.sh --manifest coolify/manifests/aisha.manifest
 *
 * Following that line would have created a FOREIGN instance's apps inside this
 * one. The drift checker is also the only tool that reports SERVER_DRIFT (an app
 * on the wrong machine), so while it was blind to the fork, a placement change —
 * exactly what a mesh bring-up needs — could never be surfaced.
 *
 * The instance is declared by the file that DECLARES it; the ambient shell may at
 * most agree. Two disagreeing sources are a refusal, never a silent winner: on a
 * shared Coolify the wrong answer writes into another tenant.
 *
 * FAIL-LOUD (no fallbacks): a manifest whose `story:` differs from the resolved
 * instance is refused rather than applied. There is no "close enough" — that
 * mismatch is precisely how one instance's inventory lands in another.
 *
 * ── PROČ TU ŘETĚZ KANÁLŮ JE (naměřeno 2026-08-13) ───────────────────────────
 * Táž otázka („která instance to je?") měla TŘI implementace, každou s jiným
 * seznamem kanálů a jiným pořadím:
 *
 *   aisha-cold-start.sh (bash prolog)  → prostředí, .env.local
 *   tenhle soubor                      → prostředí, .env.coolify
 *   generate-secrets.mjs firstNonEmpty → .env-prod-backup, prostředí, .env.coolify
 *
 * Instance, která identitu deklaruje v .env.coolify + .env-prod-backup a nemá
 * .env.local (tedy ta, co ji drží tam, kde na ni platí --wipe scope), tak pro
 * bash prolog NEEXISTOVALA: STORY zůstalo prázdné, cesta k manifestu vyšla
 * `.../.manifest` a --wipe skončil na „identita není deklarovaná". Přitom hláška
 * o kus dál posílala operátora právě do .env.coolify — kód si odporoval s vlastní
 * chybovou hláškou.
 *
 * Řetěz proto bydlí TADY, v jednom domově, a shell si ho nepřepisuje — stejné
 * pravidlo jako u coolify-project-scope.mjs.
 *
 * CLI (so the shell shares this boundary instead of re-implementing it):
 *   node scripts/lib/coolify-instance-scope.mjs --prefix
 *   node scripts/lib/coolify-instance-scope.mjs --identity-shell
 *   node scripts/lib/coolify-instance-scope.mjs --manifest-path [--allow-default]
 *   node scripts/lib/coolify-instance-scope.mjs --assert-manifest <path>
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDirectRun } from "./cli-entry.mjs";
import { OVERLAY_ENV, overlayDir } from "./instance-overlay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");

/** Klíče, kterými se identita instance deklaruje. */
export const IDENTITY_KEYS = ["APP_NAME_PREFIX", "AISHA_STORY"];

/**
 * Kanály, jimiž smí být identita deklarována — v pořadí od nejsilnějšího.
 *
 * Pozor, co to pořadí DĚLÁ: neurčuje, kdo koho přebije. Rozpor mezi kterýmikoli
 * dvěma kanály je odmítnutí (viz resolveInstanceIdentity), takže k přebíjení
 * nikdy nedojde. Pořadí určuje, který kanál se ohlásí jako ZDROJ odpovědi —
 * a je seřazené tak, aby to byla deklarace operátora, ne `.env.coolify`, který
 * generujeme my sami a identita v něm je ozvěna našeho minulého výstupu.
 *
 * @param {{ env?: NodeJS.ProcessEnv, root?: string, envFile?: string }} [opts]
 */
export function identityChannels({ env = process.env, root, envFile } = {}) {
  // Kořen deklarace = adresář, jehož soubory popisují TUHLE instanci. Běžně repo
  // root; jde přesměrovat, aby běh šel namířit na jiný checkout (worktree,
  // instance-data) a aby ho brána mohla změřit proti fixturám místo živého stromu.
  const base = resolve(env.AISHA_IDENTITY_ROOT || root || REPO_ROOT);
  const at = (override, name) => (override ? resolve(override) : join(base, name));
  return [
    { name: "prostředí", read: (key) => (env[key] || "").trim() },
    { name: ".env.local", file: at(null, ".env.local") },
    { name: ".env-prod-backup", file: at(env.ENV_PROD_BACKUP, ".env-prod-backup") },
    { name: ".env.coolify", file: at(envFile || env.ENV_FILE, ".env.coolify") },
  ];
}

/**
 * Co daný kanál o daném klíči tvrdí. Prázdný řetězec = netvrdí nic.
 * Uvnitř souboru vyhrává POSLEDNÍ přiřazení — tak se env soubory čtou všude jinde.
 */
function declaredIn(channel, key) {
  if (channel.read) return channel.read(key);
  if (!existsSync(channel.file)) return "";
  let found = "";
  for (const line of readFileSync(channel.file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${key}=`)) continue;
    found = trimmed.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  return found;
}

/**
 * Resolve which instance this run serves — přes celý řetěz kanálů.
 *
 * Rozpor mezi dvěma kanály je ODMÍTNUTÍ, ne volba vítěze: na sdíleném Coolify
 * znamená špatná odpověď zápis k jinému nájemníkovi, a u `--wipe` mazání jeho
 * aplikací. Nevědět je bezpečnější než tipnout.
 *
 * @param {{ env?: NodeJS.ProcessEnv, root?: string, envFile?: string, required?: boolean }} [opts]
 * @returns {{ prefix: string, story: string, source: string, channels: string[] }}
 */
export function resolveInstanceIdentity({ env = process.env, root, envFile, required = true } = {}) {
  const channels = identityChannels({ env, root, envFile });
  /** @type {Record<string, {channel: string, value: string}[]>} */
  const declarations = {};

  for (const key of IDENTITY_KEYS) {
    declarations[key] = [];
    for (const channel of channels) {
      const value = declaredIn(channel, key);
      if (value) declarations[key].push({ channel: channel.name, value });
    }
    const distinct = [...new Set(declarations[key].map((d) => d.value))];
    if (distinct.length > 1) {
      const where = declarations[key].map((d) => `${d.channel}='${d.value}'`).join(", ");
      throw new Error(
        `${key} je deklarovaný ROZPORNĚ (${where}) — refusing to act, ` +
          "one of them targets the wrong instance and I cannot tell which; " +
          "u --wipe by to znamenalo mazat aplikace jiného nájemníka. " +
          "Srovnej deklarace a spusť znovu (pokud nesouhlasí .env.coolify, je to " +
          "artefakt minulého běhu jiné instance — smaž ho, generuje se znovu).",
      );
    }
  }

  const prefix = declarations.APP_NAME_PREFIX[0]?.value || declarations.AISHA_STORY[0]?.value || "";
  const story = declarations.AISHA_STORY[0]?.value || prefix;
  const source =
    declarations.APP_NAME_PREFIX[0]?.channel || declarations.AISHA_STORY[0]?.channel || "";

  if (!prefix && required) {
    throw new Error(
      `cannot determine APP_NAME_PREFIX (checked ${channels.map((c) => c.name).join(", ")}) — ` +
        "refusing to act: on a shared Coolify an unknown instance means writing into another tenant",
    );
  }
  return { prefix, story, source, channels: channels.map((c) => c.name) };
}

/**
 * Resolve which instance this run serves.
 * @param {{ env?: NodeJS.ProcessEnv, envFile?: string, required?: boolean }} [opts]
 * @returns {string} the instance prefix ("" only when required is false)
 */
export function resolveInstancePrefix(opts = {}) {
  return resolveInstanceIdentity(opts).prefix;
}

/** The `story:` an AISHA manifest declares — the Coolify app-name prefix. */
export function manifestStory(text) {
  return /^story:\s*(\S+)\s*$/m.exec(text)?.[1] || "";
}

/**
 * Resolve the manifest this run may act on.
 *
 * `explicit` (a --manifest flag) still has to pass assertManifestMatchesInstance,
 * so an operator cannot hand a tool another instance's inventory by pointing at it.
 *
 * THE OVERLAY IS CONSULTED FIRST, and that is the point rather than a convenience:
 * a manifest names one deployment's app inventory, so by the same rule that moved
 * `config/profiles/<id>.json` out of this repository (see config/profiles/README.md
 * — "instance data does not belong in a public repository"), a manifest belongs to
 * the instance too. Without this lookup the instance-scope guard below demanded a
 * per-instance file in the PUBLIC tree, which is the one place the profile doctrine
 * forbids — so an instance could satisfy one rule only by breaking the other.
 *
 * Nothing about the guard weakens: whichever channel the file comes from,
 * assertManifestMatchesInstance still refuses a manifest whose `story:` is not this
 * instance. The overlay changes WHERE the inventory may live, never WHOSE it may be.
 *
 * `explicitHint` říká, JAK se u volajícího explicitní cesta zadává — hláška to
 * sama vědět nemůže. ⛔ Nález 2026-09-23 (obhlídka forku): redeploy radil
 * „pass --manifest <path>", jenže přepínač nezná (odmítne ho jako neznámý)
 * a cestu bere z MANIFEST_FILE. Rada, která nejde provést, je horší než žádná:
 * obsluha ji zkusí, narazí a začne obcházet (zrcadlo ze symlinků).
 *
 * @param {{ explicit?: string, prefix?: string, allowDefault?: boolean, explicitHint?: string }} [opts]
 * @returns {string} absolute path
 */
export function resolveManifestPath({ explicit, prefix, allowDefault = false, explicitHint = "--manifest <path>" } = {}) {
  if (explicit) return resolve(explicit);
  const instance = prefix ?? resolveInstancePrefix({ required: !allowDefault });
  if (!instance && allowDefault) return join(REPO_ROOT, "coolify/manifests/aisha.manifest");

  // Overlay first (the instance's own repo), then the public tree. Read through the
  // shared door so this cannot drift from the other overlay consumers — and lazily,
  // because the env var is hydrated by some callers after import time.
  const overlay = overlayDir();
  const fromOverlay = overlay ? join(overlay, `manifests/${instance}.manifest`) : null;
  if (fromOverlay && existsSync(fromOverlay)) return fromOverlay;

  const own = join(REPO_ROOT, `coolify/manifests/${instance}.manifest`);
  if (existsSync(own)) return own;

  throw new Error(
    `instance '${instance}' has no manifest — refusing to fall back to another instance's ` +
      "manifest, which would treat its inventory as ours. Looked in " +
      `${overlay ? `${fromOverlay} and ` : `$${OVERLAY_ENV} (unset) and `}` +
      `coolify/manifests/${instance}.manifest. Put it in the instance overlay next to ` +
      "its profile (preferred — an inventory is instance data), or in this repo for a " +
      `template/demo stack; see coolify/manifests/_template.manifest. Or pass ${explicitHint}.`,
  );
}

/**
 * Refuse a manifest that belongs to a different instance. This is the guard that
 * makes "create a foreign instance's apps here" structurally impossible rather
 * than merely unlikely.
 * @param {string} manifestPath
 * @param {{ prefix?: string }} [opts]
 * @returns {{ story: string, prefix: string, path: string }}
 */
export function assertManifestMatchesInstance(manifestPath, { prefix } = {}) {
  const path = resolve(manifestPath);
  if (!existsSync(path)) throw new Error(`manifest not found: ${path}`);
  const story = manifestStory(readFileSync(path, "utf8"));
  if (!story) {
    throw new Error(
      `${path} has no 'story:' line — cannot tell which instance it describes ` +
        "(see coolify/manifests/_template.manifest).",
    );
  }
  const instance = prefix ?? resolveInstancePrefix();
  if (story !== instance) {
    throw new Error(
      `manifest declares story='${story}' but this run serves instance '${instance}' — refusing. ` +
        `Applying it would create ${story}-* apps inside ${instance}. ` +
        `Use coolify/manifests/${instance}.manifest.`,
    );
  }
  return { story, prefix: instance, path };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Lets the bash orchestration (coolify-story-init.sh, cold-start) delegate here
// so the instance boundary lives in exactly ONE place, never re-implemented per
// language — the same reasoning as coolify-project-scope.mjs's --list-apps.
// „Spustili mě přímo?" má jeden domov: lib/cli-entry.mjs. Porovnává SKUTEČNÉ
// cesty (realpath), ne řetězce — jinak stačí symlink nebo git worktree, blok se
// TIŠE přeskočí a volající dostane prázdný výstup s kódem 0, který si vyloží
// jako měření.
if (isDirectRun(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : undefined;
  };
  try {
    if (argv.includes("--prefix")) {
      process.stdout.write(resolveInstancePrefix() + "\n");
    } else if (argv.includes("--identity-shell")) {
      // Pro bash prolog cold-startu. Nedeklarovaná identita NENÍ chyba tohohle
      // volání — prázdné hodnoty projdou dál a ohlásí je fail-closed kontrola
      // v cold-startu, která jediná zná kontext (wipe scope, cesta k manifestu).
      // Rozpor kanálů naopak padá TEĎ: to není „nevím", to je „dvě odpovědi".
      const id = resolveInstanceIdentity({ required: false });
      process.stdout.write(
        `APP_NAME_PREFIX=${id.prefix}\nAISHA_STORY=${id.story}\nAISHA_IDENTITY_SOURCE=${id.source}\n`,
      );
    } else if (argv.includes("--manifest-path")) {
      process.stdout.write(
        resolveManifestPath({
          explicit: flagValue("--manifest"),
          allowDefault: argv.includes("--allow-default"),
        }) + "\n",
      );
    } else if (argv.includes("--assert-manifest")) {
      const { story, prefix } = assertManifestMatchesInstance(flagValue("--assert-manifest"));
      process.stdout.write(`${story}\t${prefix}\n`);
    } else {
      process.stderr.write(
        "usage: coolify-instance-scope.mjs --prefix | --manifest-path [--manifest <p>] [--allow-default] | --assert-manifest <p>\n",
      );
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`coolify-instance-scope: ${err.message}\n`);
    process.exit(3);
  }
}
