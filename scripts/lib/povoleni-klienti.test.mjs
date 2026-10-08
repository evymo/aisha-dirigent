import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verejniKlientiRealmu } from "./povoleni-klienti.mjs";

const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cti = (cesta) => readFileSync(join(KOREN, cesta), "utf-8");
const realm = () => JSON.parse(cti("keycloak/aisha-realm.json"));

// Pravidlo, ze kterého vzniká KC_ALLOWED_CLIENTS (gateway i svc-mcp-knowledge `/mcp`).
// Do 2026-10-04 žilo jen uvnitř env-doktora; místní presety a výchozí hodnota ve službě
// nesly ruční výčet, do kterého by se nový veřejný klient realmu nedostal.
describe("veřejní klienti platformního realmu — pravidlo pro KC_ALLOWED_CLIENTS", () => {
  it("nad deklarací realmu vydá veřejné klienty, včetně klienta pro klienty MCP", () => {
    const klienti = verejniKlientiRealmu(realm());
    expect(klienti).toContain("aisha-mcp-client");
    expect(klienti).toContain("aisha-app");
    expect(klienti).toContain("aisha-dirigent-device");
  });

  it("vydá PRÁVĚ klienty s publicClient: true — žádného důvěrného, žádný servisní účet", () => {
    const deklarovani = realm().clients;
    const klienti = verejniKlientiRealmu(realm());
    expect(klienti).toEqual(deklarovani.filter((k) => k.publicClient === true).map((k) => k.clientId).sort());
    const duverni = deklarovani.filter((k) => k.publicClient !== true).map((k) => k.clientId);
    expect(duverni.length, "realm nemá důvěrného klienta — test by neměřil, že se vyřazují").toBeGreaterThan(0);
    for (const id of duverni) expect(klienti).not.toContain(id);
    for (const k of deklarovani.filter((x) => x.serviceAccountsEnabled === true)) expect(klienti).not.toContain(k.clientId);
  });

  // Kotvy na syntetickém realmu: každá větev pravidla rozhoduje.
  it.each([
    ["veřejný klient projde", { clientId: "priklad-app", publicClient: true }, ["priklad-app"]],
    ["důvěrný klient ne", { clientId: "priklad-proxy", publicClient: false }, []],
    ["klient bez příznaku ne", { clientId: "priklad-bez-priznaku" }, []],
    ["příznak jako řetězec ne", { clientId: "priklad-retezec", publicClient: "true" }, []],
    ["vestavěný account ne", { clientId: "account-console", publicClient: true }, []],
    ["klient bez jména ne", { publicClient: true }, []],
  ])("kotva: %s", (_popis, klient, ocekavano) => {
    expect(verejniKlientiRealmu({ clients: [klient] })).toEqual(ocekavano);
  });

  it("výstup je seřazený a bez duplicit; realm bez klientů dá prázdný seznam", () => {
    expect(
      verejniKlientiRealmu({
        clients: [
          { clientId: "zeta", publicClient: true },
          { clientId: "alfa", publicClient: true },
          { clientId: "zeta", publicClient: true },
        ],
      }),
    ).toEqual(["alfa", "zeta"]);
    for (const prazdny of [{}, { clients: null }, null, undefined]) expect(verejniKlientiRealmu(prazdny)).toEqual([]);
  });
});

// Jeden domov: oba konzumenti pravidlo VOLAJÍ, žádný si ho neopisuje.
describe("pravidlo má jeden domov", () => {
  it("env-doktor skládá platformní část KC_ALLOWED_CLIENTS touto funkcí", () => {
    const doktor = cti("scripts/aisha-env-doctor.mjs");
    expect(doktor).toMatch(/import \{ verejniKlientiRealmu \} from "\.\/lib\/povoleni-klienti\.mjs";/);
    const telo = /function kcAllowedClients\(\) \{[\s\S]*?\n\}/.exec(doktor)?.[0] ?? "";
    expect(telo, "funkce kcAllowedClients v env-doktorovi není").not.toBe("");
    expect(telo).toMatch(/verejniKlientiRealmu\(JSON\.parse\(readFileSync\(realm, "utf8"\)\)\)/);
    expect(telo, "env-doktor si pravidlo opisuje vedle domova").not.toMatch(/publicClient/);
  });

  it("místní presety vydávají KC_ALLOWED_CLIENTS týmž pravidlem z téhož realmu", async () => {
    const zdroj = cti("config/local-presets.mjs");
    expect(zdroj).toMatch(/KC_ALLOWED_CLIENTS: verejniKlientiRealmu\(/);
    const { devEnvDefaults } = await import("../../config/local-presets.mjs");
    expect(devEnvDefaults.KC_ALLOWED_CLIENTS).toBe(verejniKlientiRealmu(realm()).join(","));
    expect(devEnvDefaults.KC_ALLOWED_CLIENTS.split(",")).toContain("aisha-mcp-client");
  });

  it("compose jádra doručuje hodnotu gatewayi i službě svc-mcp-knowledge, bez výchozí hodnoty", () => {
    const radky = cti("docker-compose.coolify.yml")
      .split("\n")
      .filter((radek) => /^\s+KC_ALLOWED_CLIENTS:/.test(radek));
    expect(radky).toHaveLength(2);
    for (const radek of radky) {
      expect(radek).toMatch(/KC_ALLOWED_CLIENTS: \$\{KC_ALLOWED_CLIENTS:\?/);
      expect(radek).not.toMatch(/\$\{KC_ALLOWED_CLIENTS:-/);
    }
    expect(new Set(radky).size, "oba bloky mají nést týž řádek (jedna hláška, jeden klíč)").toBe(1);
  });
});
