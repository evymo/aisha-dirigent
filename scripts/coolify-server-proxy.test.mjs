// Typ proxy serveru proti deklaraci slotu — proti FALEŠNÉMU Coolify API.
//
// Falešné API nese to, co je o skutečném změřené (POLE_PROXY v coolify-server-proxy.mjs,
// Coolify 4.3.16): čtení vrací `proxy.type` VELKÝMI písmeny, server bez proxy pole
// nemá vůbec; zápis je `PATCH` s polem `proxy_type` (traefik|caddy|none), neznámé
// pole i hodnota → 422; zápis `none` nastaví typ a `status: exited` (pole založí
// i serveru, který ho neměl), kontejner nezastaví (ten tu není — měří ho
// lib/kontejnery-uzlu.mjs).
//
// Kontrakt oprav F1 (T1–T3): každý test, který tvrdí „shoda / kód 0", má v TÉMŽE
// běhu kotvu, kde nástroj hlásí; kód 3 (NEMĚŘENO) nikdy neskončí jako 0.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createCoolifyClient } from "./lib/coolify-http.mjs";
import { PROXY_SERVERU, proxySlotu } from "./lib/sloty-serveru.mjs";
import { POLE_PROXY, UPOZORNENI_NONE, kodVysledku, slotyKMereni, srovnejProxy } from "./coolify-server-proxy.mjs";

const STROP_MS = 60_000;
const SKRIPT = fileURLToPath(new URL("./coolify-server-proxy.mjs", import.meta.url));
const SERVERS = {
  zaklad: { hostname: "${ZAKLAD_HOSTNAME}", role: "backend", coolify_uuid: "${X}", stacks: [] },
  uzel: { hostname: "${UZEL_HOSTNAME}", role: "gpu", coolify_uuid: "${X}", has_gpu: true, proxy: "none", stacks: [] },
};

