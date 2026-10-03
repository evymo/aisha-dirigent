import { describe, expect, it } from "vitest";
import {
  anonKlicZApi,
  anonKliceVTextu,
  formatEnv,
  overAnonKlic,
  payloadJwt,
  porovnejSNasazenou,
  skriptyZIndexu,
  slozTvar,
  realmZIssueru,
} from "./verejna-tvar.mjs";

const jwt = (payload) =>
  [{ alg: "HS256", typ: "JWT" }, payload].map((x) => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".") + ".podpis";
const ANON = jwt({ role: "anon", iss: "aisha", exp: 2_257_000_000 });
const JINY_ANON = jwt({ role: "anon", iss: "jina-instance", exp: 2_257_000_000 });
const SERVICE = jwt({ role: "service_role", iss: "aisha", exp: 2_257_000_000 });

describe("anon klíč: jen role anon", () => {
  it("anon projde a vrátí payload", () => {
    expect(overAnonKlic(ANON)).toMatchObject({ role: "anon", iss: "aisha" });
  });

  it("⛔ service_role, vypršelý klíč a ne-JWT = STOP (do appky se nesmí dostat)", () => {
    expect(() => overAnonKlic(SERVICE)).toThrow(/service_role/);
    expect(() => overAnonKlic(jwt({ role: "anon", exp: 1_000 }))).toThrow(/vypršel/);
    expect(() => overAnonKlic("nejwt")).toThrow(/není JWT/);
    expect(() => payloadJwt("a.b.c")).toThrow(/nejde přečíst/);
  });

  it("v textu bundlu najde jen anon klíče, service_role přeskočí", () => {
    expect(anonKliceVTextu(`x="${ANON}";y="${SERVICE}";z="${ANON}"`)).toEqual([ANON]);
  });
});

describe("ověření proti nasazené instanci", () => {
  const spi = async () => {};
  const web = (soubory) => async (url) => {
    const cesta = url.replace("https://web.example.test", "");
    if (soubory[cesta] instanceof Error) throw soubory[cesta];
    if (soubory[cesta] === undefined) return new Response("nic", { status: 404 });
    return new Response(soubory[cesta], { status: 200 });
  };
  const INDEX = '<script type="module" src="/assets/vendor-a.js"></script><link rel="modulepreload" href="/assets/shared-b.js">';

  it("index.html → skripty (src i modulepreload)", () => {
    expect(skriptyZIndexu(INDEX)).toEqual(["/assets/vendor-a.js", "/assets/shared-b.js"]);
  });

  it("bundle nese TÝŽ anon klíč → shoda", async () => {
    const f = web({ "/": INDEX, "/assets/vendor-a.js": "kód", "/assets/shared-b.js": `k="${ANON}"` });
    expect(await porovnejSNasazenou({ klic: ANON, appDomain: "web.example.test", f, spi })).toEqual({ stav: "shoda" });
  });

  it("přechodný výpadek sítě se zopakuje; trvalý zůstane NEZMĚŘENO", async () => {
    let pokusu = 0;
    const kolisava = async (url) => {
      if (url.endsWith("/") && ++pokusu < 3) throw new Error("ECONNRESET");
      return web({ "/": INDEX, "/assets/vendor-a.js": "", "/assets/shared-b.js": `k="${ANON}"` })(url);
    };
    expect(await porovnejSNasazenou({ klic: ANON, appDomain: "web.example.test", f: kolisava, spi })).toEqual({ stav: "shoda" });
    expect(pokusu).toBe(3);
    const vzdy = async () => { throw new Error("ECONNREFUSED"); };
    expect((await porovnejSNasazenou({ klic: ANON, appDomain: "web.example.test", f: vzdy, spi })).stav).toBe("nezmereno");
  });

  it("⛔ bundle nese JINÝ anon klíč → neshoda (STOP)", async () => {
    const f = web({ "/": INDEX, "/assets/vendor-a.js": "", "/assets/shared-b.js": `k="${JINY_ANON}"` });
    expect(await porovnejSNasazenou({ klic: ANON, appDomain: "web.example.test", f, spi })).toMatchObject({ stav: "neshoda" });
  });

  it("⛔ web nedostupný, chybí skripty nebo bundle bez klíče → NEZMĚŘENO s důvodem (ne tichý průchod)", async () => {
    const pripady = [
      [web({ "/": new Error("ECONNREFUSED") }), /nedostupný/],
      [web({}), /vrátil 404/],
      [web({ "/": "<html></html>" }), /nenačítá žádné/],
      [web({ "/": INDEX, "/assets/vendor-a.js": "", "/assets/shared-b.js": "bez klíče" }), /nenese žádný anon klíč/],
      [web({ "/": INDEX, "/assets/vendor-a.js": new Error("timeout"), "/assets/shared-b.js": "" }), /vendor-a\.js nedostupný/],
    ];
    for (const [f, duvod] of pripady) {
      const v = await porovnejSNasazenou({ klic: ANON, appDomain: "web.example.test", f, spi });
      expect(v.stav).toBe("nezmereno");
      expect(v.duvod).toMatch(duvod);
    }
  });
});

