/**
 * Uzly n8n se autentizují pověřením, které platforma zakládá — ne ničím jiným.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru, po prvním funkčním nasazení workflowů):
 *   · 51 uzlů ve 22 workflowech deklarovalo `authentication: genericCredentialType`
 *     BEZ odkazu na pověření → „Credentials not found" při každém běhu
 *     (WF_OPENCLAW_NOTIFY, WF_PUSH_CAMPAIGN_CRON… stovky chyb za hodinu);
 *   · místo pověření posílaly tajemství přes `$env.…` v hlavičkách — často
 *     proměnné, které n8n vůbec nemá (AISHA_POSTGREST_SERVICE_TOKEN, OPENCLAW_API_KEY);
 *   · 16 URL `{{ $env.AISHA_POSTGREST_URL }}/rpc/…` bez /rest/v1 — gateway je 404;
 *   · odkazy na jména, která nikdo nezakládá (aishaPostgrestApi, AISHA MCP Token…);
 *   · 4 uzly typu supabaseApi (Supabase je v platformě zakázaný).
 *
 * ⭐ Měří se VLASTNOST nad všemi n8n/workflows/*.json proti deklaraci
 * v scripts/n8n/provision-credentials.mjs (jediný zakladatel pověření).
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const ADRESAR = join(ROOT, "n8n/workflows");
const PROVISION = readFileSync(join(ROOT, "scripts/n8n/provision-credentials.mjs"), "utf8");
const DEPLOY = readFileSync(join(ROOT, "scripts/deploy-workflows.mjs"), "utf8");

type Uzel = {
  name: string;
  type: string;
  parameters?: Record<string, unknown> & {
    authentication?: string;
    genericAuthType?: string;
    nodeCredentialType?: string;
    url?: unknown;
    headerParameters?: { parameters?: Array<{ name?: string; value?: unknown }> };
  };
  credentials?: Record<string, { id?: string; name?: string }>;
};

const WORKFLOWY = readdirSync(ADRESAR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(ADRESAR, f), "utf8")) as { name: string; nodes: Uzel[] });

const DEKLAROVANA = new Set([...PROVISION.matchAll(/name:\s*"([^"]+)",\s*type:\s*"([^"]+)"/g)].map((m) => `${m[2]}::${m[1]}`));

/** Aliasy jmen z deploy-workflows (`"typ:jméno": "kanonické"`). */
const ALIASY = new Map(
  [...(/CREDENTIAL_ALIASES\s*=\s*\{([\s\S]*?)\};/.exec(DEPLOY)?.[1] ?? "").matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [
    m[1],
    m[2],
  ]),
);

/**
 * Pojmenované výjimky — jen s naměřeným důvodem a rozhodnutím, které chybí.
 * WF_INTRANET_USER_ONBOARD / Check Appsmith User: Appsmith API klíč platforma
 * NEVYDÁVÁ (vzniká až v adminu Appsmithu), takže pověření nemá z čeho vzniknout.
 * Rozhodnutí majitele (2026-09-18 otevřené): klíč do tajemství platformy, nebo
 * kontrolu uživatele jinou cestou.
 */
const VYJIMKY = new Set(["WF_INTRANET_USER_ONBOARD / Check Appsmith User"]);

const uzly = WORKFLOWY.flatMap((w) => w.nodes.map((n) => ({ w: w.name, n, kde: `${w.name} / ${n.name}` })));
const S_AUTENTIZACI = uzly.filter(({ n }) =>
  ["genericCredentialType", "predefinedCredentialType"].includes(String(n.parameters?.authentication)),
);

describe("uzly n8n se autentizují pověřením platformy (brána)", () => {
  test("univerzum: měřidlo vidí workflowy, uzly s autentizací i deklaraci pověření", () => {
    expect(WORKFLOWY.length).toBeGreaterThan(80);
    expect(S_AUTENTIZACI.length, "žádný uzel s autentizací — měřidlo přestalo vidět").toBeGreaterThan(50);
    expect(DEKLAROVANA.size, "deklarace pověření nenalezena").toBeGreaterThan(10);
    expect(ALIASY.size, "aliasy z deploy-workflows nenalezeny").toBeGreaterThan(0);
  });

  test("⛔ uzel s autentizací odkazuje na pověření svého typu", () => {
    const vady = S_AUTENTIZACI.filter(({ n, kde }) => {
      if (VYJIMKY.has(kde)) return false;
      const typ = n.parameters?.genericAuthType ?? n.parameters?.nodeCredentialType;
      return !typ || !n.credentials?.[String(typ)]?.name;
    }).map(({ kde }) => kde);
    expect(vady, `autentizace bez pověření („Credentials not found"):\n${vady.join("\n")}`).toEqual([]);
  });

  test("⛔ každé odkazované pověření platforma zakládá (provision-credentials)", () => {
    const vady = uzly.flatMap(({ n, kde }) =>
      Object.entries(n.credentials ?? {})
        .map(([typ, ref]) => `${typ}::${ALIASY.get(`${typ}:${ref.name}`) ?? ref.name}`)
        .filter((k) => !DEKLAROVANA.has(k))
        .map((k) => `${kde}: ${k}`),
    );
    expect(vady, `odkaz na pověření, které nikdo nezaloží:\n${vady.join("\n")}`).toEqual([]);
  });

  test("⛔ tajemství nejde přes $env v hlavičkách — jen šifrovaným pověřením", () => {
    const vady = uzly.flatMap(({ n, kde }) =>
      (n.parameters?.headerParameters?.parameters ?? [])
        .filter((h) => /^(authorization|apikey|x-api-key)$/i.test(String(h.name ?? "")) && /\$env\./.test(String(h.value ?? "")))
        .map((h) => `${kde}: ${h.name}`),
    );
    expect(vady, vady.join("\n")).toEqual([]);
  });

  test("⛔ AISHA_POSTGREST_URL je gateway: cesta jde přes /rest/v1 nebo /functions/v1", () => {
    const vady = uzly
      .filter(({ n }) => /\{\{\s*\$env\.AISHA_POSTGREST_URL\s*\}\}\/(?!rest\/v1|functions\/v1)/.test(String(n.parameters?.url ?? "")))
      .map(({ kde, n }) => `${kde}: ${String(n.parameters?.url).slice(0, 90)}`);
    expect(vady, `gateway tyhle cesty neobsluhuje (404):\n${vady.join("\n")}`).toEqual([]);
  });

  test("⛔ žádný uzel s pověřením supabaseApi (Supabase je v platformě zakázaný)", () => {
    const vady = uzly
      .filter(({ n }) => n.parameters?.nodeCredentialType === "supabaseApi" || n.credentials?.supabaseApi)
      .map(({ kde }) => kde);
    expect(vady, vady.join("\n")).toEqual([]);
  });
});
