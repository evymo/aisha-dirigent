/**
 * Mesh discovery v redeployi nezamkne uživatele aisha-bootstrap: v jedné vlně
 * jeden pokus o token, po odmítnutí pověření do konce běhu žádný další.
 *
 * ⛔ NAMĚŘENO 2026-09-17 (cold-start instance, vlna 6): Keycloak zalogoval během
 * ~1 s šest `LOGIN_ERROR clientId="aisha-bootstrap" error="user_temporarily_disabled"`.
 * Vlna spouští appky souběžně, každá spustila vlastní netbird-peer-discover.mjs
 * a každý proces udělal jeden ROPC pokus; pamatoval se jen úspěch, takže každá
 * vlna po neúspěchu poslala N souběžných pokusů znovu. Brute-force ochrana realmu
 * (failureFactor 5, quickLoginCheck 1000 ms) uživatele zamkla a další pokusy
 * zámek jen prodlužovaly.
 *
 * ⭐ Brána SPOUŠTÍ skutečný scripts/netbird-peer-discover.mjs proti podvrženému
 * Keycloaku/NetBirdu (lokální HTTP server, který počítá požadavky na token) přes
 * TENTÝŽ modul, který volá aisha-redeploy (lib/mesh-discovery-v-behu.mjs), a
 * simuluje vlny se šesti souběžnými appkami.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vytvorDiscoveryVBehu } from "../../../scripts/lib/mesh-discovery-v-behu.mjs";

const ROOT = process.cwd();
const execFileP = promisify(execFile);
const APPEK_VE_VLNE = 6;

type Rezim = "401" | "503" | "ok";
let rezim: Rezim = "401";
let pokusyOToken = 0;
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url.includes("/protocol/openid-connect/token")) {
      pokusyOToken++;
      if (rezim === "401") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"error":"invalid_grant","error_description":"Invalid user credentials"}');
      } else if (rezim === "503") {
        res.writeHead(503);
        res.end("Keycloak ještě startuje");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"access_token":"zkusebni-token"}');
      }
      return;
    }
    if (url.includes(".well-known/openid-configuration")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"issuer":"zkouska"}');
      return;
    }
    if (url.startsWith("/api/peers")) {
      const autorizovano = /Bearer zkusebni-token/.test(String(req.headers.authorization ?? ""));
      res.writeHead(autorizovano ? 200 : 401, { "content-type": "application/json" });
      res.end(autorizovano ? "[]" : "{}");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const spust = () =>
  execFileP(process.execPath, [join(ROOT, "scripts/netbird-peer-discover.mjs"), "--json"], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      KEYCLOAK_PUBLIC_URL: `http://127.0.0.1:${port}`,
      KEYCLOAK_REALM: "zkouska",
      NETBIRD_API_URL: `http://127.0.0.1:${port}`,
      AISHA_BOOTSTRAP_PASSWORD: "zkusebni-heslo",
      AISHA_BOOTSTRAP_CLIENT_SECRET: "zkusebni-secret",
    },
    timeout: 30_000,
  });

/** Jedna vlna: N appek volá discovery souběžně (jako Promise.all v aisha-redeploy). */
const vlna = (discovery: ReturnType<typeof vytvorDiscoveryVBehu>) =>
  Promise.allSettled(Array.from({ length: APPEK_VE_VLNE }, () => discovery(spust)));

describe("mesh discovery nezamkne aisha-bootstrap (brána)", () => {
  test("⛔ odmítnuté pověření: vlna = JEDEN pokus o token, další vlny ŽÁDNÝ, chyba to řekne", async () => {
    rezim = "401";
    pokusyOToken = 0;
    const discovery = vytvorDiscoveryVBehu();
    const prvni = await vlna(discovery);
    expect(pokusyOToken, "souběžné appky ve vlně poslaly víc pokusů o token — zamyká uživatele").toBe(1);
    expect(prvni.every((r) => r.status === "rejected")).toBe(true);
    const duvod = String((prvni[0] as PromiseRejectedResult).reason?.message ?? "");
    expect(duvod).toMatch(/user_temporarily_disabled/);
    expect(duvod).toMatch(/NEZKOUŠÍ/);

    await vlna(discovery);
    await vlna(discovery);
    expect(pokusyOToken, "po odmítnutí pověření další vlny zkoušely znovu — zámek se prodlužuje").toBe(1);
  });

  test("jiný neúspěch (Keycloak/NetBird ještě nestojí) se v další vlně zkusí znovu — jednou", async () => {
    rezim = "503";
    pokusyOToken = 0;
    const discovery = vytvorDiscoveryVBehu();
    await vlna(discovery);
    expect(pokusyOToken).toBe(1);
    await vlna(discovery);
    expect(pokusyOToken, "neúspěch mimo pověření nesmí vzít pokus v pozdější vlně").toBe(2);
  });

  test("úspěch platí do konce běhu", async () => {
    rezim = "ok";
    pokusyOToken = 0;
    const discovery = vytvorDiscoveryVBehu();
    const prvni = await vlna(discovery);
    expect(prvni.every((r) => r.status === "fulfilled")).toBe(true);
    await vlna(discovery);
    expect(pokusyOToken).toBe(1);
  });

  test("aisha-redeploy volá discovery přes tenhle modul, ne přímo", () => {
    const redeploy = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");
    expect(redeploy).toMatch(/import \{ vytvorDiscoveryVBehu \} from "\.\/lib\/mesh-discovery-v-behu\.mjs"/);
    const spusteni = [...redeploy.matchAll(/execFileP?\([^)]*"scripts\/netbird-peer-discover\.mjs"/g)].length;
    const presModul = /await discoveryVBehu\(\(\) =>\s*execFileP\(process\.execPath, \[join\(ROOT, "scripts\/netbird-peer-discover\.mjs"\)/.test(redeploy);
    expect(spusteni, "discovery se v redeployi spouští na víc místech — obchvat single-flightu").toBe(1);
    expect(presModul, "spuštění discovery v refreshMeshIps neběží přes discoveryVBehu").toBe(true);
  });
});
