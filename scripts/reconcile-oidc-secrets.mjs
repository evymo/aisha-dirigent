#!/usr/bin/env node
/**
 * reconcile-oidc-secrets.mjs — heal OIDC client-secret drift between Keycloak
 * (the authority) and Coolify runtime env (the store).
 *
 * WHY: an OIDC client secret must be identical in three places — the Keycloak
 * client config, the consumer's Coolify env, and any config the consumer cached
 * at boot. When they drift, auth silently breaks. Stale `netbird-backend` drift
 * in the management IdP config was the 2026-07-02 mesh-enroll incident; this is
 * the deterministic, repeatable form of the manual fix.
 *
 * ⛔ MODEL PŘEHODNOCEN 2026-08-24 (rozhodl majitel). Do té doby tu stálo, že
 * autorita je KEYCLOAK, protože secret při přihlášení ověřuje. Validovat a
 * VLASTNIT ale není totéž, a ten směr je NEPROVEDITELNÝ — naměřeno:
 *
 *   1. Kontejner si z Keycloaku číst NEUMÍ. Hodnotu dostane jedině z Coolify env
 *      přes interpolaci v compose. Léčení KC→Coolify tedy musí projít souborem,
 *      který se GENERUJE — a další generace ho zahodí.
 *   2. Redeploy si před nasazením sype env z `.env.coolify`, takže vyléčenou
 *      kopii PŘEPÍŠE. 2026-08-24 to opravu smazalo do několika sekund.
 *   3. Po `--wipe` Keycloak žádnou hodnotu NEMÁ — vzniká v generate-secrets a
 *      drží se přes `preservedValue`. Autorita, která při cold-startu
 *      neexistuje, autorita není.
 *
 * AUTORITA JE `.env.coolify`. Teče ze ní DO Coolify env (a odtud do kontejneru)
 * a zvlášť DO Keycloaku razítkem. Keycloak není nikdy zdroj.
 *
 * TENHLE NÁSTROJ PROTO NEPÍŠE. Je DETEKTOR: porovná tři kopie a pojmenuje toho,
 * kdo daný směr vlastní. Každý zápis má jeden domov a tohle není ani jeden z nich:
 *   • Coolify env  ← `coolify-sync-envs.sh`
 *   • Keycloak     ← `provision-sso.sh` (má ověřování zpětným čtením a v komentáři
 *                    dva zdokumentované neúspěšné pokusy — nepsat podruhé)
 *
 * SAFETY:
 *   - only patches an app whose env ALREADY holds the key (never adds keys, so
 *     a wrong app can never receive a secret it should not have);
 *   - never writes an empty value;
 *   - read-only by default (--check); pass --apply to patch;
 *   - never logs a secret VALUE — only clientId, envKey, app name, drift bool.
 *
 * After --apply, redeploy the affected apps so they re-read the healed env.
 *
 * Env (process.env wins, else .env-prod-backup, else .env.coolify):
 *   COOLIFY_BASE_URL, COOLIFY_API_TOKEN     — Coolify API
 *   KEYCLOAK_URL, KEYCLOAK_REALM(=aisha)    — KC base + realm
 *   KEYCLOAK_ADMIN(=admin), KEYCLOAK_ADMIN_PASSWORD — KC admin-cli creds
 *
 * Usage:
 *   node scripts/reconcile-oidc-secrets.mjs            # nahlásí rozdíl (exit 1)
 *   node scripts/reconcile-oidc-secrets.mjs --apply    # spustí VLASTNÍKY oprav
 *   node scripts/reconcile-oidc-secrets.mjs --json     # strojově čitelně
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEnvStore, productionValue } from "./lib/coolify-env-store.mjs";
import { resolveInstanceIdentity } from "./lib/coolify-instance-scope.mjs";
import { getKcAdminToken, getClientSecret, CLIENT_REGISTRY } from "./lib/kc-client-secret.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const JSON_OUTPUT = argv.includes("--json");

function loadEnvFile(p) {
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let raw = m[2];
    if (!raw.startsWith('"') && !raw.startsWith("'")) {
      const h = raw.indexOf(" #");
      if (h >= 0) raw = raw.slice(0, h);
    }
    out[m[1]] = raw.trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

// Layered resolution: .env.coolify < .env-prod-backup < process.env.
const fileEnv = {
  ...loadEnvFile(resolve(ROOT, ".env.coolify")),
  ...loadEnvFile(resolve(ROOT, ".env-prod-backup")),
};
const cfg = (key) => process.env[key] ?? fileEnv[key] ?? "";

// AUTORITA je `.env.coolify` — ne vrstvené `cfg`. Kdyby se brala z `cfg`,
// `process.env` by mohl autoritu přepsat zvenčí a měřidlo by porovnávalo
// hodnotu, kterou nikdo nenasazuje.
const authorityEnv = loadEnvFile(resolve(ROOT, ".env.coolify"));
const otisk = (s) => (s ? `${s.length}z/${createHash("sha256").update(s).digest("hex").slice(0, 8)}` : "—");

function requireCfg(key) {
  const v = cfg(key);
  if (!v) {
    process.stderr.write(`FATAL: ${key} required (process.env, .env-prod-backup, or .env.coolify)\n`);
    process.exit(2);
  }
  return v;
}

// ⛔ ČÍ APLIKACE TENHLE BĚH ČTE A MĚNÍ? Naměřeno 2026-08-24: bez deklarované
// identity `appPrefix()` DOSADÍ „aisha" (story-app.mjs: `APP_NAME_PREFIX || "aisha"`),
// takže tenhle nástroj mířil na CIZÍ instanci — nahlásil 19 rozdílů v `aisha-edge`,
// `aisha-registry`, `aisha-netbird`. S `--apply` by do nich zapsal tajemství NAŠEHO
// Keycloaku. `coolify-sync-envs.sh` proti tomu pojistku má; tady chyběla.
//
// Neznámý cíl = STOP. Hádaný cíl je horší než žádný běh.
const IDENTITA = resolveInstanceIdentity({ required: true });
process.env.APP_NAME_PREFIX = IDENTITA.prefix; // aby appPrefix() neměl co hádat

async function main() {
  const baseUrl = cfg("COOLIFY_BASE_URL") || requireCfg("COOLIFY_URL");
  const token = requireCfg("COOLIFY_API_TOKEN");
  const kcUrl = requireCfg("KEYCLOAK_URL");
  const realm = cfg("KEYCLOAK_REALM") || "aisha";
  const admin = cfg("KEYCLOAK_ADMIN") || "admin";
  const password = requireCfg("KEYCLOAK_ADMIN_PASSWORD");

  const store = createEnvStore({ baseUrl, token });

  // Fetch app envs once.
  const apps = await store.listAishaApps();
  const appEnvs = new Map(); // uuid -> { name, uuid, envs }
  for (const a of apps) {
    appEnvs.set(a.uuid, { name: a.name, uuid: a.uuid, envs: await store.getAppEnv(a.uuid) });
  }

  const kcToken = await getKcAdminToken({ kcUrl, admin, password });

  const reports = [];
  for (const { clientId, envKey } of CLIENT_REGISTRY) {
    // AUTORITA. Bez ní se nedá tvrdit nic — a mlčet o tom by znamenalo vydat
    // „nemám s čím porovnat" za „vše souhlasí".
    const authority = authorityEnv[envKey] || "";
    if (!authority) {
      reports.push({ clientId, envKey, status: "bez-autority", drift: [] });
      continue;
    }
    const kcSecret = await getClientSecret({ kcUrl, realm, clientId, token: kcToken });
    if (!kcSecret) {
      reports.push({ clientId, envKey, status: "kc-missing", drift: [] });
      continue; // klient neexistuje nebo je PUBLIC — není co porovnávat
    }

    const drift = [];
    // (a) Keycloak proti autoritě — opravuje se RAZÍTKEM, ne zápisem odsud.
    if (kcSecret !== authority) drift.push({ kde: "keycloak", vlastnik: "provision-sso.sh" });

    // (b) Coolify env proti autoritě — porovnává se PRODUKČNÍ záznam, protože
    //     to je hodnota, se kterou appka doopravdy běží.
    for (const { name, uuid, envs } of appEnvs.values()) {
      const current = productionValue(envs, envKey);
      if (current === null) continue; // produkční kopie tu není
      if (current === authority) continue;
      drift.push({ kde: `coolify:${name}`, app: name, uuid, vlastnik: "coolify-sync-envs.sh" });
    }

    reports.push({
      clientId, envKey, status: drift.length ? "drift" : "ok", drift,
      otisky: { autorita: otisk(authority), keycloak: otisk(kcSecret) },
    });
  }

  // ── Léčení: NEPÍŠE se odsud, spouštějí se VLASTNÍCI těch směrů ─────────────
  if (APPLY) {
    const kcDrift = reports.some((r) => r.drift.some((d) => d.kde === "keycloak"));
    const envDrift = reports.some((r) => r.drift.some((d) => d.kde?.startsWith("coolify:")));
    const spustit = (popis, bin, args) => {
      console.log(`\n  ▸ ${popis}: ${bin} ${args.join(" ")}`);
      try {
        execFileSync(bin, args, { cwd: ROOT, stdio: "inherit", env: process.env });
      } catch (e) {
        // ⛔ Nezdar léčení se NESMÍ spolknout — přesně tím se 2026-08-24
        // razítkování secretů tvářilo jako úspěšné, zatímco spadlo uprostřed.
        console.error(`  ✗ ${popis} SELHALO (${e?.status ?? e?.message}) — kopie zůstávají rozešlé`);
        process.exitCode = 2;
      }
    };
    if (kcDrift) spustit("razítkuji Keycloak z autority", "bash", ["scripts/provision-sso.sh", "--prod", "--keycloak-only"]);
    if (envDrift) {
      const apps = [...new Set(reports.flatMap((r) => r.drift.filter((d) => d.app).map((d) => d.app.replace(/^[^-]+-/, ""))))];
      spustit("doručuji autoritu do Coolify", "bash", ["scripts/coolify-sync-envs.sh", ...apps]);
    }
    if (!kcDrift && !envDrift) console.log("\n  nic k léčení — všechny kopie souhlasí s autoritou");
  }

  const driftCount = reports.reduce((n, r) => n + r.drift.length, 0);
  const kcMissing = reports.filter((r) => r.status === "kc-missing").map((r) => r.clientId);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ apply: APPLY, driftCount, kcMissing, reports }, null, 2));
  } else {
    console.log(`OIDC secrety — AUTORITA: .env.coolify  (realm '${realm}')\n`);
    for (const r of reports) {
      if (r.status === "bez-autority") {
        console.log(`  ??  ${r.clientId.padEnd(26)} ${r.envKey} — v .env.coolify NENÍ, nemám s čím porovnat`);
        continue;
      }
      if (r.status === "kc-missing") {
        console.log(`  ??  ${r.clientId.padEnd(26)} ${r.envKey} — klient v KC chybí nebo je PUBLIC (přeskočeno)`);
        continue;
      }
      if (r.status === "ok") {
        console.log(`  OK  ${r.clientId.padEnd(26)} ${r.envKey}`);
        continue;
      }
      // Otisky, ne hodnoty: rozdíl musí být vidět, tajemství ne.
      const kde = r.drift.map((d) => d.kde).join(", ");
      console.log(`  ROZDÍL ${r.clientId.padEnd(23)} ${r.envKey}`);
      console.log(`         ${kde}`);
      console.log(`         autorita ${r.otisky.autorita}   keycloak ${r.otisky.keycloak}`);
    }
    if (!APPLY && driftCount > 0) {
      console.log(`\n${driftCount} kopií se liší od autority. Oprav je jejich VLASTNÍKY:`);
      console.log(`  Keycloak    → npm run sso:provision:prod`);
      console.log(`  Coolify env → bash scripts/coolify-sync-envs.sh <appky>  (pak redeploy)`);
      console.log(`Nebo je nech spustit: --apply`);
    }
  }

  // ⛔ `process.exitCode` nastavený při nezdaru léčení se NESMÍ přebít nulou —
  // tím by se selhaná oprava vydávala za úspěch (přesně vada, kvůli které
  // razítkování secretů mlčelo). Když už je nenulový, nechá se.
  if (process.exitCode) return;
  // V režimu čtení je rozdíl selhání (1); v režimu léčení rozhodly vlastníci výš.
  process.exit(!APPLY && driftCount > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`${err?.message || err}\n`);
  process.exit(2);
});