let serverStav;
let pozadavky;
let http;
let url;
beforeAll(async () => {
  http = createServer((req, res) => {
    let telo = "";
    req.on("data", (d) => (telo += d));
    req.on("end", () => {
      pozadavky.push({ method: req.method, url: req.url, telo: telo ? JSON.parse(telo) : null });
      const m = /^\/api\/v1\/servers\/([^/]+)$/.exec(req.url ?? "");
      const s = m ? serverStav[decodeURIComponent(m[1])] : undefined;
      const odpovez = (kod, obj) => {
        res.writeHead(kod, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (!s) return odpovez(404, { message: "Server not found." });
      if (req.method === "PATCH") {
        // Změřený tvar zápisu: jediné známé pole těla je `proxy_type`, hodnoty
        // malými písmeny; cokoli jiného 422.
        const t = JSON.parse(telo);
        const nezname = Object.keys(t).filter((k) => k !== "proxy_type");
        if (nezname.length > 0) return odpovez(422, { message: "Validation failed.", errors: { [nezname[0]]: ["This field is not allowed."] } });
        if (!["traefik", "caddy", "none"].includes(t.proxy_type)) return odpovez(422, { message: "Validation failed.", errors: { proxy_type: ["The selected proxy type is invalid."] } });
        // Falešné API umí „potvrdit a zahodit“ (třída nespolehlivého zápisu) a
        // „potvrdit a uložit něco jiného“ (zpětné čtení pak dává jiný typ).
        if (s.zapisujeJinou) s.data.proxy = { type: s.zapisujeJinou, status: "exited" };
        else if (!s.zahazujeZapis) s.data.proxy = { type: t.proxy_type.toUpperCase(), status: "exited" };
        return odpovez(200, { uuid: decodeURIComponent(m[1]) });
      }
      return odpovez(200, s.data);
    });
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${http.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => http.close(r));
});
beforeEach(() => {
  pozadavky = [];
  serverStav = {
    "srv-uzel": { data: { uuid: "srv-uzel", name: "Uzel", ip: "192.0.2.9", proxy: { type: "TRAEFIK", status: "running" } } },
    "srv-gpu": { data: { uuid: "srv-gpu", name: "Uzel", ip: "192.0.2.9", proxy: { type: "TRAEFIK", status: "running" } } },
  };
});

const coolify = () => createCoolifyClient({ baseUrl: url, token: "zkusebni-token", timeoutMs: 5_000, maxRetries: 1 });
const SLOTY = [{ slot: "uzel", proxy: "none" }];
const ENV = { COOLIFY_SERVER_UUID_UZEL: "srv-uzel" };
const srovnej = (extra = {}) => srovnejProxy({ coolify: coolify(), sloty: SLOTY, env: ENV, servers: SERVERS, ...extra });
const zapisy = () => pozadavky.filter((p) => p.method !== "GET");

describe("deklarace proxy slotu (lib/sloty-serveru.mjs proxySlotu)", () => {
  it("výčet ve schématu registru = PROXY_SERVERU (opis se měří, ne věří)", () => {
    const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../coolify/servers.schema.json", import.meta.url)), "utf8"));
    expect(schema.definitions.Server.properties.proxy.enum).toEqual([...PROXY_SERVERU]);
  });

  it("bez deklarace = null (nic se nedosazuje); platná projde", () => {
    expect(proxySlotu({ has_traefik: true }, "a")).toEqual({ proxy: null, chyba: null });
    expect(proxySlotu({ proxy: "none", has_traefik: false }, "a")).toEqual({ proxy: "none", chyba: null });
    expect(proxySlotu({ proxy: "traefik", has_traefik: true }, "a")).toEqual({ proxy: "traefik", chyba: null });
  });

  it("⛔ neznámý typ i rozpor s has_traefik jsou chyba, ne tiché „žádná“", () => {
    expect(proxySlotu({ proxy: "None" }, "a").chyba).toMatch(/není traefik\|caddy\|none/);
    expect(proxySlotu({ proxy: "none", has_traefik: true }, "a").chyba).toMatch(/odporují/);
    expect(proxySlotu({ proxy: "caddy", has_traefik: true }, "a").chyba).toMatch(/odporují/);
  });

  it("registr instance: slot gpu deklaruje proxy none a Traefik nemá", () => {
    const registr = JSON.parse(readFileSync(fileURLToPath(new URL("../coolify/servers.json", import.meta.url)), "utf8"));
    expect(proxySlotu(registr.servers.gpu, "gpu")).toEqual({ proxy: "none", chyba: null });
  });
});

describe("výběr slotů k měření", () => {
  it("jen sloty v provozu, které proxy deklarují; mimo provoz se vypíše", () => {
    expect(slotyKMereni({ servers: SERVERS, vProvozu: ["zaklad", "uzel"] })).toEqual({ sloty: SLOTY, chyby: [], mimoProvoz: [] });
    expect(slotyKMereni({ servers: SERVERS, vProvozu: ["zaklad"] })).toEqual({ sloty: [], chyby: [], mimoProvoz: ["uzel"] });
  });

  it("⛔ --slot bez deklarace proxy nebo neznámý slot je chyba (výběr nesmí tiše neměřit nic)", () => {
    expect(slotyKMereni({ servers: SERVERS, vProvozu: [], jenSlot: "zaklad" }).chyby[0]).toMatch(/nedeklaruje/);
    expect(slotyKMereni({ servers: SERVERS, vProvozu: [], jenSlot: "neni" }).chyby[0]).toMatch(/není v coolify\/servers.json/);
  });
});

describe("pole proxy v API Coolify je ZMĚŘENÉ (POLE_PROXY)", () => {
  it("čtení `proxy.type`, zápis `proxy_type`, a poznámka říká kdy, na které verzi a jak", () => {
    expect([...POLE_PROXY.cteni]).toEqual(["proxy", "type"]);
    expect(POLE_PROXY.zapis).toBe("proxy_type");
    expect(POLE_PROXY.zmereno).toMatch(/^2026-10-03, Coolify 4\.3\.16/);
    expect(POLE_PROXY.zmereno).toMatch(/GETem na živém API/);
    expect(POLE_PROXY.zmereno).toMatch(/zpětné čtení/);
  });

  it("⛔ bez změřeného pole (cizí verze API) se typ NEČTE ani NEPÍŠE: neměřeno, jména klíčů bez hodnot", async () => {
    serverStav["srv-uzel"].data.proxy_stav = "x";
    const v = await srovnej({ pole: { cteni: null, zapis: null, zmereno: null }, apply: true });
    expect(v[0].stav).toBe("nemereno");
    expect(v[0].duvod).toMatch(/NENÍ ZMĚŘENÉ/);
    expect(v[0].duvod).toMatch(/proxy_stav/);
    expect(v[0].duvod).not.toMatch(/"x"|: x\b|TRAEFIK/);
    expect(kodVysledku(v)).toBe(3);
    expect(zapisy()).toEqual([]);
  });

  it("⛔ --apply bez změřeného pole pro ZÁPIS nic nepošle (nehádá se)", async () => {
    const v = await srovnej({ pole: { ...POLE_PROXY, zapis: null }, apply: true });
    expect(v[0].stav).toBe("nemereno");
    expect(kodVysledku(v)).toBe(3);
    expect(zapisy()).toEqual([]);
  });
});

describe("srovnání proti falešnému API (změřené pole)", () => {
  it("T1: API vrací typ proxy ≠ deklarace → rozdíl, kód 2, ŽÁDNÝ zápis; KOTVA: táž odpověď s typem = deklarace → shoda, kód 0", async () => {
    // Kotva napřed: táž odpověď, jen typ sedí s deklarací (API ho vrací velkými).
    serverStav["srv-uzel"].data.proxy.type = "NONE";
    const kotva = await srovnej();
    expect(kotva[0]).toMatchObject({ stav: "shoda", zive: "NONE" });
    expect(kodVysledku(kotva)).toBe(0);

    serverStav["srv-uzel"].data.proxy.type = "TRAEFIK";
    const v = await srovnej();
    expect(v[0]).toMatchObject({ stav: "rozdil", zive: "TRAEFIK", deklarace: "none" });
    expect(kodVysledku(v), "rozdíl se nesmí tvářit jako shoda").toBe(2);
    expect(zapisy(), "čtecí režim nezapisuje").toEqual([]);
  });

  /** Tvary odpovědi, ve kterých pole s typem proxy CHYBÍ (server proxy nikdy neměl) — žádný z nich není „none“. */
  const BEZ_POLE = [undefined, {}, { status: "exited" }, { type: null }, { type: "" }, "NONE"];
  const nastavProxy = (proxy) => {
    if (proxy === undefined) delete serverStav["srv-uzel"].data.proxy;
    else serverStav["srv-uzel"].data.proxy = proxy;
  };

  it("T2: odpověď API nemá pole proxy.type → ve čtecím běhu neměřeno, kód 3, nikdy 0, žádný zápis; KOTVA: odpověď s polem → kód 0", async () => {
    serverStav["srv-uzel"].data.proxy = { type: "NONE", status: "exited" };
    const kotva = await srovnej();
    expect(kodVysledku(kotva)).toBe(0);

    for (const proxy of BEZ_POLE) {
      nastavProxy(proxy);
      const v = await srovnej();
      expect(v[0].stav, `proxy=${JSON.stringify(proxy)}`).toBe("nemereno");
      expect(v[0].duvod).toMatch(/odpověď nemá pole proxy\.type/);
      expect(v[0].duvod).toMatch(/není 'none', srovná ho jen zápis \(--apply\)/);
      expect(kodVysledku(v), `proxy=${JSON.stringify(proxy)}`).toBe(3);
    }
    expect(zapisy(), "čtecí běh neměřený typ nepřepisuje").toEqual([]);
  });

  it("--apply na serveru BEZ pole proxy.type: deklarace se ZAPÍŠE a zpětné čtení ji ukáže → nastaveno, kód 0 (KOTVA); pole po zápisu dál chybí nebo nese jinou hodnotu → chyba, kód 1", async () => {
    for (const proxy of BEZ_POLE) {
      pozadavky = [];
      nastavProxy(proxy);
      const v = await srovnej({ apply: true });
      expect(v[0], `proxy=${JSON.stringify(proxy)}`).toMatchObject({ stav: "nastaveno", zive: "NONE", upozorneni: UPOZORNENI_NONE });
      expect(v[0].duvod).toBe("pole proxy.type chybělo → 'none' (typ v API ověřen zpětným čtením)");
      expect(kodVysledku(v)).toBe(0);
      expect(zapisy()).toEqual([{ method: "PATCH", url: "/api/v1/servers/srv-uzel", telo: { proxy_type: "none" } }]);
      expect(pozadavky.at(-1).method, "po zápisu musí přijít čtení").toBe("GET");
    }

    // API zápis potvrdí a zahodí: pole po zápisu dál chybí → chyba, ne „neměřeno“ a ne shoda.
    pozadavky = [];
    serverStav["srv-uzel"] = { zahazujeZapis: true, data: { uuid: "srv-uzel" } };
    const zahozeno = await srovnej({ apply: true });
    expect(zapisy(), "měřidlo: PATCH opravdu odešel").toHaveLength(1);
    expect(zahozeno[0]).toMatchObject({ stav: "chyba", zive: null });
    expect(zahozeno[0].duvod).toBe("Coolify zápis potvrdil, ale zpětné čtení pole proxy.type nemá místo 'none' — hodnota se nezapsala");
    expect(kodVysledku(zahozeno)).toBe(1);

    // API uloží jiný typ, než se zapisoval → chyba.
    serverStav["srv-uzel"] = { zapisujeJinou: "TRAEFIK", data: { uuid: "srv-uzel" } };
    const jina = await srovnej({ apply: true });
    expect(jina[0]).toMatchObject({ stav: "chyba", zive: "TRAEFIK" });
    expect(jina[0].duvod).toMatch(/zpětné čtení dává 'TRAEFIK' místo 'none'/);
    expect(kodVysledku(jina)).toBe(1);
  });

  it("T3: --apply, PATCH projde, zpětné čtení vrátí STAROU hodnotu → chyba, kód ≠ 0; KOTVA: zpětné čtení vrátí novou → nastaveno, kód 0", async () => {
    const kotva = await srovnej({ apply: true });
    expect(kotva[0]).toMatchObject({ stav: "nastaveno", zive: "NONE" });
    expect(kodVysledku(kotva)).toBe(0);
    expect(zapisy()).toEqual([{ method: "PATCH", url: "/api/v1/servers/srv-uzel", telo: { proxy_type: "none" } }]);
    expect(pozadavky.at(-1).method, "po zápisu musí přijít čtení").toBe("GET");

    pozadavky = [];
    serverStav["srv-uzel"] = { zahazujeZapis: true, data: { uuid: "srv-uzel", proxy: { type: "TRAEFIK", status: "running" } } };
    const v = await srovnej({ apply: true });
    expect(zapisy(), "měřidlo: PATCH opravdu odešel a prošel").toHaveLength(1);
    expect(v[0].stav).toBe("chyba");
    expect(v[0].duvod).toMatch(/nezapsala/);
    expect(v[0].zive).toBe("TRAEFIK");
    expect(kodVysledku(v)).toBe(1);
  });

  it("⛔ past zápisu `none`: API po zápisu hlásí NONE/exited — nástroj řekne, že shoda typu v API není důkaz, že proxy neběží", async () => {
    const v = await srovnej({ apply: true });
    expect(serverStav["srv-uzel"].data.proxy).toEqual({ type: "NONE", status: "exited" });
    expect(v[0].upozorneni).toBe(UPOZORNENI_NONE);
    expect(UPOZORNENI_NONE).toMatch(/NEZASTAVÍ/);
    expect(UPOZORNENI_NONE).toMatch(/není důkaz, že proxy neběží/);
    expect(UPOZORNENI_NONE).toMatch(/kontejnery-uzlu\.mjs/);
    // I pouhá shoda při čtení nese totéž upozornění; rozdíl ne (tam je co srovnat).
    expect((await srovnej())[0]).toMatchObject({ stav: "shoda", upozorneni: UPOZORNENI_NONE });
    serverStav["srv-uzel"].data.proxy.type = "CADDY";
    expect((await srovnej())[0]).toMatchObject({ stav: "rozdil", upozorneni: null });
  });

  it("⛔ neznámé UUID slotu = neměřeno, ne shoda", async () => {
    const v = await srovnej({ env: {} });
    expect(v[0]).toMatchObject({ stav: "nemereno", duvod: expect.stringMatching(/COOLIFY_SERVER_UUID_UZEL nenastaveno/) });
    expect(kodVysledku(v)).toBe(3);
    expect(pozadavky).toEqual([]);
  });

  it("⛔ zápis, který API odmítne (422), je chyba (kód 1) — a falešné API neznámé pole opravdu odmítá", async () => {
    const v = await srovnej({ pole: { ...POLE_PROXY, zapis: "proxy" }, apply: true });
    expect(v[0].stav).toBe("chyba");
    expect(v[0].duvod).toMatch(/PATCH serveru selhal/);
    expect(kodVysledku(v)).toBe(1);
    expect(serverStav["srv-uzel"].data.proxy.type, "odmítnutý zápis nic nezměnil").toBe("TRAEFIK");
  });

  it("server, který Coolify nezná: chyba (kód 1)", async () => {
    const v = await srovnej({ env: { COOLIFY_SERVER_UUID_UZEL: "neni" } });
    expect(v[0].stav).toBe("chyba");
    expect(kodVysledku(v)).toBe(1);
  });

  it("kód podle nejvážnějšího nálezu: chyba 1 > rozdíl 2 > neměřeno 3 > 0; vadná deklarace má přednost", () => {
    const z = (stav) => ({ stav });
    expect(kodVysledku([z("shoda"), z("nastaveno")])).toBe(0);
    expect(kodVysledku([z("shoda"), z("nemereno")])).toBe(3);
    expect(kodVysledku([z("nemereno"), z("rozdil")])).toBe(2);
    expect(kodVysledku([z("rozdil"), z("chyba")])).toBe(1);
    expect(kodVysledku([], ["slot 'x': proxy=\"None\" není traefik|caddy|none"])).toBe(1);
  });
});

function spust(extra = {}, args = []) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(COOLIFY_|ACCEL_|AISHA_|APP_NAME_PREFIX$|ENV_FILE$)/.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, { COOLIFY_URL: url, COOLIFY_API_TOKEN: "zkusebni-token", ...extra });
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SKRIPT, ...args], { env });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (kod) => resolve({ kod, out, err }));
  });
}
// Slot gpu v provozu = otevřená lane některé jeho služby (tady vstup lane accel-vstup).
const LANE = { ACCEL_DEKLARACE_B64: "x", COOLIFY_SERVER_UUID_GPU: "srv-gpu" };

