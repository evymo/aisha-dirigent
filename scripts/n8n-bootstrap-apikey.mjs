#!/usr/bin/env node
/**
 * n8n-bootstrap-apikey.mjs — headless n8n public-API-key minter (in-cluster).
 *
 * Runs ONLY in-cluster, from the n8n stack's one-shot `n8n-workflow-init`
 * container (Dockerfile.migrate image). It talks to n8n over the internal
 * Docker network at http://n8n:5678 — NEVER through the oauth2-proxy edge — so
 * no skip-auth route is ever opened for key creation.
 *
 * Mechanism (verified against n8n@1.79.0 source):
 *   1. POST /rest/owner/setup {email,firstName,lastName,password}
 *      — the ONE skipAuth /rest route; promotes the pre-seeded global:owner
 *        shell user and returns Set-Cookie: n8n-auth=<sessionJWT> DIRECTLY.
 *      — on a fresh `--wipe` the n8n DB is empty, so this claims ownership and
 *        hands us a session cookie in one shot.
 *      — on a NON-wipe redeploy the owner is already set up and this answers
 *        400/404; we then LOG IN as that owner (POST /rest/login) with the
 *        same password and mint the key from that session.
 *
 *      ⛔ NAMĚŘENO (RIQ 2026-09-07, guru 2026-09-18): heslo vlastníka bylo
 *      NÁHODNÉ A ZAHOZENÉ. Klíč tak vznikl jen při prvním nasazení; každé další
 *      skončilo „owner already set up" bez klíče, pověření ani workflowy se
 *      nedoručily a z uličky vedl jen ruční `n8n user-management:reset`.
 *      ⭐ Heslo je proto DEKLAROVANÉ TAJEMSTVÍ platformy (generate-secrets →
 *      .env.coolify → kontrakt env-doktora → compose initu), stejným řetězcem
 *      jako N8N_ENCRYPTION_KEY, které je silnější. Nikdy se neloguje a bez něj
 *      bootstrap NAHLAS selže — náhodné heslo by uličku vyrobilo znovu.
 *   2. POST /rest/api-keys {label} with that cookie → response.data.rawApiKey
 *      (the USABLE key; the `apiKey` field is redacted). This route is NOT
 *      skipAuth — it needs the session cookie, so it stays oauth2-protected at
 *      the edge and is only reachable in-cluster. An existing key with our
 *      label is deleted first so a re-run mints a fresh, working key.
 *
 * The raw key is written to --out (default /run/n8n/apikey, tmpfs) for the
 * deploy step and is NEVER logged (we log lengths/booleans only, like
 * docker-migrate-entrypoint.sh).
 *
 * Usage: node scripts/n8n-bootstrap-apikey.mjs [--out <path>]
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isDirectRun } from "./lib/cli-entry.mjs";
import { authCookie, hesloVlastnika, prihlasVlastnika as prihlas } from "./n8n/relace-vlastnika.mjs";

export { hesloVlastnika };

const REST = (process.env.N8N_REST_URL || "http://n8n:5678").replace(/\/+$/, "");
const LABEL = process.env.N8N_BOOTSTRAP_KEY_LABEL || "aisha-cold-start";
const OUT =
  (process.argv.includes("--out") && process.argv[process.argv.indexOf("--out") + 1]) ||
  process.env.N8N_APIKEY_OUT ||
  "/run/n8n/apikey";

// Owner identity. Email is an account label (the external n8n access goes via
// oauth2-proxy/Keycloak, never this login); the password is a platform secret.
const OWNER = {
  email: process.env.N8N_BOOTSTRAP_OWNER_EMAIL || "n8n-owner@aisha.local",
  firstName: process.env.N8N_BOOTSTRAP_OWNER_FIRST_NAME || "AISHA",
  lastName: process.env.N8N_BOOTSTRAP_OWNER_LAST_NAME || "Bootstrap",
};

const log = (msg) => console.log(`[n8n-bootstrap] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Čeká, až n8n obslouží REST, ne jen healthcheck.
 *
 * ⛔ ZDRAVÝ ≠ PŘIPRAVENÝ (naměřeno 2026-09-30 na riq po redeployi n8n): init
 * běžel ~10 s po startu n8n, `/healthz` už odpovídal 200, ale REST trasy ještě
 * nebyly zaregistrované — `/rest/owner/setup` i `/rest/login` vracely 404.
 * U setupu je 404 zároveň signál „vlastník už je nastavený“ (n8n tu trasu po
 * dokončeném setupu odstraní, viz `claimOwnerSession`), takže se neoznačený
 * start vyložil jako hotová instance a přihlášení pak padlo. Bez klíče se
 * nedoručila pověření ani workflowy; pomohlo až ruční spuštění initu znovu.
 *
 * `/rest/settings` je veřejná trasa téhož REST routeru: 200 znamená, že trasy
 * jsou nahoře a 404 u setupu už nese jen svůj skutečný význam.
 */