describe("složení tváře", () => {
  const topologie = { PUBLIC_TLD: "example.test", API_DOMAIN_PUBLIC: "api.example.test", AUTH_DOMAIN_PUBLIC: "auth.example.test", APP_DOMAIN: "web.example.test" };
  const knock = { host: "example.test", port: 18181, kid: "ridic", scope: "ops" };

  it("domény z derivace, realm ze šablony, dveře z výbavy kiosku, anon klíč", () => {
    const t = slozTvar({ topologie, realm: "aisha", knock, brand: { slug: "ridic" }, anonKlic: ANON });
    expect(t).toEqual({ ...topologie, KEYCLOAK_REALM: "aisha", ANON_KEY: ANON, SPA_KNOCK_PUBLIC_HOST: "example.test", SPA_KNOCK_PUBLIC_PORT: "18181" });
    expect(formatEnv(t)).toMatch(/^PUBLIC_TLD=example\.test\n[\s\S]*SPA_KNOCK_PUBLIC_PORT=18181\n$/);
  });

  it("výslovný knock.kid v brandu má přednost před slugem", () => {
    expect(() => slozTvar({ topologie, realm: "aisha", knock, brand: { slug: "jiny", knock: { kid: "ridic" } }, anonKlic: ANON })).not.toThrow();
  });

  it("⛔ chybějící doména z derivace, rozjetý kid dveří nebo zakázaný znak = STOP", () => {
    expect(() => slozTvar({ topologie: { ...topologie, APP_DOMAIN: "" }, realm: "aisha", knock, brand: { slug: "ridic" }, anonKlic: ANON })).toThrow(/APP_DOMAIN/);
    expect(() => slozTvar({ topologie, realm: "aisha", knock, brand: { slug: "jina-appka" }, anonKlic: ANON })).toThrow(/dveře by appku nepoznaly/);
    expect(() => slozTvar({ topologie, realm: 'ai"sha', knock, brand: { slug: "ridic" }, anonKlic: ANON })).toThrow(/KEYCLOAK_REALM/);
  });

  it("realm z auth.issuer povrchu; host issueru musí sedět s derivací", () => {
    expect(realmZIssueru("https://auth.example.test/realms/instance", "auth.example.test")).toBe("instance");
    expect(realmZIssueru("https://auth.example.test/realms/instance/", "auth.example.test")).toBe("instance");
  });

  it("⛔ chybějící / vadný issuer nebo jiný host = STOP (realm se nehádá)", () => {
    expect(() => realmZIssueru(undefined, "auth.example.test")).toThrow(/nehádám/);
    expect(() => realmZIssueru("https://auth.example.test/jinde", "auth.example.test")).toThrow(/nemá tvar/);
    expect(() => realmZIssueru("https://auth.cizi.test/realms/instance", "auth.example.test")).toThrow(/nesoulad/);
  });
});

describe("anon klíč z veřejné konfigurace API (žádné tajemství forku — majitel 28. 9.)", () => {
  const odpoved = (status, telo) => ({ ok: status === 200, status, json: async () => telo });
  const bezCekani = () => Promise.resolve();

  it("vezme anon_key z https://<API>/.well-known/app-config.json", async () => {
    const volano = [];
    const f = async (url) => (volano.push(url), odpoved(200, { anon_key: ` ${ANON} `, web_url: "x" }));
    expect(await anonKlicZApi({ apiDomain: "api.instance.test", f })).toEqual({ stav: "ok", klic: ANON });
    expect(volano).toEqual(["https://api.instance.test/.well-known/app-config.json"]);
  });

  it("přechodný výpadek sítě se zopakuje; trvalý = NEZMĚŘENO (STOP), žádná náhradní hodnota", async () => {
    let pokus = 0;
    const jednou = async () => {
      if (++pokus === 1) throw new Error("ECONNRESET");
      return odpoved(200, { anon_key: ANON });
    };
    expect(await anonKlicZApi({ apiDomain: "a", f: jednou, spi: bezCekani })).toEqual({ stav: "ok", klic: ANON });
    const nikdy = async () => { throw new Error("ENOTFOUND"); };
    expect(await anonKlicZApi({ apiDomain: "a", f: nikdy, spi: bezCekani })).toMatchObject({ stav: "nezmereno" });
  });

  it("⛔ jiný stav než 200, odpověď bez klíče nebo ne-JSON = NEZMĚŘENO s důvodem", async () => {
    expect(await anonKlicZApi({ apiDomain: "a", f: async () => odpoved(503, {}) }))
      .toEqual({ stav: "nezmereno", duvod: "API https://a/.well-known/app-config.json vrátilo 503" });
    expect(await anonKlicZApi({ apiDomain: "a", f: async () => odpoved(200, { web_url: "x" }) }))
      .toMatchObject({ stav: "nezmereno", duvod: expect.stringMatching(/neuvádí anon_key/) });
    const neJson = async () => ({ ok: true, status: 200, json: async () => { throw new Error("x"); } });
    expect(await anonKlicZApi({ apiDomain: "a", f: neJson })).toMatchObject({ duvod: expect.stringMatching(/nevrátilo JSON/) });
  });

  it("⛔ klíč z API s jinou rolí neprojde (overAnonKlic platí i pro zdroj API)", async () => {
    const r = await anonKlicZApi({ apiDomain: "a", f: async () => odpoved(200, { anon_key: SERVICE }) });
    expect(r.stav).toBe("ok");
    expect(() => overAnonKlic(r.klic)).toThrow(/service_role/);
  });
});