describe("CLI nad registrem repa (návratový kód procesu)", () => {
  it("bez zapnuté lane: slot gpu se neměří a výpis to ŘÍKÁ (kód 0, žádný požadavek)", async () => {
    const r = await spust();
    expect(r.kod, r.err).toBe(0);
    expect(r.out).toMatch(/slot 'gpu' deklaruje proxy, ale není v provozu/);
    expect(pozadavky).toEqual([]);
  }, STROP_MS);

  it("T1 (CLI): typ ≠ deklarace → kód 2 a řádek ✗; KOTVA: typ = deklarace → kód 0, řádek ✓ a upozornění, že typ v API není důkaz", async () => {
    serverStav["srv-gpu"].data.proxy = { type: "NONE", status: "exited" };
    const kotva = await spust(LANE);
    expect(kotva.kod, kotva.err).toBe(0);
    expect(kotva.out).toMatch(/^✓ gpu .*typ proxy v API 'NONE' = deklarace$/m);
    expect(kotva.out).toMatch(/^· gpu: typ 'none' v API Coolify běžící kontejner proxy NEZASTAVÍ/m);

    serverStav["srv-gpu"].data.proxy = { type: "TRAEFIK", status: "running" };
    const r = await spust(LANE);
    expect(r.kod, r.err).toBe(2);
    expect(r.out).toMatch(/^✗ gpu .*Coolify: 'TRAEFIK', deklarace: 'none'$/m);
    expect(r.out).not.toMatch(/^✓/m);
    expect(zapisy()).toEqual([]);
  }, STROP_MS);

  it("T2 (CLI): odpověď bez proxy.type → kód 3, řádek `? … NEMĚŘENO` a žádný zápis; KOTVA: s polem → kód 0", async () => {
    serverStav["srv-gpu"].data.proxy = { type: "NONE", status: "exited" };
    expect((await spust(LANE)).kod).toBe(0);

    // Server, který proxy nikdy neměl — čtecí běh ho jen přizná.
    delete serverStav["srv-gpu"].data.proxy;
    const r = await spust(LANE);
    expect(r.kod, r.err).toBe(3);
    expect(r.out).toMatch(/^\? gpu .*NEMĚŘENO — odpověď nemá pole proxy\.type/m);
    expect(r.out).not.toMatch(/^✓/m);
    expect(zapisy()).toEqual([]);
  }, STROP_MS);

  it("(CLI) --apply na serveru bez proxy.type: zapíše deklaraci a ověří → kód 0; KOTVA selhání: API zápis zahodí → kód 1", async () => {
    delete serverStav["srv-gpu"].data.proxy;
    const r = await spust(LANE, ["--apply"]);
    expect(r.kod, r.err).toBe(0);
    expect(r.out).toMatch(/^✓ gpu .*pole proxy\.type chybělo → 'none' \(typ v API ověřen zpětným čtením\)$/m);
    expect(zapisy()).toEqual([{ method: "PATCH", url: "/api/v1/servers/srv-gpu", telo: { proxy_type: "none" } }]);

    serverStav["srv-gpu"] = { zahazujeZapis: true, data: { uuid: "srv-gpu" } };
    const zahozeno = await spust(LANE, ["--apply"]);
    expect(zahozeno.kod, zahozeno.err).toBe(1);
    expect(zahozeno.out).toMatch(/^✗ gpu .*zpětné čtení pole proxy\.type nemá místo 'none' — hodnota se nezapsala$/m);
  }, STROP_MS);

  it("T2 (CLI): --json nese kód 3 i stav `nemereno` (strojový čtenář nesmí dostat shodu)", async () => {
    delete serverStav["srv-gpu"].data.proxy;
    const j = await spust(LANE, ["--json"]);
    expect(j.kod).toBe(3);
    const telo = JSON.parse(j.out);
    expect(telo.kod).toBe(3);
    expect(telo.sloty).toHaveLength(1);
    expect(telo.sloty[0]).toMatchObject({ slot: "gpu", deklarace: "none", stav: "nemereno", zive: null });
  }, STROP_MS);

  it("T3 (CLI): --apply a API zápis zahodí → kód 1; KOTVA: --apply se zápisem, který platí → kód 0 a zpětné čtení", async () => {
    const kotva = await spust(LANE, ["--apply"]);
    expect(kotva.kod, kotva.err).toBe(0);
    expect(kotva.out).toMatch(/^✓ gpu .*'TRAEFIK' → 'none' \(typ v API ověřen zpětným čtením\)$/m);
    expect(zapisy()).toEqual([{ method: "PATCH", url: "/api/v1/servers/srv-gpu", telo: { proxy_type: "none" } }]);
    expect(pozadavky.at(-1).method).toBe("GET");

    pozadavky = [];
    serverStav["srv-gpu"] = { zahazujeZapis: true, data: { uuid: "srv-gpu", proxy: { type: "TRAEFIK", status: "running" } } };
    const r = await spust(LANE, ["--apply"]);
    expect(zapisy()).toHaveLength(1);
    expect(r.kod, r.err).toBe(1);
    expect(r.out).toMatch(/^✗ gpu .*hodnota se nezapsala$/m);
  }, STROP_MS);

  it("neznámý přepínač: kód 1 s použitím", async () => {
    const r = await spust({}, ["--nevim"]);
    expect(r.kod).toBe(1);
    expect(r.err).toMatch(/použití/);
  }, STROP_MS);
});
