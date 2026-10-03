import { describe, expect, it } from "vitest";
import {
  blobSha,
  cestaDeklarace,
  deklaruj,
  naplanuj,
  otiskZApksigneru,
  overPodpis,
  overDeklaraci,
  povrchAppky,
  registrZFetch,
  repoDat,
  rozhodni,
  souradnice,
  upravDeklaraci,
  vetevDeklarace,
  zeSeznamuSouboru,
  zverejni,
} from "./kiosk-balicky.mjs";

describe("seznam souborů z registru (tvar Forgejo)", () => {
  const SHA = "8b411090d6c25f3ba8c00c1800bc17154b984fb60d1b81c2ce9acafeaecd56e0";
  it("čte `Size` s velkým S — tak ho Forgejo skutečně vrací (2026-09-29, první artefakt)", () => {
    const odpoved = [{ id: 430, Size: 82740, name: "cz.riq.hlidac-1.5.0-7.apk", md5: "x", sha256: SHA }];
    expect(zeSeznamuSouboru(odpoved, "cz.riq.hlidac-1.5.0-7.apk")).toEqual({ sha256: SHA, bajtu: 82740 });
  });
  it("`size` malým jako záloha; cizí soubor = null; bez velikosti = chyba, ne odhad", () => {
    expect(zeSeznamuSouboru([{ name: "a.apk", size: 5, sha256: SHA }], "a.apk")).toEqual({ sha256: SHA, bajtu: 5 });
    expect(zeSeznamuSouboru([{ name: "a.apk", Size: 5, sha256: SHA }], "b.apk")).toBeNull();
    expect(() => zeSeznamuSouboru([{ name: "a.apk", sha256: SHA }], "a.apk")).toThrow(/nemá otisk nebo velikost/);
  });
});

const REGISTR = "https://repo.example.test";
const OTISK_PODPISU = "4B:6E:9C:3E:90:DE:2B:9D:BF:76:5D:B2:B2:8F:B2:A7:20:5A:FB:23:B3:93:EA:5E:AC:13:5C:7F:BE:8A:28:00";
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

/** Deklarace ve tvaru dat instance (poznámky a pořadí klíčů jako v reálném souboru). */
function deklarace(zmena = {}) {
  return {
    $comment: "identita Kiosk Admina",
    applicationId: "com.example.kioskadmin",
    label: "Kiosk Admin",
    versionName: "1.4.0",
    versionCode: 5,
    kiosk: { package: "com.example.ridic" },
    signing: { certSha256: OTISK_PODPISU },
    apk: { _note: "otisk balíčku", sha256: A, velikostBajtu: 73268 },
    appky: [
      {
        _note: "appka řidiče",
        balicek: "com.example.ridic",
        versionCode: 14,
        versionName: "1.1.0",
        sha256: B,
        velikostBajtu: 52114514,
      },
    ],
    ...zmena,
  };
}
const text = (j) => JSON.stringify(j, null, 2) + "\n";
const PROFIL = { soubor: "profiles/x.json", obsah: JSON.stringify({ zarizeni: { hlidac: "zarizeni/hlidac.json" } }) };
const povrch = (povrch, bundleId, version, build) => ({
  povrch,
  obsah: JSON.stringify({ version, build, app: { bundleId } }),
});

