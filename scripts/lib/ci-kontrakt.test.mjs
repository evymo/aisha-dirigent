import { describe, expect, it } from "vitest";
import { DEKLARACE_OVERLAYE, KONTRAKT_CI, ODVOZOVACE, klicKontraktuDoktora, nactiForgejo, nalezyKontraktu, odvod, overlayProCi, planApply, planDopln, referenceWorkflow, runnerProStitek, zivyRunnerSeStitkem, zmer } from "./ci-kontrakt.mjs";

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

describe("lehká dráha: živý runner se štítkem z proměnné", () => {
  const F = "https://forgejo.example.test";
  const R = "/api/v1/repos/org/repo/actions";
  const O = "/api/v1/orgs/org/actions";
  const A = "/api/v1/admin/actions/runners";
  /** Tvar runneru naměřený 2026-10-01 na /admin/actions/runners (Forgejo 16.0.2). */
  const runner = (name, status, labels) => ({ id: 1, uuid: "u", name, status, labels, version: "v12.10.0", owner_id: 0, repo_id: 0, ephemeral: false, description: "" });
  const api = (odpovedi) => async (url) => {
    const o = odpovedi[new URL(url).pathname];
    if (o === undefined) return new Response("", { status: 404 });
    if (typeof o === "number") return new Response("", { status: o });
    return Response.json(o);
  };
  const zmerDrahu = (odpovedi) => runnerProStitek({ forgejo: F, repo: "org/repo", token: "t", promenna: "CI_LIGHT_LABEL", f: api(odpovedi) });
  const nastavena = { [`${R}/variables/CI_LIGHT_LABEL`]: { name: "CI_LIGHT_LABEL", data: "ci-light", owner_id: 0, repo_id: 1 } };

  it("proměnná nenastavená (repo ani organizace) → vypnuto, runnery se nečtou", async () => {
    expect((await zmerDrahu({})).stav).toBe("vypnuto");
  });

  it("živý runner instance se štítkem → ok a jméno runneru; hodnota proměnné se nevypisuje", async () => {
    const v = await zmerDrahu({ ...nastavena, [`${R}/runners`]: [], [`${O}/runners`]: [], [A]: [runner("lehka", "idle", ["ci-light"]), runner("tezka", "active", ["ubuntu-latest"])] });
    expect(v.stav).toBe("ok");
    expect(v.duvod).toContain("lehka (idle)");
    expect(v.duvod).not.toContain("ci-light");
  });

  it("proměnná z organizace platí stejně", async () => {
    const v = await zmerDrahu({ [`${O}/variables/CI_LIGHT_LABEL`]: { name: "CI_LIGHT_LABEL", data: "ci-light" }, [A]: [runner("lehka", "active", ["ci-light"])] });
    expect(v.stav).toBe("ok");
  });

  it("⛔ výpis instance čitelný a runner se štítkem jen offline nebo žádný → chybi (BLOKUJE)", async () => {
    const offline = await zmerDrahu({ ...nastavena, [A]: [runner("lehka", "offline", ["ci-light"])] });
    expect(offline.stav).toBe("chybi");
    expect(offline.duvod).toMatch(/lehka \(offline\)[\s\S]*BLOKUJE/);
    expect((await zmerDrahu({ ...nastavena, [A]: [runner("tezka", "idle", ["ubuntu-latest"])] })).stav).toBe("chybi");
  });

  it("⛔ výpis repa i organizace PRÁZDNÝ a instance 403 → NEMĚŘENO, ne „runner chybí“ (runnery instance tam nejsou vidět)", async () => {
    const v = await zmerDrahu({ ...nastavena, [`${R}/runners`]: [], [`${O}/runners`]: [], [A]: 403 });
    expect(v.stav).toBe("nemereno");
    expect(v.duvod).toMatch(/runnery instance nejsou čitelné/);
  });

  it("⛔ runner CIZÍ organizace nebo repa ve výpisu instance se nepočítá (joby tohohle repa na něj nepůjdou)", async () => {
    const cizi = { ...runner("cizi-org", "idle", ["ci-light"]), owner_id: 42 };
    const ciziRepo = { ...runner("cizi-repo", "active", ["ci-light"]), repo_id: 99 };
    const v = await zmerDrahu({ ...nastavena, [`${R}/runners`]: [], [`${O}/runners`]: [], [A]: [cizi, ciziRepo] });
    expect(v.stav).toBe("chybi");
    expect(v.duvod).not.toContain("cizi-");
  });

  it("runner organizace se počítá z výpisu organizace (ve výpisu instance je taky, ale jen jednou)", async () => {
    const orgRunner = { ...runner("izolovany-push", "idle", ["ci-light"]), owner_id: 3 };
    const v = await zmerDrahu({ ...nastavena, [`${R}/runners`]: [], [`${O}/runners`]: [orgRunner], [A]: [orgRunner] });
    expect(v.stav).toBe("ok");
    expect(v.duvod.match(/izolovany-push/g)).toHaveLength(1);
  });

  it("výpis instance bez owner_id/repo_id → NEMĚŘENO (nejde poznat, čí runner je)", async () => {
    const { owner_id: _o, repo_id: _r, ...bezRozsahu } = runner("lehka", "idle", ["ci-light"]);
    const v = await zmerDrahu({ ...nastavena, [A]: [bezRozsahu] });
    expect(v.stav).toBe("nemereno");
    expect(v.duvod).toContain("owner_id/repo_id");
  });

  it("živý runner na úrovni repa stačí i bez výpisu instance", async () => {
    expect((await zmerDrahu({ ...nastavena, [`${R}/runners`]: [runner("repo-lehka", "idle", ["ci-light"])], [A]: 403 })).stav).toBe("ok");
  });

  it("proměnnou nejde přečíst (403) nebo runner má neznámý stav → NEMĚŘENO, nikdy průchod", async () => {
    expect((await zmerDrahu({ [`${R}/variables/CI_LIGHT_LABEL`]: 403 })).stav).toBe("nemereno");
    const divny = await zmerDrahu({ ...nastavena, [A]: [runner("lehka", "busy", ["ci-light"])] });
    expect(divny.stav).toBe("nemereno");
    expect(divny.duvod).toContain("neznámý stav");
  });

  it("stránkuje výpis instance, dokud strana není neúplná", async () => {
    const plna = Array.from({ length: 50 }, (_, i) => runner(`t${i}`, "idle", ["ubuntu-latest"]));
    const f = async (url) => {
      const u = new URL(url);
      if (u.pathname === `${R}/variables/CI_LIGHT_LABEL`) return Response.json({ data: "ci-light" });
      if (u.pathname === A) return Response.json(u.searchParams.get("page") === "1" ? plna : [runner("lehka", "idle", ["ci-light"])]);
      return Response.json([]);
    };
    expect((await runnerProStitek({ forgejo: F, repo: "org/repo", token: "t", promenna: "CI_LIGHT_LABEL", f })).stav).toBe("ok");
  });
});

