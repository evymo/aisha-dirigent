/**
 * Mesh DNS: nástroj maže jen zóny se SVOU značkou — a značka musí přežít NetBird
 *
 * ⛔ NAMĚŘENO 2026-09-19 (NetBird 0.70): zóna NetBirdu nemá pole `description`
 * (schéma ZoneRequest/Zone ani odpověď API), takže značka, kterou do něj
 * `netbird-dns-provision` psal, se nikdy neuložila a prořezávání se nespustilo
 * ani jednou — ani pro zóny, které nástroj sám založil. Jméno odebrané
 * z topologie nechalo zónu viset navždy.
 *
 * Brána proto pouští reconcile proti NetBirdu v paměti, jehož zóny mají PŘESNĚ
 * tvar skutečné odpovědi (bez `description`), a tvrdí obě strany smlouvy:
 *   vlastní + nechtěná  → smazána
 *   cizí (bez značky)   → zůstane, jen se vypíše
 *   chtěná bez značky   → převezme se (značka do `name`), nesmaže se
 *   nová                → založí se se značkou v `name`
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ZNACKA, jeVlastni, jmenoZony, planZon, reconcileZony } from "../../../scripts/lib/netbird-dns-zony.mjs";

const ROOT = process.cwd();

type Zona = { id: string; name: string; domain: string; enabled: boolean; enable_search_domain: boolean; distribution_groups: string[]; records: Array<{ id: string; name: string; type: string; content: string }> };

/** NetBird v paměti — jen cesty, které reconcile volá; zóny v tvaru skutečného API. */
function netbird(zony: Array<Partial<Zona> & { name: string; domain: string }>, opts: { putSelze?: boolean } = {}) {
  let n = 0;
  const stav = new Map<string, Zona>();
  for (const z of zony) {
    const id = `z${++n}`;
    stav.set(id, { id, enabled: true, enable_search_domain: false, distribution_groups: ["g-all"], records: [], ...z });
  }
  const volani: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const call = async (method: string, path: string, body?: Record<string, unknown>) => {
    volani.push({ method, path, body });
    if (method === "GET" && path === "/api/groups") return [{ id: "g-all", name: "All" }];
    if (method === "GET" && path === "/api/dns/zones") return [...stav.values()].map((z) => ({ ...z }));
    if (method === "POST" && path === "/api/dns/zones") {
      const id = `z${++n}`;
      // Jako skutečný NetBird: uloží jen pole ze schématu — `description` zahodí.
      const { name, domain, enabled, enable_search_domain, distribution_groups } = body as unknown as Zona;
      const z: Zona = { id, name, domain, enabled, enable_search_domain, distribution_groups, records: [] };
      stav.set(id, z);
      return { ...z };
    }
    let m = /^\/api\/dns\/zones\/([^/]+)$/.exec(path);
    if (m && method === "PUT") {
      if (opts.putSelze) throw new Error(`PUT ${path} → 500 simulovaná chyba`);
      const z = stav.get(m[1])!;
      stav.set(m[1], { ...z, name: String(body!.name) });
      return { ...stav.get(m[1]) };
    }
    if (m && method === "DELETE") { stav.delete(m[1]); return null; }
    m = /^\/api\/dns\/zones\/([^/]+)\/records$/.exec(path);
    if (m && method === "GET") return [...(stav.get(m[1])?.records ?? [])];
    if (m && method === "POST") {
      const z = stav.get(m[1])!;
      z.records.push({ id: `r${++n}`, ...(body as { name: string; type: string; content: string }) });
      return null;
    }
    m = /^\/api\/dns\/zones\/([^/]+)\/records\/([^/]+)$/.exec(path);
    if (m && method === "PUT") {
      const r = stav.get(m[1])!.records.find((x) => x.id === m![2])!;
      r.content = String(body!.content);
      return null;
    }
    throw new Error(`nečekané volání ${method} ${path}`);
  };
  const podleDomeny = (d: string) => [...stav.values()].find((z) => z.domain === d);
  return { call, volani, stav, podleDomeny };
}

const PLAN = [
  { key: "core", domain: "acme-api.mesh.example", ip: "100.70.0.1" },
  { key: "external_faces.partner-api", domain: "acme-partner-api.mesh.example", ip: "100.70.0.2" },
];
const tiche = { log: () => {} };

describe("značka vlastníka žije v `name`", () => {
  test("jmenoZony nese značku a jeVlastni ji pozná; starý tag v description se uznává dál", () => {
    expect(jmenoZony("core")).toBe(`${ZNACKA}:core`);
    expect(jeVlastni({ name: jmenoZony("core"), domain: "x" })).toBe(true);
    expect(jeVlastni({ name: "core", domain: "x" })).toBe(false);
    expect(jeVlastni({ name: "Office Zone", domain: "x" })).toBe(false);
    expect(jeVlastni({ name: "core", domain: "x", description: ZNACKA })).toBe(true);
  });
});

