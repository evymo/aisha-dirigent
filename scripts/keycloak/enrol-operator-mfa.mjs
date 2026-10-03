#!/usr/bin/env node
/**
 * enrol-operator-mfa.mjs — odemkne operátorovi zavedení druhého faktoru
 *
 * ⛔ PROČ TENHLE SKRIPT VŮBEC EXISTUJE (naměřeno 2026-09-01).
 *
 * Realm vyžaduje MFA pro role `admin` a `staff`, ale zavedení faktoru nikomu
 * nepřiřazuje — takže se do žádné plochy za oauth2-proxy nedalo přihlásit:
 *
 *     AISHA Browser Forms
 *       auth-username-password-form   REQUIRED      ← heslo projde
 *       AISHA MFA For Admin           CONDITIONAL   ← podmínka: role admin
 *       AISHA MFA For Staff           CONDITIONAL   ← podmínka: role staff
 *           └ AISHA MFA Factor        REQUIRED
 *               webauthn-authenticator  ALTERNATIVE ← nikdo nemá klíč
 *               auth-otp-form           ALTERNATIVE ← nikdo nemá TOTP
 *
 * `AISHA MFA Factor` je REQUIRED a obsahuje dvě alternativy, z nichž ani jedna
 * není nakonfigurovaná. Keycloak nemá jak vybrat, kterou zavést, a vrátí
 * `credentialSetupRequired` — česky „Není možné se přihlásit, je vyžadována
 * konfigurace přístupových údajů". Zamčené dveře, klíč uvnitř.
 *
 * V realmu je akce `CONFIGURE_TOTP` zapnutá, ale s `defaultAction=false`, takže
 * se sama nikomu nepřiřadí. Tenhle skript ji přiřadí konkrétnímu účtu; při
 * dalším přihlášení Keycloak nabídne QR kód a účet se odemkne.
 *
 * ⛔ HESLA SE NEDOTÝKÁ. Přidává se JEN required action. Účet si ponechá své
 * heslo — výměna hesla je jiné rozhodnutí a nemá se vézt s odblokováním MFA.
 *
 * Použití:
 *   node scripts/keycloak/enrol-operator-mfa.mjs <email>            # jen ukáže stav
 *   node scripts/keycloak/enrol-operator-mfa.mjs <email> --apply    # přiřadí akci
 *
 * Env (stejné rozlišení jako scripts/db/provision-operators.mjs):
 *   KEYCLOAK_URL | KEYCLOAK_DOMAIN_PUBLIC | KEYCLOAK_DOMAIN
 *   KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD   (master realm, admin-cli)
 *   KEYCLOAK_REALM                            (identita instance — NEDOSAZUJE se)
 */

const AKCE = "CONFIGURE_TOTP";

function konec(zprava) {
  process.stderr.write(`✗ ${zprava}\n`);
  process.exit(1);
}

// ⛔ ŽÁDNÝ FALLBACK NAD IDENTITOU — převzato z provision-operators.mjs.
// Dosazený realm by hledal uživatele v realmu, který instanci nepatří:
// nenašel by nikoho a skript by hlásil úspěch nad prázdnem.
function keycloakBase() {
  const raw =
    process.env.KEYCLOAK_URL ||
    (process.env.KEYCLOAK_DOMAIN_PUBLIC && `https://${process.env.KEYCLOAK_DOMAIN_PUBLIC}`) ||
    (process.env.KEYCLOAK_DOMAIN && `https://${process.env.KEYCLOAK_DOMAIN}`) ||
    "";
  return raw.replace(/\/+$/, "");
}

const KC = keycloakBase();
const KC_REALM = (process.env.KEYCLOAK_REALM || "").trim();
// ⛔ JMÉNO ADMINA SE NEDOSAZUJE. `|| "admin"` je hádání faktu o světě: kdyby
// se admin realmu jmenoval jinak, skript by se pokusil přihlásit pod cizím
// jménem a selhal by na hesle — tedy hláškou, která ukazuje špatným směrem.
// Chybějící hodnota má selhat na SVÉ příčině. (Ratchet `zadny-fallback-nad-identitou`
// tenhle řádek zachytil při prvním zápisu, ještě před pushem.)
const KC_ADMIN = (process.env.KEYCLOAK_ADMIN || "").trim();
const KC_ADMIN_PW =
  process.env.KEYCLOAK_ADMIN_PASSWORD || process.env.KC_BOOTSTRAP_ADMIN_PASSWORD || "";


