/**
 * Bootstrap API klíče n8n vyrobí klíč při KAŽDÉM nasazení.
 *
 * ⛔ NAMĚŘENO (RIQ 2026-09-07, guru 2026-09-18): heslo vlastníka bylo náhodné
 * a zahozené, takže klíč vznikl jen při prvním nasazení a každé další skončilo
 * „owner already set up" — pověření ani workflowy se nedoručily. Test měří
 * chování proti falešnému n8n: čerstvá instance → setup, existující → přihlášení
 * TÝMŽ heslem, cizí heslo → nahlas s cestou ven, chybějící tajemství → nahlas
 * dřív, než na n8n cokoli pošle.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TAJEMSTVI = "tajemstvi-platformy_0123456789abcdefghijklmnopq";
const EMAIL = "n8n-owner@instance.test";

/** Stav falešného n8n: `rezim` řídí odpověď na setup a přihlášení. */
const n8n = { rezim: "cerstva", pozadavky: [], hesla: [], restNahoru: true };
let server;
let tmp;
let bootstrap;

function odpovez(res, status, telo, cookie) {
  const hlavicky = { "Content-Type": "application/json" };
  if (cookie) hlavicky["Set-Cookie"] = `n8n-auth=${cookie}; Path=/; HttpOnly`;
  res.writeHead(status, hlavicky);
  res.end(JSON.stringify(telo));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      n8n.pozadavky.push(`${req.method} ${req.url}`);
      const telo = data ? JSON.parse(data) : {};
      if (req.url === "/healthz") return odpovez(res, 200, { status: "ok" });
      // Start n8n: healthcheck už odpovídá, REST trasy ještě ne — každá /rest/* dá 404.
      if (req.url.startsWith("/rest/") && !n8n.restNahoru) {
        if (req.url === "/rest/settings") n8n.restNahoru = true; // naběhne po prvním dotazu
        return odpovez(res, 404, {});
      }
      if (req.method === "GET" && req.url === "/rest/settings") return odpovez(res, 200, { data: {} });
      if (req.method === "POST" && req.url === "/rest/owner/setup") {
        n8n.hesla.push(telo.password);
        if (n8n.rezim === "neplatny-email") {
          // Přesný tvar odpovědi n8n na adresu bez tečky v doméně (naměřeno 2026-10-08).
          return odpovez(res, 400, { validation: "email", code: "invalid_string", message: "Invalid email", path: ["email"] });
        }
        return n8n.rezim === "cerstva" ? odpovez(res, 200, { data: {} }, "setup-session") : odpovez(res, 404, {});
      }
      if (req.method === "POST" && req.url === "/rest/login") {
        n8n.hesla.push(telo.password);
        return n8n.rezim === "existujici" && telo.email === EMAIL
          ? odpovez(res, 200, { data: {} }, "login-session")
          : odpovez(res, 401, { message: "Wrong username or password" });
      }
      if (req.url === "/rest/api-keys" && req.method === "GET") return odpovez(res, 200, { data: [] });
      if (req.url === "/rest/api-keys" && req.method === "POST") {
        const session = /n8n-auth=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
        return odpovez(res, 200, { data: { rawApiKey: `klic-z-${session}` } });
      }
      odpovez(res, 404, {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  tmp = mkdtempSync(join(tmpdir(), "n8n-bootstrap-"));
  // Modul čte adresu, výstup a e-mail při importu — nastavit PŘED importem.
  process.env.N8N_REST_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.N8N_APIKEY_OUT = join(tmp, "apikey");
  process.env.N8N_BOOTSTRAP_OWNER_EMAIL = EMAIL;
  bootstrap = await import("./n8n-bootstrap-apikey.mjs");
});

afterAll(() => {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
  for (const k of ["N8N_REST_URL", "N8N_APIKEY_OUT", "N8N_BOOTSTRAP_OWNER_EMAIL", "N8N_BOOTSTRAP_OWNER_PASSWORD"]) {
    delete process.env[k];
  }
});

beforeEach(() => {
  n8n.pozadavky = [];
  n8n.hesla = [];
  n8n.restNahoru = true;
  rmSync(join(tmp, "apikey"), { force: true });
  process.env.N8N_BOOTSTRAP_OWNER_PASSWORD = TAJEMSTVI;
});

describe("n8n bootstrap API klíče", () => {
  test("heslo splní passwordSchema n8n a je deterministické", () => {
    expect(bootstrap.hesloVlastnika("abc")).toBe("Aa1abc");
    expect(() => bootstrap.hesloVlastnika("")).toThrow(/N8N_BOOTSTRAP_OWNER_PASSWORD chybí/);
    expect(() => bootstrap.hesloVlastnika("x".repeat(62))).toThrow(/nejvýš 64/);
  });

  test("čerstvá instance: převezme vlastnictví a klíč vyrobí ze session setupu", async () => {
    n8n.rezim = "cerstva";
    await bootstrap.main();
    expect(readFileSync(join(tmp, "apikey"), "utf8")).toBe("klic-z-setup-session");
    expect(n8n.hesla).toEqual([`Aa1${TAJEMSTVI}`]);
    expect(n8n.pozadavky).not.toContain("POST /rest/login");
  });

  test("⛔ existující instance: přihlásí se TÝMŽ heslem a klíč vyrobí — žádná slepá ulička", async () => {
    n8n.rezim = "existujici";
    await bootstrap.main();
    expect(readFileSync(join(tmp, "apikey"), "utf8")).toBe("klic-z-login-session");
    expect(n8n.hesla).toEqual([`Aa1${TAJEMSTVI}`, `Aa1${TAJEMSTVI}`]);
  });

  test("⛔ start n8n: 404 před naběhnutím REST NENÍ „vlastník už nastaven“ — počká a převezme (2026-09-30)", async () => {
    n8n.rezim = "cerstva";
    n8n.restNahoru = false;
    await bootstrap.main();
    expect(readFileSync(join(tmp, "apikey"), "utf8")).toBe("klic-z-setup-session");
    // setup se poslal až PO připraveném REST, ne do 404 startu
    const prvniSetup = n8n.pozadavky.indexOf("POST /rest/owner/setup");
    expect(n8n.pozadavky.slice(0, prvniSetup)).toEqual(["GET /rest/settings", "GET /rest/settings"]);
    expect(n8n.pozadavky).not.toContain("POST /rest/login");
  }, 20_000);

  test("vlastník s cizím heslem: selže nahlas a řekne cestu ven, klíč nezapíše", async () => {
    n8n.rezim = "cizi-heslo";
    await expect(bootstrap.main()).rejects.toThrow(/HTTP 401[\s\S]*user-management:reset/);
    expect(existsSync(join(tmp, "apikey"))).toBe(false);
  });

  test("⛔ neplatný e-mail vlastníka: 400 s `validation` NENÍ „vlastník už nastaven“ — selže hned a jmenuje vstup", async () => {
    n8n.rezim = "neplatny-email";
    await expect(bootstrap.main()).rejects.toThrow(/owner\/setup odmítl data vlastníka[\s\S]*Invalid email/);
    expect(n8n.pozadavky).not.toContain("POST /rest/login");
    expect(existsSync(join(tmp, "apikey"))).toBe(false);
  });

  test("chybějící tajemství: selže dřív, než na n8n cokoli pošle", async () => {
    delete process.env.N8N_BOOTSTRAP_OWNER_PASSWORD;
    await expect(bootstrap.main()).rejects.toThrow(/N8N_BOOTSTRAP_OWNER_PASSWORD chybí/);
    expect(n8n.pozadavky).toEqual([]);
  });
});
