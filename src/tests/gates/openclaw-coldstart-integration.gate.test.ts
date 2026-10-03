/**
 * Gate: B4+B5 — OpenClaw cold-start integration chain (#20 #21).
 *
 * OpenClaw is a tier:optional agent-mesh executor whose svc-ai-chat adapter self-enables ONLY when
 * OPENCLAW_URL + OPENCLAW_API_KEY resolve at runtime (DERIVED from reachability — never a seed
 * flip). For that to happen post-deploy, six SoTs must agree. This gate locks the whole chain at PR
 * time so a HALF-wired integration — which the adapter would otherwise hide as a silent "openclaw
 * disabled" — fails loud:
 *
 *   catalog (services.json internal_url)            → topology emits OPENCLAW_URL  (B6)
 *   generate-secrets mints OPENCLAW_API_KEY (pg)    → shared svc-ai-chat ↔ svc-openclaw bearer
 *   env-doctor contracts API_KEY(secret)+URL(placeholder) → keys validated/healed
 *   compose passes the 3 vars + SSRF-allows <prefix>-openclaw → adapter has config + may reach it
 *   adapter reads all three; isAvailable gates on them; selfRegister derives is_enabled
 *   server boot runs discoverModels (automatic — no manual POST to gate)
 *
 * Runtime proof lives in the LIVE omni-acceptance suite (resolver ranks discovered providers) and
 * the cold-start-doctor Phase I (preflight reachability); this gate is the offline SoT lock.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

const CATALOG = read("config/services.json");
const SECRETS = read("scripts/generate-secrets.mjs");
const ENVDOC = read("scripts/aisha-env-doctor.mjs");
const COMPOSE = read("docker-compose.coolify-ai-chat.yml");
const CONFIG = read("services/svc-ai-chat/src/reflection/config.ts");
const ADAPTERS = read("services/svc-ai-chat/src/reflection/runtime/adapters.ts");
const SERVER = read("services/svc-ai-chat/src/server.ts");
const DOCTOR = read("scripts/cold-start-doctor.sh");
const COLDSTART = read("scripts/aisha-cold-start.sh");

describe("#20 #21 B4+B5 — OpenClaw cold-start integration chain", () => {
  it("catalog: openclaw has an internal_url the topology emits as OPENCLAW_URL (B6)", () => {
    const oc = JSON.parse(CATALOG).services?.openclaw;
    expect(oc?.internal_url?.service, "katalog musí na compose službu UKAZOVAT, ne opisovat její jméno").toBe("openclaw");
    expect(oc?.internal_url?.port).toBe(5210);
  });

  it("secrets: generate-secrets mints OPENCLAW_API_KEY EXACTLY ONCE via pg (no duplicate emit)", () => {
    expect(SECRETS).toMatch(/emit\('OPENCLAW_API_KEY',\s*pg\('OPENCLAW_API_KEY'/);
    const emits = (SECRETS.match(/emit\('OPENCLAW_API_KEY',/g) || []).length;
    expect(emits, "a second emit() double-mints the shared bearer (last-wins on eval, but dead/DRY)").toBe(1);
  });

  it("contract: env-doctor declares OPENCLAW_API_KEY (secret) + OPENCLAW_URL (placeholder)", () => {
    expect(ENVDOC).toMatch(/\["OPENCLAW_API_KEY",\s*"secret"/);
    expect(ENVDOC).toMatch(/\["OPENCLAW_URL",\s*"placeholder"\]/);
  });

  it("compose: ai-chat receives the three openclaw vars + SSRF allows the internal host", () => {
    expect(COMPOSE).toMatch(/OPENCLAW_URL:\s*\$\{OPENCLAW_URL/);
    expect(COMPOSE).toMatch(/OPENCLAW_API_KEY:\s*\$\{OPENCLAW_API_KEY/);
    expect(COMPOSE).toMatch(/LANGGRAPH_ENABLE_OPENCLAW:\s*\$\{LANGGRAPH_ENABLE_OPENCLAW/);
    // ⛔ NAMĚŘENO 2026-08-19: tady stálo `toMatch(/…aisha-openclaw/)`, takže brána
    // PŘEDEPISOVALA adresu CIZÍ instance — kdo ji narovnal na vlastní, shodil bránu.
    // Vlastnost zní „adaptér smí na openclaw SVÉ instance", a ta se skládá ze dvou
    // článků: compose seznam VYŽADUJE (nesmí si ho tiše domyslet) a cold-start ho
    // vyrábí z prefixu. Vnořená interpolace ve compose padá na Coolify parseru,
    // proto se skládá v pipeline, ne tady.
    expect(COMPOSE, "compose seznam jen ODVOZUJE ze složeniny, neskládá ho").toMatch(
      /SSRF_HOST_ALLOWLIST:\s*\$\{AI_CHAT_SSRF_ALLOWLIST:-\}/,
    );
    expect(COMPOSE, "adresa cizí instance ve stacku nemá co dělat").not.toMatch(/aisha-openclaw/);
    // Složenina žije JEN v config/domains.env (týž mechanismus jako CORS) a
    // hostitel se LOUPE Z `OPENCLAW_URL` — ne skládá vedle ní z prefixu.
    // Přesně tím rozdílem se seznam dřív rozešel: měl `<x>-openclaw`, zatímco
    // se volalo na `<x>-companion.mesh.<tld>`.
    const domains = readFileSync(join(ROOT, "config/domains.env"), "utf-8");
    expect(domains, "hostitel se odvozuje z OPENCLAW_URL").toMatch(
      // Výslovně volitelné (`:+`): bez OPENCLAW_URL je hostitel prázdný, ne nerozbalitelný.
      /OPENCLAW_HOSTPORT=\$\{OPENCLAW_URL(?::\+\$\{OPENCLAW_URL)?#\*:\/\/\}/,
    );
    expect(domains, "a vstupuje do seznamu ai-chatu").toMatch(
      /AI_CHAT_SSRF_ALLOWLIST=[^\n]*\$\{OPENCLAW_HOST:\+/,
    );
  });

  it("adapter: config reads all three vars + isAvailable gates on URL+key+enable (self-enable is derived)", () => {
    expect(CONFIG).toMatch(/openclawUrl:\s*process\.env\.OPENCLAW_URL/);
    expect(CONFIG).toMatch(/openclawApiKey:\s*process\.env\.OPENCLAW_API_KEY/);
    expect(CONFIG).toMatch(/enableOpenclaw:\s*process\.env\.LANGGRAPH_ENABLE_OPENCLAW/);
    expect(ADAPTERS).toMatch(
      /isAvailable:\s*\(\)\s*=>\s*Boolean\(config\.enableOpenclaw\s*&&\s*config\.openclawUrl\s*&&\s*config\.openclawApiKey\)/,
    );
  });

  it("discovery: model discovery runs automatically on svc-ai-chat boot (no manual POST to gate)", () => {
    expect(SERVER).toMatch(/discoverModels\(/);
  });

  it("doctor: cold-start-doctor has Phase I proving the chain at preflight", () => {
    expect(DOCTOR).toMatch(/phase I "Orchestration executor wiring \(OpenClaw\)"/);
    // Táž oprava jako výše: měří se, že doktor seznam odvozuje z prefixu instance,
    // ne že v něm stojí jméno cizí instance.
    expect(DOCTOR, "doktor musí hostitele odvodit z OPENCLAW_URL, ne skládat vedle ní").toMatch(
      /_openclaw_host="\$\{OPENCLAW_URL#\*:\/\/\}"/,
    );
    expect(DOCTOR, "doktor nesmí vyžadovat adresu cizí instance").not.toMatch(
      /SSRF_HOST_ALLOWLIST:\.\*aisha-openclaw/,
    );
  });

  it("no duplicate OPENCLAW_API_KEY across the SoTs (openclaw was pre-wired — declare once, don't double)", () => {
    const secretEmits = (SECRETS.match(/emit\('OPENCLAW_API_KEY',/g) || []).length;
    const contractEntries = (ENVDOC.match(/"OPENCLAW_API_KEY"/g) || []).length;
    const heredocLines = (COLDSTART.match(/^OPENCLAW_API_KEY=\$\{OPENCLAW_API_KEY\}/gm) || []).length;
    expect(
      { secretEmits, contractEntries, heredocLines },
      "the bearer must be minted/contracted/projected ONCE each — the trio's first cut duplicated all three",
    ).toEqual({ secretEmits: 1, contractEntries: 1, heredocLines: 1 });
  });
});