async function waitForRest() {
  for (let i = 1; i <= 60; i++) {
    try {
      const res = await fetch(`${REST}/rest/settings`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        log(`n8n REST připravený (/rest/settings 200 po ${i}. pokusu)`);
        return;
      }
      if (i % 6 === 0) log(`čekám na n8n /rest/settings (pokus ${i}): HTTP ${res.status}`);
    } catch (e) {
      if (i % 6 === 0) log(`čekám na n8n /rest/settings (pokus ${i}): ${e.name}`);
    }
    await sleep(5000);
  }
  throw new Error(`n8n REST nepřipravený: ${REST}/rest/settings neodpověděl 200 do 5 min`);
}

async function postJson(path, body, cookie) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;
  return fetch(`${REST}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
}

/**
 * Claim the seeded global:owner on a fresh instance and return its session
 * cookie. Returns null if the owner is already set up (non-wipe redeploy).
 */
async function claimOwnerSession(heslo) {
  const setup = await postJson("/rest/owner/setup", {
    email: OWNER.email,
    firstName: OWNER.firstName,
    lastName: OWNER.lastName,
    password: heslo,
  });
  const cookie = authCookie(setup);
  if (setup.ok && cookie) {
    log("ownership claimed via /rest/owner/setup (fresh instance)");
    return cookie;
  }
  // ⛔ 404 PATŘÍ SEM STEJNĚ JAKO 400. Naměřeno na n8n 1.79.0: po dokončeném
  // setupu n8n tu routu ODSTRANÍ, takže odpoví `404 Cannot POST
  // /rest/owner/setup`. Původní podmínka znala jen 400, takže tenhle stav
  // spadl do FATAL — a entrypoint ho spolkl `exit 0`.
  if (setup.status === 400 || setup.status === 404) {
    log(`owner already set up (HTTP ${setup.status}) — přihlašuji se jako vlastník`);
    return null;
  }
  const text = await setup.text().catch(() => "");
  throw new Error(`/rest/owner/setup failed: ${setup.status} ${text.slice(0, 200)}`);
}

/** Existující instance: session vlastníka přihlášením (sdílená relace-vlastnika.mjs). */
async function prihlasVlastnika(heslo) {
  const cookie = await prihlas({ rest: REST, email: OWNER.email, heslo });
  log("přihlášen jako vlastník přes /rest/login (existující instance)");
  return cookie;
}

async function ensureApiKey(cookie) {
  // Delete any pre-existing key with our label so the mint is repeatable.
  try {
    const list = await fetch(`${REST}/rest/api-keys`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(30000),
    });
    if (list.ok) {
      const body = await list.json();
      const keys = body?.data ?? body ?? [];
      for (const k of Array.isArray(keys) ? keys : []) {
        if (k?.label === LABEL && k?.id) {
          await fetch(`${REST}/rest/api-keys/${k.id}`, {
            method: "DELETE",
            headers: { Cookie: cookie },
            signal: AbortSignal.timeout(30000),
          });
          log(`removed stale key '${LABEL}' for idempotent re-mint`);
        }
      }
    }
  } catch (e) {
    log(`existing-key cleanup skipped (best-effort): ${e.name}`);
  }

  const res = await postJson("/rest/api-keys", { label: LABEL, expiresAt: null }, cookie);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /rest/api-keys failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const raw = body?.data?.rawApiKey ?? body?.rawApiKey ?? null;
  if (!raw) throw new Error("api-keys response had no rawApiKey field");
  return raw;
}

export async function main() {
  const heslo = hesloVlastnika(process.env.N8N_BOOTSTRAP_OWNER_PASSWORD);
  log(`target=${REST} label=${LABEL} ownerEmailLen=${OWNER.email.length} ownerPasswordLen=${heslo.length}`);
  await waitForRest();
  const cookie = (await claimOwnerSession(heslo)) ?? (await prihlasVlastnika(heslo));
  const rawKey = await ensureApiKey(cookie);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, rawKey, { mode: 0o600 });
  log(`minted api key (len=${rawKey.length}) → ${OUT}`);
}

if (isDirectRun(import.meta.url)) {
  main().catch((e) => {
    console.error(`[n8n-bootstrap] FATAL: ${e.message}`);
    process.exit(1);
  });
}
