#!/usr/bin/env node
/**
 * apple-idp-secret-push.mjs — dostat Apple client_secret do BĚŽÍCÍHO Keycloaku.
 *
 * ⛔ NAMĚŘENO 2026-08-23. Přihlášení přes Apple hlásilo „Neočekávaná chyba při
 * ověřování s poskytovatelem identity". Příčina: `OAUTH_APPLE_CLIENT_SECRET`
 * byl PRÁZDNÝ. Client ID, Team ID i Key ID přitom nastavené byly.
 *
 * ⭐ PROČ HO ŽÁDNÁ ZÁLOHA NEMĚLA: Apple nepoužívá trvalý secret. Je to JWT
 * podepsaný `.p8` klíčem, platný nejvýš 180 dní — tedy ODVOZENINA S EXPIRACÍ,
 * ne pověření. Ve vaultech je proto nula `OAUTH_APPLE_*` klíčů, a je to
 * správně. Obnovit ho nejde; musí se PŘERAZIT.
 *
 * ⛔ A PROČ NESTAČÍ PŘENASADIT: konfigurace poskytovatele žije v DATABÁZI
 * Keycloaku. Compose má `--import-realm`, což importuje jen když realm
 * NEEXISTUJE — na běžící realm to nesáhne. Doručení do Coolify env tedy
 * nestačí, hodnota musí do Keycloaku přes admin API.
 *
 * ⭐ SMĚR JE OPAČNÝ NEŽ U `reconcile-oidc-secrets.mjs`: tam je autoritou
 * Keycloak a hodnota se z něj čte. Tady je autoritou Apple a hodnota se do
 * Keycloaku TLAČÍ. Proto samostatný nástroj, ne větev v tom existujícím.
 *
 * Použití:
 *   node scripts/apple-idp-secret-push.mjs                 # z .env.coolify
 *   node scripts/apple-idp-secret-push.mjs --dry-run       # jen ukáže, co by udělal
 *
 * Vstupy (z prostředí nebo .env.coolify): KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD,
 * KEYCLOAK_REALM, OAUTH_APPLE_CLIENT_ID, OAUTH_APPLE_CLIENT_SECRET a veřejná
 * adresa Keycloaku.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");

function zEnvSouboru(jmeno) {
  try {
    for (const r of readFileSync(resolve(ROOT, ".env.coolify"), "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(r.trim());
      if (m && m[1] === jmeno) return m[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (e) {
    // ⛔ „Soubor neexistuje" a „soubor nejde přečíst" NEJSOU totéž. První je
    // legitimní (hodnota přijde z prostředí), druhé je vada, která se bez
    // hlášky projeví až jako chybějící hodnota o tři kroky dál.
    if (e?.code !== "ENOENT") {
      console.error(`⚠ .env.coolify nelze přečíst (${e?.code || e?.message}) — hledám ${jmeno} jen v prostředí`);
    }
  }
  return "";
}
const hodnota = (k) => process.env[k] || zEnvSouboru(k);

function musi(k) {
  const v = hodnota(k);
  if (!v) {
    console.error(`✗ ${k} chybí. Nedosazuji: prázdná hodnota by IdP tiše rozbila.`);
    if (k === "OAUTH_APPLE_CLIENT_SECRET") {
      console.error("  Vyrob ho: node scripts/gen-apple-secret.mjs --key <AuthKey_*.p8> \\");
      console.error("            --team-id <TEAM> --client-id <SERVICES_ID> --key-id <KEY>");
    }
    process.exit(1);
  }
  return v;
}

const realm = hodnota("KEYCLOAK_REALM") || "aisha";
const domena = hodnota("KEYCLOAK_DOMAIN_PUBLIC") || hodnota("KEYCLOAK_DOMAIN");
if (!domena) { console.error("✗ veřejná adresa Keycloaku není známá (KEYCLOAK_DOMAIN_PUBLIC)"); process.exit(1); }
const base = domena.startsWith("http") ? domena : `https://${domena}`;

const admin = musi("KEYCLOAK_ADMIN");
const heslo = musi("KEYCLOAK_ADMIN_PASSWORD");
const clientId = musi("OAUTH_APPLE_CLIENT_ID");
const secret = musi("OAUTH_APPLE_CLIENT_SECRET");

// ⛔ Keycloak secrety v odpovědi MASKUJE (`**********`). Otisk proto počítáme
// z délky a hashe, ne z konce hodnoty — a do logu nejde ani kousek tajemství.
const maska = (s) => /^\*+$/.test(String(s || ""));
const otisk = (s) => `${String(s).length} znaků`;

// Každé volání má strop. Bez něj se skript při nedostupném Keycloaku zasekne
// navždy — a v cold-startu to vypadá jako „běží", ne jako „nedosáhne".
const CAS_MS = Number(process.env.APPLE_IDP_TIMEOUT_MS || 15000);
async function volat(url, init = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), CAS_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`${url.split("/admin/")[0]}: timeout po ${CAS_MS} ms`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function token() {
  const r = await volat(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: admin, password: heslo }),
  });
  if (!r.ok) throw new Error(`admin token: HTTP ${r.status}`);
  return (await r.json()).access_token;
}

const t = await token();
const url = `${base}/admin/realms/${realm}/identity-provider/instances/apple`;
const cur = await volat(url, { headers: { Authorization: `Bearer ${t}` } });
if (cur.status === 404) { console.error(`✗ realm '${realm}' nemá poskytovatele 'apple' — nejdřív import realmu`); process.exit(1); }
if (!cur.ok) throw new Error(`čtení IdP: HTTP ${cur.status}`);
const idp = await cur.json();

// Maskovanou hodnotu nelze porovnat — pak se zapisuje vždy (je to idempotentní).
const stejny = idp.config?.clientId === clientId
  && !maska(idp.config?.clientSecret)
  && idp.config?.clientSecret === secret;
console.log(`  realm:      ${realm}`);
console.log(`  clientId:   ${idp.config?.clientId || "(prázdné)"} → ${clientId}`);
console.log(`  secret:     ${!idp.config?.clientSecret ? "(PRÁZDNÝ)" : maska(idp.config.clientSecret) ? "(nastaven, Keycloak maskuje)" : otisk(idp.config.clientSecret)} → ${otisk(secret)}`);
if (stejny) { console.log("✓ už sedí — nic neměním"); process.exit(0); }
if (DRY) { console.log("… --dry-run: nezapisuji"); process.exit(0); }

idp.config = { ...(idp.config || {}), clientId, clientSecret: secret };
const put = await volat(url, {
  method: "PUT",
  headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  body: JSON.stringify(idp),
});
if (!put.ok) throw new Error(`zápis IdP: HTTP ${put.status}`);

// Zápis NENÍ důkaz. Přečti zpátky.
const zpet = await volat(url, { headers: { Authorization: `Bearer ${t}` } });
if (!zpet.ok) throw new Error(`zpětné čtení IdP: HTTP ${zpet.status}`);
const po = await zpet.json();
// Secret se zpátky přečíst NEDÁ (maskuje se), takže se ověřuje to, co ověřit lze:
// že IdP existuje, má správný clientId a secret NENÍ prázdný. Tvrdit víc by bylo
// předstírání důkazu.
if (po.config?.clientId !== clientId || !po.config?.clientSecret) {
  console.error("✗ po zápisu IdP nenese očekávaný clientId nebo má prázdný secret");
  process.exit(1);
}
console.log("✓ Apple IdP aktualizován a ověřen zpětným čtením");