describe("kde je deklarace zařízení", () => {
  it("jediná cesta napříč profily; stejná cesta ve dvou profilech je pořád jedna", () => {
    expect(cestaDeklarace([PROFIL, { soubor: "profiles/y.json", obsah: "{}" }])).toBe("zarizeni/hlidac.json");
    expect(cestaDeklarace([PROFIL, { ...PROFIL, soubor: "profiles/z.json" }])).toBe("zarizeni/hlidac.json");
  });

  it("žádný profil zařízení nechce → null (schopnost vypnutá, nic se nestaví)", () => {
    expect(cestaDeklarace([{ soubor: "profiles/x.json", obsah: "{}" }])).toBeNull();
  });

  it("⛔ dvě různé cesty = STOP, ne náhodná volba", () => {
    const jiny = { soubor: "profiles/y.json", obsah: JSON.stringify({ zarizeni: { hlidac: "jinde/hlidac.json" } }) };
    expect(() => cestaDeklarace([PROFIL, jiny])).toThrow(/různé cesty/);
  });

  it("⛔ cesta ven z dat instance neprojde (táž kontrola jako derivace)", () => {
    const ven = { soubor: "profiles/x.json", obsah: JSON.stringify({ zarizeni: { hlidac: "../etc/passwd" } }) };
    expect(() => cestaDeklarace([ven])).toThrow(/relativní cesta/);
  });
});

describe("který povrch appku staví", () => {
  const povrchy = [povrch("web", "com.example.app", "1.0.12", 26), povrch("ridic", "com.example.ridic", "1.1.0", 15)];

  it("podle app.bundleId (= jméno balíčku na Androidu)", () => {
    expect(povrchAppky(povrchy, "com.example.ridic")).toEqual({ povrch: "ridic", versionName: "1.1.0", versionCode: 15 });
  });

  it("⛔ žádný nebo dva povrchy = STOP", () => {
    expect(() => povrchAppky(povrchy, "com.example.nikdo")).toThrow(/žádný povrch/);
    expect(() => povrchAppky([...povrchy, povrch("ridic2", "com.example.ridic", "1.2.0", 16)], "com.example.ridic")).toThrow(
      /víc povrchů/,
    );
  });
});

describe("souřadnice v registru", () => {
  it("verze = versionName-versionCode, soubor nese balíček i verzi", () => {
    const s = souradnice({ registr: `${REGISTR}/`, vlastnik: "org", balicek: "com.example.ridic", versionName: "1.1.0", versionCode: 15 });
    expect(s).toEqual({
      verze: "1.1.0-15",
      soubor: "com.example.ridic-1.1.0-15.apk",
      url: `${REGISTR}/api/packages/org/generic/com.example.ridic/1.1.0-15/com.example.ridic-1.1.0-15.apk`,
      seznam: `${REGISTR}/api/v1/packages/org/generic/com.example.ridic/1.1.0-15/files`,
    });
  });

  it("⛔ nic, co by adresu rozbilo (lomítko, mezera, ..)", () => {
    expect(() => souradnice({ registr: REGISTR, vlastnik: "org", balicek: "x", versionName: "1.0/../../y", versionCode: 1 })).toThrow();
    expect(() => souradnice({ registr: REGISTR, vlastnik: "o g", balicek: "x", versionName: "1", versionCode: 1 })).toThrow();
  });
});

describe("rozhodnutí o jedné položce", () => {
  const cil = { versionName: "1.1.0", versionCode: 15 };
  const url = "https://repo.example.test/x.apk";
  const vRegistru = { sha256: C, bajtu: 10 };

  it("registr verzi nemá → postavit", () => {
    expect(rozhodni({ cil, deklarovano: { versionCode: 14 }, vRegistru: null, url }).akce).toBe("postavit");
  });

  it("deklarace uvádí přesně zveřejněný artefakt → nic", () => {
    const d = { ...cil, sha256: C.toUpperCase(), velikostBajtu: 10, zdroj: url };
    expect(rozhodni({ cil, deklarovano: d, vRegistru, url }).akce).toBe("nic");
  });

  it("chybí zdroj, jiný otisk nebo jiná velikost → deklarovat", () => {
    const d = { ...cil, sha256: C, velikostBajtu: 10, zdroj: url };
    expect(rozhodni({ cil, deklarovano: { ...d, zdroj: undefined }, vRegistru, url }).akce).toBe("deklarovat");
    expect(rozhodni({ cil, deklarovano: { ...d, sha256: A }, vRegistru, url }).akce).toBe("deklarovat");
    expect(rozhodni({ cil, deklarovano: { ...d, velikostBajtu: 11 }, vRegistru, url }).akce).toBe("deklarovat");
  });

  it("⛔ cíl pod rozdávanou verzí = STOP (kiosk bere jen vyšší versionCode)", () => {
    expect(() => rozhodni({ cil, deklarovano: { versionCode: 16 }, vRegistru, url })).toThrow(/NIŽŠÍ/);
  });
});

