import { describe, expect, it } from "vitest";
import { hlavni, podpisyLogu, souhrnTestu, srovnejFaze, trvani } from "./ci-verdikt.mjs";

const ESC = String.fromCharCode(27);
const T0 = Date.parse("2026-10-03T06:21:00Z");
/** Log ve tvaru runneru: [sekund od začátku, text]. */
const log = (radky) => radky.map(([s, t]) => `${new Date(T0 + s * 1000).toISOString().replace("Z", "0000Z")} ${t}`).join("\n");

// Tvar podle skutečných logů #1141 (job 345972 zelený, job 347567 padlý), zkrácený.
const ZELENY = log([
  [0, "⭐ Run Main actions/checkout@v4"],
  [10, "Attempting to download 22..."],
  [24, "##[group]Environment details"],
  [84, "added 1422 packages, and audited 1477 packages in 1m"],
  [85, "> aisha-platform@0.9.0 lint"],
  [195, "✖ 53 problems (0 errors, 53 warnings)"],
  [196, "🏁  Job succeeded"],
]);
const PADLY_UKLIZEC = log([
  [0, "⭐ Run Main actions/checkout@v4"],
  [10, "Attempting to download 22..."],
  [230, "##[group]Environment details"],
  [650, "npm error code EEXIST"],
  [650, "npm error ENOENT: no such file or directory, rename '/ci-cache/npm/_cacache/tmp/ac31c15f' -> '/ci-cache/npm/_cacache/content-v2/sha512/35/32/fb11'"],
  [770, "added 1422 packages, and audited 1477 packages in 2m"],
  [780, "> aisha-platform@0.9.0 lint"],
  [790, "⚙️ [runner]: context deadline exceeded"],
  [791, "🏁  Job failed"],
]);

describe("souhrn testů z logu", () => {
  it("vitest i s barvami — tvar z ev-eet (2026-10-02: zelený job, 6 červených testů)", () => {
    const t = log([[0, `      ${ESC}[2mTests ${ESC}[22m ${ESC}[1m${ESC}[31m6 failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m126 passed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m6 skipped (138)`]]);
    expect(souhrnTestu(t)).toEqual({ padlo: 6, proslo: 126 });
  });
  it("jest, node:test a mocha; víc sad se sečte", () => {
    expect(souhrnTestu(log([[0, "Tests:       1 failed, 5 passed, 6 total"]]))).toEqual({ padlo: 1, proslo: 5 });
    expect(souhrnTestu(log([[0, "ℹ pass 40"], [1, "ℹ fail 2"]]))).toEqual({ padlo: 2, proslo: 40 });
    expect(souhrnTestu(log([[0, "  12 passing (3s)"], [1, "  1 failing"]]))).toEqual({ padlo: 1, proslo: 12 });
    expect(souhrnTestu(log([[0, "      Tests  3 passed (3)"], [5, "      Tests  1 failed | 4 passed (5)"]]))).toEqual({ padlo: 1, proslo: 7 });
  });
  it("log bez souhrnu → null (nic neznamená nulu)", () => {
    expect(souhrnTestu(ZELENY)).toBeNull();
  });
});

describe("podpisy v logu", () => {
  const tridy = (l) => podpisyLogu(l).map((p) => `${p.trida}:${p.jmeno}`);
  it("uklízeč pod instalací = EEXIST A ZÁROVEŇ ENOENT rename z _cacache/tmp (scripts/ci/npm-ci.sh)", () => {
    expect(tridy(PADLY_UKLIZEC)).toContain("runner:uklízeč runneru smazal sdílenou npm cache pod instalací");
    expect(tridy(PADLY_UKLIZEC)).toContain("strop:job přetekl strop — runner ho ukončil");
    expect(tridy(log([[0, "npm error code EEXIST"]]))).toEqual([]);
  });
  it("ESLint jen s chybami je kód; samá varování nejsou", () => {
    expect(tridy(ZELENY)).toEqual([]);
    expect(tridy(log([[0, "✖ 55 problems (2 errors, 53 warnings)"]]))).toEqual(["kod:ESLint"]);
  });
  it("TypeScript, červené testy, krok s continue-on-error", () => {
    expect(tridy(log([[0, "src/a.ts(25,35): error TS2307: Cannot find module '@aisha/x'"]]))).toEqual(["kod:TypeScript"]);
    expect(tridy(log([[0, "⚙️ [runner]: Failed to execute step (but continue-on-error is true): exitcode '1': failure"]]))).toEqual([
      "failopen:krok padl, job zelený (continue-on-error)",
    ]);
  });
});

