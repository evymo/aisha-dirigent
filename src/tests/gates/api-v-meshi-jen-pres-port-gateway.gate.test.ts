/**
 * Služba v meshi volá API platformy přes port gateway, ne přes `https://${API_DOMAIN}`.
 *
 * ⛔ NAMĚŘENO 2026-09-17 (guru): `API_DOMAIN` je v meshi jméno core
 * (`aisha-api.mesh.aisha.internal` → peer 100.77.147.34) a jeho netns poslouchá
 * jen na 3000/3001/3017/3029/3030/8080/9000 — na 443 NE. Spojení z kontejneru
 * s mesh routou: `https://aisha-api.mesh.aisha.internal/rest/v1/` → ECONNREFUSED;
 * `http://aisha-api.mesh.aisha.internal:3001/rest/v1/…` → 401 bez klíče (živá
 * gateway). Adresu s portem vydává topology resolver jako `API_UPSTREAM_MESH`.
 *
 * n8n a n8n-worker to řeší wrapperem (`x-n8n-mesh-client` přepíše AISHA_API_URL
 * na API_UPSTREAM_MESH), ale `n8n-workflow-init` wrapper nemá a dostal
 * `AISHA_POSTGREST_URL=https://${API_DOMAIN}` — verdikt bootstrapu n8n se proto
 * nikdy nezapsal (integration_service_logs: 0 řádků) a cold-start ho nedostal.
 *
 * ⭐ Měří se VLASTNOST nad parsovaným compose: služba v meshi (routa do peer CIDR
 * / resolver mesh) nesmí mít spojovací adresu API ve tvaru `https://${API_DOMAIN}`
 * bez portu, pokud ji za běhu nepřepisuje na API_UPSTREAM_MESH.
 *
 * ROHATKA: BASELINE jsou dnešní nálezy, u kterých není ověřen konzument. Položka
 * smí jen ubýt — oprava, po které nález zmizí, musí baseline zkrátit.
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(__dirname, "../../..");

/** Proměnné, které nesou adresu, NA KTEROU se služba připojuje (ne identitu k zobrazení). */
const SPOJOVACI = /^AISHA_(API|POSTGREST|BACKEND|MCP)_URL$/;
const HTTPS_BEZ_PORTU = /^https:\/\/\$\{API_DOMAIN\}(?:\/|$)/;

/**
 * NAMĚŘENO 2026-09-17: openclaw `AISHA_MCP_URL=https://${API_DOMAIN}/mcp` míří na
 * tentýž odmítnutý 443; konzumenta v repu (obraz openclaw) jsem neověřil.
 */
const BASELINE = new Set(["docker-compose.coolify-openclaw.yml:openclaw:AISHA_MCP_URL"]);

type Sluzba = {
  environment?: string[] | Record<string, string>;
  entrypoint?: unknown;
  command?: unknown;
  dns?: string[];
};

function env(s: Sluzba): Array<[string, string]> {
  const e = s.environment ?? [];
  if (Array.isArray(e)) {
    return e.map((r) => {
      const i = r.indexOf("=");
      return (i < 0 ? [r, ""] : [r.slice(0, i), r.slice(i + 1)]) as [string, string];
    });
  }
  return Object.entries(e).map(([k, v]) => [k, String(v ?? "")]);
}

function jeVMeshi(s: Sluzba): boolean {
  const skript = JSON.stringify([s.entrypoint ?? null, s.command ?? null]);
  const promenne = env(s).map(([k]) => k);
  return (
    promenne.includes("NETBIRD_PEER_CIDR") ||
    /NETBIRD_PEER_CIDR/.test(skript) ||
    (s.dns ?? []).some((d) => /NETBIRD_DNS_IP/.test(d))
  );
}

/** Wrapper, který za běhu adresu přepíše na API_UPSTREAM_MESH (x-n8n-mesh-client). */
function prepisujeNaUpstream(s: Sluzba, promenna: string): boolean {
  const skript = JSON.stringify([s.entrypoint ?? null, s.command ?? null]);
  const primo = new RegExp(`export ${promenna}=\\\\"\\$\\$\\{API_UPSTREAM_MESH\\}\\\\"`).test(skript);
  const odvozene = new RegExp(`export ${promenna}=\\\\"\\$\\$\\{AISHA_API_URL\\}\\\\"`).test(skript)
    && /export AISHA_API_URL=\\"\$\$\{API_UPSTREAM_MESH\}\\"/.test(skript);
  return primo || odvozene;
}

const SOUBORY = readdirSync(ROOT).filter((f) => /^docker-compose\.coolify.*\.ya?ml$/.test(f)).sort();

const MERENI = SOUBORY.flatMap((soubor) => {
  const dok = parseYaml(readFileSync(join(ROOT, soubor), "utf8"), { merge: true }) as {
    services?: Record<string, Sluzba>;
  };
  return Object.entries(dok?.services ?? {}).flatMap(([jmeno, s]) =>
    env(s ?? {})
      .filter(([k]) => SPOJOVACI.test(k))
      .map(([k, v]) => ({ klic: `${soubor}:${jmeno}:${k}`, hodnota: v, vMeshi: jeVMeshi(s ?? {}), prepis: prepisujeNaUpstream(s ?? {}, k) })),
  );
});

describe("API v meshi jen přes port gateway (brána)", () => {
  test("univerzum: měřidlo vidí spojovací adresy API ve službách v meshi", () => {
    expect(MERENI.filter((m) => m.vMeshi).length, "měřidlo nevidí služby v meshi se spojovací adresou API").toBeGreaterThan(3);
    expect(
      MERENI.some((m) => m.prepis),
      "měřidlo nevidí ani wrapper n8n — přestalo číst entrypoint",
    ).toBe(true);
  });

  test("⛔ žádná služba v meshi nemá spojovací adresu API https://${API_DOMAIN} bez portu (mimo baseline)", () => {
    const nalezy = MERENI.filter((m) => m.vMeshi && HTTPS_BEZ_PORTU.test(m.hodnota) && !m.prepis).map((m) => m.klic);
    const nove = nalezy.filter((k) => !BASELINE.has(k));
    expect(nove, `nové spojení na 443, který v meshi nikdo neobsluhuje:\n${nove.join("\n")}`).toEqual([]);
  });

  test("rohatka: každá položka baseline je pořád nález (opravené se z baseline mažou)", () => {
    const nalezy = new Set(MERENI.filter((m) => m.vMeshi && HTTPS_BEZ_PORTU.test(m.hodnota) && !m.prepis).map((m) => m.klic));
    const vyrizene = [...BASELINE].filter((k) => !nalezy.has(k));
    expect(vyrizene, `opraveno — smaž z BASELINE:\n${vyrizene.join("\n")}`).toEqual([]);
  });
});
