/**
 * n8n API-key bootstrap gate
 *
 * Locks the security + wiring contract of the FULLY AUTOMATED, in-cluster n8n
 * public-API-key provisioning (cold-start full-automation):
 *
 *   - n8n 1.79 blocks programmatic public-API-key creation from OUTSIDE. The
 *     supported headless mint (/rest/owner/setup → /rest/api-keys) is reached
 *     ONLY on the internal Docker network at http://n8n:5678 — never through
 *     the n8n-auth (oauth2-proxy) edge. So the key-minting endpoints MUST NOT
 *     appear in OAUTH2_PROXY_SKIP_AUTH_ROUTES (that would let anyone mint a key
 *     / claim ownership). This complements oauth2-proxy-config.gate.test.ts.
 *   - The one-shot bootstrap runs in `n8n-workflow-init` (reusing the migrate
 *     image), depends_on n8n healthy, on the internal network only.
 *   - No owner credentials or API keys are committed (runtime-only material).
 *
 * Runs via: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { naSiti, reHost, sitiSluzby } from "./lib/vnitrni-adresa";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

const N8N_COMPOSE = "docker-compose.coolify-n8n.yml";
const BOOTSTRAP = "scripts/n8n-bootstrap-apikey.mjs";
const ENTRYPOINT = "scripts/n8n-deploy-entrypoint.sh";
const RELACE = "scripts/n8n/relace-vlastnika.mjs";

describe("n8n API-key bootstrap (security + wiring gate)", () => {
  test("the in-cluster bootstrap scripts exist and are non-empty", () => {
    for (const rel of [BOOTSTRAP, ENTRYPOINT]) {
      expect(existsSync(join(ROOT, rel)), `missing ${rel}`).toBe(true);
      expect(read(rel).length, `${rel} is empty`).toBeGreaterThan(0);
    }
  });

  test("key-minting endpoints are NOT exposed via oauth2 skip-auth", () => {
    const compose = read(N8N_COMPOSE);
    const skip = /OAUTH2_PROXY_SKIP_AUTH_ROUTES:\s*"([^"]*)"/.exec(compose);
    expect(skip, "n8n-auth must declare OAUTH2_PROXY_SKIP_AUTH_ROUTES").not.toBeNull();
    const routes = skip![1];
    // The privileged minting/ownership endpoints must never be skip-auth.
    for (const forbidden of ["rest/owner", "rest/api-keys", "api/v1/me", "/rest/"]) {
      expect(
        routes.includes(forbidden),
        `OAUTH2_PROXY_SKIP_AUTH_ROUTES must not expose '${forbidden}' — key minting stays in-cluster only.`,
      ).toBe(false);
    }
    // And no blanket /api/.* broadening crept in.
    expect(routes).not.toMatch(/\^\/api\/\.\*/);
    expect(routes).not.toMatch(/\^\/api\/v1\/\.\*/);
  });

  test("n8n-workflow-init runs in-cluster (internal only), depends on n8n healthy, builds the migrate image", () => {
    const compose = read(N8N_COMPOSE);
    expect(compose).toMatch(/n8n-workflow-init:/);
    // Isolate the service block (from its key to the next top-level service or volumes:).
    const block = /\n {2}n8n-workflow-init:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|\nvolumes:)/.exec(compose);
    expect(block, "could not isolate n8n-workflow-init block").not.toBeNull();
    const svc = block![1];

    // Built from the migrate image (has node + repo + deploy-workflows.mjs + workflows).
    expect(svc).toMatch(/dockerfile:\s*Dockerfile\.migrate/);
    // One-shot.
    expect(svc).toMatch(/restart:\s*"no"/);
    // Talks to n8n on the internal network at the in-cluster REST URL.
    expect(svc).toMatch(new RegExp(`N8N_REST_URL=http://${reHost("n8n", 5678)}`));
    // Waits for n8n to be healthy.
    expect(svc).toMatch(/depends_on:[\s\S]*?n8n:[\s\S]*?condition:\s*service_healthy/);
    // Internal network only — NOT exposed to the coolify (edge) network.
    //
    // ⛔ PTÁ SE PARSERU, NE TEXTU (opraveno 2026-08-21). Dřív tu stálo
    // `toMatch(/networks:\s*\n\s*-\s*internal/)`, což uznává JEN seznamový
    // zápis. Jakmile služba dostala síťový alias (a tím slovníkový tvar
    // `networks: { internal: { aliases: [...] } }`), brána spadla — přestože
    // sítě zůstaly TYTÉŽ. Měřidlo hlídalo pravopis místo vlastnosti.
    const site = sitiSluzby(compose, "n8n-workflow-init");
    expect(site, "n8n-workflow-init musí být na síti internal").toContain("internal");
    expect(
      site,
      "n8n-workflow-init must NOT join the coolify (edge) network — in-cluster only.",
    ).not.toContain("coolify");
    // Raw key material on tmpfs, never a named volume.
    expect(svc).toMatch(/tmpfs:[\s\S]*?\/run\/n8n/);
  });

  // ⛔ PŘEPSÁNO 2026-09-18. Dřív tu stálo „heslo vlastníka NÁHODNÉ, nikdy
  // z env". Ten invariant vyrobil slepou uličku: klíč vznikl jen při prvním
  // nasazení, každé další skončilo „owner already set up" bez klíče a pověření
  // ani workflowy se nedoručily (RIQ 2026-09-07, guru 2026-09-18). Vlastnost,
  // kterou brána drží TEĎ: bootstrap klíč vyrobí při KAŽDÉM nasazení —
  // převezme vlastnictví (čerstvá instance), nebo se přihlásí (existující) —
  // heslem z tajemství platformy, které se nikdy neloguje a nemá náhodnou zálohu.
  test("bootstrap mints on every deploy: setup on a fresh instance, login on an existing one", () => {
    // Přihlášení a heslo žijí ve sdílené relace-vlastnika.mjs (používá ji i
    // provision-credentials) — měří se bootstrap SPOLU s ní.
    const js = read(BOOTSTRAP) + "\n" + read(RELACE);
    expect(js).toMatch(/\/rest\/owner\/setup/);
    expect(js).toMatch(/\/rest\/login/);
    expect(js).toMatch(/\/rest\/api-keys/);
    expect(js).toMatch(/rawApiKey/);
    expect(js, "heslo vlastníka musí jít z tajemství platformy").toMatch(/process\.env\.N8N_BOOTSTRAP_OWNER_PASSWORD/);
    expect(
      /randomBytes|Math\.random/.test(js),
      "náhodné heslo vlastníka = heslo, kterým se další nasazení nepřihlásí (slepá ulička)",
    ).toBe(false);
    const logujeHeslo = js
      .split("\n")
      .filter((r) => /\b(log|console\.\w+)\(/.test(r) && /\$\{(heslo|tajemstvi)\}|OWNER\.password/.test(r));
    expect(logujeHeslo, "heslo vlastníka se nesmí dostat do logu (jen délka)").toEqual([]);
  });

  test("heslo vlastníka projde celým řetězcem tajemství: generátor → .env.coolify → doktor → compose initu", () => {
    const klic = "N8N_BOOTSTRAP_OWNER_PASSWORD";
    const vady: string[] = [];
    if (!new RegExp(`emit\\('${klic}'`).test(read("scripts/generate-secrets.mjs"))) vady.push("generate-secrets ho nevydává");
    if (!new RegExp(`^${klic}=\\$\\{${klic}\\}$`, "m").test(read("scripts/aisha-cold-start.sh"))) {
      vady.push("cold-start ho nezapisuje do .env.coolify");
    }
    if (!new RegExp(`\\["${klic}",\\s*"secret"`).test(read("scripts/aisha-env-doctor.mjs"))) vady.push("není v kontraktu env-doktora jako secret");
    const block = /\n {2}n8n-workflow-init:\n([\s\S]*?)(?=\n {2}[a-z0-9-]+:\n|\nvolumes:)/.exec(read(N8N_COMPOSE));
    if (!block || !new RegExp(`- ${klic}=\\$\\{${klic}(\\}|:\\?)`).test(block[1])) {
      vady.push("init ho v compose nedostává jako ${" + klic + "} (bez prázdného defaultu)");
    }
    expect(vady, vady.join("; ")).toEqual([]);
  });

  test("no committed owner credentials or API-key literals", () => {
    for (const rel of [BOOTSTRAP, ENTRYPOINT, N8N_COMPOSE]) {
      const txt = read(rel);
      // A literal password assignment (not an env ref) would be a leak.
      expect(
        /OWNER_PASSWORD\s*[:=]\s*["'][A-Za-z0-9]{6,}["']/.test(txt),
        `${rel} must not embed a literal owner password.`,
      ).toBe(false);
      // An n8n public API key is a JWT (eyJ...). Must never be committed.
      expect(/eyJ[A-Za-z0-9_-]{20,}\./.test(txt), `${rel} must not embed a JWT/API key.`).toBe(false);
    }
  });
});