describe("odvoditelné položky: co MÁ repo mít podle deklarace instance a měření", () => {
  const O = [
    { jmeno: "INSTANCE_OVERLAY_REPO", druh: "secret", zdroj: { odvozeno: "overlay" }, povinne: false, ucel: "x" },
    { jmeno: "CI_LIGHT_LABEL", druh: "var", zdroj: { odvozeno: "lehka-draha" }, povinne: false, ucel: "x" },
  ];
  const DRAHY = { lehka: { promenna: "CI_LIGHT_LABEL", stitek: "ci-light", strop_min: 240 } };
  const zije = async () => ({ stav: "ok", duvod: "živý runner lehka (idle)" });
  const nezije = async () => ({ stav: "chybi", duvod: "žádný živý runner se štítkem" });
  const nevim = async () => ({ stav: "nemereno", duvod: "runnery instance nejsou čitelné" });
  const forgejo = (secrets = [], vars = []) => ({ secrets: new Set(secrets), vars: new Set(vars) });

  it("adresa overlaye pro CI: bez schématu, přihlašovacích údajů, refu a .git; nečitelná = null", () => {
    expect(overlayProCi("https://oauth2:tajne@git.example.com/org/data.git#main")).toBe("git.example.com/org/data");
    expect(overlayProCi("https://git.example.com/org/data")).toBe("git.example.com/org/data");
    expect(overlayProCi("git@git.example.com:org/data.git")).toBe("git.example.com/org/data");
    expect(overlayProCi("https:\\/\\/git.example.com\\/org\\/data.git")).toBe("git.example.com/org/data");
    for (const spatne of ["", "   ", "nesmysl", "https://git.example.com/jen-vlastnik"]) expect(overlayProCi(spatne), spatne).toBeNull();
    // přihlašovací údaje se do hodnoty pro CI nikdy nedostanou
    expect(overlayProCi("https://uzivatel:heslo@git.example.com/org/data.git")).not.toMatch(/heslo|uzivatel|@/);
  });

  it("overlay: deklarovaný → má být; nedeklarovaný → nemá; bez trezoru a prostředí → NEMĚŘENO", async () => {
    const s = async (trezor, env = {}) => (await odvod({ trezor, drahy: DRAHY, zivyRunner: nezije, env })).get("overlay");
    expect(await s(new Map([[DEKLARACE_OVERLAYE, "https://t@git.example.com/org/data.git"]]))).toMatchObject({ stav: "ma-byt", hodnota: "git.example.com/org/data" });
    expect((await s(new Map())).stav).toBe("nema-byt");
    expect((await s(null)).stav, "trezor nedodán = nevíme, ne „overlay nemá“").toBe("nemereno");
    expect(await s(null, { [DEKLARACE_OVERLAYE]: "git@git.example.com:org/data.git" })).toMatchObject({ stav: "ma-byt", hodnota: "git.example.com/org/data" });
    expect((await s(new Map([[DEKLARACE_OVERLAYE, "nesmysl"]]))).stav).toBe("nemereno");
  });

  it("lehká dráha: rozhoduje MĚŘENÍ runneru se štítkem z deklarace platformy", async () => {
    const s = async (zivyRunner, drahy = DRAHY) => (await odvod({ trezor: new Map(), drahy, zivyRunner, env: {} })).get("lehka-draha");
    expect(await s(zije)).toMatchObject({ stav: "ma-byt", hodnota: "ci-light" });
    expect((await s(nezije)).stav).toBe("nema-byt");
    expect((await s(nevim)).stav, "nečitelné runnery = NEMĚŘENO, ne „runner není“").toBe("nemereno");
    expect((await s(zije, { lehka: { promenna: "CI_LIGHT_LABEL" } })).stav, "bez deklarovaného štítku není co měřit").toBe("nemereno");
    expect((await s(zije, null)).stav).toBe("nemereno");
  });

  it("⛔ má být a ve Forgeju není = NÁLEZ (kód 1) s akcí --dopln; je = ok; nemá být = jen upozornění", async () => {
    const odvozene = await odvod({ trezor: new Map([[DEKLARACE_OVERLAYE, "https://git.example.com/org/data.git"]]), drahy: DRAHY, zivyRunner: zije, env: {} });
    const chybi = await zmer({ kontrakt: O, forgejo: forgejo(), trezor: new Map(), odvozene });
    expect(chybi.kod).toBe(1);
    expect(chybi.radky.map((r) => [r.jmeno, r.stav, r.akce])).toEqual([
      ["INSTANCE_OVERLAY_REPO", "chybi", "doplnit odvozením (--dopln)"],
      ["CI_LIGHT_LABEL", "chybi", "doplnit odvozením (--dopln)"],
    ]);
    expect((await zmer({ kontrakt: O, forgejo: forgejo(["INSTANCE_OVERLAY_REPO"], ["CI_LIGHT_LABEL"]), trezor: new Map(), odvozene })).kod).toBe(0);

    const nema = await odvod({ trezor: new Map(), drahy: DRAHY, zivyRunner: nezije, env: {} });
    const v = await zmer({ kontrakt: O, forgejo: forgejo(), trezor: new Map(), odvozene: nema });
    expect(v.kod).toBe(0);
    expect(v.radky.map((r) => r.stav)).toEqual(["chybi-nepovinne", "chybi-nepovinne"]);
  });

  it("⛔ odvození NEMĚŘENO nebo vůbec neproběhlo → kód 3, nikdy tichý průchod", async () => {
    const nemereno = await odvod({ trezor: null, drahy: DRAHY, zivyRunner: nevim, env: {} });
    expect((await zmer({ kontrakt: O, forgejo: forgejo(), trezor: null, odvozene: nemereno })).kod).toBe(3);
    expect((await zmer({ kontrakt: O, forgejo: forgejo(), trezor: new Map() })).kod, "bez odvozených = neproběhlo").toBe(3);
  });

  it("plán doplnění: jen co má být a chybí; proměnná i při jiné hodnotě; existující tajemství se nepřepisuje", async () => {
    const odvozene = await odvod({ trezor: new Map([[DEKLARACE_OVERLAYE, "https://git.example.com/org/data.git"]]), drahy: DRAHY, zivyRunner: zije, env: {} });
    expect(planDopln({ kontrakt: O, forgejo: forgejo(), odvozene }).map((p) => [p.jmeno, p.akce, p.hodnota])).toEqual([
      ["INSTANCE_OVERLAY_REPO", "pridat", "git.example.com/org/data"],
      ["CI_LIGHT_LABEL", "pridat", "ci-light"],
    ]);
    const obojiJe = forgejo(["INSTANCE_OVERLAY_REPO"], ["CI_LIGHT_LABEL"]);
    expect(planDopln({ kontrakt: O, forgejo: obojiJe, odvozene, hodnotyVars: new Map([["CI_LIGHT_LABEL", "ci-light"]]) })).toEqual([]);
    expect(planDopln({ kontrakt: O, forgejo: obojiJe, odvozene, hodnotyVars: new Map([["CI_LIGHT_LABEL", "stary-stitek"]]) }).map((p) => [p.jmeno, p.akce])).toEqual([["CI_LIGHT_LABEL", "prepsat"]]);
    // co být nemá nebo je NEMĚŘENO, se nezapisuje nikdy
    const nic = await odvod({ trezor: null, drahy: DRAHY, zivyRunner: nezije, env: {} });
    expect(planDopln({ kontrakt: O, forgejo: forgejo(), odvozene: nic })).toEqual([]);
  });

  it("kontrakt: tajemství overlaye a štítek lehké dráhy jsou ODVOZENÉ, ne zadávané ručně; odvozovače existují", () => {
    const zdroj = (j) => KONTRAKT_CI.find((p) => p.jmeno === j)?.zdroj;
    expect(zdroj("INSTANCE_OVERLAY_REPO")).toEqual({ odvozeno: "overlay" });
    expect(zdroj("CI_LIGHT_LABEL")).toEqual({ odvozeno: "lehka-draha" });
    const pouzite = KONTRAKT_CI.filter((p) => p.zdroj?.odvozeno).map((p) => p.zdroj.odvozeno);
    expect(pouzite.filter((o) => !ODVOZOVACE.includes(o))).toEqual([]);
    // brána kontraktu: neznámý odvozovač je nález (jinak by se položka nikdy nezměřila)
    const n = nalezyKontraktu({ reference: new Map([["secret:X", {}]]), kontrakt: [{ jmeno: "X", druh: "secret", zdroj: { odvozeno: "neexistuje" } }], racna: [], doktor: new Map() });
    expect(n.neznamyTrezor).toEqual(["secret:X → odvozovač neexistuje"]);
  });

  it("živý runner se štítkem: sdílené měření pro oba směry (proměnná bez runneru i runner bez proměnné)", async () => {
    const F = "https://git.example.com";
    const A = "/api/v1/admin/actions/runners";
    const api = (odpovedi) => async (url) => {
      const o = odpovedi[new URL(url).pathname];
      if (o === undefined) return new Response("", { status: 404 });
      if (typeof o === "number") return new Response("", { status: o });
      return Response.json(o);
    };
    const r = (name, status, labels) => ({ name, status, labels, owner_id: 0, repo_id: 0 });
    const m = (odpovedi) => zivyRunnerSeStitkem({ forgejo: F, repo: "org/repo", token: "t", stitek: "ci-light", f: api(odpovedi) });
    expect(await m({ [A]: [r("lehka", "idle", ["ci-light"])] })).toMatchObject({ stav: "ok", zive: ["lehka (idle)"] });
    expect(await m({ [A]: [r("lehka", "offline", ["ci-light"]), r("tezka", "idle", ["ubuntu-latest"])] })).toMatchObject({ stav: "chybi", nezive: ["lehka (offline)"] });
    expect(await m({ [A]: 403 })).toMatchObject({ stav: "nemereno", instanceNecitelna: true });
  });
});
