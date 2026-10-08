// Behaviorální test drift-checku proti falešnému Coolify API: nezměřený server
// aplikace (nenastavené UUID / slot mimo registr) NENÍ „bez driftu“ — vypíše se
// v `serverUnmeasured` a skončí kódem 3, ne nulou.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Každý test spouští skutečný skript (import topologie, HTTP na falešné API) — pod
// zátěží sdíleného stroje trvá víc než výchozích 5 s; strop proto výslovně.
const STROP_MS = 60_000;
const SKRIPT = fileURLToPath(new URL("./coolify-drift-check.mjs", import.meta.url));
const PROJEKT = "projekt-zkouska";

// Živé aplikace: alfa na slotu frontend (server s1), beta na slotu, který registr nezná.
// TVAR ODPOVĚDI API: server je v `destination.server.uuid`, pole `server_uuid` API
// u aplikací NEVRACÍ (změřeno živě 249/249, 2026-10-05). Fixtura s vymyšleným polem
// dělala z měření tautologii (revize accel-1).
const sServerem = (uuid) => ({ destination: { uuid: `d-${uuid}`, server: { uuid } } });
const APLIKACE = [
  { name: "zkouska-alfa", uuid: "a1", ...sServerem("s1"), environment_id: 7, docker_compose_location: "/docker-compose.coolify-alfa.yml" },
  { name: "zkouska-beta", uuid: "b1", ...sServerem("s2"), environment_id: 7, docker_compose_location: "/docker-compose.coolify-beta.yml" },
];
// Aplikace BEZ serveru v odpovědi — jen pro test, který ji měří (jinak by v ostatních byla osiřelá).
const BEZ_SERVERU = { name: "zkouska-gama", uuid: "g1", environment_id: 7, docker_compose_location: "/docker-compose.coolify-gama.yml" };
let navic = [];

