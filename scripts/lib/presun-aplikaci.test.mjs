// Přesun existující aplikace na jiný server (kontrakt d8 U3, UT3): konvergence ho
// neprovede (Coolify mění server jen při založení), takže krok 0 musí říct nahlas,
// co se stane — držená = DRŽENO a nic se nehýbe, ostatní = STOP s pojmenovanou cestou.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { storyManifestu, verdiktyPresunu } from "./presun-aplikaci.mjs";

const STROP_MS = 60_000;
const SKRIPT = fileURLToPath(new URL("./presun-aplikaci.mjs", import.meta.url));
const PROJEKT = "projekt-zkouska";

describe("verdiktyPresunu — pravidla", () => {
  const drift = {
    serverDrift: [{ name: "zkouska-model", liveServer: "server-stary-0001", expectedServer: "server-novy-0002", expectedHost: "gpu", uuid: "m1" }],
    serverUnmeasured: [],
  };

  it("nedržená aplikace na jiném serveru = STOP (1) s pojmenovanou cestou --rewarmup", () => {
    const v = verdiktyPresunu(drift, { story: "zkouska", drzene: [] });
    expect(v).toEqual([expect.objectContaining({ kod: 1, aplikace: "zkouska-model" })]);
    expect(v[0].zprava).toContain("--rewarmup=zkouska-model");
    expect(v[0].zprava).toMatch(/NEPŘESUNE/);
  });

  it("držená aplikace = DRŽENO (0), přesun čeká na uvolnění; role se bere bez prefixu story", () => {
    const v = verdiktyPresunu(drift, { story: "zkouska", drzene: [{ aplikace: "model" }] });
    expect(v).toEqual([expect.objectContaining({ kod: 0 })]);
    expect(v[0].zprava).toMatch(/^DRŽENO: zkouska-model/);
  });

  it("držení jiné aplikace přesun nekryje (kotva: role musí sedět přesně)", () => {
    expect(verdiktyPresunu(drift, { story: "zkouska", drzene: [{ aplikace: "web-render" }] })[0].kod).toBe(1);
  });

  it("plánovaný wipe nebo rewarmup té aplikace: přesun provede operace sama = PŘESUN (0), ne STOP", () => {
    expect(verdiktyPresunu(drift, { story: "zkouska", drzene: [], planovanyWipe: true })[0]).toEqual(expect.objectContaining({ kod: 0 }));
    const r = verdiktyPresunu(drift, { story: "zkouska", drzene: [], planovanyRewarmup: ["zkouska-model"] });
    expect(r[0]).toEqual(expect.objectContaining({ kod: 0 }));
    expect(r[0].zprava).toMatch(/^PŘESUN: zkouska-model se přesune plánovaným rewarmupem/);
    expect(verdiktyPresunu(drift, { story: "zkouska", drzene: [], planovanyRewarmup: ["zkouska-jina"] })[0].kod, "kotva: rewarmup jiné aplikace nekryje").toBe(1);
    // Holá role: cold-start ji mezi aplikacemi nenajde a nic nepřestaví → STOP zůstává.
    expect(verdiktyPresunu(drift, { story: "zkouska", drzene: [], planovanyRewarmup: ["model"] })[0].kod, "holá role = STOP").toBe(1);
  });

  it("držení má přednost i před plánovaným rewarmupem (cold-start drženou nepřestaví)", () => {
    expect(verdiktyPresunu(drift, { story: "zkouska", drzene: [{ aplikace: "model" }], planovanyRewarmup: ["zkouska-model"] })[0].zprava).toMatch(/^DRŽENO/);
  });

  it("nezměřený server = NEZMĚŘENO (2); bez driftu nic", () => {
    expect(verdiktyPresunu({ serverDrift: [], serverUnmeasured: [{ name: "zkouska-x", reason: "COOLIFY_SERVER_UUID_GPU nenastaveno" }] }, { story: "zkouska", drzene: [] }))
      .toEqual([expect.objectContaining({ kod: 2 })]);
    expect(verdiktyPresunu({ serverDrift: [], serverUnmeasured: [] }, { story: "zkouska", drzene: [] })).toEqual([]);
  });

  it("story z manifestu; bez řádku story nic", () => {
    expect(storyManifestu("# x\nstory: zkouska\napp: a:b:c\n")).toBe("zkouska");
    expect(storyManifestu("app: a:b:c\n")).toBeNull();
  });
});

