/**
 * Brána: domain-doctor --apply NEVYNUTÍ doménu, kterou na témž serveru drží CIZÍ projekt.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na sdíleném Coolify. Krok 4 cold-startu pouští
 * `coolify-domain-doctor.mjs --apply`. Ten při driftu posílal od druhého pokusu
 * `force_domain_override=true` s odůvodněním „bezpečné — konflikty jsou prázdné".
 * Konflikty se ale počítaly jen UVNITŘ vlastního projektu. Registry cache instance
 * měla drift na host, který na TÉMŽ serveru držela aplikace jiného projektu:
 * vynucení doménu přebije, cizímu vlastníkovi ji NEODEBERE — dva Traefik routery
 * na jeden host (týž tvar jako incident 2026-07-09).
 *
 * CO SE MĚŘÍ — CHOVÁNÍ, ne text skriptu: skutečný doktor proti místnímu serveru,
 * který odpovídá tvarem Coolify API a zapisuje každý PATCH.
 *   1. cizí držitel na témž serveru → žádný PATCH, nenulový kód, konflikt pojmenovaný
 *      (host, jméno a projekt držitele) a bez přihlašovacích údajů z git_repository;
 *   2. cizí držitel bez driftu (dvojí vazba už stojí) → v --apply taky nenulový kód;
 *   3. sonda jde rozsvítit: týž host na JINÉM serveru není konflikt — doktor zapisuje,
 *      a bez ALLOW_DOMAIN_FORCE_OVERRIDE=1 ani opakovaný pokus nevynucuje;
 *   4. vědomá migrace (ALLOW_DOMAIN_FORCE_OVERRIDE=1) vynucení povolí — rozhodnutí
 *      o vlastnictví je na obsluze, ne na nástroji.
 * Plus čistá funkce findForeignClaimants (server, projekt, tajemství).
 *
 * Jména instancí ani domény tu nejsou: identita je vymyšlená a hosty leží
 * v `.local`, který doktor živou sondou routování nezkouší.
 */
import { describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { findForeignClaimants } from "../../../scripts/lib/fqdn-owners.mjs";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");

const PREFIX = "zkusebni";
const HOST = "cache.zkusebni.local";
const TAJEMSTVI = "tajny-token-v-url";

type App = Record<string, unknown>;

function nase(ulozeny: string, serverId = 0): App {
  return {
    uuid: "nase-uuid",
    name: `${PREFIX}-registry`,
    environment_id: 1,
    destination: { server_id: serverId },
    build_pack: "dockercompose",
    status: "running:healthy",
    docker_compose_domains: [{ name: "registry-cache", domain: ulozeny }],
  };
}

function cizi(serverId: number): App {
  return {
    uuid: "cizi-uuid",
    name: "jiny-registry",
    environment_id: 2,
    destination: { server_id: serverId },
    status: "running:healthy",
    git_repository: `https://operator:${TAJEMSTVI}@forge.zkusebni.local/org/repo.git`,
    docker_compose_domains: JSON.stringify({ registry_cache: { domain: `https://${HOST}:5000` } }),
  };
}

type Beh = { kod: number | null; vystup: string; patche: Record<string, unknown>[] };

/** Skutečný doktor proti místnímu „Coolify". `ulozit` = zda PATCH hodnotu opravdu uloží. */
async function doktor(apps: App[], { ulozit, env = {} }: { ulozit: boolean; env?: Record<string, string> }): Promise<Beh> {
  const patche: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    const cesta = (req.url ?? "").replace(/^\/api\/v1/, "");
    let telo = "";
    req.on("data", (c) => (telo += c));
    req.on("end", () => {
      const json = (x: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(x));
      };
      if (req.method === "GET" && cesta === "/applications") return json(apps);
      if (req.method === "GET" && cesta === "/projects") {
        return json([{ uuid: "projekt-nas", name: PREFIX }, { uuid: "projekt-cizi", name: "cizi-projekt" }]);
      }
      if (req.method === "GET" && cesta === "/projects/projekt-nas") return json({ environments: [{ id: 1 }] });
      if (req.method === "GET" && cesta === "/projects/projekt-cizi") return json({ environments: [{ id: 2 }] });
      const app = apps.find((a) => cesta === `/applications/${a.uuid}`);
      if (app && req.method === "PATCH") {
        const b = JSON.parse(telo || "{}");
        patche.push(b);
        if (ulozit) app.docker_compose_domains = b.docker_compose_domains;
        return json({ uuid: app.uuid });
      }
      if (app && req.method === "GET") return json(app);
      res.statusCode = 404;
      res.end(`{"message":"neznámá cesta ${cesta}"}`);
    });
  });
  await new Promise<void>((hotovo) => server.listen(0, "127.0.0.1", () => hotovo()));
  const adresa = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await new Promise<Beh>((vysledek) => {
      execFile(
        process.execPath,
        [DOKTOR, "--apply", "--only=registry", "--max-retries=1", "--timeout-ms=10000"],
        {
          cwd: ROOT,
          // Prostředí OD NULY: identita, adresa i token jen ty zkušební.
          env: {
            PATH: process.env.PATH ?? "",
            COOLIFY_URL: adresa,
            COOLIFY_API_TOKEN: "zkusebni-token",
            COOLIFY_PROJECT_UUID: "projekt-nas",
            APP_NAME_PREFIX: PREFIX,
            REGISTRY_DOMAIN: HOST,
            ...env,
          },
          timeout: 60_000,
        },
        (err, stdout, stderr) =>
          vysledek({
            kod: err ? (typeof err.code === "number" ? err.code : null) : 0,
            vystup: `${stdout}\n${stderr}`,
            patche,
          }),
      );
    });
  } finally {
    server.close();
  }
}

