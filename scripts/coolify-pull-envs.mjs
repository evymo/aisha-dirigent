#!/usr/bin/env node
/**
 * coolify-pull-envs.mjs — REVERSE-SYNC: pull the live Coolify env (the persistent
 * secret store) back into the operator's .env-prod-backup vault.
 *
 * Why: coolify-sync-envs.sh is PUSH-only (.env.coolify → Coolify). The only durable
 * copy of the stack-internal secrets is otherwise the gitignored local vault; if it
 * is lost/stale, a --wipe would regenerate NEW secrets (unrecoverable encryption
 * keys, validator identity — see the credential-durability audit). While the stack
 * is up, Coolify server-side IS a durable copy — this tool reconstructs the vault
 * from it, so generate-secrets' firstNonEmpty() preserves the SAME values on wipe.
 *
 * This is a thin composition of the SHARED single-sources — it does NOT re-implement
 * Coolify I/O:
 *   - createCoolifyClient  (lib/coolify-http.mjs)      retry/timeout, 4xx/5xx fail-loud
 *   - createEnvStore        (lib/coolify-env-store.mjs)  listAishaApps / getAppEnv
 *   - productionRealValue    (lib/coolify-env-store.mjs)  real_value-first coalescing
 *   - createProjectScope     (lib/coolify-project-scope.mjs) fail-loud tenant boundary
 *
 * Safety invariants:
 *   - ⛔ ZMĚNĚNO 2026-08-25. Do té doby platilo „hodnota v .env-prod-backup vždy
 *     VYHRÁVÁ (doplní se jen CHYBĚJÍCÍ klíče)". U klíče, který dodal operátor, je
 *     to správně — jenže sem se dostanou jen SPRAVOVANÁ tajemství (filtr
 *     `managedSecretKeys`), tedy hodnoty, které si vyrábí platforma. A protože
 *     trezor má v kanonickém řetězu VYŠŠÍ přednost než `.env.coolify`, jednou
 *     zapsaná kopie tam ZKAMENÍ a přebíjí každou další generaci.
 *     Naměřeno: přeražené setup klíče (`setup key is invalid`) a starý
 *     `AISHA_BOOTSTRAP_CLIENT_SECRET` (401, ač secret v `.env.coolify` seděl).
 *     Nově tedy: spravovaný klíč s JINOU živou hodnotou se PŘERAZÍ — živý
 *     Coolify je to, s čím stack skutečně běží, tedy co má wipe přežít.
 *   - Odvozené klíče (DERIVED_NETWORK_KEYS) se nejen nezapisují, ale z trezoru
 *     se i VYHAZUJÍ: odvození si je spočítá samo, kdežto zkamenělá kopie ho
 *     přebije (incident 2026-08-13 MESH_DNS_SUBNET, 2026-08-25 NETBIRD_DNS_IP).
 *   - Před zásahem se vedle trezoru zapíše `.pred-reverse-sync` kopie.
 *   - Values are NEVER printed (only key names + counts + sha-256 fingerprints).
 *   - Confined to COOLIFY_PROJECT_UUID (never reads another tenant's same-named app).
 *   - The vault is written mode 0600.
 *
 * Usage:
 *   node scripts/coolify-pull-envs.mjs [--dry-run] [--out=<path>]
 * Exit codes: 0 ok · 1 API/IO failure · 2 no managed secrets found
 */
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { createEnvStore, productionRealValue } from "./lib/coolify-env-store.mjs";
import { DERIVED_NETWORK_KEYS } from "./lib/derive-subnets.mjs";
import { createProjectScope } from "./lib/coolify-project-scope.mjs";
import { readConfigKey } from "./lib/config-env-files.mjs";
import { isDirectRun } from "./lib/cli-entry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const OUT = (argv.find((a) => a.startsWith("--out=")) || "").split("=")[1] || resolve(ROOT, ".env-prod-backup");

const fp = (v) => (v ? createHash("sha256").update(String(v)).digest("hex").slice(0, 12) : "empty");

