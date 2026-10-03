/**
 * nasazeny-stav — co na instanci SKUTEČNĚ běží (K1 rekonciliace, jen hlášení).
 *
 * Scénáře jsou z naměřeného incidentu 2026-09-26/27 (aisha.guru): Core padl na disku
 * build serveru, stacky vln 3+ se přeskočily kvůli padlému Edge a další push je už
 * neviděl. Jména aplikací jsou druhy (core, edge…), ne jména instancí.
 */
import { describe, expect, it } from "vitest";
import {
  mnozinaAplikaci,
  navicKNasazeni,
  seznamNasazeni,
  stavAplikace,
  zmerStav,
} from "./nasazeny-stav.mjs";

const A = "a".repeat(40); // poslední úspěch
const B = "b".repeat(40); // spadlý pokus
const C = "c".repeat(40); // hlava

describe("stavAplikace — poslední ÚSPĚCH, ne poslední pokus", () => {
  it("spadlý pokus po úspěchu: úspěch zůstává A, pokus je B/failed", () => {
    const s = stavAplikace([
      { commit: B, status: "failed", created_at: "2026-09-26T21:27:12Z" },
      { commit: A, status: "finished", created_at: "2026-09-26T18:00:54Z" },
    ]);
    expect(s).toEqual({ uspesny: A, pokus: { commit: B, status: "failed" } });
  });

  it("řadí podle času, ne podle pořadí v odpovědi API", () => {
    const s = stavAplikace([
      { commit: A, status: "finished", created_at: "2026-09-25T10:00:00Z" },
      { commit: C, status: "finished", created_at: "2026-09-27T10:00:00Z" },
    ]);
    expect(s.uspesny).toBe(C);
  });

  it("bez jediného finished → uspesny null (ne poslední commit)", () => {
    const s = stavAplikace([{ commit: B, status: "failed", created_at: "2026-09-26T21:00:00Z" }]);
    expect(s.uspesny).toBeNull();
  });
});

describe("seznamNasazeni — nečitelný tvar není prázdná historie", () => {
  it("tři známé tvary odpovědi", () => {
    expect(seznamNasazeni([{ commit: A }])).toHaveLength(1);
    expect(seznamNasazeni({ deployments: [{ commit: A }] })).toHaveLength(1);
    expect(seznamNasazeni({ data: [] })).toEqual([]);
  });
  it("cokoli jiného → null", () => {
    expect(seznamNasazeni({ message: "Unauthenticated." })).toBeNull();
  });
});

describe("navicKNasazeni — co by rekonciliace nasadila navíc", () => {
  const nasaditOd = (mapa) => (zaklad) => {
    if (!(zaklad in mapa)) throw new Error("commit není v historii klonu");
    return new Set(mapa[zaklad]);
  };

  it("⛔ spadlé nasazení: změna aplikace je jen v A..B, head C ji nenese — dnešní detekce ji vynechá, rekonciliace ne", () => {
    const r = navicKNasazeni({
      stav: { core: { uspesny: A }, edge: { uspesny: C } },
      head: C,
      deployApps: mnozinaAplikaci(",extranet,"), // dnešní rozdíl B..C core neobsahuje
      nasaditOd: nasaditOd({ [A]: ["core", "extranet"] }),
    });
    expect(r.navic).toEqual([{ app: "core", zaklad: A }]);
    expect(r.nezmereno).toEqual([]);
  });

  it("aplikace už běží na hlavě → nic navíc", () => {
    const r = navicKNasazeni({
      stav: { core: { uspesny: C } },
      head: C,
      deployApps: new Set(),
      nasaditOd: () => { throw new Error("nemá se volat"); },
    });
    expect(r.navic).toEqual([]);
  });

  it("aplikace, kterou rozdíl od jejího úspěchu netýká (jen kontrakt / nic), se nehlásí", () => {
    const r = navicKNasazeni({
      stav: { "shared-redis": { uspesny: A } },
      head: C,
      deployApps: new Set(),
      nasaditOd: nasaditOd({ [A]: ["core"] }),
    });
    expect(r.navic).toEqual([]);
  });

  it("aplikace už v deploy_apps se nehlásí dvakrát", () => {
    const r = navicKNasazeni({
      stav: { core: { uspesny: A } },
      head: C,
      deployApps: mnozinaAplikaci(",core,"),
      nasaditOd: nasaditOd({ [A]: ["core"] }),
    });
    expect(r.navic).toEqual([]);
  });

  it("bez úspěchu v historii → hlášena zvlášť (cold-start), ne navíc", () => {
    const r = navicKNasazeni({ stav: { nova: { uspesny: null } }, head: C, deployApps: new Set(), nasaditOd: () => new Set() });
    expect(r.bezUspechu).toEqual(["nova"]);
  });

  it("⛔ neznámý základ / chyba měření → NEZMĚŘENO s důvodem, nikdy tiše v pořádku", () => {
    const r = navicKNasazeni({
      stav: { core: { uspesny: A }, edge: { chyba: "HTTP 500" } },
      head: C,
      deployApps: new Set(),
      nasaditOd: nasaditOd({}),
    });
    expect(r.navic).toEqual([]);
    expect(r.nezmereno.map((n) => n.app)).toEqual(["core", "edge"]);
    expect(r.nezmereno[0].duvod).toContain("commit není v historii klonu");
  });
});

describe("zmerStav — měří jen aplikace projektu instance", () => {
  const scope = { inProject: (a) => a.environment_id === 1 };
  const falesneApi = (odpovedi) => async (cesta) => {
    if (!(cesta in odpovedi)) throw new Error(`neočekávané volání ${cesta}`);
    const v = odpovedi[cesta];
    if (v instanceof Error) throw v;
    return v;
  };

  it("cizí projekt ani cizí prefix se neměří; chyba jedné aplikace neshodí ostatní", async () => {
    const coolify = falesneApi({
      "/applications": [
        { uuid: "u1", name: "inst-core", environment_id: 1 },
        { uuid: "u2", name: "inst-edge", environment_id: 1 },
        { uuid: "u3", name: "inst-core", environment_id: 2 }, // jiný projekt, stejné jméno
        { uuid: "u4", name: "jina-core", environment_id: 1 },
      ],
      "/deployments/applications/u1?take=20": [{ commit: A, status: "finished", created_at: "2026-09-26T18:00:00Z" }],
      "/deployments/applications/u2?take=20": new Error("HTTP 500"),
    });
    const stav = await zmerStav({ coolify, scope, prefix: "inst" });
    expect(Object.keys(stav).sort()).toEqual(["core", "edge"]);
    expect(stav.core.uspesny).toBe(A);
    expect(stav.edge.chyba).toBe("HTTP 500");
  });

  it("⛔ /applications, který nevrátí pole, je chyba měření — ne prázdná instance", async () => {
    const coolify = falesneApi({ "/applications": { message: "Unauthenticated." } });
    await expect(zmerStav({ coolify, scope, prefix: "inst" })).rejects.toThrow(/nelze změřit/);
  });
});
