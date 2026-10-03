/**
 * "AISHA as a model" public face gate — the CORRECTED (Pattern-2) wiring.
 *
 * Design (docs/planning/AISHA_OMNI_GATEWAY.md §2/§3): the public IDE model
 * endpoint is a DISTINCT host ask.<public_tld>/v1 (ANTHROPIC_BASE_URL) that fronts
 * the GOVERNED Omni /v1 facade in svc-ai-chat (auth→story-bind→admit→CLOW dynamic
 * model-select). CRITICALLY, svc-ai-chat is an INTERNAL service: it must NOT carry
 * its own public Traefik router / Let's-Encrypt cert (public TLS terminates upstream
 * at pfSense/HAProxy). The public /v1 edge is @aisha/gateway (the core gateway),
 * which STREAMING-proxies /v1/* to svc-ai-chat:3011 — never the buffering
 * functions.ts pattern.
 *
 * This gate locks the corrected mechanism so a refactor cannot silently:
 *   - give svc-ai-chat a public Traefik router / LE cert again (the #613 mistake),
 *   - repoint the public face at the bare llm-gateway passthrough,
 *   - route /v1 through the buffering functions.ts lane (breaks SSE), or
 *   - drop the core-gateway /v1 streaming proxy.
 */

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const SERVICES = join(ROOT, "config/services.json");
const AI_CHAT_COMPOSE = join(ROOT, "docker-compose.coolify-ai-chat.yml");
const GW_V1_ROUTE = join(ROOT, "services/gateway/src/routes/v1.ts");
const GW_SERVER = join(ROOT, "services/gateway/src/server.ts");

// Reference public TLD — same source the resolver falls back to (keeps the gate
// in lock-step with the .example instead of hardcoding a domain).
const REF_PUBLIC_TLD = JSON.parse(
  readFileSync(join(ROOT, "config/profiles/cloud-multi.json.example"), "utf-8"),
).domain.public_tld as string;

/** Emitted shell env (KEY=VALUE) from the resolver for a profile. */
function shellEnv(profileId: string): Record<string, string> {
  const out = execFileSync("node", [DERIVE, `--profile=${profileId}`, "--shell"], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

describe("AISHA-as-a-model face — ask.<public_tld>/v1 via the core gateway", () => {
  test("catalog: svc-ai-chat is internal-only (no public face); llm-gateway is internal-only", () => {
    const cat = JSON.parse(readFileSync(SERVICES, "utf-8")).services;
    // svc-ai-chat carries NO public face — it is reached only by the core gateway
    // over the shared network. A public subdomain here would be the #613 mistake.
    // Testuje se VLASTNOST (žádná veřejná URL), ne PRAVOPIS (subdomain === null).
    // Riziko je veřejné vystavení, a to hlídá `public:false` níž — subdomain sám
    // o sobě dává jen vnitřní/mesh jméno, které je naopak žádoucí: bez něj je
    // služba dosažitelná pouze container aliasem na ploché síti, tedy tím, co se
    // segmentací zavírá. Připnuté `null` tak bránilo správné změně a nechránilo
    // před špatnou (public:true se subdomain=null by veřejnou tvář stejně nedalo,
    // ale public:true s jakoukoli subdoménou ano — a to test nezachytával).
    expect(cat["ai-chat"].public, "ai-chat must be public:false — jinak by subdoména vytvořila veřejnou tvář").toBe(false);
    expect(cat["ai-chat"].public, "ai-chat must be public:false").toBe(false);
    // llm-gateway stays deployed as an internal backend (role 2 CLOW / role 3
    // batches) — never a public face.
    expect(cat["llm-gateway"], "llm-gateway must remain in the catalog").toBeDefined();
    expect(cat["llm-gateway"].public, "llm-gateway must NOT be a public face").toBe(false);
  });

  test("resolver: the public model face is ask.<tld> and routes via the CORE gateway", () => {
    const env = shellEnv("cloud-multi");
    // Public host is the distinct 'ask' face (NOT 'gateway', NOT the sentinel).
    expect(env.GATEWAY_DOMAIN_PUBLIC, "model public face must be ask.<public_tld>").toBe(
      `ask.${REF_PUBLIC_TLD}`,
    );
    // Its upstream is the CORE gateway (== the api face) — svc-ai-chat is reached
    // via the gateway's streaming /v1 proxy, NOT a per-service Traefik host.
    expect(env.GATEWAY_UPSTREAM_PUBLIC, "model upstream must be the core gateway (api face)").toBe(
      env.API_UPSTREAM_PUBLIC,
    );
    // …and NOT a svc-ai-chat 'aichat' backend face (that was the #613 mistake).
    expect(env.GATEWAY_UPSTREAM_PUBLIC, "must NOT front a svc-ai-chat backend host").not.toMatch(
      /\/\/aichat\./,
    );
    // llm-gateway's own internal domain still exists (role 2/3 intact).
    expect(env.GATEWAY_DOMAIN, "llm-gateway internal GATEWAY_DOMAIN must still exist").toMatch(
      /^gateway\./,
    );
  });

  test("security: svc-ai-chat carries NO public Traefik router / LE cert", () => {
    const compose = readFileSync(AI_CHAT_COMPOSE, "utf-8");
    // The #613 mistake: a public router with certresolver=letsencrypt on the
    // internal service. None of these may appear.
    expect(compose, "no Traefik router labels on svc-ai-chat").not.toMatch(/traefik\.http\.routers/);
    expect(compose, "no Traefik Host() rule on svc-ai-chat").not.toMatch(/Host\(`/);
    expect(compose, "no Let's-Encrypt cert on svc-ai-chat").not.toMatch(/certresolver|letsencrypt/i);
    expect(compose, "no traefik.enable on svc-ai-chat").not.toMatch(/traefik\.enable/);
  });

  test("mechanism: the core gateway has a STREAMING /v1 proxy to svc-ai-chat", () => {
    expect(existsSync(GW_V1_ROUTE), "services/gateway/src/routes/v1.ts must exist").toBe(true);
    const v1 = readFileSync(GW_V1_ROUTE, "utf-8");
    // Streaming proxy (reply-from), NOT the buffering functions.ts arrayBuffer pattern.
    expect(v1, "must use @fastify/http-proxy (streaming)").toMatch(/@fastify\/http-proxy/);
    // No actual buffering CALL (a `.arrayBuffer(` invocation) — the doc comment may
    // still name arrayBuffer() to explain why the buffering functions.ts pattern is avoided.
    expect(v1, "must NOT buffer the upstream (no .arrayBuffer() call)").not.toMatch(/\.arrayBuffer\s*\(/);
    // Fronts svc-ai-chat, preserving the /v1 path.
    expect(v1, "must proxy to svc-ai-chat via config.aiChatUrl").toMatch(/config\.aiChatUrl/);
    expect(v1, "must preserve the /v1 path (rewritePrefix)").toMatch(/rewritePrefix:\s*['"]\/v1['"]/);
    // Registered at prefix '/v1' in the gateway server.
    const server = readFileSync(GW_SERVER, "utf-8");
    expect(server, "omniV1Proxy must be registered at prefix '/v1'").toMatch(
      /register\(\s*omniV1Proxy\s*,\s*\{\s*prefix:\s*['"]\/v1['"]/,
    );
  });
});
