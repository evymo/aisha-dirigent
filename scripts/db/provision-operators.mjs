#!/usr/bin/env node
/**
 * provision-operators.mjs — Dynamic operator provisioning (no hardcoded subs)
 *
 * Reads config/operators.json (email + roles, NO user_id), resolves each
 * operator's LIVE Keycloak `sub` by email, and upserts:
 *   - aisha_auth.users        (id = live sub, email)
 *   - aisha_auth.identities   (keycloak provider link)
 *   - public.profiles         (display_name, language) — idempotent
 *   - public.user_roles       (the configured app roles → is_admin_or_staff();
 *                             `production_operator` je PODMÍNĚNÝ grant — viz
 *                             planRatifikaci() u SQL emitoru)
 *
 * WHY: seed/demo/03_admin_grants.sql hard-pinned stale Keycloak subs
 * (e.g. 5298d168… for zdenek) that DON'T survive a fresh Keycloak — every
 * cold-start re-broke operator role + story access. This resolves the sub from
 * the live realm instead, so the operator roster is durable across --wipe.
 *
 * Usage:
 *   node scripts/db/provision-operators.mjs               # resolve + print SQL (safe, default)
 *   node scripts/db/provision-operators.mjs --apply       # also apply via psql ($AISHA_DB_URL)
 *   node scripts/db/provision-operators.mjs --json        # print resolved roster as JSON
 *   node scripts/db/provision-operators.mjs --create-only # only create MISSING KC users (no DB)
 *   node scripts/db/provision-operators.mjs --no-create   # never create KC users (old skip behavior)
 *
 * Env (resolved from process.env; cold-start has these in scope):
 *   KEYCLOAK_URL | KEYCLOAK_DOMAIN_PUBLIC | KEYCLOAK_DOMAIN  (base for admin API)
 *   KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD                  (master-realm admin-cli)
 *   KEYCLOAK_REALM (default: aisha)
 *   AISHA_DB_URL                                             (only needed for --apply)
 *   AISHA_OPERATORS_CREATE_MISSING (default 1)               (0 = never create KC users)
 *   AISHA_OPERATORS_FILE                                     (path to a roster JSON file)
 *
 * Roster source priority (first PRESENT source wins; see loadRoster()):
 *   1. AISHA_OPERATORS_FILE  env path to a roster JSON — in the migrate
 *      container this is the PRIVATE instance-data overlay's top-level
 *      operators.json (exported by scripts/deploy/instance-data-hook.sh), so a
 *      wipe cold-start restores users purely from the private instance repo,
 *      zero local files; day-2 ops point it at a clone via
 *      scripts/instance-rollout.sh. This is the DECLARED roster.
 *   2. AISHA_OPERATORS       env JSON (array or {operators:[]}) — a SNAPSHOT
 *      written by aisha-cold-start.sh as the wipe-restore path for when the
 *      overlay is unreachable
 *   3. config/operators.json (gitignored, operator's local roster)
 *   4. AISHA_PRIMARY_ADMIN_EMAIL (minimal roster; also always ensured/prepended)
 *   5. Keycloak realm-role fallback (admin/staff members of the live realm)
 *
 * ⛔ 1 and 2 are in this order since 2026-08-07 (was: env first). A frozen env
 * snapshot silently outranked the re-cloned overlay, so operators added to
 * operators.json never reached public.user_roles and the deploy still reported
 * success. When BOTH are present, the file wins and every disagreement is
 * printed as a ROSTER CONFLICT block — see loadRoster() for the full rationale.
 *
 * Idempotent: ON CONFLICT DO UPDATE / DO NOTHING throughout; Keycloak user
 * creation fires ONLY for roster emails with no existing KC account (existing
 * users are never modified — no password resets on re-runs).
 *
 * @module
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { getKcAdminToken } from "../lib/kc-client-secret.mjs";
import { psqlPripojeni } from "./lib/psql-pripojeni.mjs";
import { isDirectRun } from "../lib/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const AS_JSON = args.includes("--json");
const CREATE_ONLY = args.includes("--create-only");
// Auto-creation of missing Keycloak roster users: ON by default (full --wipe
// automation); opt out via --no-create or AISHA_OPERATORS_CREATE_MISSING=0.
const NO_CREATE =
  args.includes("--no-create") || (process.env.AISHA_OPERATORS_CREATE_MISSING ?? "1") === "0";

function fail(msg) {
  process.stderr.write(`❌ ${msg}\n`);
  process.exit(1);
}

// ── Keycloak base + admin creds ───────────────────────────────────────────────
function keycloakBase() {
  const raw =
    process.env.KEYCLOAK_URL ||
    (process.env.KEYCLOAK_DOMAIN_PUBLIC && `https://${process.env.KEYCLOAK_DOMAIN_PUBLIC}`) ||
    (process.env.KEYCLOAK_DOMAIN && `https://${process.env.KEYCLOAK_DOMAIN}`) ||
    "";
  return raw.replace(/\/+$/, "");
}
const KC = keycloakBase();
// ⛔ ŽÁDNÝ FALLBACK (2026-08-25). Tenhle krok hledá operátorům jejich `sub`
// v Keycloaku a podle něj uděluje DB role. Dosazený realm by je hledal v realmu,
// který instanci nepatří — nikoho by nenašel a role by mlčky neudělil.
const KC_REALM = (process.env.KEYCLOAK_REALM || "").trim();
if (!KC_REALM) {
  throw new Error(
    "KEYCLOAK_REALM není deklarovaná — jméno realmu je identita instance a nedosazuje se.",
  );
}
const KC_ADMIN = process.env.KEYCLOAK_ADMIN || "admin";
const KC_ADMIN_PW = process.env.KEYCLOAK_ADMIN_PASSWORD || process.env.KC_BOOTSTRAP_ADMIN_PASSWORD || "";

// Okno pro přechodné chyby Keycloaku (5xx, spojení). Migrace běží hned po
// restartu DB, kterou Keycloak sdílí — naměřeno 2026-09-19: 500 z admin tokenu,
// Keycloak zpátky do 30 s. Tři minuty to přečkají s rezervou; déle trvající
// výpadek už přechodný není a padá nahlas.
const KC_TRANSIENT_RETRY_MS = 180_000;

async function kcAdminToken() {
  if (!KC) fail("Keycloak base URL not set (KEYCLOAK_URL / KEYCLOAK_DOMAIN_PUBLIC / KEYCLOAK_DOMAIN)");
  if (!KC_ADMIN_PW) fail("KEYCLOAK_ADMIN_PASSWORD not set");
  try {
    return await getKcAdminToken({
      kcUrl: KC,
      admin: KC_ADMIN,
      password: KC_ADMIN_PW,
      timeoutMs: 30_000,
      transientRetryMs: KC_TRANSIENT_RETRY_MS,
      onRetry: ({ pokus, prodleva, chyba }) =>
        process.stderr.write(`⏳ Keycloak admin auth přechodně selhal (${chyba.slice(0, 120)}) — pokus ${pokus + 1} za ${prodleva / 1000} s\n`),
    });
  } catch (err) {
    fail(`Keycloak admin auth failed: ${err.message}`);
  }
}

async function resolveSub(token, email) {
  const res = await fetch(
    `${KC}/admin/realms/${KC_REALM}/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) fail(`Keycloak user lookup failed for ${email}: HTTP ${res.status}`);
  const users = await res.json();
  const u = Array.isArray(users) ? users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase()) : null;
  return u ? { sub: u.id, username: u.username } : null;
}

// Mirror the operator-tier roster roles into Keycloak REALM roles: the DB
// plane authorizes via public.user_roles, but surfaces read the access token's
// realm `roles` claim (the mobile app hides its Admin entry without it, and
// the realm-role fallback roster below reconstructs FROM these mappings after
// a roster file is lost). Only roles in OPERATOR_REALM_ROLES are mirrored —
// app-only roles have no realm counterpart. Idempotent: re-POSTing an existing
// mapping is a no-op for Keycloak.
async function ensureRealmRoles(token, sub, roles) {
  const wanted = roles.filter((r) => OPERATOR_REALM_ROLES.includes(r));
  if (wanted.length === 0) return;
  const reps = [];
  for (const name of wanted) {
    const res = await fetch(
      `${KC}/admin/realms/${KC_REALM}/roles/${encodeURIComponent(name)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
    );
    if (res.ok) reps.push(await res.json());
    else process.stderr.write(`⚠ realm role '${name}' not found in realm '${KC_REALM}' (skipping mirror)\n`);
  }
  if (reps.length === 0) return;
  const res = await fetch(`${KC}/admin/realms/${KC_REALM}/users/${sub}/role-mappings/realm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(reps),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    process.stderr.write(`⚠ realm-role mirror failed for ${sub.slice(0, 12)}…: HTTP ${res.status}\n`);
  }
}

// ── Roster je AUTORITA operátorských rolí (rozhodnutí majitele 2026-09-28) ────
// ⛔ NAMĚŘENO 2026-09-28: provisioning role jen PŘIDÁVAL (INSERT … DO NOTHING,
// POST role-mappings). Odebrat někomu admina v rosteru tedy nic neudělalo a ruční
// odebrání vydrželo jen do dalšího nasazení Core. Záložní rekonstrukce rosteru
// z realm rolí by admina vrátila i po ztrátě souboru. Běžný uživatel (dřív
// operátor) tak nešel udělat běžným jinak než ručně, proti pipeline.
//
// Proto: když roster pochází z DEKLAROVANÉHO souboru dat instance
// (AISHA_OPERATORS_FILE) a běží --apply, operátorské role (admin/staff), které
// roster u daného e-mailu NEUVÁDÍ, se odeberou — v DB i v Keycloaku.
//   • jen deklarovaný soubor: snapshot v env může být zastaralý a rekonstrukce
//     z realmu je odvozená z toho, co se má srovnat;
//   • jen operátorské role (OPERATOR_REALM_ROLES) — aplikační role (member …)
//     roster neřídí;
//   • jen e-maily v rosteru — kdo v něm není, toho se to netýká;
//   • ⛔ pojistka: kdyby po srovnání nezůstal v rosteru žádný admin, STOP bez
//     jediného odebrání (zamčení instance je horší než přebytečná role).
export function operatorRolesToRevoke(op, operatorRoles = OPERATOR_REALM_ROLES) {
  const declared = new Set((op.roles || []).map((r) => String(r)));
  return operatorRoles.filter((r) => !declared.has(r));
}

export function planRevocations(resolved, operatorRoles = OPERATOR_REALM_ROLES) {
  if (operatorRoles.includes("admin") && !resolved.some((op) => (op.roles || []).includes("admin"))) {
    throw new Error(
      "roster by po srovnání nenechal ŽÁDNÉHO admina — neodebírám nic (zamčení instance). " +
        "Oprav operators.json v datech instance.",
    );
  }
  return resolved
    .map((op) => ({ email: op.email, sub: op.sub, roles: operatorRolesToRevoke(op, operatorRoles) }))
    .filter((r) => r.roles.length > 0);
}

// Keycloak: DELETE role-mappings/realm s reprezentacemi rolí, které uživatel MÁ.
// ⛔ NAMĚŘENO 2026-09-28 na <fork>: klient s omezenými právy nesmí GET
// /roles/{name} (403); DELETE s prázdným seznamem pak vrátí 204 a neudělá nic —
// „odebráno" by lhalo. Reprezentace se proto berou z mapování samotného
// uživatele (to smí) a výsledek se ověří dalším čtením.
async function dropRealmRoles(token, sub, roles) {
  const url = `${KC}/admin/realms/${KC_REALM}/users/${sub}/role-mappings/realm`;
  const hdr = { Authorization: `Bearer ${token}` };
  const mapRes = await fetch(url, { headers: hdr, signal: AbortSignal.timeout(30_000) });
  if (!mapRes.ok) {
    process.stderr.write(`⚠ realm-role mappings unreadable for ${sub.slice(0, 12)}…: HTTP ${mapRes.status}\n`);
    return false;
  }
  const mapped = await mapRes.json();
  const reps = (Array.isArray(mapped) ? mapped : [])
    .filter((m) => roles.includes(m.name))
    .map((m) => ({ id: m.id, name: m.name }));
  if (reps.length === 0) return true; // nic z toho uživatel nemá
  const res = await fetch(`${KC}/admin/realms/${KC_REALM}/users/${sub}/role-mappings/realm`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(reps),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    process.stderr.write(`⚠ realm-role removal failed for ${sub.slice(0, 12)}…: HTTP ${res.status}\n`);
    return false;
  }
  const po = await fetch(url, { headers: hdr, signal: AbortSignal.timeout(30_000) });
  const zbylo = po.ok ? (await po.json()).filter((m) => roles.includes(m.name)).map((m) => m.name) : ["?"];
  if (zbylo.length > 0) {
    process.stderr.write(`⚠ realm roles still mapped for ${sub.slice(0, 12)}… after removal: ${zbylo.join(",")}\n`);
    return false;
  }
  return true;
}

// ── Missing-user creation (closes the last manual --wipe step) ───────────────
// A volume-purging wipe destroys human Keycloak accounts and the committed
// realm import ships none (public repo = PII-free), so roster operators whose
// email resolves to no KC user used to be skipped ("create the account first")
// — a manual step. When enabled (default), we create the user via the admin
// API with a crypto-random ONE-TIME temporary password (printed ONCE to
// stdout in a [TEMP-PASSWORD] block, never persisted) and
// requiredActions=[UPDATE_PASSWORD] → first login forces a password change.
// Existing users are NEVER touched (no password resets) — creation fires only
// when the email resolves to nothing, so re-runs stay idempotent. The
// realm-role fallback roster derives FROM the realm → nothing to create there.

export const TEMP_PW_MARK = "[TEMP-PASSWORD]";

/** "Ada Lovelace" → { firstName: "Ada", lastName: "Lovelace" } (rest = lastName). */
export function parseDisplayName(displayName) {
  const parts = String(displayName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Crypto-random one-time password: 24 random bytes → 32 base64url chars (≥190 bits). */
export function generateTempPassword() {
  return crypto.randomBytes(24).toString("base64url");
}

function printTempPasswordBlock({ email, username, tempPassword }) {
  const P = TEMP_PW_MARK;
  process.stdout.write(
    [
      `${P} ──────────────────────────────────────────────────────────────`,
      `${P} ONE-TIME temporary password (auto-created Keycloak user)`,
      `${P}   user:     ${email} (username: ${username})`,
      `${P}   password: ${tempPassword}`,
      `${P} Shown ONCE — copy it NOW; it is never persisted anywhere.`,
      `${P} First login forces a password change (UPDATE_PASSWORD).`,
      `${P} ──────────────────────────────────────────────────────────────`,
      "",
    ].join("\n"),
  );
}

/**
 * Create a missing Keycloak user for a roster operator and set a one-time
 * temporary password. Returns { sub, username, tempPassword } or null on
 * failure (soft — caller falls back to the old skip-with-warning behavior).
 */
export async function createKcUser(token, op) {
  const email = op.email;
  const username = (op.username || email.split("@")[0] || "").trim();
  const { firstName, lastName } = parseDisplayName(op.displayName);
  const rep = {
    username,
    email,
    enabled: true,
    emailVerified: true,
    requiredActions: ["UPDATE_PASSWORD"],
  };
  if (firstName) rep.firstName = firstName;
  if (lastName) rep.lastName = lastName;
  const res = await fetch(`${KC}/admin/realms/${KC_REALM}/users`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(rep),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 201) {
    // e.g. 409 = username collision under a different email — needs a human.
    process.stderr.write(
      `⚠ ${email}: Keycloak user create failed: HTTP ${res.status} ${(await res.text()).slice(0, 160)} — create manually\n`,
    );
    return null;
  }
  // New user id from the Location header; re-lookup by email as fallback.
  const loc = res.headers.get("location") || "";
  let sub = loc.split("/").filter(Boolean).pop() || null;
  if (!sub) sub = (await resolveSub(token, email))?.sub || null;
  if (!sub) {
    process.stderr.write(`⚠ ${email}: created but could not resolve the new user id — re-run provisioning\n`);
    return null;
  }
  const tempPassword = generateTempPassword();
  const pwRes = await fetch(`${KC}/admin/realms/${KC_REALM}/users/${sub}/reset-password`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "password", value: tempPassword, temporary: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!pwRes.ok) {
    process.stderr.write(
      `⚠ ${email}: user created but temp password set failed: HTTP ${pwRes.status} — set one in the Keycloak admin UI\n`,
    );
    return { sub, username, tempPassword: null };
  }
  printTempPasswordBlock({ email, username, tempPassword });
  process.stderr.write(`+ ${email}: Keycloak user created (${sub.slice(0, 12)}…, UPDATE_PASSWORD required)\n`);
  return { sub, username, tempPassword };
}

// ── Realm-driven roster (zero-touch reconstruction fallback) ──────────────────
// When NO explicit roster is supplied (no AISHA_OPERATORS, no config/operators.json,
// no AISHA_PRIMARY_ADMIN_EMAIL), reconstruct the operator set deterministically from
// the COMMITTED realm: every Keycloak user carrying an operator-tier realm role
// (admin / staff) becomes an operator with the matching app_role. The realm import
// (aisha-realm.json) is committed + version-controlled, so a fresh --wipe clone grants
// operators their DB roles with zero manual step and zero PII in the repo.
//
// SCOPE: only the operator-tier realm roles below map to app_roles — never a blanket
// grant of every realm user. Realm role name == public.app_role value (admin, staff).
const OPERATOR_REALM_ROLES = (process.env.AISHA_OPERATOR_REALM_ROLES || "admin,staff")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function usersWithRealmRole(token, roleName) {
  const res = await fetch(
    `${KC}/admin/realms/${KC_REALM}/roles/${encodeURIComponent(roleName)}/users?max=2000`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  if (res.status === 404) return []; // role not defined in this realm → no operators of that tier
  if (!res.ok) fail(`Keycloak role-users lookup failed for '${roleName}': HTTP ${res.status}`);
  const users = await res.json();
  return Array.isArray(users) ? users : [];
}

async function rosterFromRealm(token) {
  const byEmail = new Map(); // lower(email) → operator (roles unioned across realm roles)
  for (const role of OPERATOR_REALM_ROLES) {
    for (const u of await usersWithRealmRole(token, role)) {
      const email = (u.email || "").trim();
      if (!email) continue; // operators must carry an email (identity + resolveSub need it)
      const key = email.toLowerCase();
      const op = byEmail.get(key) || {
        email,
        username: u.username || email.split("@")[0],
        displayName: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || email.split("@")[0],
        language: "en",
        roles: [],
      };
      if (!op.roles.includes(role)) op.roles.push(role);
      byEmail.set(key, op);
    }
  }
  return [...byEmail.values()];
}

// ── SQL emit (single-quote-safe; values are emails/uuids/role enums) ──────────
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ── production_operator = ODPOVĚDNOST za odsouhlasování „pravdy" ──────────────
// Rozhodnutí majitele 2026-09-28. Naměřeno téhož dne na DB postavené z main +
// overlay dat instance: všech 63 `production_workflow_steps` („Odečet na místě")
// je psáno na roli `production_operator`, kterou NEMÁ NIKDO — roster deklaruje
// čtyři lidi a všem dává jen admin+staff. Blok `wf_my_steps` na poradě proto
// vracel prázdno KAŽDÉMU účtu, ačkoli práce existovala (po dočasném přidání té
// role členovi vydal 20 položek). Nešlo o vadu bloku, ale o nedoručitelnou adresu.
//
// Grant proto drží JEDNU podmínku: roli smí dostat jen admin/staff — least
// privilege a default deny, aby roster nemohl paušálně rozdávat frontu, na kterou
// se pak navěšuje potvrzování. A je v SQL, ne jen tady: deklarace v rosteru je
// vstup, o přidělení rozhoduje databáze při každém nasazení znovu.
//
// ⛔ PODMÍNKA „jen když nemá nárok z VAZBY" TU BĚŽELA A BYLA ODSTRANĚNA (týž den),
// protože stavěla na předpokladu, který měření vyvrátilo: potvrzená vazba
// účet↔dvojče NENÍ náhradní cesta. Ukazuje jen kroky, kde
// `input_data.authorized_twin_id` je TVOJE dvojče, nikdy kroky adresované ROLI, a
// na ratifikaci nálezů nemá vliv vůbec (`submit_evidence_review_audited` chce
// `is_admin_or_staff()` i pro `twin_identity`). Podmínka tedy uměla jen odebrat
// adresu někomu, kdo za to nedostal nic — a vypadala u toho promyšleně.
// Nepřidávat ji zpět bez měření, které ukáže, že vazba tu frontu nese.
//
// ⚠ Dnešní provoz na roli NESTOJÍ: `wf_my_steps` na poradě má v datech instance
// `all_assignees`, což je v predikátu bloku ANDováno s `is_admin_or_staff()`, takže
// správce frontu vidí i bez této role. Role zůstává jako ADRESA pro den, kdy bude
// existovat skutečný operátor, který admin NENÍ (řidič, kiosk) a má tu frontu
// dostat bez toho, aby dostal admina — rozhodnutí majitele 2026-09-28.
//
// ⚠ Co tohle NEŘEŠÍ: odebírání. Jednou přidělenou roli tenhle grant nesundá;
// to je věc autority rosteru, ne grantu.
export const RATIFIKACNI_ROLE = "production_operator";
const RATIFIKACNI_NAROK_ROLE = ["admin", "staff"];

/** Role bez podmínky × ta jediná podmíněná — rozdělení na JEDNOM místě. */
export function rozdelRole(roles = []) {
  const vsechny = (roles || []).map((r) => String(r));
  return {
    bezne: vsechny.filter((r) => r !== RATIFIKACNI_ROLE),
    ratifikace: vsechny.includes(RATIFIKACNI_ROLE),
  };
}

/**
 * Přidělí roster ratifikační roli? Vrací buď `sql` (podmíněný INSERT), nebo
 * `duvod`, proč se nepřiděluje — nikdy obojí.
 */
export function planRatifikaci(op) {
  const roles = (op.roles || []).map((r) => String(r));
  if (!roles.includes(RATIFIKACNI_ROLE)) return { duvod: "roster ji neuvádí" };
  if (!roles.some((r) => RATIFIKACNI_NAROK_ROLE.includes(r))) {
    return { duvod: `smí ji dostat jen ${RATIFIKACNI_NAROK_ROLE.join("/")}, roster uvádí [${roles.join(",")}]` };
  }
  const sub = sqlStr(op.sub);
  return {
    sql: `-- ${RATIFIKACNI_ROLE}: adresa fronty k odsouhlasování „pravdy" — smí ji dostat jen admin/staff
INSERT INTO public.user_roles (user_id, role, granted_by, granted_at)
SELECT ${sub}::uuid, ${sqlStr(RATIFIKACNI_ROLE)}::public.app_role, NULL, NOW()
WHERE EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = ${sub}::uuid
           AND ur.role IN (${RATIFIKACNI_NAROK_ROLE.map((r) => `${sqlStr(r)}::public.app_role`).join(", ")}))
ON CONFLICT (user_id, role) DO NOTHING;`,
  };
}

export function buildSql(resolved, revocations = []) {
  const lines = ["BEGIN;"];
  for (const op of resolved) {
    const { sub, email, displayName, language, roles } = op;
    lines.push(`-- ${email} → ${sub}`);
    lines.push(
      `INSERT INTO aisha_auth.users (id, email, raw_user_meta_data, created_at, updated_at)
VALUES (${sqlStr(sub)}, ${sqlStr(email)}, jsonb_build_object('display_name', ${sqlStr(displayName)}), NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();`,
    );
    lines.push(
      `INSERT INTO aisha_auth.identities (id, user_id, provider, provider_id, email, identity_data, created_at, updated_at)
VALUES (${sqlStr(sub)}, ${sqlStr(sub)}, 'keycloak', ${sqlStr(sub)}, ${sqlStr(email)}, jsonb_build_object('sub', ${sqlStr(sub)}, 'email', ${sqlStr(email)}), NOW(), NOW())
ON CONFLICT (provider, provider_id) DO UPDATE SET email = EXCLUDED.email, identity_data = EXCLUDED.identity_data, updated_at = NOW();`,
    );
    lines.push(
      `INSERT INTO public.profiles (user_id, display_name, preferred_language, created_at, updated_at)
VALUES (${sqlStr(sub)}, ${sqlStr(displayName)}, ${sqlStr(language || "en")}, NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;`,
    );
    // Role bez podmínky jdou hromadným INSERTem; ratifikační role má vlastní,
    // PODMÍNĚNÝ zápis (viz planRatifikaci) — a roster, který uvádí JEN ji,
    // nesmí vyrobit INSERT s prázdným VALUES.
    const { bezne, ratifikace } = rozdelRole(roles);
    if (bezne.length > 0) {
      const roleVals = bezne.map((r) => `(${sqlStr(sub)}, ${sqlStr(r)}::public.app_role, NULL, NOW())`).join(",\n  ");
      lines.push(
        `INSERT INTO public.user_roles (user_id, role, granted_by, granted_at) VALUES\n  ${roleVals}\nON CONFLICT (user_id, role) DO NOTHING;`,
      );
    }
    if (ratifikace) {
      const plan = planRatifikaci(op);
      if (plan.sql) {
        lines.push(plan.sql);
      } else {
        lines.push(`-- ⛔ ${RATIFIKACNI_ROLE} NEPŘIDĚLENO (${plan.duvod})`);
        process.stderr.write(`⚠ ${email}: ${RATIFIKACNI_ROLE} nepřidělen — ${plan.duvod}\n`);
      }
    }
  }
  // Roster jako autorita operátorských rolí: co u e-mailu neuvádí, se odebere
  // (viz planRevocations — jen deklarovaný soubor, jen operátorské role).
  for (const r of revocations) {
    const vals = r.roles.map((x) => `${sqlStr(x)}::public.app_role`).join(", ");
    lines.push(`-- ${r.email}: roster neuvádí ${r.roles.join(",")} → odebrat`);
    lines.push(`DELETE FROM public.user_roles WHERE user_id = ${sqlStr(r.sub)} AND role IN (${vals});`);
  }
  lines.push("COMMIT;");
  return lines.join("\n");
}

// Normalize `{operators:[]}` | `[]` into a plain array (both shapes are accepted
// wherever a roster is read, so the parsing lives in ONE place).
function asOperatorArray(parsed) {
  return Array.isArray(parsed) ? parsed : parsed?.operators || [];
}

// A roster's identity for comparison: lowercased email + its sorted roles.
// Emails alone would miss a role downgrade (admin→staff) between two sources.
function rosterFingerprint(operators) {
  return new Map(
    operators
      .filter((o) => o?.email)
      .map((o) => [String(o.email).toLowerCase(), [...(o.roles || [])].sort().join("+")]),
  );
}

// ── Operator roster — the DECLARED overlay wins over the env SNAPSHOT ─────────
// Source priority (real emails are PII, must not live in the public repo):
//   1. AISHA_OPERATORS_FILE — the DECLARED roster: operators.json in the PRIVATE
//      instance-data repo, exported from the overlay clone by
//      instance-data-hook.sh. Reviewed, merged, and re-read on every deploy.
//   2. AISHA_OPERATORS env (JSON: array or {operators:[]}) — a SNAPSHOT.
//      aisha-cold-start.sh writes it as the wipe-restore path for when the
//      overlay is unreachable, so it stays a full-value source on its own.
//   3. config/operators.json (gitignored, operator's local roster)
//   4. AISHA_PRIMARY_ADMIN_EMAIL alone (minimal: just the primary admin)
//   5. (in main) realm-role fallback — reconstructed from the live realm
// The committed config/operators.json.example (placeholders) is NEVER used.
//
// ⛔ WHY the file outranks the env (reversed 2026-08-07 after a measured
// incident on a live instance): AISHA_OPERATORS is frozen at cold-start, the
// overlay is not. With env-first, an operator added to operators.json and
// merged to main NEVER reached public.user_roles — the deploy re-cloned the
// overlay, exported the roster, then discarded it for a months-old snapshot,
// and reported "operator provisioning ok" with no warning (the missing person
// wasn't in the roster, so there was nothing to skip and nothing to log).
// The symmetric half matters just as much: while a stale snapshot can win,
// REMOVING somebody from the declared roster never takes effect either — the
// env resurrects them on every deploy. A declared roster has to be declarative
// in both directions.
//
// A disagreement between the two is reported LOUDLY but is NOT fatal: the
// migrate entrypoint treats provisioning as best-effort, so fail() here would
// not mean "stop and think", it would mean "nobody gets provisioned at all" —
// trading a visible conflict for a silent outage. We provision from the
// declared roster and put the diff where an operator will read it.
export function loadRoster() {
  // Read EVERY present source (not just the winner) — the winner-only `else if`
  // chain this replaced made a stale snapshot structurally undetectable.
  const sources = [];

  // Set-but-broken is FATAL (loud > silent) for both explicit sources: a set
  // path/JSON means the operator intended THIS roster — silently falling
  // through to another source would provision the wrong users.
  const rosterPath = process.env.AISHA_OPERATORS_FILE;
  if (rosterPath) {
    if (!fs.existsSync(rosterPath)) fail(`AISHA_OPERATORS_FILE points at a missing file: ${rosterPath}`);
    try {
      sources.push({ name: "AISHA_OPERATORS_FILE", detail: rosterPath, operators: asOperatorArray(JSON.parse(fs.readFileSync(rosterPath, "utf8"))) });
    } catch (e) {
      fail(`AISHA_OPERATORS_FILE (${rosterPath}) is not valid JSON: ${e.message}`);
    }
  }
  if (process.env.AISHA_OPERATORS) {
    try {
      sources.push({ name: "AISHA_OPERATORS", detail: "env JSON", operators: asOperatorArray(JSON.parse(process.env.AISHA_OPERATORS)) });
    } catch (e) {
      fail(`AISHA_OPERATORS is not valid JSON: ${e.message}`);
    }
  }
  if (sources.length === 0) {
    const cfgPath = path.join(ROOT, "config/operators.json");
    if (fs.existsSync(cfgPath)) {
      sources.push({ name: "config/operators.json", detail: cfgPath, operators: asOperatorArray(JSON.parse(fs.readFileSync(cfgPath, "utf8"))) });
    }
  }

  const winner = sources[0];
  let operators = winner ? winner.operators : [];

  // Which source won, and how big it is. Without this the migrate log said
  // "Provisioned N operator(s)" and nothing about WHERE the roster came from,
  // so a snapshot silently standing in for the overlay was invisible.
  if (winner) {
    process.stderr.write(`ℹ Roster source: ${winner.name} (${winner.detail}) — ${winner.operators.length} operator(s)\n`);
  }

  // Both explicit sources present → compare and report every disagreement.
  if (sources.length > 1) {
    const [win, other] = sources;
    const a = rosterFingerprint(win.operators);
    const b = rosterFingerprint(other.operators);
    const onlyInWinner = [...a.keys()].filter((e) => !b.has(e));
    const onlyInOther = [...b.keys()].filter((e) => !a.has(e));
    const roleDiff = [...a.keys()].filter((e) => b.has(e) && a.get(e) !== b.get(e));
    if (onlyInWinner.length || onlyInOther.length || roleDiff.length) {
      process.stderr.write(
        `⚠ ROSTER CONFLICT — ${win.name} (declared, WINS) vs ${other.name} (snapshot, IGNORED):\n` +
          (onlyInWinner.length ? `  only in ${win.name}: ${onlyInWinner.join(", ")}\n` : "") +
          (onlyInOther.length ? `  only in ${other.name}: ${onlyInOther.join(", ")} — these will NOT be provisioned\n` : "") +
          (roleDiff.length
            ? `  different roles: ${roleDiff.map((e) => `${e} (${win.name}=${a.get(e) || "-"} vs ${other.name}=${b.get(e) || "-"})`).join(", ")}\n`
            : "") +
          `  Fix the disagreement at its source: update operators.json in the instance-data repo, then drop the stale ${other.name}.\n`,
      );
    }
  }

  // Primary admin comes from env (its password is cold-start-generated, never
  // committed). Ensure it's in the roster with admin+staff, prepended.
  const primaryEmail = process.env.AISHA_PRIMARY_ADMIN_EMAIL;
  if (primaryEmail && !operators.some((o) => o.email?.toLowerCase() === primaryEmail.toLowerCase())) {
    operators.unshift({
      email: primaryEmail,
      username: process.env.AISHA_PRIMARY_ADMIN_USERNAME || primaryEmail.split("@")[0],
      displayName: process.env.AISHA_PRIMARY_ADMIN_NAME || "Primary Admin",
      language: "en",
      roles: ["admin", "staff"],
    });
  }
  return operators;
}

async function main() {
  let operators = loadRoster();
  // Auto-creation applies ONLY to an explicit roster (env/file/primary-admin):
  // the realm-role fallback below derives FROM the live realm, so by
  // construction there is never a missing user to create on that path.
  const rosterIsExplicit = operators.length > 0;
  const token = await kcAdminToken();

  // Zero-touch fallback: no explicit roster → reconstruct from realm roles. Keeps
  // a fresh --wipe clone (gitignored operators.json absent) from granting NOBODY DB
  // roles, without committing any PII — the realm JSON is the durable source.
  if (operators.length === 0) {
    process.stderr.write(
      `ℹ No explicit roster (AISHA_OPERATORS / AISHA_OPERATORS_FILE / config/operators.json / AISHA_PRIMARY_ADMIN_EMAIL).\n` +
        `  Reconstructing operators from Keycloak realm roles [${OPERATOR_REALM_ROLES.join(", ")}]…\n`,
    );
    operators = await rosterFromRealm(token);
  }

  if (operators.length === 0) {
    fail(
      "No operators. Provide AISHA_OPERATORS (JSON), AISHA_OPERATORS_FILE (path to a " +
        "roster JSON — e.g. the private instance-data repo's operators.json), or " +
        "config/operators.json (gitignored; copy from config/operators.json.example), " +
        "set AISHA_PRIMARY_ADMIN_EMAIL, " +
        "or assign the admin/staff realm role to operator accounts in Keycloak.",
    );
  }
  // Creation is a Keycloak MUTATION → never in the safe dry default (plain
  // invocation only prints SQL). It fires under --apply (cold-start migrate
  // path) or --create-only (host-side cold-start pass, prints temp passwords
  // in the operator's terminal).
  const canCreate = rosterIsExplicit && !NO_CREATE && (APPLY || CREATE_ONLY);
  const resolved = [];
  let createdCount = 0;
  for (const op of operators) {
    let hit = await resolveSub(token, op.email);
    if (!hit && canCreate) {
      hit = await createKcUser(token, op);
      if (hit) createdCount++;
    }
    if (!hit) {
      const why = NO_CREATE
        ? "creation disabled (--no-create / AISHA_OPERATORS_CREATE_MISSING=0) — create the account first"
        : canCreate
          ? "auto-create failed (see above) — create the account manually"
          : "dry mode — re-run with --apply or --create-only to auto-create";
      process.stderr.write(`⚠ ${op.email}: no Keycloak user (skipping — ${why})\n`);
      continue;
    }
    resolved.push({ ...op, sub: hit.sub });
    // Mutation modes also mirror admin/staff into KC realm roles so the token's
    // `roles` claim matches the DB grant (mobile Admin entry, realm fallback).
    if (APPLY || CREATE_ONLY) await ensureRealmRoles(token, hit.sub, op.roles);
    process.stderr.write(`✓ ${op.email} → ${hit.sub.slice(0, 12)}… roles=[${op.roles.join(",")}]\n`);
  }
  if (resolved.length === 0) fail("No operators resolved from Keycloak");

  // Roster jako autorita operátorských rolí — JEN deklarovaný soubor dat instance.
  // Snapshot v env i rekonstrukce z realmu jen přidávají (viz planRevocations).
  const declared = rosterIsExplicit && Boolean(process.env.AISHA_OPERATORS_FILE);
  let revocations = [];
  if (declared && !CREATE_ONLY) {
    try {
      revocations = planRevocations(resolved);
    } catch (e) {
      fail(String(e?.message || e));
    }
    for (const r of revocations) {
      process.stderr.write(`↓ ${r.email}: odebírám ${r.roles.join(",")} (roster je neuvádí)\n`);
    }
  } else if (APPLY) {
    process.stderr.write("ℹ Roster není deklarovaný soubor dat instance — operátorské role se jen přidávají, neodebírají.\n");
  }

  if (CREATE_ONLY) {
    process.stderr.write(
      `\n✅ Keycloak roster ensured — ${createdCount} user(s) created` +
        `${createdCount > 0 ? " (one-time temp passwords printed above — copy them now)" : ""}.\n`,
    );
    return;
  }

  if (AS_JSON) {
    process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
    return;
  }

  const sql = buildSql(resolved, revocations);
  if (!APPLY) {
    process.stdout.write(sql + "\n");
    process.stderr.write(`\nℹ Dry mode — printed SQL only. Re-run with --apply (needs AISHA_DB_URL) to execute.\n`);
    return;
  }

  const dbUrl = process.env.AISHA_DB_URL;
  if (!dbUrl) fail("--apply needs AISHA_DB_URL");
  // Keycloak dřív než DB: token nese realm role a záložní rekonstrukce rosteru
  // čte právě je. Když Keycloak odebrání odmítne, DB se nesnižuje (rozpor autorit
  // by byl horší než přebytečná role) — nahlas, a další nasazení to zkusí znovu.
  const neodebrano = [];
  for (const r of revocations) {
    if (!(await dropRealmRoles(token, r.sub, r.roles))) neodebrano.push(r.email);
  }
  if (neodebrano.length) fail(`Keycloak neodebral operátorské role u: ${neodebrano.join(", ")} — DB beze změny`);
  // Heslo prostředím, ne v argv — selhání by ho jinak vypsalo do výstupu, jehož
  // konec entrypoint ukládá do anon-čitelné migration_log_dump.
  const { cil, env } = psqlPripojeni(dbUrl);
  execFileSync("psql", [cil, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit", env });
  process.stderr.write(`\n✅ Provisioned ${resolved.length} operator(s).\n`);
}

// Run the CLI only when executed directly — the exported helpers above are
// imported by the gate suite (mock-fetch unit coverage) without side effects.
// isDirectRun (cli-entry.mjs): přes symlink se CLI dřív tiše přeskočilo.
const isMain = isDirectRun(import.meta.url);
if (isMain) main().catch((e) => fail(String(e?.message || e)));