describe("reconcile proti NetBirdu bez `description`", () => {
  test("vlastní + nechtěná → smazána; cizí mimo plán → zůstane", async () => {
    const nb = netbird([
      { name: jmenoZony("core"), domain: "acme-api.mesh.example" },
      { name: jmenoZony("external_faces.stara"), domain: "acme-stara.mesh.example" },
      { name: "Office Zone", domain: "office.example" },
      { name: "partner", domain: "acme-rucne.mesh.example" },
    ]);
    const p = await reconcileZony(nb.call, PLAN, tiche);
    expect(nb.podleDomeny("acme-stara.mesh.example"), "vlastní nechtěná zóna musí zmizet").toBeUndefined();
    expect(nb.podleDomeny("office.example"), "cizí zóna se nesmí smazat").toBeDefined();
    expect(nb.podleDomeny("acme-rucne.mesh.example"), "zóna bez značky se nesmí smazat").toBeDefined();
    expect(p.cizi.map((z: { domain: string }) => z.domain).sort()).toEqual(["acme-rucne.mesh.example", "office.example"]);
    const smazano = nb.volani.filter((v) => v.method === "DELETE").map((v) => v.path);
    expect(smazano).toHaveLength(1);
  });

  test("nová zóna se založí se značkou v `name` a bez `description` (to pole NetBird nemá)", async () => {
    const nb = netbird([]);
    await reconcileZony(nb.call, PLAN, tiche);
    const zalozeni = nb.volani.filter((v) => v.method === "POST" && v.path === "/api/dns/zones");
    expect(zalozeni.map((v) => v.body!.name)).toEqual([jmenoZony("core"), jmenoZony("external_faces.partner-api")]);
    for (const v of zalozeni) expect(v.body).not.toHaveProperty("description");
    // A značka po založení OPRAVDU přežije — čte se zpět z uloženého stavu.
    for (const z of nb.stav.values()) expect(jeVlastni(z), z.domain).toBe(true);
    for (const x of PLAN) expect(nb.podleDomeny(x.domain)!.records.map((r) => r.content)).toEqual([x.ip]);
  });

  test("chtěná zóna bez značky (z doby před opravou) se převezme a nesmaže", async () => {
    const nb = netbird([{ name: "core", domain: "acme-api.mesh.example", distribution_groups: ["g-jina"] }]);
    await reconcileZony(nb.call, PLAN, tiche);
    const z = nb.podleDomeny("acme-api.mesh.example")!;
    expect(z.name).toBe(jmenoZony("core"));
    expect(z.distribution_groups, "převzetí nesmí změnit skupiny").toEqual(["g-jina"]);
    expect(nb.volani.some((v) => v.method === "DELETE")).toBe(false);
    // Po převzetí ji další běh už pozná jako vlastní — a až zmizí z plánu, smaže ji.
    await reconcileZony(nb.call, PLAN.filter((x) => x.key !== "core"), tiche);
    expect(nb.podleDomeny("acme-api.mesh.example")).toBeUndefined();
  });

  test("selhané převzetí není fatální: záznam se spravuje dál, zóna zůstane", async () => {
    const nb = netbird([{ name: "core", domain: "acme-api.mesh.example" }], { putSelze: true });
    const log: string[] = [];
    await reconcileZony(nb.call, PLAN, { log: (l: string) => log.push(l) });
    expect(nb.podleDomeny("acme-api.mesh.example")!.records.map((r) => r.content)).toEqual(["100.70.0.1"]);
    expect(log.join("\n")).toMatch(/převzetí selhalo/);
  });

  test("zóna se starým tagem v description se uznává jako vlastní i při prořezávání", async () => {
    const nb = netbird([{ name: "stara", domain: "acme-stara.mesh.example", description: ZNACKA } as never]);
    await reconcileZony(nb.call, PLAN, tiche);
    expect(nb.podleDomeny("acme-stara.mesh.example")).toBeUndefined();
  });

  test("planZon je čistý a shoduje se s tím, co reconcile provede", async () => {
    const zony = [
      { id: "a", name: jmenoZony("x"), domain: "acme-x.mesh.example" },
      { id: "b", name: "core", domain: "acme-api.mesh.example" },
      { id: "c", name: "Office Zone", domain: "office.example" },
    ];
    const p = planZon(zony, PLAN);
    expect(p.zalozit.map((x: { domain: string }) => x.domain)).toEqual(["acme-partner-api.mesh.example"]);
    expect(p.prevzit.map((x: { zona: { id: string } }) => x.zona.id)).toEqual(["b"]);
    expect(p.smazat.map((z: { id: string }) => z.id)).toEqual(["a"]);
    expect(p.cizi.map((z: { id: string }) => z.id)).toEqual(["c"]);
  });
});

describe("nástroj knihovnu opravdu používá", () => {
  test("netbird-dns-provision volá reconcileZony a zónám už nepíše description", () => {
    const src = readFileSync(join(ROOT, "scripts/netbird-dns-provision.mjs"), "utf8");
    expect(src).toContain("reconcileZony(call, plan)");
    expect(src).not.toMatch(/z\.description === TAG/);
    expect(src).not.toMatch(/\/api\/dns\/zones",\s*\{[^}]*description/);
  });
});