describe("plán", () => {
  const vstup = (j, registr = {}) => ({
    cti: (c) => (c === "zarizeni/hlidac.json" ? text(j) : null),
    profily: [PROFIL],
    povrchy: [povrch("ridic", "com.example.ridic", "1.1.0", 15)],
    dotazRegistru: async (s) => registr[s.soubor] ?? null,
    registr: REGISTR,
    vlastnik: "org",
  });

  it("appka se zvednutou verzí a Kiosk Admin bez artefaktu v registru → postavit oba", async () => {
    const plan = await naplanuj(vstup(deklarace()));
    expect(plan.polozky.map((p) => [p.druh, p.balicek, p.verze, p.akce])).toEqual([
      ["appka", "com.example.ridic", "1.1.0-15", "postavit"],
      ["kiosk-admin", "com.example.kioskadmin", "1.4.0-5", "postavit"],
    ]);
  });

  it("registr má postaveno → deklarovat; deklarace sedí → nic", async () => {
    const reg = { "com.example.ridic-1.1.0-15.apk": { sha256: C, bajtu: 99 } };
    expect((await naplanuj(vstup(deklarace(), reg))).polozky[0].akce).toBe("deklarovat");
    const url = `${REGISTR}/api/packages/org/generic/com.example.ridic/1.1.0-15/com.example.ridic-1.1.0-15.apk`;
    const hotovo = deklarace({
      appky: [{ balicek: "com.example.ridic", versionCode: 15, versionName: "1.1.0", sha256: C, velikostBajtu: 99, zdroj: url }],
    });
    expect((await naplanuj(vstup(hotovo, reg))).polozky[0].akce).toBe("nic");
  });

  it("instance bez zařízení → prázdný plán, registr se ani neptá", async () => {
    let dotazu = 0;
    const plan = await naplanuj({
      ...vstup(deklarace()),
      profily: [{ soubor: "profiles/x.json", obsah: "{}" }],
      dotazRegistru: async () => (dotazu++, null),
    });
    expect(plan).toEqual({ cesta: null, text: null, polozky: [] });
    expect(dotazu).toBe(0);
  });

  it("⛔ nad deklarací, kterou by konzument odmítl, se nestaví", async () => {
    await expect(naplanuj(vstup(deklarace({ signing: { certSha256: "abc" } })))).rejects.toThrow(/certSha256/);
  });

  it("⛔ NEDOSTUPNÝ registr není prázdný registr (jinak by se stavělo znovu a znovu)", async () => {
    const f = async () => new Response("chyba", { status: 502 });
    await expect(naplanuj({ ...vstup(deklarace()), dotazRegistru: registrZFetch({ token: "t", f }) })).rejects.toThrow(/502/);
  });

  it("registr: 404 = verze není; soubor v seznamu → jeho otisk a velikost", async () => {
    const s = souradnice({ registr: REGISTR, vlastnik: "org", balicek: "com.example.ridic", versionName: "1.1.0", versionCode: 15 });
    const volani = [];
    const f404 = async (u, init) => (volani.push([u, init.headers.Authorization]), new Response("", { status: 404 }));
    expect(await registrZFetch({ token: "t", f: f404 })(s)).toBeNull();
    expect(volani).toEqual([[s.seznam, "token t"]]);
    const f200 = async () => Response.json([{ name: "jiny.apk", sha256: A, size: 1 }, { name: s.soubor, sha256: C, size: 7 }]);
    expect(await registrZFetch({ token: "t", f: f200 })(s)).toEqual({ sha256: C, bajtu: 7 });
  });
});

