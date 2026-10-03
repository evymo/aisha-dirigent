/**
 * Brána: DEKLAROVANÝ TCP ENDPOINT MUSÍ MÍT ROZVADĚČ (CLASS gate)
 *
 * ⛔ TŘÍDA (naměřeno 2026-08-22): mesh vezl JEN HTTP. `mesh-ingress` je Caddy a
 * rozlišuje podle `Host`, který TCP nemá — takže clamd (3310) a redis (6379)
 * chodily po SDÍLENÉ síti `coolify`. Tam ale jméno nárokuje víc nájemníků
 * najednou: 2026-08-16 tam stálo 149 aplikací a 8 zákaznických prefixů a docker
 * mezi stejnojmennými ROUND-ROBINUJE. Katalog to u clamavu sám přiznával:
 * „Non-HTTP TCP 3310, reachable on the shared coolify network as `clamd`."
 *
 * ⭐ U TCP přitom rozlišovat `Host` NETŘEBA: sidecar běží v netns AGENTA, takže
 * poslouchá na mesh IP svého peeru a dvojice (mesh IP, port) je jednoznačná
 * sama. Konflikt, kvůli kterému u HTTP vznikl Host-routing, tu neexistuje.
 *
 * CO SE MĚŘÍ (vlastnost, ne pravopis): služba, která v katalogu DEKLARUJE
 * `internal_tcp_endpoints`, musí mít ve svém compose sidecar, který
 *   1. běží v netns agenta (`network_mode: service:netbird-agent`) — jinak
 *      neposlouchá na mesh IP a deklarace je jen přání;
 *   2. dostane směrovací tabulku `<ID>_MESH_TCP_ROUTES` — tedy TÝŽ zdroj,
 *      jaký vydává derivace, ne druhý ručně udržovaný seznam.
 *
 * Bez téhle brány jde endpoint deklarovat a nic ho nerozvede — a projeví se to
 * jako TICHÁ nedostupnost, ne jako chyba nasazení.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";

const ROOT = resolve(__dirname, "../../..");

interface Sluzba {
  compose?: string;
  internal_tcp_endpoints?: { service?: string; port?: number }[];
}

/** Služby, které TCP endpoint DEKLARUJÍ — univerzum se hledá v katalogu. */
export function sluzbySTcp(katalog: Record<string, Sluzba>): [string, Sluzba][] {
  return Object.entries(katalog).filter(
    ([, s]) => Array.isArray(s?.internal_tcp_endpoints) && s.internal_tcp_endpoints.length > 0,
  );
}

describe("deklarovaný TCP endpoint má rozvaděč", () => {
  const raw = JSON.parse(readFileSync(join(ROOT, "config/services.json"), "utf-8"));
  const katalog: Record<string, Sluzba> = raw.services ?? raw;
  const sTcp = sluzbySTcp(katalog);

  test("univerzum se hledá v katalogu a není prázdné", () => {
    expect(
      Object.keys(katalog).length,
      "katalog je prázdný — brána by tvrdila čisto o ničem",
    ).toBeGreaterThan(10);
  });

  test("každá služba s TCP endpointem má sidecar v netns agenta s tabulkou", () => {
    const nalezy: string[] = [];
    for (const [id, svc] of sTcp) {
      if (!svc.compose) {
        nalezy.push(`${id}: deklaruje TCP endpoint, ale nemá 'compose' — není kde rozvaděč hledat`);
        continue;
      }
      const cesta = join(ROOT, svc.compose);
      if (!existsSync(cesta)) {
        // Nečitelný SLEDOVANÝ compose není „nula nálezů", je to díra v pokrytí.
        nalezy.push(`${id}: ${svc.compose} neexistuje`);
        continue;
      }
      const doc = yaml.load(readFileSync(cesta, "utf-8")) as {
        services?: Record<string, { network_mode?: string; environment?: Record<string, string> }>;
      };
      const klic = `${id.toUpperCase().replace(/-/g, "_")}_MESH_TCP_ROUTES`;
      const sidecar = Object.entries(doc.services ?? {}).find(
        ([, s]) =>
          String(s?.network_mode ?? "") === "service:netbird-agent" &&
          Object.keys(s?.environment ?? {}).includes(klic),
      );
      if (!sidecar) {
        nalezy.push(
          `${id}: ${svc.compose} nemá sidecar v netns agenta, který dostane ${klic}`,
        );
      }
    }
    expect(
      nalezy.sort(),
      "TCP endpoint bez rozvaděče se projeví jako TICHÁ nedostupnost — konzument\n" +
        "spadne zpátky na sdílenou síť, kde o jméno soupeří víc nájemníků.\n" +
        "Sidecar musí běžet v netns agenta (jinak neposlouchá na mesh IP) a brát\n" +
        "tabulku z derivace (jinak vznikne druhý ručně udržovaný seznam).",
    ).toEqual([]);
  });

  // ── Záporné testy ────────────────────────────────────────────────────────
  test("detektor najde deklarující službu a přeskočí ostatní", () => {
    expect(sluzbySTcp({ a: { internal_tcp_endpoints: [{ port: 1 }] } })).toHaveLength(1);
    expect(sluzbySTcp({ a: { internal_tcp_endpoints: [] }, b: {} })).toEqual([]);
  });
});
