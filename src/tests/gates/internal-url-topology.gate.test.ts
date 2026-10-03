/**
 * Gate: B6 — internal-URL topology primitive (#19).
 *
 * formatShellExports emits <ID>_URL=http://<container>:<port> for every catalog service with a
 * primary INTERNAL HTTP endpoint (OPENCLAW_URL, EXEC_URL, INTEGRATION_URL), plus legacy consumer
 * aliases (AGENT_RUNNER_URL→exec, RAGNAROK_URL→integration). Derived from config/services.json
 * (internal_url), which fixes the hardcoded AGENT_RUNNER_URL passthrough that drifted when a
 * container name/port changed. local-presets derives the same dev fallback from the catalog.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildTopology,
  formatShellExports,
  internalUrlFor,
} from "../../../scripts/lib/derive-domains.mjs";

function exportsFor(profile: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of formatShellExports(buildTopology({ profileId: profile })).split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

describe("#19 B6 — internal-URL topology primitive", () => {
  it("internalUrlFor skládá jméno z IDENTITY, nevydává literál", () => {
    // Dřív tu stály tři pevné řetězce (`http://aisha-openclaw:5210`, …). Tenhle
    // test tedy nehlídal pravidlo — DRŽEL na místě přesně tu vadu, kvůli které
    // se katalog s compose rozešel: jméno JEDNÉ instance zapečené v platformě.
    //
    // Měří se proto vlastnost: to jméno musí nést identitu, kterou dostane.
    // Dvě různé identity ⇒ dvě různá jména, žádný průnik.
    for (const [id, port] of [["openclaw", 5210], ["exec", 3030], ["integration", 9696]] as const) {
      const naAishe = internalUrlFor(id, "aisha");
      const naForku = internalUrlFor(id, "testfork");
      expect(naAishe, `${id}: adresa se nesložila`).toMatch(new RegExp(`^http://aisha-[a-z0-9-]+:${port}$`));
      expect(naForku, `${id}: adresa se nesložila pro cizí identitu`).toMatch(
        new RegExp(`^http://testfork-[a-z0-9-]+:${port}$`),
      );
      expect(naAishe, `${id}: jméno se nezměnilo s identitou — je to literál`).not.toBe(naForku);
    }
    expect(internalUrlFor("core", "aisha")).toBeNull(); // data plane — no single internal HTTP URL

    // Bez identity se jméno složit NESMÍ. Dosazený prefix by adresu otočil na
    // cizí produkci — to je ta vada, ne ochrana před ní.
    expect(internalUrlFor("openclaw", ""), "bez identity se nesmí nic vydat").toBeNull();
  });

  it("cloud-multi emits <ID>_URL for every internal-HTTP service + legacy aliases", () => {
    // <ID>_URL je od 2026-07-29 VŽDY PLNÁ ADRESA z topologie, ne container alias.
    //
    // `http://<container>:<port>` platí na jednom stroji a mezi instancemi je
    // nepřenositelné — každá další komponenta by si musela vyrobit výjimku.
    // Vydává se proto `<sub>.<zóna>.<tld>`, odvozené per instance z jejích TLD.
    // Kolokace se řeší VRSTVOU POD jménem (mesh DNS, Traefik), ne změnou jména.
    //
    // Port zůstává týž; mění se jen host.
    const multi = exportsFor("cloud-multi");
    for (const [key, sub] of [["OPENCLAW_URL", "companion"], ["EXEC_URL", "exec"], ["INTEGRATION_URL", "integration"]]) {
      expect(multi[key], `${key} musí být plná adresa, ne container alias`)
        .toMatch(new RegExp(`^http://${sub}\\.[a-z0-9.-]+:\\d+$`));
    }
    expect(multi.AGENT_RUNNER_URL).toBe(multi.EXEC_URL); // legacy alias = the <ID> form
    expect(multi.RAGNAROK_URL).toBe(multi.INTEGRATION_URL); // legacy alias

    // Totéž pravidlo na jednouzlové instalaci — jméno se nemění podle profilu.
    // openclaw i exec jsou tier:optional a v cloud-single nejsou, takže se bere služba,
    // která tam JE. (Sáhnout po chybějící službě dá undefined, a `toMatch`
    // na undefined selže hláškou o typu, ne o pravidle — sonda by pak měřila
    // něco jiného, než co má.)
    const single = exportsFor("cloud-single");
    expect(single.INTEGRATION_URL, "pravidlo platí i na jednom uzlu")
      .toMatch(/^http:\/\/integration\.[a-z0-9.-]+:9696$/);
  });

  it("AGENT_RUNNER_URL is DERIVED in local-presets, not a hardcoded literal (the passthrough fix)", () => {
    const presets = readFileSync(join(process.cwd(), "config/local-presets.mjs"), "utf8");
    expect(presets).toMatch(/AGENT_RUNNER_URL: internalUrlFor\("exec"\)/);
    expect(presets).not.toMatch(/AGENT_RUNNER_URL: "http:\/\/aisha-svc-agent-runner:3030"/);
  });

  it("services with no internal HTTP endpoint emit no <ID>_URL", () => {
    const env = exportsFor("cloud-multi");
    expect(env.CORE_URL).toBeUndefined(); // core = data plane (pgbouncer/migrate/api), no single URL
    expect(env.KEYCLOAK_URL).toBeUndefined(); // reached via domain, not an internal port
  });
});