describe("úprava deklarace", () => {
  const url = "https://repo.example.test/api/packages/org/generic/com.example.ridic/1.1.0-15/com.example.ridic-1.1.0-15.apk";
  const appka = { druh: "appka", balicek: "com.example.ridic", versionName: "1.1.0", versionCode: 15, url, akce: "deklarovat", vRegistru: { sha256: C, bajtu: 99 } };

  it("appka: změní se JEN verze a artefakt; poznámky, pořadí a zbytek souboru zůstanou", () => {
    const puvodni = text(deklarace());
    const novy = upravDeklaraci(puvodni, [appka], "zarizeni/hlidac.json");
    const j = JSON.parse(novy);
    expect(j.appky[0]).toEqual({
      _note: "appka řidiče", balicek: "com.example.ridic", versionCode: 15, versionName: "1.1.0",
      sha256: C, velikostBajtu: 99, zdroj: url,
    });
    expect(Object.keys(j.appky[0])).toEqual(["_note", "balicek", "versionCode", "versionName", "sha256", "velikostBajtu", "zdroj"]);
    // Kromě položky appky je soubor BAJT PO BAJTU stejný.
    expect({ ...j, appky: null }).toEqual({ ...deklarace(), appky: null });
    expect(novy.endsWith("}\n")).toBe(true);
  });

  it("Kiosk Admin: artefakt do `apk`, identita (verze, podpis, výbava) se nemění", () => {
    const kiosk = { druh: "kiosk-admin", balicek: "com.example.kioskadmin", versionName: "1.4.0", versionCode: 5, url: "https://repo.example.test/k.apk", akce: "deklarovat", vRegistru: { sha256: C, bajtu: 80000 } };
    const bezApk = deklarace();
    delete bezApk.apk;
    const j = JSON.parse(upravDeklaraci(text(bezApk), [kiosk], "zarizeni/hlidac.json"));
    expect(j.apk).toEqual({ sha256: C, velikostBajtu: 80000, zdroj: "https://repo.example.test/k.apk" });
    expect([j.versionName, j.versionCode, j.signing.certSha256]).toEqual(["1.4.0", 5, OTISK_PODPISU]);
  });

  it("položky „nic“ a „postavit“ deklaraci nemění", () => {
    const puvodni = text(deklarace());
    expect(upravDeklaraci(puvodni, [{ ...appka, akce: "postavit" }, { ...appka, akce: "nic" }], "x")).toBe(puvodni);
  });
});

