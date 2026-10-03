import { describe, expect, it } from "vitest";
import { klicKontraktuDoktora, nactiForgejo, nalezyKontraktu, planApply, referenceWorkflow, zmer } from "./ci-kontrakt.mjs";

const K = [
  { jmeno: "URL", druh: "secret", zdroj: { trezor: "URL" }, povinne: true },
  { jmeno: "TOKEN", druh: "secret", zdroj: "externi", povinne: true },
  { jmeno: "PREFIX", druh: "var", zdroj: { trezor: "PREFIX" }, povinne: false },
];

describe("co workflow čtou", () => {
  it("secrets i vars, víc souborů; komentář není čtení; GITHUB_TOKEN dodává Forgejo", () => {
    const r = referenceWorkflow([
      { soubor: "a.yml", text: "env:\n  X: ${{ secrets.URL }}\n  # ${{ secrets.JEN_V_KOMENTARI }}\n  G: ${{ secrets.GITHUB_TOKEN }}\n  P: ${{ vars.PREFIX }}" },
      { soubor: "b.yml", text: "run: echo ${{ secrets.URL || secrets.TOKEN }}" },
    ]);
    expect([...r.keys()].sort()).toEqual(["secret:TOKEN", "secret:URL", "var:PREFIX"]);
    expect(r.get("secret:URL").workflow).toEqual(["a.yml", "b.yml"]);
  });

  it("klíče kontraktu doktora v tvaru, který čte i brána env-doctor-contract-coverage", () => {
    const d = klicKontraktuDoktora('const CONTRACT = [\n  ["URL", "required-static", x],\n  ["PREFIX", "static"],\n];');
    expect([...d.entries()]).toEqual([["URL", "required-static"], ["PREFIX", "static"]]);
  });
});

describe("soulad kontraktu (brána)", () => {
  const reference = referenceWorkflow([{ soubor: "a.yml", text: "${{ secrets.URL }} ${{ secrets.TOKEN }} ${{ vars.PREFIX }} ${{ secrets.NOVE }}" }]);
  const doktor = new Map([["URL", "static"], ["PREFIX", "static"]]);

  it("nové jméno mimo kontrakt i ráčnu = nález; v ráčně = tolerováno", () => {
    expect(nalezyKontraktu({ reference, kontrakt: K, racna: [], doktor }).nezarazene).toEqual(["secret:NOVE"]);
    expect(nalezyKontraktu({ reference, kontrakt: K, racna: ["secret:NOVE"], doktor }).nezarazene).toEqual([]);
  });

  it("⛔ ráčna jen ubývá: zařazené nebo nečtené jméno z ní musí odejít", () => {
    const n = nalezyKontraktu({ reference, kontrakt: K, racna: ["secret:NOVE", "secret:URL", "secret:NIKDO_NECTE"], doktor });
    expect(n.zastaraleVRacne).toEqual(["secret:NIKDO_NECTE", "secret:URL"]);
  });

  it("⛔ mrtvá položka, neznámý klíč doktora, neznámý ověřovač, dvojitá položka", () => {
    const n = nalezyKontraktu({
      reference,
      kontrakt: [...K, { jmeno: "MRTVE", druh: "secret", zdroj: "externi" }, { jmeno: "URL", druh: "secret", zdroj: { trezor: "NEZNAMY" }, overeni: "neexistuje" }],
      racna: ["secret:NOVE"],
      doktor,
      overovace: {},
    });
    expect(n.mrtve).toEqual(["secret:MRTVE"]);
    expect(n.neznamyTrezor).toEqual(["secret:URL → NEZNAMY"]);
    expect(n.neznamyOverovac).toEqual(["secret:URL → neexistuje"]);
    expect(n.dvojite).toEqual(["secret:URL"]);
  });
});

