/**
 * Tenant / PII leak detection for the public repo — WITHOUT naming any real
 * tenant.
 *
 * A hardcoded denylist of real customer names, committed to a PUBLIC repo, is
 * itself a disclosure: it enumerates exactly who the tenants are — the very
 * thing the gate exists to prevent. So this module detects leakage two ways,
 * neither of which names a real tenant in the tree:
 *
 *   1. STRUCTURAL (always on, public-safe): by SHAPE, using only NON-sensitive
 *      allowlists (fictional placeholders, the platform's own product identity,
 *      canonical infra). A shipped Keycloak client outside the platform set, an
 *      email domain outside the safe set, or a seed compiled from a non public
 *      profile is flagged — no tenant name required.
 *
 *   2. EXACT-NAME (optional, operator-supplied): a private sentinel list from
 *      the gitignored `config/tenant.json` (`{ "sentinels": [...] }`) or the
 *      `AISHA_TENANT_SENTINELS` env var. Present on operator/CI hosts that hold
 *      the real roster; ABSENT in the public repo and in forks, where the
 *      structural layer alone applies. This is the team's planned
 *      `config/tenant.json` externalization (see legacy-domains gate).
 *
 * "Lose nothing": operators keep exact detection via the private list; the
 * public tree keeps structural detection; no real tenant name lives in git.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/**
 * Safe email / URL domains — NONE sensitive. Fictional placeholders (RFC 2606 +
 * the conventional `acme`/`globex` example forks), the platform's own product
 * domain, canonical infra, and dev tools referenced in the shipped realm.
 * Matched as exact or dot-suffix (so `x.aisha.guru` ⊆ `aisha.guru`). A tenant on
 * an infra subdomain (e.g. `<tenant>.id3a.cz`) is covered by the KC-client and
 * private-sentinel layers instead — this layer targets EXTERNAL tenant domains.
 */
export const SAFE_DOMAINS = [
  // fictional placeholders
  "example.com", "example.org", "example.net", "example.edu", "example.invalid",
  "acme.com", "acme.internal", "globex.com",
  // generic seed placeholder (support@platform.com in the baseline seed)
  "platform.com",
  // reserved / loopback names
  "localhost", "invalid", "test", "local", "system.local",
  // platform / product
  "aisha.guru", "aisha.internal",
  // canonical infra
  "id3a.cz",
  // dev tools referenced in keycloak/aisha-realm.json
  "vscode.dev",
];

/**
 * The platform's OWN Keycloak clients (product, never a tenant) plus Keycloak's
 * built-in clients. A client in the shipped realm outside this set is an
 * instance's OIDC client that belongs in its private overlay.
 */
export const PLATFORM_KC_CLIENTS = [
  // platform clients (keycloak/aisha-realm.json)
  "aisha-app", "aisha-bootstrap", "aisha-dirigent-device", "aisha-pki-bootstrap",
  // aisha-pki-issuer: every instance needs it — the renewer authenticates with it
  // to issue that instance's own mesh certs. Platform, not tenant.
  "aisha-pki-issuer",
  // aisha-user-admin: servisní účet, kterým administrace zakládá uživatele
  // (gateway POST /admin/users/invite). Potřebuje ho KAŽDÁ instance, která
  // pouští lidi dovnitř heslem — platformní, ne tenantský.
  "aisha-user-admin",
  "appsmith-intranet-proxy", "appsmith-proxy", "langfuse", "n8n-proxy",
  "netbird", "netbird-backend", "nocodb-proxy", "openclaw-proxy", "pki-proxy", "studio-proxy",
  // extranet-proxy: oauth2-proxy před extranetem, aby se bundle nevydal
  // nepřihlášenému. Extranet je platformní povrch (workbench shell nad
  // surface_blocks), ne tenantská appka — klienta potřebuje každá instance,
  // která extranet zapne. Táž kategorie jako studio-proxy nebo n8n-proxy.
  "extranet-proxy",
  // Keycloak built-ins
  "account", "account-console", "admin-cli", "broker", "realm-management",
  "security-admin-console",
];

/** Seed profiles that are safe to ship in the public repo. */
export const PUBLIC_SAFE_SEED_PROFILES = ["platform", "demo", "core"];

const EMAIL_RE = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi;

function domainAllowed(domain: string): boolean {
  const d = domain.toLowerCase().replace(/\.+$/, "");
  return SAFE_DOMAINS.some((s) => d === s || d.endsWith("." + s));
}

/**
 * Email addresses in `content` whose domain is not on the safe allowlist — the
 * low-noise structural signal for operator/customer PII. We deliberately do NOT
 * scan bare http(s) URLs: curated artifacts legitimately cite third-party
 * endpoints (AI providers, github, package registries) and prose docs cite many
 * more, so URL-domain scanning is pure noise. Tenant DOMAINS (e.g. an external
 * project's `*.com`) are caught by the exact private-sentinel layer instead —
 * `privateSentinelHits` substring-matches "acme"/"acme.example.com" inside a URL
 * just as well as inside an email.
 */
export function findLeakedIdentities(content: string): string[] {
  const hits = new Set<string>();
  for (const m of content.matchAll(EMAIL_RE)) {
    if (!domainAllowed(m[1])) hits.add(m[0]);
  }
  return [...hits];
}

/** clientIds present in a Keycloak realm export that are not platform clients. */
export function nonPlatformKcClients(realmContent: string): string[] {
  let realm: unknown;
  try {
    realm = JSON.parse(realmContent);
  } catch {
    return [];
  }
  const clients = (realm as { clients?: Array<{ clientId?: string }> })?.clients;
  if (!Array.isArray(clients)) return [];
  return clients
    .map((c) => c?.clientId)
    .filter((id): id is string => typeof id === "string" && !PLATFORM_KC_CLIENTS.includes(id));
}

/** The `-- Profile: X` header written by compile-seed.mjs, lowercased. */
export function seedProfile(content: string): string | null {
  const m = content.match(/^--\s*Profile:\s*(\S+)/im);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Operator-supplied exact tenant names — from `config/tenant.json`
 * (`{ "sentinels": [...] }`, gitignored) and the `AISHA_TENANT_SENTINELS` env
 * var (comma/space separated). Empty in the public repo and in forks. Never
 * committed.
 */
export function loadTenantSentinels(): string[] {
  const out: string[] = [];
  const env = process.env.AISHA_TENANT_SENTINELS;
  if (env) out.push(...env.split(/[\s,]+/));
  const p = join(ROOT, "config/tenant.json");
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as { sentinels?: unknown };
      if (Array.isArray(j.sentinels)) out.push(...j.sentinels.map(String));
    } catch {
      /* malformed private config → ignore; the structural layer still applies */
    }
  }
  return [...new Set(out.map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

/** Case-insensitive substring hits of `sentinels` in `content`. */
export function privateSentinelHits(content: string, sentinels: string[]): string[] {
  const lc = content.toLowerCase();
  return sentinels.filter((s) => lc.includes(s));
}