describe("srovnání fází proti zelenému běhu", () => {
  it("ukáže úsek, kde se čas ztratil — kotvy jsou řádky v obou lozích bez čísel", () => {
    const f = srovnejFaze(ZELENY, PADLY_UKLIZEC);
    expect(trvani(f.zeleny)).toBe("3m16s");
    expect(trvani(f.padly)).toBe("13m11s");
    expect(f.useky[0]).toMatchObject({ od: "##[group]Environment details", navic: 480_000 });
    expect(f.useky[0].do).toMatch(/^added # packages/);
    expect(f.useky[1]).toMatchObject({ od: "Attempting to download #...", do: "##[group]Environment details", navic: 206_000 });
  });
  it("opakovaný řádek není kotva a přehozené pořadí se nezarovná", () => {
    const z = log([[0, "první řádek kotvy"], [10, "opakuje se dvakrát"], [20, "opakuje se dvakrát"], [30, "druhý řádek kotvy"], [40, "třetí řádek kotvy"]]);
    const p = log([[0, "první řádek kotvy"], [5, "třetí řádek kotvy"], [100, "druhý řádek kotvy"], [110, "opakuje se dvakrát"]]);
    const f = srovnejFaze(z, p, { prah: 0 });
    const kotvy = new Set(f.useky.flatMap((u) => [u.od, u.do]));
    expect(kotvy.has("opakuje se dvakrát")).toBe(false);
    expect(kotvy.has("třetí řádek kotvy") && kotvy.has("druhý řádek kotvy")).toBe(false);
  });
});

describe("verdikt nad Forgejo API", () => {
  const REPO = "org/repo";
  const P = "b".repeat(40);
  const Z = "a".repeat(40);
  const ENV = { FORGEJO_URL: "https://forgejo.example.test", FORGEJO_TOKEN: "tajny-token-123" };
  const beh = (id, status, index = id) => ({ id, index_in_repo: index, status, workflow_id: "ci.yml", event: "pull_request", prettyref: "#1" });
  /** Odpovědi podle cesty (+ head_sha); čísla = HTTP chyba. */
  const api = (o) => async (url) => {
    const u = new URL(url);
    const k = u.pathname.replace("/api/v1", "") + (u.searchParams.get("head_sha") ? `?head_sha=${u.searchParams.get("head_sha")}` : "");
    const v = typeof o === "function" ? o(k) : o[k];
    if (v === undefined) return new Response("", { status: 404 });
    if (typeof v === "number") return new Response("", { status: v });
    return typeof v === "string" ? new Response(v) : Response.json(v);
  };
  const zaklad = {
    [`/repos/${REPO}/git/commits/${P}`]: { sha: P, parents: [{ sha: Z }] },
    [`/repos/${REPO}/git/commits/${Z}`]: { sha: Z, parents: [] },
    [`/repos/${REPO}/actions/runs?head_sha=${Z}`]: { workflow_runs: [beh(10, "success")] },
    [`/repos/${REPO}/actions/runs/10/jobs`]: [{ id: 100, name: "Web: TypeScript & Lint", status: "success" }],
    [`/repos/${REPO}/actions/jobs/100/logs`]: ZELENY,
  };
  const spust = async (odpovedi, argv = [REPO, P], env = ENV) => {
    const out = [];
    const spani = [];
    const kod = await hlavni(argv, { env, f: api(odpovedi), pis: (s) => out.push(s), spi: async (ms) => spani.push(ms), ted: () => T0 });
    return { kod, text: out.join("\n"), spani };
  };
  const padlyBeh = (status, logPadleho) => ({
    ...zaklad,
    [`/repos/${REPO}/actions/runs?head_sha=${P}`]: { workflow_runs: [beh(11, status, 12)] },
    [`/repos/${REPO}/actions/runs/11/jobs`]: [
      { id: 110, name: "Web: TypeScript & Lint", status: "failure" },
      { id: 111, name: "Deploy", status: "skipped" },
    ],
    [`/repos/${REPO}/actions/jobs/110/logs`]: logPadleho,
  });

  it("zelený běh: joby doběhly, logy bez vady → 0", async () => {
    const v = await spust({
      ...zaklad,
      [`/repos/${REPO}/actions/runs?head_sha=${P}`]: { workflow_runs: [beh(11, "success")] },
      [`/repos/${REPO}/actions/runs/11/jobs`]: [{ id: 100, name: "Web: TypeScript & Lint", status: "success" }],
    });
    expect(v.kod).toBe(0);
    expect(v.text).toMatch(/VERDIKT: ZELENÁ/);
  });

  it("⛔ padlý job s podpisem uklízeče → RUNNER (2) a srovnání fází s posledním zeleným předkem", async () => {
    const v = await spust(padlyBeh("failure", PADLY_UKLIZEC));
    expect(v.kod).toBe(2);
    expect(v.text).toMatch(/RUNNER: uklízeč runneru smazal sdílenou npm cache/);
    expect(v.text).toMatch(/fáze proti poslednímu zelenému \(#10 @aaaaaaaaa, job 100\): 3m16s → 13m11s/);
    expect(v.text).toMatch(/\+8m00s {2}„##\[group\]Environment details“ → „added # packages/);
    expect(v.text).toMatch(/VERDIKT: RUNNER/);
  });

  it("padlý job s chybou TypeScriptu → KÓD (1), i když je v logu i podpis runneru", async () => {
    const v = await spust(padlyBeh("failure", `${PADLY_UKLIZEC}\n${log([[795, "src/a.ts(1,1): error TS2307: Cannot find module 'x'"]])}`));
    expect(v.kod).toBe(1);
    expect(v.text).toMatch(/VERDIKT: KÓD/);
  });

  it("⛔ ZELENÝ job s padlým krokem (continue-on-error) a červenými testy → KÓD (1)", async () => {
    const failopen = log([
      [0, "      Tests  6 failed | 126 passed | 6 skipped (138)"],
      [3, "⚙️ [runner]: Failed to execute step (but continue-on-error is true): exitcode '1': failure"],
      [4, "🏁  Job succeeded"],
    ]);
    const v = await spust({
      ...zaklad,
      [`/repos/${REPO}/actions/runs?head_sha=${P}`]: { workflow_runs: [beh(11, "success")] },
      [`/repos/${REPO}/actions/runs/11/jobs`]: [{ id: 120, name: "build", status: "success" }],
      [`/repos/${REPO}/actions/jobs/120/logs`]: failopen,
    });
    expect(v.kod).toBe(1);
    expect(v.text).toMatch(/⚠ build \(job 120, success\) — KOD/);
    expect(v.text).toMatch(/testy v logu: 6 padlo, 126 prošlo/);
  });

  it("⛔ známé pády rohatky se odečtou JMÉNEM z jejího výpisu; o jeden pád víc nebo výměna známého za nový = KÓD", async () => {
    const ZNAME = ["a.test.ts > p1", "a.test.ts > p2", "b.test.ts > p3", "c.test.ts > p4", "d.test.ts > p5"];
    const rohatka = ({ padlo, zname, nove = [], kod = 0 }) =>
      log([
        [0, `      Tests  ${padlo} failed | 2889 passed | 30 skipped (2924)`],
        [1, `test-db-rohatka: ${kod ? "nový pád" : "bez nového pádu"} (kód ${kod}) · známých pádů ${zname.length}/5 · verdikt /tmp/x/v.json`],
        [1, "  známý dluh (baseline), neshazuje:"],
        ...zname.map((z) => [1, `    ${z}`]),
        ...nove.map((z) => [2, `  ✗ NOVÝ PÁD: ${z}`]),
        [3, kod ? "🏁  Job failed" : "🏁  Job succeeded"],
      ]);
    const beh11 = (l, status) => ({
      ...zaklad,
      [`/repos/${REPO}/actions/runs?head_sha=${P}`]: { workflow_runs: [beh(11, status)] },
      [`/repos/${REPO}/actions/runs/11/jobs`]: [{ id: 130, name: "DB: runtime testy (celá test:db, rohatka)", status }],
      [`/repos/${REPO}/actions/jobs/130/logs`]: l,
    });
    // Zelený main 2026-10-03: 5 červených = 5 jmen dluhu.
    expect((await spust(beh11(rohatka({ padlo: 5, zname: ZNAME }), "success"))).kod).toBe(0);
    // Jeden pád navíc.
    const navic = await spust(beh11(rohatka({ padlo: 6, zname: ZNAME, nove: ["e.test.ts > novy"], kod: 1 }), "failure"));
    expect(navic.kod).toBe(1);
    expect(navic.text).toMatch(/rohatka: nový pád \[kod\]/);
    expect(navic.text).toMatch(/testy v logu: 6 padlo \(z toho 5 známých pod rohatkou\)/);
    // Známý opravený, nový padlý — počet stejný (5), jména ne: pořád KÓD.
    const vymena = await spust(beh11(rohatka({ padlo: 5, zname: ZNAME.slice(0, 4), nove: ["e.test.ts > novy"], kod: 1 }), "failure"));
    expect(vymena.kod).toBe(1);
  });

  it("padlý job bez známého podpisu a bez zeleného předka → NEZMĚŘENO (75), nehádá se", async () => {
    const v = await spust({ ...padlyBeh("failure", log([[0, "něco se pokazilo"]])), [`/repos/${REPO}/actions/runs/10/jobs`]: [] });
    expect(v.kod).toBe(75);
    expect(v.text).toMatch(/na předcích commitu není zelený běh téhož jobu/);
    expect(v.text).toMatch(/VERDIKT: NEZMĚŘENO/);
  });

  it("běh ještě běží: bez --cekej 75, s --cekej čeká do konce a logy stahuje až po doběhnutí", async () => {
    expect((await spust(padlyBeh("running", PADLY_UKLIZEC))).kod).toBe(75);
    let dotazu = 0;
    const stazeneLogy = [];
    const odpovedi = (k) => {
      if (k === `/repos/${REPO}/actions/runs?head_sha=${P}`) return { workflow_runs: [beh(11, ++dotazu < 3 ? "running" : "success")] };
      if (k === `/repos/${REPO}/actions/runs/11/jobs`) return [{ id: 100, name: "Web: TypeScript & Lint", status: dotazu < 3 ? "running" : "success" }];
      if (k.endsWith("/logs")) stazeneLogy.push(dotazu);
      return zaklad[k];
    };
    const v = await spust(odpovedi, [REPO, P, "--cekej"]);
    expect(v.kod).toBe(0);
    expect(v.spani).toEqual([30_000, 30_000]);
    expect(stazeneLogy.every((d) => d >= 3)).toBe(true);
  });

  it("neznámý stav jobu, chyba API nebo chybějící token → NEZMĚŘENO; token se nevypíše nikdy", async () => {
    const nezname = await spust({
      ...padlyBeh("failure", PADLY_UKLIZEC),
      [`/repos/${REPO}/actions/runs/11/jobs`]: [{ id: 110, name: "x", status: "unknown" }],
    });
    expect(nezname.kod).toBe(75);
    expect(nezname.text).toMatch(/neznámý stav jobu „unknown“/);
    const chyba = await spust({ ...zaklad, [`/repos/${REPO}/actions/runs?head_sha=${P}`]: 500 });
    expect(chyba.kod).toBe(75);
    expect(chyba.text).toMatch(/actions\/runs: HTTP 500/);
    for (const t of [nezname.text, chyba.text]) expect(t).not.toContain(ENV.FORGEJO_TOKEN);
    expect((await spust(zaklad, [REPO, P], { FORGEJO_URL: ENV.FORGEJO_URL })).text).toMatch(/chybí FORGEJO_URL \(nebo --forgejo\) nebo FORGEJO_TOKEN/);
  });

  it("ke commitu zatím není běh: bez --cekej 75, výpis to řekne", async () => {
    const v = await spust({ ...zaklad, [`/repos/${REPO}/actions/runs?head_sha=${P}`]: { workflow_runs: [] } });
    expect(v.kod).toBe(75);
    expect(v.text).toMatch(/ke commitu zatím není žádný běh/);
  });
});