describe("drobnosti, na kterých stojí idempotence", () => {
  it("blob SHA-1 odpovídá `git hash-object`", () => {
    expect(blobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(blobSha("čeština\n")).toBe(blobSha("čeština\n"));
  });

  it("táž změna = táž větev, jiný otisk = jiná větev", () => {
    const p = { balicek: "b", verze: "1-1", akce: "deklarovat", vRegistru: { sha256: C } };
    expect(vetevDeklarace([p])).toBe(vetevDeklarace([p]));
    expect(vetevDeklarace([p])).not.toBe(vetevDeklarace([{ ...p, vRegistru: { sha256: A } }]));
    expect(vetevDeklarace([p])).toMatch(/^ci\/zarizeni-[0-9a-f]{12}$/);
  });

  it("repo dat z tvaru INSTANCE_OVERLAY_REPO", () => {
    expect(repoDat("repo.example.test/org/data-instance.git")).toEqual({ api: "https://repo.example.test/api/v1", repo: "org/data-instance" });
    expect(() => repoDat("jen-host")).toThrow();
  });
});

describe("zveřejnění v registru", () => {
  const s = souradnice({ registr: REGISTR, vlastnik: "org", balicek: "com.example.ridic", versionName: "1.1.0", versionCode: 15 });
  const data = Buffer.from("apk");

  it("201 → zveřejněno, PUT na neměnnou adresu s tokenem", async () => {
    const volani = [];
    const f = async (u, init) => (volani.push([init.method, u, init.headers.Authorization]), new Response("", { status: 201 }));
    const v = await zverejni({ data, s, token: "t", f });
    expect(v.stav).toBe("zverejneno");
    expect(v.bajtu).toBe(3);
    expect(volani).toEqual([["PUT", s.url, "token t"]]);
  });

  it("409 a registr drží TÝŽ soubor → opakovaný běh, v pořádku", async () => {
    const { sha256 } = await zverejni({ data, s, token: "t", f: async () => new Response("", { status: 201 }) });
    const f = async (u, init) =>
      init?.method === "PUT" ? new Response("", { status: 409 }) : Response.json([{ name: s.soubor, sha256, size: 3 }]);
    expect((await zverejni({ data, s, token: "t", f })).stav).toBe("uz_tam_je");
  });

  it("⛔ 409 a registr drží JINÝ otisk → pád, verze se nepřepisuje", async () => {
    const f = async (u, init) =>
      init?.method === "PUT" ? new Response("", { status: 409 }) : Response.json([{ name: s.soubor, sha256: A, size: 3 }]);
    await expect(zverejni({ data, s, token: "t", f })).rejects.toThrow(/JINÝM otiskem/);
  });

  it("⛔ token bez práva zápisu → řekne to jménem", async () => {
    await expect(zverejni({ data, s, token: "t", f: async () => new Response("", { status: 403 }) })).rejects.toThrow(/write:package/);
  });
});

describe("PR s deklarací", () => {
  const polozky = [{ balicek: "com.example.ridic", verze: "1.1.0-15", versionName: "1.1.0", versionCode: 15, url: "https://r/x.apk", akce: "deklarovat", vRegistru: { sha256: C, bajtu: 9 } }];
  const zaklad = { api: "https://repo.example.test/api/v1", repo: "org/data", cesta: "zarizeni/hlidac.json", puvodni: "{}\n", novy: "{\"a\":1}\n", polozky, token: "t", beh: "https://beh/1" };

  function forgejo({ push = true, vetevExistuje = false, prExistuje = false, kontroly = [[{ context: "CI" }, "pending"]] } = {}) {
    const volani = [];
    let dotazuNaStav = 0;
    const f = async (u, init = {}) => {
      const m = init.method ?? "GET";
      const cesta = u.replace(zaklad.api, "");
      volani.push([m, cesta, init.body ? JSON.parse(init.body) : undefined]);
      if (m === "GET" && cesta === "/repos/org/data") return Response.json({ default_branch: "main", permissions: { push } });
      if (m === "GET" && /\/commits\/[^/]+\/status$/.test(cesta)) {
        const [statuses, state] = kontroly[Math.min(dotazuNaStav++, kontroly.length - 1)];
        return Response.json({ state, statuses: statuses ? [statuses].flat() : [] });
      }
      if (m === "GET" && cesta.startsWith("/repos/org/data/branches/")) return new Response("", { status: vetevExistuje ? 200 : 404 });
      if (m === "PUT" && cesta.startsWith("/repos/org/data/contents/")) return Response.json({}, { status: 201 });
      if (m === "GET" && cesta.startsWith("/repos/org/data/pulls?")) {
        return Response.json(prExistuje ? [{ number: 7, head: { ref: vetevDeklarace(polozky), sha: "h7" } }] : []);
      }
      if (m === "POST" && cesta === "/repos/org/data/pulls") return Response.json({ number: 8, head: { sha: "h8" } }, { status: 201 });
      if (m === "POST" && cesta.endsWith("/merge")) return new Response(null, { status: 200 });
      return new Response("neznámé volání", { status: 500 });
    };
    return { f, volani };
  }

  const spi = async () => {};

  it("nová změna: větev z hlavní s předpokladem verze souboru → PR → sloučit po zelené", async () => {
    const { f, volani } = forgejo();
    const v = await deklaruj({ ...zaklad, f, spi });
    expect(v).toEqual({ stav: "pr", cislo: 8, vetev: vetevDeklarace(polozky) });
    const zapis = volani.find(([m, c]) => m === "PUT");
    expect(zapis[1]).toBe("/repos/org/data/contents/zarizeni/hlidac.json");
    expect(zapis[2]).toMatchObject({ branch: "main", new_branch: vetevDeklarace(polozky), sha: blobSha("{}\n") });
    expect(Buffer.from(zapis[2].content, "base64").toString()).toBe("{\"a\":1}\n");
    expect(volani.at(-1)).toEqual(["POST", "/repos/org/data/pulls/8/merge", { Do: "merge", merge_when_checks_succeed: true, head_commit_id: "h8", delete_branch_after_merge: true }]);
  });

  it("opakovaný běh: větev i PR už jsou → nic se nezakládá znovu", async () => {
    const { f, volani } = forgejo({ vetevExistuje: true, prExistuje: true });
    expect((await deklaruj({ ...zaklad, f, spi })).cislo).toBe(7);
    expect(volani.filter(([m]) => m === "PUT" || m === "POST").map(([m, c]) => `${m} ${c}`)).toEqual(["POST /repos/org/data/pulls/7/merge"]);
  });

  it("⛔ token bez zápisu do dat → STOP dřív, než cokoli založí", async () => {
    const { f, volani } = forgejo({ push: false });
    await expect(deklaruj({ ...zaklad, f, spi })).rejects.toThrow(/nesmí zapisovat/);
    expect(volani.map(([m]) => m)).toEqual(["GET"]);
  });

  it("beze změny → žádné volání", async () => {
    const { f, volani } = forgejo();
    expect(await deklaruj({ ...zaklad, novy: zaklad.puvodni, f, spi })).toEqual({ stav: "beze_zmeny" });
    expect(volani).toEqual([]);
  });

  it("o sloučení se žádá, až CI dat na commitu PR OHLÁSÍ kontroly (ne dřív)", async () => {
    const { f, volani } = forgejo({ kontroly: [[null, ""], [null, ""], [{ context: "CI" }, "pending"]] });
    await deklaruj({ ...zaklad, f, spi });
    const poradi = volani.map(([m, c]) => (c.endsWith("/status") ? "stav" : c.endsWith("/merge") ? "merge" : null)).filter(Boolean);
    expect(poradi).toEqual(["stav", "stav", "stav", "merge"]);
  });

  it("⛔ CI dat se nerozběhne → NESLOUČENO a nahlas (bez ochrany větve by Forgejo sloučilo hned)", async () => {
    const { f, volani } = forgejo({ kontroly: [[null, ""]] });
    await expect(deklaruj({ ...zaklad, f, spi })).rejects.toThrow(/nerozběhlo/);
    expect(volani.some(([, c]) => c.endsWith("/merge"))).toBe(false);
  });

  it("⛔ kontroly už selhaly → NESLOUČENO", async () => {
    const { f, volani } = forgejo({ kontroly: [[{ context: "CI" }, "failure"]] });
    await expect(deklaruj({ ...zaklad, f, spi })).rejects.toThrow(/selhaly/);
    expect(volani.some(([, c]) => c.endsWith("/merge"))).toBe(false);
  });
});

describe("kontrola deklarace pro CI dat instance (náhrada ochrany z derivace)", () => {
  const data = (j) => ({
    cti: (c) => (c === "zarizeni/hlidac.json" ? (typeof j === "string" ? j : text(j)) : null),
    profily: [PROFIL],
    povrchy: [povrch("ridic", "com.example.ridic", "1.1.0", 15)],
  });

  it("platná deklarace projde a řekne, který povrch kterou appku staví", () => {
    expect(overDeklaraci(data(deklarace()))).toEqual({
      cesta: "zarizeni/hlidac.json",
      appky: [{ balicek: "com.example.ridic", povrch: "ridic", versionName: "1.1.0", versionCode: 15 }],
    });
  });

  it("instance bez zařízení = nic k ověření, žádná chyba", () => {
    expect(overDeklaraci({ ...data(deklarace()), profily: [{ soubor: "profiles/x.json", obsah: "{}" }] })).toEqual({ cesta: null, appky: [] });
  });

  it("⛔ vadná deklarace, rozbitý JSON, chybějící soubor i appka bez povrchu = CHYBA nahlas", () => {
    expect(() => overDeklaraci(data(deklarace({ signing: { certSha256: "abc" } })))).toThrow(/certSha256/);
    expect(() => overDeklaraci(data("{ nedopsané"))).toThrow(/není platný JSON/);
    expect(() => overDeklaraci({ ...data(deklarace()), cti: () => null })).toThrow(/soubor v datech instance není/);
    expect(() => overDeklaraci({ ...data(deklarace()), povrchy: [] })).toThrow(/žádný povrch/);
  });
});

describe("podpis balíku před zveřejněním", () => {
  const VYSTUP = [
    "Verifies",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "Signer #1 certificate DN: CN=Test",
    `Signer #1 certificate SHA-256 digest: ${"7bb86658d030fa9837595df5ed67f792c95b80bc6b7201e702a0e46c86bf9985"}`,
  ].join("\n");
  const OTISK_RIDICE = "7B:B8:66:58:D0:30:FA:98:37:59:5D:F5:ED:67:F7:92:C9:5B:80:BC:6B:72:01:E7:02:A0:E4:6C:86:BF:99:85";

  it("otisk z apksigneru → tvar deklarace (velká písmena, dvojtečky)", () => {
    expect(otiskZApksigneru(VYSTUP)).toBe(OTISK_RIDICE);
  });

  it("⛔ apksigner bez otisku (nepodepsané / neplatné APK) = STOP", () => {
    expect(() => otiskZApksigneru("DOES NOT VERIFY")).toThrow(/není \(platně\) podepsané/);
  });

  it("deklarovaný otisk projde bez ohledu na velikost písmen", () => {
    expect(() => overPodpis({ polozka: { balicek: "b", certSha256: OTISK_RIDICE.toLowerCase() }, otisk: OTISK_RIDICE })).not.toThrow();
  });

  it("⛔ jiný klíč nebo chybějící otisk v deklaraci = STOP (tablet by aktualizaci odmítal každou noc)", () => {
    expect(() => overPodpis({ polozka: { balicek: "b", certSha256: OTISK_RIDICE }, otisk: OTISK_RIDICE.replace("7B", "7C") })).toThrow(/JINÝM klíčem/);
    expect(() => overPodpis({ polozka: { balicek: "b", certSha256: null }, otisk: OTISK_RIDICE })).toThrow(/neuvádí otisk podpisu/);
  });

  it("plán nese deklarovaný otisk: appka z appky[].certSha256, Kiosk Admin ze signing.certSha256", async () => {
    const j = deklarace({ appky: [{ balicek: "com.example.ridic", versionCode: 14, versionName: "1.1.0", sha256: B, velikostBajtu: 1, certSha256: OTISK_RIDICE }] });
    const plan = await naplanuj({
      cti: (c) => (c === "zarizeni/hlidac.json" ? text(j) : null),
      profily: [PROFIL],
      povrchy: [povrch("ridic", "com.example.ridic", "1.1.0", 15)],
      dotazRegistru: async () => null,
      registr: REGISTR,
      vlastnik: "org",
    });
    expect(plan.polozky.map((p) => [p.druh, p.certSha256])).toEqual([["appka", OTISK_RIDICE], ["kiosk-admin", OTISK_PODPISU]]);
  });
});