// ── env / creds (process.env → canonical config chain) ──────────────────────
// Credentials come from lib/config-env-files.mjs, the same chain every other
// tool in this toolchain reads. Two separate bugs lived in the previous version:
//
//  1. It looked only in .env-prod-backup, which cold-start writes only when the
//     operator has taken a vault snapshot. On a stack that never has, this tool
//     could not authenticate — and this is the PRE-WIPE reverse-sync, so the one
//     moment it must work is the moment a fresh vault does not exist yet. The
//     failure was soft ("stack partially down?"), so the wipe went ahead with a
//     snapshot missing every secret that lives only server-side.
//
//  2. It read credentials out of OUT — the OUTPUT path. With --out pointed
//     anywhere else (a test, a temp file), it hunted for the API token inside
//     the file it was about to write. Output is not an input.
function backupVal(key) {
  if (process.env[key]) return process.env[key].replace(/^["']|["']$/g, "");
  return readConfigKey(key);
}
function fatal(msg) {
  process.stderr.write(`FATAL: ${msg}\n`);
  process.exit(1);
}

// The managed-secret key set — SINGLE SOURCE OF TRUTH is generate-secrets.mjs.
// We reverse-sync ONLY these (durability-critical secrets), never derived config
// (GIT_SHA / IMAGE_* / *_DOMAIN etc. from derive-domains/build): a stale copy of
// those in the highest-precedence vault would deploy old images/domains on wipe.
function managedSecretKeys() {
  const out = execFileSync(process.execPath, [resolve(ROOT, "scripts/generate-secrets.mjs"), "--print-keys"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const keys = new Set(out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  if (keys.size === 0) fatal("generate-secrets --print-keys returned no keys — refusing to reverse-sync unscoped");
  return keys;
}

/**
 * Pověření se rozlišuje AŽ PŘI SPUŠTĚNÍ, ne při importu.
 *
 * ⛔ NAMĚŘENO 2026-08-25 (spadlo to v CI, lokálně ne): tyhle čtyři řádky stály
 * v MODULOVÉM ROZSAHU, takže pouhý `import` tohohle souboru volal `fatal()` →
 * `process.exit(1)`. Brána, která si sem chodí pro čistou `klasifikujTrezor`,
 * tím padala celá jako suite:
 *
 *     Error: process.exit unexpectedly called with "1"
 *       ❯ fatal scripts/coolify-pull-envs.mjs:82
 *
 * Lokálně to prošlo, protože `.env.coolify` na disku JE — jenže je gitignorovaný,
 * takže v CI NENÍ. `isDirectRun` hlídal `main()`, ale ne tohle: modul byl
 * knihovnou jen napůl.
 */
function poveřeni() {
  const base = backupVal("COOLIFY_URL") || backupVal("COOLIFY_BASE_URL");
  const token = backupVal("COOLIFY_API_TOKEN");
  if (!base) fatal("COOLIFY_URL / COOLIFY_BASE_URL required (env or .env-prod-backup)");
  if (!token) fatal("COOLIFY_API_TOKEN required (env or .env-prod-backup)");
  return { base, token };
}

// ── parse the existing vault (preserve content + comments; know which keys exist)
/**
 * Rozhodne, co se s každým klíčem stane. ČISTÁ funkce — žádné I/O, žádná síť.
 *
 * Vyjmuto ze `main()` 2026-08-25, aby to šlo ZMĚŘIT: dokud rozhodování leželo
 * uvnitř skriptu, dala se brána opřít jen o grep nad zdrojákem — a ten měří
 * text, ne chování.
 *
 * @param {Map<string,string>} pulled          klíč → živá hodnota z Coolify (už zúžené na managed)
 * @param {Map<string,string>} existingValues  klíč → hodnota v trezoru
 * @param {Set<string>} existingKeys           klíče v trezoru (i ty mimo `pulled`)
 * @param {Set<string>} derived                rodina odvozených klíčů
 */
export function klasifikujTrezor(pulled, existingValues, existingKeys, derived) {
  const toAdd = [];
  const refreshed = [];
  let unchanged = 0;
  for (const [key, value] of pulled) {
    if (!existingKeys.has(key)) { toAdd.push([key, value]); continue; }
    if (existingValues.get(key) === value) { unchanged++; continue; }
    refreshed.push([key, value]);
  }
  // Odvozené se NEPŘERAZÍ — vyhodí se. Odvození si je spočítá samo; zkamenělá
  // kopie v trezoru (vyšší přednost) by ho jinak přebila.
  const toRemove = [...derived].filter((k) => existingKeys.has(k));
  return { toAdd, refreshed, unchanged, toRemove };
}

function parseVaultKeys(path) {
  const keys = new Set();
  // Hodnoty se čtou taky: bez nich nejde poznat ROZCHOD, jen přítomnost — a
  // právě rozchod je ta vada, kvůli které se sem sahá (viz refreshed níž).
  const values = new Map();
  if (!existsSync(path)) return { keys, values, lines: [] };
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) { keys.add(m[1]); values.set(m[1], m[2].trim().replace(/^['"]|['"]$/g, "")); }
  }
  return { keys, values, lines };
}

async function main() {
  const { base: BASE, token: TOKEN } = poveřeni();
  const store = createEnvStore({ baseUrl: BASE, token: TOKEN });
  const scope = await createProjectScope(store.raw); // fail-loud without COOLIFY_PROJECT_UUID
  const apps = scope.filter(await store.listAishaApps());
  if (apps.length === 0) fatal("no project-scoped aisha-* apps found — refusing to pull");
  process.stdout.write(`Reverse-sync from ${apps.length} project apps → ${OUT}${DRY_RUN ? " (dry-run)" : ""}\n`);

  // Union all production key→realValue across the project's apps.
  const pulled = new Map(); // key → value
  const conflicts = new Set();
  for (const app of apps) {
    let envs;
    try {
      envs = await store.getAppEnv(app.uuid);
    } catch (err) {
      process.stderr.write(`  WARN ${app.name}: env fetch failed (${err.message}) — skipping\n`);
      continue;
    }
    if (!Array.isArray(envs)) continue;
    const keys = new Set(envs.filter((e) => e.is_preview !== true).map((e) => e.key));
    for (const key of keys) {
      const v = productionRealValue(envs, key);
      if (v === null || v === "") continue;
      if (pulled.has(key) && pulled.get(key) !== v) conflicts.add(key); // same key, different value across apps
      if (!pulled.has(key)) pulled.set(key, v);
    }
  }
  // Scope to managed secrets only (exclude derived config to avoid stale-deploy).
  //
  // `--print-keys` vrací VŠECHNO, co generate-secrets emituje — tedy i hodnoty,
  // které si sám POČÍTÁ z identity instance. Filtr „managed" je tedy nutný, ne
  // dostatečný: odvozené klíče jím projdou. A právě u nich je zpětná synchronizace
  // škodlivá — nic nezachraňují (spočítají se znovu), jen zakonzervují minulost:
  //
  //   generate-secrets → Coolify → sem → vault → prostředí → „operátorský override"
  //
  // NAMĚŘENO 2026-08-13: takhle ve vaultu přežil mesh-DNS rozsah, který na
  // hostiteli mezitím zabral cizí nájemník; `docker network create` padal na
  // „Pool overlaps" a mesh na tom uzlu nevstal. Seznam má jeden domov — tam,
  // kde se ty hodnoty odvozují (lib/derive-subnets.mjs).
  const managed = managedSecretKeys();
  const derived = new Set(DERIVED_NETWORK_KEYS);
  let excludedConfig = 0;
  let excludedDerived = 0;
  for (const key of [...pulled.keys()]) {
    if (!managed.has(key)) { pulled.delete(key); conflicts.delete(key); excludedConfig++; continue; }
    if (derived.has(key)) { pulled.delete(key); conflicts.delete(key); excludedDerived++; }
  }
  process.stdout.write(
    `  scoped to ${managed.size} managed-secret keys ` +
      `(excluded ${excludedConfig} derived/config keys, ${excludedDerived} computed-from-identity keys)\n`,
  );

  if (pulled.size === 0) {
    process.stderr.write("No non-empty managed secrets returned by Coolify (masked token?) — nothing to reverse-sync\n");
    process.exit(2);
  }
  for (const key of conflicts) {
    process.stderr.write(`  WARN key ${key} has DIFFERENT values across apps — kept first-seen (fp=${fp(pulled.get(key))})\n`);
  }

  const { keys: existing, values: existingValues, lines } = parseVaultKeys(OUT);

  // ── Co se s klíčem stane ─────────────────────────────────────────────────
  // ⛔ DO 2026-08-25 TU BYLO `if (existing.has(key)) skip`. „Hodnota operátora
  // vyhrává" je správně u klíče, který operátor DODAL — u spravovaného
  // tajemství, které si vyrábí platforma, je to naopak past: trezor má VYŠŠÍ
  // přednost než `.env.coolify` (kanonický řetěz), takže jednou zapsaná kopie
  // tam ZKAMENÍ a přebíjí každou další generaci.
  //
  // NAMĚŘENO 2026-08-25: `netbird-bootstrap.sh` přerazil čtyři setup klíče,
  // trezor si nechal mrtvé, a agenti hlásili `setup key is invalid`. Týmž
  // způsobem držel trezor starý `AISHA_BOOTSTRAP_CLIENT_SECRET` (401
  // unauthorized_client, ač secret v `.env.coolify` s Keycloakem SEDĚL).
  // Živý Coolify je přitom to, s čím stack SKUTEČNĚ běží — tedy právě ta
  // hodnota, která má wipe přežít.
  const { toAdd, refreshed, unchanged, toRemove } =
    klasifikujTrezor(pulled, existingValues, existing, derived);

  // ── Zkamenělé ODVOZENÉ klíče se z trezoru VYHAZUJÍ ───────────────────────
  // Odvozené hodnoty se sem zapsat nesmějí (viz filtr výš, incident
  // 2026-08-13: MESH_DNS_SUBNET přežil ve vaultu a mesh na uzlu nevstal).
  // Filtr ale bránil jen ZÁPISU — na hodnotu, která už tam leží, nesahal.
  // NAMĚŘENO 2026-08-25: `NETBIRD_DNS_IP=127.0.0.11` (vestavěný resolver
  // Dockeru) ležel v trezoru a přebíjel odvozený mesh resolver. Týž incident,
  // jiný klíč. Odvozené se nepřerazí — odvození si je spočítá samo; jediné
  // správné je nemít je tam.
  process.stdout.write(
    `  pulled=${pulled.size} keys · new=${toAdd.length} · refreshed=${refreshed.length} ` +
      `· unchanged=${unchanged} · derived-evicted=${toRemove.length} · conflicts=${conflicts.size}\n`,
  );
  for (const [key, value] of toAdd) process.stdout.write(`  + ${key} (fp=${fp(value)})\n`);
  for (const [key, value] of refreshed) {
    process.stdout.write(`  ~ ${key} (trezor fp=${fp(existingValues.get(key))} → živé fp=${fp(value)})\n`);
  }
  for (const key of toRemove) {
    process.stdout.write(`  - ${key} (odvozený, fp=${fp(existingValues.get(key))}) — odvození si ho spočítá samo\n`);
  }

  if (DRY_RUN) { process.stdout.write("dry-run: vault not modified\n"); return; }
  if (toAdd.length === 0 && refreshed.length === 0 && toRemove.length === 0) {
    process.stdout.write("vault already complete — no changes\n");
    return;
  }

  // Quote any value that would word-split / mis-parse when the vault is `source`d under
  // `set -e` (e.g. COSMOS_SIGNER_MNEMONIC, a space-separated BIP39 phrase). Writing it bare
  // made a phrase word (e.g. "dish") run as a command → aborted the cold-start create step
  // (incident 2026-07-17). Single-quote (no shell expansion) + escape embedded single quotes;
  // leave simple bare-safe tokens unquoted to match the existing vault style.
  const shQuote = (v) =>
    /^[A-Za-z0-9_@%+=:,./-]*$/.test(v) ? v : `'${String(v).replace(/'/g, "'\\''")}'`;

  // Kopie PŘED zásahem. Tenhle nástroj nově i PŘEPISUJE a MAŽE řádky, ne jen
  // připisuje — a běží těsně před wipem, kdy je trezor jediná záchranná síť.
  if (existsSync(OUT)) {
    const kopie = `${OUT}.pred-reverse-sync`;
    writeFileSync(kopie, readFileSync(OUT, "utf8"), { mode: 0o600 });
    chmodSync(kopie, 0o600);
    process.stdout.write(`  záloha trezoru: ${kopie}\n`);
  }

  // Přerazit a vyhodit se musí NA MÍSTĚ. Připsat přeraženou hodnotu na konec
  // by nechalo klíč v souboru DVAKRÁT — a který z nich vyhraje, závisí na tom,
  // který parser ho zrovna čte (shell `source` bere poslední, jiné čtečky
  // první). Dvojznačný trezor je horší než zastaralý.
  const noveHodnoty = new Map(refreshed);
  const kVyhozeni = new Set(toRemove);
  const prepsane = [];
  for (const l of lines) {
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!m) { prepsane.push(l); continue; }
    const klic = m[1];
    if (kVyhozeni.has(klic)) continue;                       // odvozený fosil — pryč
    if (noveHodnoty.has(klic)) { prepsane.push(`${klic}=${shQuote(noveHodnoty.get(klic))}`); continue; }
    prepsane.push(l);
  }

  // Append missing keys under a stamped section (values are single-line Coolify env).
  const header = "# --- reverse-synced from Coolify (coolify-pull-envs.mjs) — DO NOT edit values by hand ---";
  const body = prepsane.filter((l, i) => !(i === prepsane.length - 1 && l === "")); // drop a trailing empty
  const out = toAdd.length > 0
    ? [...body, "", header, ...toAdd.map(([k, v]) => `${k}=${shQuote(v)}`), ""].join("\n")
    : [...body, ""].join("\n");
  writeFileSync(OUT, out, { mode: 0o600 });
  chmodSync(OUT, 0o600);
  process.stdout.write(
    `Vault ${OUT} (mode 600): +${toAdd.length} doplněno · ~${refreshed.length} přeraženo · -${toRemove.length} odvozených vyhozeno\n`,
  );
}

// Tenhle soubor je zároveň NÁSTROJ i KNIHOVNA (`klasifikujTrezor` měří brána).
// Bez téhle stráže by import v testu spustil skutečnou zpětnou synchronizaci
// proti živému Coolify a přepsal trezor. `isDirectRun` porovnává dev+ino, ne
// zápis cesty — viz lib/cli-entry.mjs.
if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    process.stderr.write(`${e?.stack || e}\n`);
    process.exit(1);
  });
}
