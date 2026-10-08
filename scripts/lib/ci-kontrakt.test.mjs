import { describe, expect, it } from "vitest";
import { klicKontraktuDoktora, nactiRepozitar, nalezyKontraktu, planApply, referenceWorkflow, zapis, zmer } from "./ci-kontrakt.mjs";

const K = [
  { jmeno: "URL", druh: "secret", zdroj: { trezor: "URL" }, povinne: true },
  { jmeno: "TOKEN", druh: "secret", zdroj: "externi", povinne: true },
  { jmeno: "PREFIX", druh: "var", zdroj: { trezor: "PREFIX" }, povinne: false },
];

describe("co workflow čtou", () => {
  it("secrets i vars, víc souborů; komentář není čtení; GITHUB_TOKEN dodává GitHub Actions", () => {
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

describe("měření proti repu a trezoru", () => {
  const repozitar = (secrets, vars = []) => ({ secrets: new Set(secrets), vars: new Set(vars) });
  const trezor = new Map([["URL", "https://x"], ["PREFIX", "p"]]);

  it("vše v repu → 0", async () => {
    expect((await zmer({ kontrakt: K, repozitar: repozitar(["URL", "TOKEN"], ["PREFIX"]), trezor })).kod).toBe(0);
  });

  it("⛔ repo nečitelné → 2 (NEMĚŘENO), ne prázdný seznam jako „vše v pořádku“", async () => {
    expect(await zmer({ kontrakt: K, repozitar: null, trezor })).toEqual({ radky: [], kod: 2 });
  });

  it("⛔ chybí povinné → 1 s radou, odkud doplnit; chybí nepovinné → jen upozornění", async () => {
    const v = await zmer({ kontrakt: K, repozitar: repozitar([], []), trezor });
    expect(v.kod).toBe(1);
    expect(v.radky.map((r) => [r.jmeno, r.stav, r.akce])).toEqual([
      ["URL", "chybi", "doplnit z trezoru (URL)"],
      ["TOKEN", "chybi", "zadá správce (externí)"],
      ["PREFIX", "chybi-nepovinne", "doplnit z trezoru (PREFIX)"],
    ]);
  });

  it("⛔ povinné chybí i v trezoru → nález s radou „nejdřív env-doktor“", async () => {
    const v = await zmer({ kontrakt: K, repozitar: repozitar(["URL", "TOKEN"], ["PREFIX"]), trezor: new Map() });
    expect(v.kod).toBe(1);
    expect(v.radky[0].akce).toMatch(/nejdřív env-doktor/);
  });

  it("trezor nedodán → 3 (část nezměřena)", async () => {
    expect((await zmer({ kontrakt: K, repozitar: repozitar(["URL", "TOKEN"], ["PREFIX"]), trezor: null })).kod).toBe(3);
  });

  it("ověřovač: nesedí → 1; spadne nebo chybí hodnota → 3, nikdy průchod", async () => {
    const k = [{ jmeno: "URL", druh: "secret", zdroj: { trezor: "URL" }, povinne: true, overeni: "t" }];
    const f = repozitar(["URL"]);
    expect((await zmer({ kontrakt: k, repozitar: f, trezor, overovace: { t: async () => ({ stav: "nesedi" }) } })).kod).toBe(1);
    const spadly = await zmer({ kontrakt: k, repozitar: f, trezor, overovace: { t: async () => { throw new Error("web nedostupný"); } } });
    expect(spadly.kod).toBe(3);
    expect(spadly.radky[0].duvod).toMatch(/web nedostupný/);
    expect((await zmer({ kontrakt: k, repozitar: f, trezor, overovace: { t: async () => ({ stav: "ok" }) } })).kod).toBe(0);
  });

  it("apply: jen položky z trezoru s hodnotou; existující se přepíše, chybějící přidá; externí nikdy", () => {
    expect(planApply({ kontrakt: K, repozitar: repozitar(["URL"], []), trezor })).toEqual([
      { druh: "secret", jmeno: "URL", klic: "URL", akce: "prepsat" },
      { druh: "var", jmeno: "PREFIX", klic: "PREFIX", akce: "pridat" },
    ]);
  });
});

describe("výpis z GitHubu (jen jména)", () => {
  const API = "https://api.example.test";
  const ZAKLAD = "/repos/org/repo/actions";
  const api = (odpovedi) => async (url) => {
    const cesta = new URL(url).pathname;
    const o = odpovedi[cesta];
    if (o === undefined) return Response.json({ total_count: 0, secrets: [], variables: [] });
    if (typeof o === "number") return new Response("", { status: o });
    return Response.json(o);
  };

  it("repo ∪ organizační sdílené s repem; repo osobního účtu (404) nevadí", async () => {
    const f = api({
      [`${ZAKLAD}/secrets`]: { total_count: 1, secrets: [{ name: "A" }] },
      [`${ZAKLAD}/variables`]: { total_count: 1, variables: [{ name: "V", value: "x" }] },
      [`${ZAKLAD}/organization-secrets`]: { total_count: 1, secrets: [{ name: "O" }] },
      [`${ZAKLAD}/organization-variables`]: 404,
    });
    const s = await nactiRepozitar({ api: `${API}/`, repo: "org/repo", token: "t", f });
    expect([...s.secrets].sort()).toEqual(["A", "O"]);
    expect([...s.vars]).toEqual(["V"]);
  });

  it("⛔ token bez oprávnění (403) → výjimka (NEMĚŘENO), ne prázdná množina", async () => {
    const f = api({ [`${ZAKLAD}/secrets`]: 403 });
    await expect(nactiRepozitar({ api: API, repo: "org/repo", token: "t", f })).rejects.toThrow(/oprávnění/);
  });

  it("⛔ repo, jehož nastavení token nevidí (404 na secrets) → výjimka, ne „nic tam není“", async () => {
    const f = api({ [`${ZAKLAD}/secrets`]: 404 });
    await expect(nactiRepozitar({ api: API, repo: "org/repo", token: "t", f })).rejects.toThrow(/nenalezeno/);
  });

  it("stránkuje, dokud strana není neúplná; ptá se s Bearer tokenem", async () => {
    const plna = Array.from({ length: 100 }, (_, i) => ({ name: `S${i}` }));
    const auth = new Set();
    const f = async (url, init) => {
      auth.add(init.headers.Authorization);
      const u = new URL(url);
      if (u.pathname === `${ZAKLAD}/secrets`) {
        return Response.json({ secrets: u.searchParams.get("page") === "1" ? plna : [{ name: "POSLEDNI" }] });
      }
      return Response.json({ secrets: [], variables: [] });
    };
    const s = await nactiRepozitar({ api: API, repo: "org/repo", token: "t", f });
    expect(s.secrets.size).toBe(101);
    expect([...auth]).toEqual(["Bearer t"]);
  });

  it("⛔ odpověď bez seznamu → výjimka (tvar API se změnil, neměří se naslepo)", async () => {
    const f = api({ [`${ZAKLAD}/secrets`]: { total_count: 3 } });
    await expect(nactiRepozitar({ api: API, repo: "org/repo", token: "t", f })).rejects.toThrow(/nenese seznam/);
  });
});

describe("zápis (apply)", () => {
  const API = "https://api.example.test";

  it("proměnná: nová POST, existující PATCH — hodnota v těle, ne v adrese", async () => {
    const volani = [];
    const f = async (url, init) => (volani.push([init.method, new URL(url).pathname, JSON.parse(init.body)]), new Response("", { status: 201 }));
    await zapis({ api: API, repo: "org/repo", token: "t", polozka: { druh: "var", jmeno: "P", akce: "pridat" }, hodnota: "h1", f });
    await zapis({ api: API, repo: "org/repo", token: "t", polozka: { druh: "var", jmeno: "P", akce: "prepsat" }, hodnota: "h2", f });
    expect(volani).toEqual([
      ["POST", "/repos/org/repo/actions/variables", { name: "P", value: "h1" }],
      ["PATCH", "/repos/org/repo/actions/variables/P", { name: "P", value: "h2" }],
    ]);
  });

  it("tajemství: přes `gh secret set` (šifruje klíčem repa), hodnota na stdin, nikdy v argv", async () => {
    const volani = [];
    const spust = (prikaz, argv, o) => volani.push({ prikaz, argv, input: o.input, token: o.env.GH_TOKEN });
    await zapis({ api: API, repo: "org/repo", token: "t", polozka: { druh: "secret", jmeno: "S", akce: "pridat" }, hodnota: "tajne", spust });
    expect(volani).toEqual([{ prikaz: "gh", argv: ["secret", "set", "S", "--repo", "org/repo"], input: "tajne", token: "t" }]);
    expect(volani[0].argv.join(" ")).not.toContain("tajne");
  });

  it("⛔ odmítnutý zápis proměnné → výjimka", async () => {
    const f = async () => new Response("", { status: 403 });
    await expect(zapis({ api: API, repo: "org/repo", token: "t", polozka: { druh: "var", jmeno: "P", akce: "pridat" }, hodnota: "h", f })).rejects.toThrow(/403/);
  });
});