// Celá cesta: skutečný drift-check proti falešnému Coolify API, které ZAPISUJE každé volání.
describe("presun-aplikaci CLI proti falešnému Coolify API", () => {
  const APLIKACE = [
    // Skutečný tvar odpovědi API: server v destination.server.uuid (ne server_uuid).
    { name: "zkouska-model", uuid: "m1", destination: { uuid: "d1", server: { uuid: "server-stary-0001" } }, environment_id: 7, docker_compose_location: "/docker-compose.coolify-model.yml" },
  ];
  const volani = [];
  let server;
  let url;
  let dir;
  let overlayDrzeny;
  let overlayPrazdny;
  let manifest;

  beforeAll(async () => {
    server = createServer((req, res) => {
      volani.push(`${req.method} ${req.url}`);
      const telo =
        req.method === "GET" && req.url === "/api/v1/applications" ? APLIKACE
        : req.method === "GET" && req.url === `/api/v1/projects/${PROJEKT}` ? { uuid: PROJEKT, environments: [{ id: 7, name: "production" }] }
        : null;
      res.writeHead(telo ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(telo ?? { message: "not found" }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${server.address().port}`;
    dir = mkdtempSync(join(tmpdir(), "presun-"));
    manifest = join(dir, "zkouska.manifest");
    writeFileSync(manifest, "story: zkouska\napp: model:gpu:docker-compose.coolify-model.yml\n");
    overlayPrazdny = join(dir, "overlay-prazdny");
    mkdirSync(overlayPrazdny);
    overlayDrzeny = join(dir, "overlay-drzeny");
    mkdirSync(overlayDrzeny);
    writeFileSync(
      join(overlayDrzeny, "nasazeni-drzene.json"),
      JSON.stringify([
        { aplikace: "model", duvod: "zkouška: model se nepřesouvá", rozhodnuti: { kdo: "zkouška", datum: "2026-10-01", odkaz: "test presun-aplikaci" } },
      ]),
    );
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  function spust(extra) {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^(COOLIFY_|AISHA_|APP_NAME_PREFIX$|ENV_PROD_BACKUP$|ENV_FILE$)/.test(k)) continue;
      env[k] = v;
    }
    Object.assign(env, {
      COOLIFY_BASE_URL: url,
      COOLIFY_API_TOKEN: "zkusebni-token",
      COOLIFY_PROJECT_UUID: PROJEKT,
      APP_NAME_PREFIX: "zkouska",
      ...extra,
    });
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [SKRIPT, "--manifest", manifest], { env });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (kod) => resolve({ kod, out, err }));
    });
  }
  const mutace = () => volani.filter((v) => !v.startsWith("GET "));

  it("kotva: aplikace na deklarovaném serveru = 0, žádný přesun nečeká", async () => {
    const r = await spust({ COOLIFY_SERVER_UUID_GPU: "server-stary-0001", AISHA_INSTANCE_CONFIG_DIR: overlayPrazdny });
    expect(r.kod, r.err).toBe(0);
    expect(r.out).toMatch(/žádná aplikace neběží jinde/);
  }, STROP_MS);

  it("nedržený model na starém serveru, manifest říká gpu = STOP 1 s --rewarmup; 0 mutací Coolify", async () => {
    volani.length = 0;
    const r = await spust({ COOLIFY_SERVER_UUID_GPU: "server-novy-0002", AISHA_INSTANCE_CONFIG_DIR: overlayPrazdny });
    expect(r.kod, r.err + r.out).toBe(1);
    expect(r.err).toMatch(/STOP zkouska-model běží na serveru server-stary…, manifest deklaruje slot 'gpu'/);
    expect(r.err).toContain("--rewarmup=zkouska-model");
    expect(volani.length, "falešné API nedostalo žádné volání — test nic neměřil").toBeGreaterThan(0);
    expect(mutace()).toEqual([]);
  }, STROP_MS);

  it("DRŽENÝ model na starém serveru = DRŽENO 0, pokračuje se; 0 mutací Coolify (UT3)", async () => {
    volani.length = 0;
    const r = await spust({ COOLIFY_SERVER_UUID_GPU: "server-novy-0002", AISHA_INSTANCE_CONFIG_DIR: overlayDrzeny });
    expect(r.kod, r.err + r.out).toBe(0);
    expect(r.out).toMatch(/^DRŽENO: zkouska-model zůstává na serveru server-stary…, manifest deklaruje slot 'gpu'/m);
    expect(volani.length).toBeGreaterThan(0);
    expect(mutace()).toEqual([]);
  }, STROP_MS);

  it("cesta ven: plánovaný rewarmup téže aplikace = 0, STOP nebrání operaci, která přesun provede", async () => {
    const env = { COOLIFY_SERVER_UUID_GPU: "server-novy-0002", AISHA_INSTANCE_CONFIG_DIR: overlayPrazdny };
    const r = await new Promise((resolve) => {
      const e = {};
      for (const [k, v] of Object.entries(process.env)) if (!/^(COOLIFY_|AISHA_|APP_NAME_PREFIX$|ENV_PROD_BACKUP$|ENV_FILE$)/.test(k)) e[k] = v;
      Object.assign(e, { COOLIFY_BASE_URL: url, COOLIFY_API_TOKEN: "zkusebni-token", COOLIFY_PROJECT_UUID: PROJEKT, APP_NAME_PREFIX: "zkouska", ...env });
      const p = spawn(process.execPath, [SKRIPT, "--manifest", manifest, "--planovany-rewarmup", "zkouska-model"], { env: e });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (kod) => resolve({ kod, out, err }));
    });
    expect(r.kod, r.err + r.out).toBe(0);
    expect(r.out).toMatch(/^PŘESUN: zkouska-model se přesune plánovaným rewarmupem/m);
  }, STROP_MS);

  // Vlastnictví z topologie (dávka 3): služba s `external_domain` v profilu prostředí není
  // naše — nezakládáme, nenasazujeme, nemažeme ji. Přesun ji proto nesmí zastavit, ať běží
  // kdekoli (např. sangha → cache.aisha.guru místo vlastní registry). Kotva: táž aplikace
  // jako VLASTNÍ (prázdná proměnná = deklarace „vlastní“) STOP dostane.
  it("EXTERNÍ aplikace (external_domain v profilu) na jiném serveru = žádný STOP; kotva: vlastní = STOP", async () => {
    const overlay = join(dir, "overlay-externi");
    mkdirSync(join(overlay, "profiles"), { recursive: true });
    writeFileSync(join(overlay, "profiles", "zk.json"), JSON.stringify({ id: "zk", service_overrides: { model: { placement: "gpu", external_domain: "${MODEL_EXTERNI}" } } }));
    const env = { COOLIFY_SERVER_UUID_GPU: "server-novy-0002", AISHA_INSTANCE_CONFIG_DIR: overlay, AISHA_PROFILE: "zk" };
    const externi = await spust({ ...env, MODEL_EXTERNI: "model.cizi.example" });
    expect(externi.kod, externi.err + externi.out).toBe(0);
    expect(externi.err).not.toMatch(/STOP/);
    const vlastni = await spust({ ...env, MODEL_EXTERNI: "" });
    expect(vlastni.kod, vlastni.err + vlastni.out).toBe(1);
    expect(vlastni.err).toMatch(/STOP zkouska-model/);
  }, STROP_MS);

  it("UUID cílového slotu nenastavené = NEZMĚŘENO 2, ne „bez přesunu“", async () => {
    const r = await spust({ AISHA_INSTANCE_CONFIG_DIR: overlayPrazdny });
    expect(r.kod, r.err + r.out).toBe(2);
    expect(r.err).toMatch(/NEZMĚŘENO zkouska-model: server NEZMĚŘEN \(COOLIFY_SERVER_UUID_GPU nenastaveno\)/);
  }, STROP_MS);
});
