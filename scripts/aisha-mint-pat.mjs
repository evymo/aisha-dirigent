#!/usr/bin/env node
/**
 * aisha-mint-pat — self-service Personal Access Token (PAT) minting for the AISHA Omni /v1
 * model endpoint (IDE napoj). A KC-authenticated developer mints a token bound to THEIR OWN
 * identity, scoped to a story they can access, then points any editor at <your AISHA>/v1
 * (default: the local stack gateway, config/local-presets.mjs getLocalGatewayUrl).
 *
 * Auth: the caller's KC access token (JWT). Resolution order:
 *   1. --token <jwt>            (explicit)
 *   2. $AISHA_ACCESS_TOKEN / $AISHA_KEYCLOAK_ACCESS_TOKEN
 *   3. .aisha/dirigent.local.json → profiles[active].accessToken
 * The token is sent as `Authorization: Bearer <jwt>` to PostgREST rpc/create_mcp_token, which
 * (post 2026-07-07 relax) lets an authenticated user mint their own story-scoped token.
 *
 * Usage:
 *   node scripts/aisha-mint-pat.mjs --story <uuid> [--scope story] [--expires-days 90]
 *        [--rpm 60] [--daily 1000] [--api <AISHA API base>] [--token <jwt>]
 *
 * On success prints the raw `mcp_…` token ONCE plus the ready-to-paste editor napoj recipe.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
/** Gateway of the local stack — one home for that address: config/local-presets.mjs. */
async function localApiBase() {
  const { getLocalGatewayUrl } = await import("../config/local-presets.mjs");
  return getLocalGatewayUrl().replace(/\/$/, "");
}
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const has = (name) => argv.includes(`--${name}`);

function resolveToken() {
  const explicit = arg("token");
  if (explicit) return explicit;
  for (const k of ["AISHA_ACCESS_TOKEN", "AISHA_KEYCLOAK_ACCESS_TOKEN", "AISHA_CLIENT_TOKEN"]) {
    if (process.env[k]) return process.env[k];
  }
  const local = join(ROOT, ".aisha", "dirigent.local.json");
  if (existsSync(local)) {
    try {
      const cfg = JSON.parse(readFileSync(local, "utf8"));
      const p = cfg.profiles?.[cfg.activeProfile];
      if (p?.accessToken) return p.accessToken;
    } catch (e) {
      console.warn("⚠ aisha-mint-pat: skipping unreadable config — " + (e && e.message ? e.message : String(e)));
    }
  }
  return null;
}

function resolveApiBase() {
  const explicit = arg("api");
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.AISHA_API_BASE_URL) return process.env.AISHA_API_BASE_URL.replace(/\/$/, "");
  const local = join(ROOT, ".aisha", "dirigent.local.json");
  const tmpl = join(ROOT, ".aisha", "dirigent.template.json");
  for (const f of [local, tmpl]) {
    if (!existsSync(f)) continue;
    try {
      const cfg = JSON.parse(readFileSync(f, "utf8"));
      const p = cfg.profiles?.[cfg.activeProfile];
      const url = p?.aishaUrl;
      if (url) return url.replace(/\/$/, "");
    } catch (e) {
      console.warn("⚠ aisha-mint-pat: skipping unreadable config — " + (e && e.message ? e.message : String(e)));
    }
  }
  return null; // → local stack gateway (resolved asynchronously below)
}

const story = arg("story");
// Editor base URL for the recipe: explicit flag, else env, else the API base
// itself (the gateway serves /v1) — never a hosted instance.
const modelBaseArg = arg("model-base", process.env.AISHA_MODEL_BASE_URL || "");
if (has("help") || !story) {
  console.log(`aisha-mint-pat — mint a self-service PAT for the AISHA Omni /v1 endpoint

  --story <uuid>       (required) story to scope the token to (must be one you can access)
  --scope story|chat   (default: story)
  --expires-days 90    (self-service cap: 90)   --rpm 60 (cap 120)   --daily 1000 (cap 5000)
  --api <url>          AISHA core API base (default: $AISHA_API_BASE_URL / .aisha profile / local stack gateway)
  --token <jwt>        your KC access token (else $AISHA_ACCESS_TOKEN / .aisha config)
  --model-base <url>   editor base URL to print in the recipe (default: $AISHA_MODEL_BASE_URL / the API base)`);
  process.exit(story ? 0 : 1);
}

const token = resolveToken();
if (!token) {
  console.error("✗ No KC access token. Pass --token <jwt> or set $AISHA_ACCESS_TOKEN (log in via Keycloak first).");
  process.exit(2);
}
const apiBase = resolveApiBase() ?? (await localApiBase());
const modelBase = (modelBaseArg || apiBase).replace(/\/$/, "");

const body = {
  p_scope: arg("scope", "story"),
  p_scoped_to_story_id: story,
  p_rate_limit_rpm: Number(arg("rpm", "60")),
  p_rate_limit_daily: Number(arg("daily", "1000")),
  p_expires_in_days: Number(arg("expires-days", "90")),
};

const res = await fetch(`${apiBase}/rest/v1/rpc/create_mcp_token`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    // PostgREST needs an apikey header too; the JWT doubles as it for a KC-fronted PostgREST.
    apikey: process.env.AISHA_ANON_KEY || token,
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(20000),
}).catch((e) => ({ ok: false, _err: String(e) }));

if (!res.ok) {
  const detail = res._err || (await res.text().catch(() => "")) || `HTTP ${res.status}`;
  console.error(`✗ Mint failed: ${String(detail).slice(0, 300)}`);
  console.error("  (403/42501 → you lack access to that story, or the admin-gate relax isn't deployed yet.)");
  process.exit(3);
}
const out = await res.json();
const raw = out?.raw_token || out?.[0]?.raw_token;
if (!raw) {
  console.error("✗ No raw_token in response:", JSON.stringify(out).slice(0, 300));
  process.exit(4);
}

console.log(`✅ PAT minted (store it now — shown ONCE):\n`);
console.log(`   ${raw}\n`);
console.log(`── Napoj recipe (paste into your editor / shell) ──`);
console.log(`   export ANTHROPIC_BASE_URL=${modelBase}`);
console.log(`   export ANTHROPIC_API_KEY=${raw}`);
console.log(`   # or OpenAI SDK:  OPENAI_BASE_URL=${modelBase}/v1  OPENAI_API_KEY=${raw}`);
console.log(`   # then: claude   (all LLM calls now route through AISHA — dynamic per-task model select)`);
