// Behaviorální test discovery serverů proti falešnému Coolify API: slot s has_gpu
// (GPU uzel `gpu`) se NEHÁDÁ. Při jediném serveru v Coolify dostanou běžné sloty
// jeho UUID (dosavadní jednouzlové chování), GPU slot ne — jinak by na produkční
// hostitel přistála vrstva i firewall hostitele (accel-hostfw).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

// Každý test spouští skutečný skript (import topologie, HTTP na falešné API) — pod
// zátěží sdíleného stroje trvá víc než výchozích 5 s; strop proto výslovně.
const STROP_MS = 60_000;
const SKRIPT = fileURLToPath(new URL("./generate-coolify-context.mjs", import.meta.url));

let servery = [];
let server;
let url;
beforeAll(async () => {
  server = createServer((req, res) => {
    const telo =
      req.url === "/api/v1/projects" ? [{ name: "zkouska", uuid: "projekt-zkouska" }]
      : req.url === "/api/v1/servers" ? servery
      : null;
    res.writeHead(telo ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(telo ?? { message: "not found" }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

function spust(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Žádná deklarace slotu z prostředí volajícího — měří se jen to, co test dodá.
    if (/^(COOLIFY_|AISHA_|APP_NAME_PREFIX$|ENV_PROD_BACKUP$|ENV_FILE$)|_HOSTNAME$|_IP$/.test(k)) continue;
    env[k] = v;
  }
  Object.assign(env, {
    COOLIFY_URL: url,
    COOLIFY_API_TOKEN: "zkusebni-token",
    AISHA_ENV: "production",
    APP_NAME_PREFIX: "zkouska",
    COOLIFY_AUTO_CREATE_PROJECT: "0",
    DRY_RUN: "1",
    ...extra,
  });
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SKRIPT, "--preserve=0"], { env });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (kod) => {
      const hodnoty = {};
      for (const m of out.matchAll(/^([A-Z0-9_]+)='([^']*)'$/gm)) hodnoty[m[1]] = m[2];
      resolve({ kod, hodnoty, err });
    });
  });
}

describe("discovery: slot s has_gpu vyžaduje výslovnou vazbu", () => {
  it("⛔ jediný server v Coolify: běžné sloty ano, GPU slot NE", async () => {
    servery = [{ uuid: "server-jediny", name: "Hlavni", ip: "192.0.2.5", is_coolify_host: true, settings: { is_build_server: false } }];
    const r = await spust();
    expect(r.kod, r.err).toBe(0);
    for (const slot of ["FRONTEND", "BACKEND", "EXPERIMENTAL", "BUILD"]) {
      expect(r.hodnoty[`COOLIFY_SERVER_UUID_${slot}`], slot).toBe("server-jediny");
    }
    expect(r.hodnoty.COOLIFY_SERVER_UUID_GPU).toBe("");
  }, STROP_MS);

  it("⛔ server pojmenovaný jako slot GPU nestačí — jméno je heuristika, ne vazba", async () => {
    servery = [
      { uuid: "server-a", name: "Hlavni", ip: "192.0.2.5", is_coolify_host: true },
      { uuid: "server-gpu", name: "gpu", ip: "192.0.2.9" },
    ];
    const r = await spust();
    expect(r.hodnoty.COOLIFY_SERVER_UUID_GPU).toBe("");
  }, STROP_MS);

  it("výslovná vazba (GPU_HOSTNAME) platí i pro GPU slot", async () => {
    servery = [
      { uuid: "server-a", name: "Hlavni", ip: "192.0.2.5", is_coolify_host: true },
      { uuid: "server-gpu", name: "Gpu-uzel", ip: "192.0.2.9" },
    ];
    const r = await spust({ GPU_HOSTNAME: "gpu-uzel" });
    expect(r.kod, r.err).toBe(0);
    expect(r.hodnoty.COOLIFY_SERVER_UUID_GPU).toBe("server-gpu");
  }, STROP_MS);

  it("výslovná vazba i při jediném serveru (jednouzlová instance s GPU)", async () => {
    servery = [{ uuid: "server-jediny", name: "Hlavni", ip: "192.0.2.5", is_coolify_host: true }];
    const r = await spust({ GPU_HOSTNAME: "Hlavni" });
    expect(r.hodnoty.COOLIFY_SERVER_UUID_GPU).toBe("server-jediny");
  }, STROP_MS);
});