// ⛔ NEZNÁMÝ PŘEPÍNAČ JE STOP, NE VÝCHOZÍ CHOVÁNÍ. Tenhle nástroj ZAPISUJE.
// Kdyby překlep („--aply") jen propadl, běželo by chování, které nikdo nechtěl —
// a u zapisujícího nástroje je tiché spolknutí přepínače tichá škoda.
// Registr se drží U PARSOVÁNÍ, ne v dokumentaci: přepínač přidaný níž a sem
// nezapsaný tuhle stráž shodí na první použití.
const ZNAME_PREPINACE = new Set(["--apply", "--help", "-h"]);
{
  const nezname = process.argv
    .slice(2)
    .filter((a) => a.startsWith("-") && !ZNAME_PREPINACE.has(a.split("=")[0]));
  if (nezname.length) {
    console.error(`enrol-operator-mfa: neznámý přepínač: ${nezname.join(" ")}`);
    console.error("Použití: node scripts/keycloak/enrol-operator-mfa.mjs <email> [--apply]");
    process.exit(2);
  }
}

const [email, ...vlajky] = process.argv.slice(2);
const APLIKOVAT = vlajky.includes("--apply");

if (!email || email.startsWith("--")) konec("chybí e-mail operátora (první argument)");
if (!KC) konec("adresa Keycloaku není v env (KEYCLOAK_URL / KEYCLOAK_DOMAIN_PUBLIC / KEYCLOAK_DOMAIN)");
if (!KC_REALM) konec("KEYCLOAK_REALM není deklarovaný — jméno realmu je identita instance a nedosazuje se");
if (!KC_ADMIN) konec("KEYCLOAK_ADMIN není v env — jméno admina realmu se nehádá");
if (!KC_ADMIN_PW) konec("KEYCLOAK_ADMIN_PASSWORD není v env");

async function token() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      password: KC_ADMIN_PW,
      username: KC_ADMIN,
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) konec(`přihlášení do admin API selhalo: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function api(t, cesta, init = {}) {
  const res = await fetch(`${KC}/admin/realms/${encodeURIComponent(KC_REALM)}${cesta}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) konec(`${init.method ?? "GET"} ${cesta} → HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const t = await token();

const nalezeni = await api(t, `/users?email=${encodeURIComponent(email)}&exact=true`);
if (!Array.isArray(nalezeni) || nalezeni.length === 0) {
  konec(`v realmu ${KC_REALM} není uživatel s e-mailem ${email} — provisioning operátorů neproběhl`);
}
const u = nalezeni[0];

// Faktor, který UŽ existuje, je důvod NIC nedělat: přiřazená akce by účet
// zbytečně poslala znovu zakládat to, co má.
const kredence = await api(t, `/users/${u.id}/credentials`);
const typy = (kredence ?? []).map((c) => c.type);
const maFaktor = typy.some((x) => x === "otp" || x.startsWith("webauthn"));
const akce = u.requiredActions ?? [];

process.stdout.write(
  [
    `realm      ${KC_REALM}`,
    `uživatel   ${u.username}  (${u.email})  enabled=${u.enabled}`,
    `kredence   ${typy.length ? typy.join(", ") : "(žádné kromě hesla)"}`,
    `akce       ${akce.length ? akce.join(", ") : "(žádné)"}`,
    "",
  ].join("\n"),
);

if (maFaktor) {
  process.stdout.write("✓ účet už druhý faktor má — není co odemykat\n");
  process.exit(0);
}
if (akce.includes(AKCE)) {
  process.stdout.write(`✓ akce ${AKCE} je už přiřazená — stačí se přihlásit, nabídne QR kód\n`);
  process.exit(0);
}
if (!APLIKOVAT) {
  process.stdout.write(
    `▸ chybí druhý faktor i akce k jeho zavedení.\n` +
      `  Spusť znovu s --apply; přidá se ${AKCE} a při dalším přihlášení se nabídne QR kód.\n` +
      `  Heslo zůstane beze změny.\n`,
  );
  process.exit(0);
}

await api(t, `/users/${u.id}`, {
  body: JSON.stringify({ requiredActions: [...akce, AKCE] }),
  method: "PUT",
});

// Verdikt se čte ZPĚTNĚ ze serveru, ne z toho, že PUT vrátil 204. Zápis, který
// se neprojevil, je horší než zápis, který selhal nahlas.
const po = await api(t, `/users/${u.id}`);
const sedi = (po.requiredActions ?? []).includes(AKCE);
process.stdout.write(
  sedi
    ? `✓ ${AKCE} přiřazeno. Přihlas se na plochu — Keycloak nabídne QR kód.\n  Heslo zůstalo beze změny.\n`
    : `✗ PUT prošel, ale server akci nedrží: ${(po.requiredActions ?? []).join(", ") || "(žádné)"}\n`,
);
process.exit(sedi ? 0 : 1);
