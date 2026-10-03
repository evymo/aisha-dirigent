#!/usr/bin/env node
/**
 * verdaccio-mint-token.mjs — mint a fresh Verdaccio auth token from a stored
 * username+password, instead of pasting a long-lived token that silently
 * EXPIRES (Verdaccio signs API tokens with `jwt.sign.expiresIn: 30d`; a static
 * VERDACCIO_TOKEN in the vault breaks publishing every 30 days — incident
 * 2026-06-13). Cold-start and CI call this so the publish token is GENERATED
 * fresh each run — never hardcoded, never stale.
 *
 * Reads (env, no hardcoded host):
 *   VERDACCIO_URL        required — registry base URL (e.g. https://npm.example.com)
 *   VERDACCIO_USER       optional — htpasswd user with publish rights
 *   VERDACCIO_PASSWORD   optional — that user's password
 *
 * Behaviour (backward compatible):
 *   - USER or PASSWORD missing → prints NOTHING, exits 0. The caller keeps its
 *     existing static VERDACCIO_TOKEN (the legacy path; logs a hint to stderr).
 *   - both present → npm/couchdb login (PUT /-/user/org.couchdb.user:<user>);
 *     on success prints ONLY the token to stdout (caller captures it); any
 *     failure exits non-zero with a redacted error (loud > silent).
 *   - `--check` also verifies the minted token via /-/whoami before printing.
 *
 * Usage:
 *   TOKEN=$(node scripts/verdaccio-mint-token.mjs)   # empty if no user/pass
 *   node scripts/verdaccio-mint-token.mjs --check
 *
 * Credentials are never printed; only the resulting token goes to stdout.
 * @module
 */

const args = process.argv.slice(2);
const CHECK = args.includes("--check");

const URL_RAW = (process.env.VERDACCIO_URL || "").replace(/\/+$/, "");
const USER = process.env.VERDACCIO_USER || "";
const PASSWORD = process.env.VERDACCIO_PASSWORD || "";

function die(msg) {
  process.stderr.write(`[verdaccio-mint] ERROR: ${msg}\n`);
  process.exit(1);
}

// No user/pass → no-op (legacy static-token path stays in effect).
if (!USER || !PASSWORD) {
  process.stderr.write(
    "[verdaccio-mint] VERDACCIO_USER/VERDACCIO_PASSWORD not set — skipping mint " +
      "(caller keeps existing VERDACCIO_TOKEN). Set both in the vault for auto-refresh.\n",
  );
  process.exit(0);
}
if (!URL_RAW) die("VERDACCIO_URL not set");

async function main() {
  // Verdaccio WEB login: POST /-/verdaccio/sec/login {username,password} → {token}.
  // NOT the npm/couchdb `PUT /-/user/org.couchdb.user:<user>` path — that one is
  // the REGISTRATION endpoint and Verdaccio rejects it with HTTP 409 "user
  // registration disabled" whenever `auth.htpasswd.max_users: -1` (our prod
  // config), even for an existing user. The web-login endpoint authenticates
  // existing htpasswd users regardless of max_users and returns a JWT carrying
  // the $authenticated group required by `publish: $authenticated`.
  // (Verified 2026-06-13 against verdaccio:6.5.2 with max_users:-1.)
  const loginUrl = `${URL_RAW}/-/verdaccio/sec/login`;
  let res;
  try {
    res = await fetch(loginUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: USER, password: PASSWORD }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    die(`login request to registry failed: ${e.message}`);
  }

  const bodyText = await res.text();
  if (res.status !== 201 && res.status !== 200) {
    // 401 = bad credentials; 4xx body usually carries the reason.
    die(
      `registry login HTTP ${res.status} for user '${USER}' ` +
        `(check VERDACCIO_USER/PASSWORD + that the user has publish rights). ` +
        `Body: ${bodyText.slice(0, 160)}`,
    );
  }

  let token;
  try {
    token = JSON.parse(bodyText).token;
  } catch (e) {
    die(
      `registry returned non-JSON login response (${e instanceof Error ? e.message : String(e)}): ` +
        bodyText.slice(0, 160),
    );
  }
  if (!token) die("registry login succeeded but returned no token");

  if (CHECK) {
    let who;
    try {
      who = await fetch(`${URL_RAW}/-/whoami`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      die(`whoami verification request failed: ${e.message}`);
    }
    if (!who.ok) die(`minted token failed /-/whoami (HTTP ${who.status})`);
    const username = (await who.json()).username;
    if (username !== USER) {
      die(`minted token authenticates as '${username}', expected '${USER}'`);
    }
    process.stderr.write(`[verdaccio-mint] OK — token verified as user '${USER}'\n`);
  }

  // ONLY the token on stdout — caller does VERDACCIO_TOKEN=$(node ...).
  process.stdout.write(token);
}

main();