let server;
let url;
let dir;
beforeAll(async () => {
  server = createServer((req, res) => {
    const telo =
      req.url === "/api/v1/applications" ? [...APLIKACE, ...navic]
      : req.url === `/api/v1/projects/${PROJEKT}` ? { uuid: PROJEKT, environments: [{ id: 7, name: "production" }] }
      : null;
    res.writeHead(telo ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(telo ?? { message: "not found" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
  dir = mkdtempSync(join(tmpdir(), "drift-check-"));
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

function manifest(radky) {
  const p = join(dir, `m-${Math.random().toString(36).slice(2)}.manifest`);
  writeFileSync(p, ["story: zkouska", ...radky, ""].join("\n"));
  return p;
}

function spust(manifestPath, extra = {}) {
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
    const p = spawn(process.execPath, [SKRIPT, "--json", "--manifest", manifestPath], { env });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (kod) => resolve({ kod, out, err }));
  });
}

describe("drift-check: nezměřený server není shoda", () => {
  it("⛔ nenastavené COOLIFY_SERVER_UUID_<SLOT> a neznámý slot → serverUnmeasured + kód 3", async () => {
    const r = await spust(
      manifest(["app: alfa:frontend:docker-compose.coolify-alfa.yml", "app: beta:neznamy:docker-compose.coolify-beta.yml"]),
    );
    expect(r.kod, r.err).toBe(3);
    const drift = JSON.parse(r.out);
    expect(drift.serverDrift).toEqual([]);
    expect(drift.serverUnmeasured.map((x) => [x.name, x.reason])).toEqual([
      ["zkouska-alfa", "COOLIFY_SERVER_UUID_FRONTEND nenastaveno"],
      ["zkouska-beta", "slot 'neznamy' není v coolify/servers.json"],
    ]);
  }, STROP_MS);

  it("změřený server, který sedí, NENÍ nezměřený (beta mimo manifest = orphaned, kód 1)", async () => {
    const r = await spust(manifest(["app: alfa:frontend:docker-compose.coolify-alfa.yml"]), { COOLIFY_SERVER_UUID_FRONTEND: "s1" });
    const drift = JSON.parse(r.out);
    expect(drift.serverUnmeasured).toEqual([]);
    // beta je v Coolify, ale ne v manifestu → orphaned (fatální, kód 1): i to musí být změřené.
    expect(drift.orphaned.map((x) => x.name)).toEqual(["zkouska-beta"]);
    expect(r.kod).toBe(1);
  }, STROP_MS);

  it("aplikace, u které API server neuvádí, = NEZMĚŘENO s důvodem, ne shoda", async () => {
    navic = [BEZ_SERVERU];
    let r;
    try {
      r = await spust(manifest(["app: alfa:frontend:docker-compose.coolify-alfa.yml", "app: beta:frontend:docker-compose.coolify-beta.yml", "app: gama:frontend:docker-compose.coolify-gama.yml"]), { COOLIFY_SERVER_UUID_FRONTEND: "s1" });
    } finally {
      navic = [];
    }
    const drift = JSON.parse(r.out);
    // Kotva v témže běhu: alfa (s1) sedí, beta (s2) je drift — měřidlo server opravdu čte.
    expect(drift.serverDrift.map((x) => x.name)).toEqual(["zkouska-beta"]);
    expect(drift.serverUnmeasured.map((x) => [x.name, x.reason])).toEqual([["zkouska-gama", "API Coolify neuvádí server aplikace (destination.server.uuid)"]]);
  }, STROP_MS);

  it("server na jiném stroji, než říká slot → serverDrift (kód 2 má přednost před nezměřeným)", async () => {
    const r = await spust(
      manifest(["app: alfa:frontend:docker-compose.coolify-alfa.yml", "app: beta:backend:docker-compose.coolify-beta.yml"]),
      { COOLIFY_SERVER_UUID_FRONTEND: "jiny-server" },
    );
    const drift = JSON.parse(r.out);
    expect(drift.serverDrift.map((x) => x.name)).toEqual(["zkouska-alfa"]);
    expect(drift.serverUnmeasured.map((x) => x.name)).toEqual(["zkouska-beta"]);
    expect(r.kod).toBe(2);
  }, STROP_MS);
});

describe("drift-check: opt-in aplikace za zavřenou lane není fatální „missing“", () => {
  // accel-hostfw je v katalogu opt-in (provision_when_env = deklarace uzlu
  // ACCEL_FW_NODE_OWNER | ACCEL_FW_SSH, ne lane vstupu ani enginů): story-init ho se zavřenou lane
  // nezakládá, takže jeho nepřítomnost v Coolify je správný stav.
  const RADKY = ["app: alfa:frontend:docker-compose.coolify-alfa.yml", "app: accel-hostfw:gpu:docker-compose.coolify-accel-hostfw.yml"];

  it("⛔ lane zavřená (uzel nedeklarovaný; otevřené lane vstupu a enginu firewall nezapnou): v zaZavrenouLane s podmínkou, ne v missing", async () => {
    const r = await spust(manifest(RADKY), { COOLIFY_SERVER_UUID_FRONTEND: "s1", ACCEL_DEKLARACE_B64: "x", ACCEL_EMBED_1_REPO: "org/model", ACCEL_FW_NODE_OWNER: "", ACCEL_FW_SSH: "" });
    const drift = JSON.parse(r.out);
    expect(drift.missing).toEqual([]);
    expect(drift.zaZavrenouLane).toEqual([{ name: "zkouska-accel-hostfw", lane: ["ACCEL_FW_NODE_OWNER", "ACCEL_FW_SSH"] }]);
    expect(drift.orphaned.map((x) => x.name)).toEqual(["zkouska-beta"]); // měří se dál
  }, STROP_MS);

  it("⛔ lane otevřená (deklarovaný vlastník uzlu, lane vstupu zavřená) a aplikace v Coolify chybí: fatální missing, kód 1", async () => {
    const r = await spust(manifest(RADKY), { COOLIFY_SERVER_UUID_FRONTEND: "s1", ACCEL_FW_NODE_OWNER: "vrstva-a" });
    const drift = JSON.parse(r.out);
    expect(drift.missing).toEqual([{ name: "zkouska-accel-hostfw" }]);
    expect(drift.zaZavrenouLane).toEqual([]);
    expect(r.kod).toBe(1);
  }, STROP_MS);

  it("aplikace bez podmínky v katalogu chybí: missing jako dosud", async () => {
    const r = await spust(manifest(["app: alfa:frontend:docker-compose.coolify-alfa.yml", "app: gama:backend:docker-compose.coolify-gama.yml"]), {
      COOLIFY_SERVER_UUID_FRONTEND: "s1",
    });
    expect(JSON.parse(r.out).missing).toEqual([{ name: "zkouska-gama" }]);
  }, STROP_MS);
});