describe("měření proti Forgeju a trezoru", () => {
  const forgejo = (secrets, vars = []) => ({ secrets: new Set(secrets), vars: new Set(vars) });
  const trezor = new Map([["URL", "https://x"], ["PREFIX", "p"]]);

  it("vše v Forgeju → 0", async () => {
    expect((await zmer({ kontrakt: K, forgejo: forgejo(["URL", "TOKEN"], ["PREFIX"]), trezor })).kod).toBe(0);
  });

  it("⛔ Forgejo nečitelné → 2 (NEMĚŘENO), ne prázdný seznam jako „vše v pořádku“", async () => {
    expect(await zmer({ kontrakt: K, forgejo: null, trezor })).toEqual({ radky: [], kod: 2 });
  });

  it("⛔ chybí povinné → 1 s radou, odkud doplnit; chybí nepovinné → jen upozornění", async () => {
    const v = await zmer({ kontrakt: K, forgejo: forgejo([], []), trezor });
    expect(v.kod).toBe(1);
    expect(v.radky.map((r) => [r.jmeno, r.stav, r.akce])).toEqual([
      ["URL", "chybi", "doplnit z trezoru (URL)"],
      ["TOKEN", "chybi", "zadá správce (externí)"],
      ["PREFIX", "chybi-nepovinne", "doplnit z trezoru (PREFIX)"],
    ]);
  });

  it("⛔ povinné chybí i v trezoru → nález s radou „nejdřív env-doktor“", async () => {
    const v = await zmer({ kontrakt: K, forgejo: forgejo(["URL", "TOKEN"], ["PREFIX"]), trezor: new Map() });
    expect(v.kod).toBe(1);
    expect(v.radky[0].akce).toMatch(/nejdřív env-doktor/);
  });

  it("trezor nedodán → 3 (část nezměřena)", async () => {
    expect((await zmer({ kontrakt: K, forgejo: forgejo(["URL", "TOKEN"], ["PREFIX"]), trezor: null })).kod).toBe(3);
  });

  it("ověřovač: nesedí → 1; spadne nebo chybí hodnota → 3, nikdy průchod", async () => {
    const k = [{ jmeno: "URL", druh: "secret", zdroj: { trezor: "URL" }, povinne: true, overeni: "t" }];
    const f = forgejo(["URL"]);
    expect((await zmer({ kontrakt: k, forgejo: f, trezor, overovace: { t: async () => ({ stav: "nesedi" }) } })).kod).toBe(1);
    const spadly = await zmer({ kontrakt: k, forgejo: f, trezor, overovace: { t: async () => { throw new Error("web nedostupný"); } } });
    expect(spadly.kod).toBe(3);
    expect(spadly.radky[0].duvod).toMatch(/web nedostupný/);
    expect((await zmer({ kontrakt: k, forgejo: f, trezor, overovace: { t: async () => ({ stav: "ok" }) } })).kod).toBe(0);
  });

  it("apply: jen položky z trezoru s hodnotou; existující se přepíše, chybějící přidá; externí nikdy", () => {
    expect(planApply({ kontrakt: K, forgejo: forgejo(["URL"], []), trezor })).toEqual([
      { druh: "secret", jmeno: "URL", klic: "URL", akce: "prepsat" },
      { druh: "var", jmeno: "PREFIX", klic: "PREFIX", akce: "pridat" },
    ]);
  });
});

describe("výpis z Forgeja (jen jména)", () => {
  const api = (odpovedi) => async (url) => {
    const cesta = new URL(url).pathname;
    const o = odpovedi[cesta];
    if (o === undefined) return new Response("[]", { status: 200 });
    if (typeof o === "number") return new Response("", { status: o });
    return Response.json(o);
  };

  it("repo ∪ organizace; vlastník bez organizace (404) nevadí", async () => {
    const f = api({
      "/api/v1/repos/org/repo/actions/secrets": [{ name: "A" }],
      "/api/v1/repos/org/repo/actions/variables": [{ name: "V" }],
      "/api/v1/orgs/org/actions/secrets": [{ name: "O" }],
      "/api/v1/orgs/org/actions/variables": 404,
    });
    const s = await nactiForgejo({ forgejo: "https://forgejo.example.test/", repo: "org/repo", token: "t", f });
    expect([...s.secrets].sort()).toEqual(["A", "O"]);
    expect([...s.vars]).toEqual(["V"]);
  });

  it("⛔ token bez oprávnění (403) → výjimka (NEMĚŘENO), ne prázdná množina", async () => {
    const f = api({ "/api/v1/repos/org/repo/actions/secrets": 403 });
    await expect(nactiForgejo({ forgejo: "https://forgejo.example.test", repo: "org/repo", token: "t", f })).rejects.toThrow(/oprávnění/);
  });

  it("stránkuje, dokud strana není neúplná", async () => {
    const plna = Array.from({ length: 50 }, (_, i) => ({ name: `S${i}` }));
    const f = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/repos/org/repo/actions/secrets")) return Response.json(u.searchParams.get("page") === "1" ? plna : [{ name: "POSLEDNI" }]);
      return Response.json([]);
    };
    const s = await nactiForgejo({ forgejo: "https://forgejo.example.test", repo: "org/repo", token: "t", f });
    expect(s.secrets.size).toBe(51);
  });
});