describe("findForeignClaimants — cizí držitel hostu (jen čtení)", () => {
  const inProject = (a: App) => a.environment_id === 1;
  const kontrakt = [`https://${HOST}:5000`];

  test("cizí projekt na témž serveru je držitel; výsledek nenese git_repository", () => {
    const r = findForeignClaimants([nase("https://stary.zkusebni.local:5000"), cizi(0)], inProject, kontrakt, nase("x"));
    expect(r).toHaveLength(1);
    expect(r[0].host).toBe(HOST);
    expect(r[0].owners.map((o: { uuid: string }) => o.uuid)).toEqual(["cizi-uuid"]);
    expect(JSON.stringify(r)).not.toContain(TAJEMSTVI);
  });

  test("jiný server = jiný Traefik, žádný držitel; neznámý server = držitel (fail-closed)", () => {
    expect(findForeignClaimants([cizi(7)], inProject, kontrakt, nase("x", 0))).toEqual([]);
    const bezServeru = { ...cizi(0), destination: undefined };
    expect(findForeignClaimants([bezServeru], inProject, kontrakt, nase("x", 0))).toHaveLength(1);
  });

  test("aplikace vlastního projektu cizí držitel není (to hlídá findContractConflicts)", () => {
    const vlastni = { ...cizi(0), environment_id: 1 };
    expect(findForeignClaimants([vlastni], inProject, kontrakt, nase("x"))).toEqual([]);
  });
});

describe("coolify-domain-doctor --apply a cizí držitel hostu (chování)", () => {
  test("1. drift + cizí držitel na témž serveru → žádný zápis, nenulový kód, konflikt pojmenovaný", { timeout: 90_000 }, async () => {
    const r = await doktor([nase("https://stary.zkusebni.local:5000"), cizi(0)], { ulozit: false });
    expect(r.patche, `doktor zapisoval přes cizí vazbu:\n${r.vystup}`).toEqual([]);
    expect(r.kod, r.vystup).toBe(1);
    expect(r.vystup).toMatch(new RegExp(`FQDN_CONFLICT_FOREIGN[\\s\\S]*${HOST.replace(/\./g, "\\.")}`));
    expect(r.vystup, "hlášení nejmenuje projekt držitele").toContain("cizi-projekt");
    expect(r.vystup, "hlášení vyneslo přihlašovací údaj z git_repository").not.toContain(TAJEMSTVI);
  });

  test("2. bez driftu, ale cizí držitel na témž serveru → v --apply taky nenulový kód", { timeout: 90_000 }, async () => {
    const r = await doktor([nase(`https://${HOST}:5000`), cizi(0)], { ulozit: false });
    expect(r.patche).toEqual([]);
    expect(r.kod, r.vystup).toBe(1);
    expect(r.vystup).toContain("FQDN_CONFLICT_FOREIGN");
  });

  test("3. sonda jde rozsvítit — týž host na JINÉM serveru: doktor zapisuje a nevynucuje", { timeout: 90_000 }, async () => {
    // Coolify zápis „tiše zahodí" (ulozit: false) — doktor proto zkusí všechny tři pokusy,
    // a právě na druhém a třetím dřív přidával force_domain_override.
    const r = await doktor([nase("https://stary.zkusebni.local:5000"), cizi(7)], { ulozit: false });
    expect(r.patche.length, r.vystup).toBe(3);
    expect(r.patche.filter((b) => "force_domain_override" in b), "vynucení bez ALLOW_DOMAIN_FORCE_OVERRIDE=1").toEqual([]);
    expect(r.vystup).not.toContain("FQDN_CONFLICT_FOREIGN");
    expect(r.kod, "nezapsaný drift musí skončit nenulou").toBe(1);
  });

  test("3b. …a když se zápis uloží, doktor skončí nulou (měřidlo nečervená pořád)", { timeout: 90_000 }, async () => {
    const r = await doktor([nase("https://stary.zkusebni.local:5000"), cizi(7)], { ulozit: true });
    expect(r.patche).toHaveLength(1);
    expect(r.kod, r.vystup).toBe(0);
  });

  test("4. ALLOW_DOMAIN_FORCE_OVERRIDE=1 — vědomá migrace smí vynutit, dvojí vazba ale zůstane nahlášená", { timeout: 90_000 }, async () => {
    const r = await doktor([nase("https://stary.zkusebni.local:5000"), cizi(0)], {
      ulozit: false,
      env: { ALLOW_DOMAIN_FORCE_OVERRIDE: "1" },
    });
    expect(r.patche.some((b) => b.force_domain_override === true), r.vystup).toBe(true);
    expect(r.vystup).toContain("FQDN_CONFLICT_FOREIGN");
    expect(r.kod).toBe(1);
  });
});
