/**
 * provision-credentials: deklarativní správa pověření n8n přes interní REST.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru, n8n 1.79.0): veřejné API pověření nevypíše
 * (GET → 405), skript na výpisu padal a nevzniklo nic; deploy-workflows mezitím
 * zakládal pověření při každém nasazení znovu (duplicity). Testy měří chování
 * `srovnejPovereni` nad falešným klientem REST: založit / upravit / uklidit
 * duplicity / jedno selhání nezastaví ostatní / tajemství nejde do výpisu.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { srovnejPovereni } from "./provision-credentials.mjs";

const TAJNE = "fixture-tajemstvi-nesmi-do-vypisu";

/** Falešný klient REST: drží seznam pověření a zaznamenává volání. */
function falesnyKlient(existujici = [], { selzePost = [] } = {}) {
  const stav = [...existujici];
  const volani = [];
  let dalsi = 100;
  return {
    stav,
    volani,
    get: async (cesta) => (volani.push(`GET ${cesta}`), [...stav]),
    post: async (cesta, telo) => {
      volani.push(`POST ${cesta} ${telo.type}::${telo.name}`);
      if (selzePost.includes(telo.type)) throw new Error(`POST /rest${cesta} → 400: Unknown credential type ${telo.type}`);
      const c = { id: String(dalsi++), name: telo.name, type: telo.type, createdAt: "2026-09-18T20:00:00Z" };
      stav.push(c);
      return c;
    },
    patch: async (cesta, telo) => (volani.push(`PATCH ${cesta} ${telo.type}::${telo.name}`), {}),
    smaz: async (cesta) => {
      volani.push(`DELETE ${cesta}`);
      const id = cesta.split("/").pop();
      stav.splice(stav.findIndex((c) => c.id === id), 1);
      return null;
    },
  };
}

const pov = (name, type, needs, platforma = false) => ({
  name,
  type,
  needs,
  platforma,
  data: () => ({ value: process.env[needs[0]] }),
});

let vypis;
beforeEach(() => {
  vypis = [];
  for (const m of ["log", "warn", "error"]) vi.spyOn(console, m).mockImplementation((...a) => vypis.push(a.join(" ")));
  process.env.FIXTURE_A = TAJNE;
  process.env.FIXTURE_B = TAJNE;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIXTURE_A;
  delete process.env.FIXTURE_B;
});

describe("provision-credentials: srovnání s deklarací", () => {
  test("chybějící založí, existující UPRAVÍ na hodnoty z env, mapa nese id", async () => {
    const k = falesnyKlient([{ id: "7", name: "B", type: "httpHeaderAuth", createdAt: "2026-09-17T00:00:00Z" }]);
    const v = await srovnejPovereni({
      klient: k,
      desired: [pov("A", "httpHeaderAuth", ["FIXTURE_A"], true), pov("B", "httpHeaderAuth", ["FIXTURE_B"], true)],
    });
    expect(v.vytvoreno).toBe(1);
    expect(v.upraveno).toBe(1);
    expect(k.volani).toContain("POST /credentials httpHeaderAuth::A");
    expect(k.volani).toContain("PATCH /credentials/7 httpHeaderAuth::B");
    expect(v.mapa).toEqual({ "httpHeaderAuth::A": "100", "httpHeaderAuth::B": "7" });
    expect(vypis.join("\n")).not.toContain(TAJNE);
  });

  test("⛔ duplicity: ponechá nejnovější, smaže neodkazovanou, odkazovanou odloží", async () => {
    const k = falesnyKlient([
      { id: "1", name: "A", type: "httpHeaderAuth", createdAt: "2026-09-17T00:55:17Z" },
      { id: "2", name: "A", type: "httpHeaderAuth", createdAt: "2026-09-18T19:57:28Z" },
      { id: "3", name: "A", type: "httpHeaderAuth", createdAt: "2026-09-16T00:00:00Z" },
    ]);
    const v = await srovnejPovereni({
      klient: k,
      desired: [pov("A", "httpHeaderAuth", ["FIXTURE_A"])],
      odkazovana: new Set(["3"]),
    });
    expect(v.mapa["httpHeaderAuth::A"]).toBe("2");
    expect(k.volani).toContain("PATCH /credentials/2 httpHeaderAuth::A");
    expect(k.volani).toContain("DELETE /credentials/1");
    expect(k.volani).not.toContain("DELETE /credentials/3");
    expect(v.smazano).toBe(1);
    expect(v.odlozeneDuplicity).toEqual(["httpHeaderAuth::A (3)"]);
  });

  test("jedno selhání nezastaví ostatní; konec nese seznam", async () => {
    const k = falesnyKlient([], { selzePost: ["aishaPostgrestApi"] });
    const v = await srovnejPovereni({
      klient: k,
      desired: [pov("AISHA PostgREST", "aishaPostgrestApi", ["FIXTURE_A"], true), pov("A", "httpHeaderAuth", ["FIXTURE_A"], true)],
    });
    expect(v.selhala).toEqual(["aishaPostgrestApi::AISHA PostgREST"]);
    expect(k.volani).toContain("POST /credentials httpHeaderAuth::A");
    expect(v.mapa["httpHeaderAuth::A"]).toBeDefined();
  });

  test("chybějící vstup platformy je selhání, klíč třetí strany jen skip", async () => {
    const k = falesnyKlient();
    const v = await srovnejPovereni({
      klient: k,
      desired: [pov("P", "httpHeaderAuth", ["FIXTURE_CHYBI"], true), pov("T", "openAiApi", ["FIXTURE_CHYBI2"])],
    });
    expect(v.selhala).toEqual(["httpHeaderAuth::P"]);
    expect(v.preskoceno).toBe(1);
    // přeskočené volitelné je v mapě null (deploy-workflows: nahrát neaktivní), selhané v mapě není
    expect(v.mapa).toEqual({ "openAiApi::T": null });
    expect(k.volani.filter((x) => x.startsWith("POST"))).toEqual([]);
    expect(vypis.join("\n")).toMatch(/❌ "P" \[httpHeaderAuth\] — chybí env, které doručuje platforma: FIXTURE_CHYBI/);
  });
});
