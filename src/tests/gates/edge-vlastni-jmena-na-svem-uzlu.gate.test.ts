/**
 * Brána: veřejné jméno, které na SVÉM uzlu obsluhuje edge, vlastní edge —
 * backend na témž uzlu ho neregistruje.
 *
 * ⛔ NAMĚŘENO 2026-09-27 (jednouzlová instance s meshem — server_bindings všech
 * slotů na jeden stroj; cold-start krok 4): edge-proxy i backendy
 * registrovaly totéž veřejné jméno — api × core `gateway`, auth × keycloak,
 * mcp/dirigent × orchestration `n8n-auth`. Návrh to dovoluje záměrně („jiný
 * server = jiný Traefik", fqdn-owners.mjs), jenže instance měla všechny sloty
 * vázané na JEDEN stroj: dva routery na jednom Traefiku, FQDN_CONFLICT ×4,
 * APPLY BLOCKED — a veřejná jména obsluhovaly backendy MIMO edge.
 *
 * Rozhoduje derivace (EDGE_OWNED_HOSTS), uplatňují obě roviny, které domény
 * zapisují. Brána je SPOUŠTÍ nad týmiž vstupy:
 *   derivace    → CLI `--shell` nad profilem v dočasném overlayi instance
 *   doktor      → skutečný coolify-domain-doctor --apply proti místnímu „Coolify"
 *   deploy-init → vyříznuté domena_pro_coolify + set_coolify_domains (DRY_RUN) v bashi
 *
 * Mimo rozsah (vědomě): bez meshe jde edge přes `*_UPSTREAM_PUBLIC`, na
 * jednozónové instanci je to totéž veřejné jméno → edge by proxoval sám na sebe.
 * Tam se vlastnictví nemění a derivace nic nevydá (test níž).
 *
 * Identita, zóny i hosty jsou vymyšlené; doktorovy hosty leží v `.local`,
 * který živá sonda routování nezkouší.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EDGE_VEREJNE_TVARE,
  RESOLVER_ENV_INPUTS,
  edgeOwnedHosts,
} from "../../../scripts/lib/derive-domains.mjs";
import {
  domenaProCoolify,
  edgeOwnedSet,
  isReleaseSentinel,
  releaseSentinel,
} from "../../../scripts/lib/edge-vlastni-jmena.mjs";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const DOKTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");
const DEPLOY_INIT = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf8");

// ── Derivace ────────────────────────────────────────────────────────────────

const ZONA = "zona.example";
const REF = { PUBLIC_TLD: ZONA, INTERNAL_TLD: ZONA, MESH_TLD: "mesh.acme.internal", APP_NAME_PREFIX: "acme" };

let overlay = "";
beforeAll(() => {
  overlay = mkdtempSync(join(tmpdir(), "edge-vlastni-jmena-"));
  mkdirSync(join(overlay, "profiles"));
  const sablona = JSON.parse(readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf8"));
  // Tvar instance, na které se vada naměřila: tři sloty, jedna zóna (internal =
  // public), jména s prefixem, veřejná tvář jako přímá (výchozí direct_scope).
  const jednaZona = {
    ...sablona.domain,
    internal_pattern: "{subdomain}.{internal_tld}",
    subdomain_prefix: "acme-",
  };
  delete jednaZona.direct_scope;
  const profil = (id: string, bindings: Record<string, string> | undefined) => {
    const p = { ...sablona, id, domain: jednaZona };
    if (bindings) p.server_bindings = bindings;
    else delete p.server_bindings;
    writeFileSync(join(overlay, `profiles/${id}.json`), JSON.stringify(p));
  };
  profil("test-jeden-uzel", { frontend: "uzel-a", backend: "uzel-a", experimental: "uzel-a" });
  profil("test-vic-uzlu", { frontend: "uzel-a", backend: "uzel-b", experimental: "uzel-c" });
  profil("test-bez-vazeb", undefined);
});
afterAll(() => {
  if (overlay) rmSync(overlay, { recursive: true, force: true });
});

function derivace(profil: string, mesh: "on" | "off") {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of RESOLVER_ENV_INPUTS) delete env[key];
  delete env.AISHA_PROFILE;
  const r = spawnSync("node", [DERIVE, `--profile=${profil}`, `--mesh=${mesh}`, "--shell"], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...env, ...REF, AISHA_INSTANCE_CONFIG_DIR: overlay },
  });
  expect(r.status, r.stderr).toBe(0);
  const vars = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) vars.set(m[1], m[2].replace(/^'(.*)'$/, "$1"));
  }
  return vars;
}

/** Jména, o která se edge a backendy přely na naměřené instanci. */
const SPORNA = ["API_DOMAIN_PUBLIC", "MCP_DOMAIN", "DIRIGENT_DOMAIN", "KEYCLOAK_DOMAIN_PUBLIC"];

describe("derivace: EDGE_OWNED_HOSTS", () => {
  test("jeden uzel + mesh: vada se reprodukuje a sporná jména vlastní edge", () => {
    const v = derivace("test-jeden-uzel", "on");
    // Kotva, že scénář je SKUTEČNĚ ten naměřený: Keycloak registruje přímou tvář,
    // která je při výchozím direct_scope TOTÉŽ jméno jako veřejná tvář edge.
    // (Orchestration registruje MCP/DIRIGENT vždy — kontrakt n8n-auth. Core se
    // s meshem registruje na mesh jméno, které Coolify nedostane; na naměřené
    // instanci kolidoval proto, že overlay API_DOMAIN přišpendlil na veřejné
    // jméno — to pokrývá běh doktora níž, pravidlo pracuje s hosty.)
    expect(v.get("KEYCLOAK_DOMAIN_DIRECT"), "keycloak registruje totéž jméno jako edge").toBe(v.get("KEYCLOAK_DOMAIN_PUBLIC"));
    expect(v.get("API_DOMAIN"), "s meshem je kanonické API jméno mesh").toMatch(/\.internal$/);
    const vlastni = (v.get("EDGE_OWNED_HOSTS") ?? "").split(",");
    for (const klic of SPORNA) expect(vlastni, klic).toContain(v.get(klic));
    // n8n edge neobsluhuje — zůstává orchestration.
    expect(vlastni).not.toContain(v.get("N8N_DOMAIN"));
  });

  test("mesh vypnutý: nic se nevydá (edge by šel přes Traefik na totéž jméno — smyčka)", () => {
    const v = derivace("test-jeden-uzel", "off");
    expect(v.has("EDGE_OWNED_HOSTS"), "klíč se vydává VŽDY, aby prázdná hodnota přepsala starou").toBe(true);
    expect(v.get("EDGE_OWNED_HOSTS")).toBe("");
  });

  // ⛔ OTOČENO 2026-10-02 („vše jen přes edge“): dřív tu stálo, že na víc uzlech
  // edge sporná jména NEPŘEBÍRÁ — tím brána VYNUCOVALA boční router n8n-auth pro
  // veřejné mcp/dirigent na backendovém Traefiku, ačkoli edge k nim jde meshem.
  // Teď: tvář, ke které edge jde MESHEM, vlastní edge na jakémkoli uzlu; tvář,
  // ke které jde přes Traefik backendu (auth = přímá tvář Keycloaku, bootstrap
  // meshe), zůstává backendu — převzetí by vyrobilo smyčku.
  test.each([
    ["víc uzlů (backend jinde než edge)", "test-vic-uzlu"],
    ["bez server_bindings — nevázaný slot je samostatný uzel", "test-bez-vazeb"],
  ])("%s: edge přebírá tváře, ke kterým jde meshem; auth (Traefik) ne", (_popis, profil) => {
    const v = derivace(profil, "on");
    const vlastni = (v.get("EDGE_OWNED_HOSTS") ?? "").split(",").filter(Boolean);
    for (const klic of ["API_DOMAIN_PUBLIC", "MCP_DOMAIN", "DIRIGENT_DOMAIN"]) {
      expect(v.get(klic.replace(/_DOMAIN(_PUBLIC)?$/, "") === "API" ? "API_UPSTREAM_MESH" : `${klic.replace(/_DOMAIN(_PUBLIC)?$/, "")}_UPSTREAM_MESH`), `${klic}: edge k ní jde meshem`).toMatch(/\.internal(:\d+)?(\/|$)/);
      expect(vlastni, klic).toContain(v.get(klic));
    }
    expect(v.get("AUTH_UPSTREAM_MESH"), "kontrolní vzorek: auth jde přes Traefik").not.toMatch(/\.internal/);
    expect(vlastni, "auth zůstává přímé tváři Keycloaku").not.toContain(v.get("KEYCLOAK_DOMAIN_PUBLIC"));
  });

  test("kladná kotva: bez edge v topologii se nevydá nic a backend registruje dál", () => {
    const hodnota = (k: string) => ({ API_DOMAIN_PUBLIC: `acme-api.${ZONA}` })[k] ?? "";
    const topo = {
      mesh_enabled: true,
      server_bindings: { frontend: "uzel-a", backend: "uzel-a" },
      services: { core: { placement: "backend" } },
    };
    expect(edgeOwnedHosts(topo, hodnota)).toEqual([]);
    const beze = edgeOwnedSet("");
    expect(domenaProCoolify("gateway", `https://acme-api.${ZONA}:3001`, beze, "acme")).toBe(`https://acme-api.${ZONA}:3001`);
  });

  test("sentinel `.invalid`, nerozvinutá šablona ani prázdno se nevydají", () => {
    const hodnoty: Record<string, string> = {
      API_DOMAIN_PUBLIC: "live-disabled.invalid",
      MCP_DOMAIN: "${MCP_DOMAIN}",
      DIRIGENT_DOMAIN: "",
      KEYCLOAK_DOMAIN_PUBLIC: `ACME-Auth.${ZONA}`,
    };
    const topo = {
      mesh_enabled: true,
      server_bindings: { frontend: "u", backend: "u" },
      services: { edge: { placement: "frontend" }, core: { placement: "backend" }, orchestration: { placement: "backend" }, keycloak: { placement: "backend" } },
    };
    expect(edgeOwnedHosts(topo, (k: string) => hodnoty[k] ?? "")).toEqual([`acme-auth.${ZONA}`]);
  });
});

// ── Doktor (skutečný běh proti místnímu „Coolify") ─────────────────────────

const PREFIX = "zkusebni";
const L = "zkusebni.local";
const H = { api: `api.${L}`, auth: `auth.${L}`, mcp: `mcp.${L}`, dirigent: `dirigent.${L}`, n8n: `n8n.${L}`, web: `web.${L}` };

type App = Record<string, unknown>;
const app = (uuid: string, role: string, dcd: Array<{ name: string; domain: string }>, serverId = 0): App => ({
  uuid,
  name: `${PREFIX}-${role}`,
  environment_id: 1,
  destination: { server_id: serverId },
  build_pack: "dockercompose",
  status: "running:healthy",
  docker_compose_domains: dcd,
});

/** Stav z cold-startu 27. 9.: veřejná jména drží backendy, edge je nemá. */
function naMeřenyStav(serverBackendu = 0): App[] {
  return [
    app("edge-uuid", "edge", [{ name: "web", domain: `https://${H.web}` }]),
    app("core-uuid", "core", [{ name: "gateway", domain: `https://${H.api}:3001` }], serverBackendu),
    app("kc-uuid", "keycloak", [{ name: "keycloak", domain: `https://${H.auth}:80` }], serverBackendu),
    app("orch-uuid", "orchestration", [
      { name: "n8n-auth", domain: `https://${H.n8n}:4180,https://${H.mcp}:4180,https://${H.dirigent}:4180` },
    ], serverBackendu),
  ];
}

type Beh = { kod: number | null; vystup: string; patche: Array<{ uuid: string; telo: { docker_compose_domains: Array<{ name: string; domain: string }> } }> };

async function doktor(apps: App[], env: Record<string, string>): Promise<Beh> {
  const patche: Beh["patche"] = [];
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
      if (req.method === "GET" && cesta === "/projects") return json([{ uuid: "projekt-nas", name: PREFIX }]);
      if (req.method === "GET" && cesta === "/projects/projekt-nas") return json({ environments: [{ id: 1 }] });
      const a = apps.find((x) => cesta === `/applications/${x.uuid}`);
      if (a && req.method === "PATCH") {
        const b = JSON.parse(telo || "{}");
        // Coolify (v4) jménem služby odmítne doménu, kterou drží jiná app téhož
        // serveru — tak se chová i živé API („Domain conflicts detected").
        const hosty = (b.docker_compose_domains ?? []).flatMap((e: { domain: string }) =>
          String(e.domain).split(",").map((d) => d.replace(/^https?:\/\//, "").split(/[:/]/)[0]),
        );
        const drzi = apps.filter((o) => o !== a).some((o) =>
          (o.docker_compose_domains as Array<{ domain: string }>).some((e) =>
            String(e.domain).split(",").some((d) => hosty.includes(d.replace(/^https?:\/\//, "").split(/[:/]/)[0])),
          ) && (o.destination as { server_id: number }).server_id === (a.destination as { server_id: number }).server_id,
        );
        patche.push({ uuid: String(a.uuid), telo: b });
        if (drzi) {
          res.statusCode = 409;
          return json({ message: "Domain conflicts detected" });
        }
        a.docker_compose_domains = b.docker_compose_domains;
        return json({ uuid: a.uuid });
      }
      if (a && req.method === "GET") return json(a);
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
        [DOKTOR, "--apply", "--only=edge,core,keycloak,orchestration", "--max-retries=1", "--timeout-ms=10000"],
        {
          cwd: ROOT,
          env: {
            PATH: process.env.PATH ?? "",
            COOLIFY_URL: adresa,
            COOLIFY_API_TOKEN: "zkusebni-token",
            COOLIFY_PROJECT_UUID: "projekt-nas",
            APP_NAME_PREFIX: PREFIX,
            APP_DOMAIN: H.web,
            // Deklarace instance s jednou značkou. Bez ní doktor domény webu
            // neskládá (lib/domeny-webu.mjs: chybějící WEB_FQDNS = „nevím")
            // a pro edge nezapíše nic — viz domeny-webu-jeden-domov.
            WEB_FQDNS: "",
            API_DOMAIN: H.api,
            API_DOMAIN_PUBLIC: H.api,
            KEYCLOAK_DOMAIN_DIRECT: H.auth,
            KEYCLOAK_DOMAIN_PUBLIC: H.auth,
            N8N_DOMAIN: H.n8n,
            MCP_DOMAIN: H.mcp,
            DIRIGENT_DOMAIN: H.dirigent,
            ...env,
          },
          timeout: 60_000,
        },
        (err, stdout, stderr) =>
          vysledek({ kod: err ? (typeof err.code === "number" ? err.code : null) : 0, vystup: `${stdout}\n${stderr}`, patche }),
      );
    });
  } finally {
    server.close();
  }
}

const VLASTNI_EDGE = [H.api, H.auth, H.mcp, H.dirigent].join(",");
const hostyPatche = (b: Beh, uuid: string) =>
  b.patche.filter((p) => p.uuid === uuid).at(-1)?.telo.docker_compose_domains ?? [];

describe("doktor --apply: uvolnění před převzetím, v jednom běhu", () => {
  test("sonda jde rozsvítit — bez EDGE_OWNED_HOSTS se naměřená vada reprodukuje", { timeout: 90_000 }, async () => {
    const r = await doktor(naMeřenyStav(), { EDGE_OWNED_HOSTS: "" });
    expect(r.vystup).toMatch(/FQDN_CONFLICT/);
    expect(r.vystup).toMatch(/APPLY BLOCKED: intra-project fqdn collision/);
    expect(r.kod, r.vystup).not.toBe(0);
  });

  test("jeden uzel: backendy jména uvolní, edge je převezme, doktor skončí nulou", { timeout: 90_000 }, async () => {
    const apps = naMeřenyStav();
    const r = await doktor(apps, { EDGE_OWNED_HOSTS: VLASTNI_EDGE });
    expect(r.vystup).not.toMatch(/APPLY BLOCKED/);
    expect(r.kod, r.vystup).toBe(0);

    // core a keycloak přišly o jediné jméno → VÝSLOVNÉ uvolnění sentinelem.
    expect(hostyPatche(r, "core-uuid")).toEqual([{ name: "gateway", domain: releaseSentinel("gateway", PREFIX) }]);
    expect(hostyPatche(r, "kc-uuid")).toEqual([{ name: "keycloak", domain: releaseSentinel("keycloak", PREFIX) }]);
    // orchestration si nechá n8n (edge ho neobsluhuje).
    expect(hostyPatche(r, "orch-uuid")).toEqual([{ name: "n8n-auth", domain: `https://${H.n8n}:4180` }]);
    // edge dostal všechna sporná jména.
    const edgeProxy = hostyPatche(r, "edge-uuid").find((e) => e.name === "edge-proxy")?.domain ?? "";
    for (const h of [H.api, H.auth, H.mcp, H.dirigent]) expect(edgeProxy, h).toContain(`https://${h}`);

    // Pořadí: edge až po všech, kdo uvolňovali.
    const poradi = r.patche.map((p) => p.uuid);
    expect(poradi.indexOf("edge-uuid")).toBeGreaterThan(Math.max(poradi.indexOf("core-uuid"), poradi.indexOf("kc-uuid"), poradi.indexOf("orch-uuid")));
    // Žádný zápis neodmítnut pro konflikt.
    expect(r.vystup).not.toMatch(/Domain conflicts detected/);
  });

  test("víc uzlů (derivace nic nevydá): backendy si jména nechají, nic se neuvolňuje", { timeout: 90_000 }, async () => {
    const r = await doktor(naMeřenyStav(1), { EDGE_OWNED_HOSTS: "" });
    expect(r.patche.flatMap((p) => p.telo.docker_compose_domains).some((e) => isReleaseSentinel(e.domain))).toBe(false);
    expect(r.patche.map((p) => p.uuid)).not.toContain("core-uuid");
    expect(r.patche.map((p) => p.uuid)).not.toContain("kc-uuid");
  });

  test("mesh na víc uzlech: n8n-auth s mesh jménem UVOLNÍ boční mcp/dirigent (dřív se neposlalo nic)", { timeout: 90_000 }, async () => {
    // ⛔ NAMĚŘENO 2026-10-02: N8N_DOMAIN je s meshem `.internal`; po vyřazení
    // jmen edge a mesh jména nezbylo nic a doktor NEPOSLAL NIC — v Coolify tak
    // zůstal boční router veřejných mcp/dirigent na backendovém Traefiku.
    const meshN8n = `zkusebni-n8n.mesh.zkusebni.internal`;
    const apps = naMeřenyStav(1);
    const orch = apps.find((a) => a.uuid === "orch-uuid")!;
    orch.docker_compose_domains = [{ name: "n8n-auth", domain: `https://${H.mcp}:4180,https://${H.dirigent}:4180` }];
    const r = await doktor(apps, {
      EDGE_OWNED_HOSTS: [H.api, H.mcp, H.dirigent].join(","),
      N8N_DOMAIN: meshN8n,
      API_DOMAIN: `zkusebni-api.mesh.zkusebni.internal`,
    });
    expect(r.kod, r.vystup).toBe(0);
    expect(hostyPatche(r, "orch-uuid")).toEqual([{ name: "n8n-auth", domain: releaseSentinel("n8n-auth", PREFIX) }]);
    const edgeProxy = hostyPatche(r, "edge-uuid").find((e) => e.name === "edge-proxy")?.domain ?? "";
    for (const h of [H.mcp, H.dirigent]) expect(edgeProxy, h).toContain(`https://${h}`);
    // Keycloak (auth přes Traefik) si přímou tvář nechává.
    expect(r.patche.map((p) => p.uuid)).not.toContain("kc-uuid");
  });
});

// ── deploy-init (bash) mluví stejně jako doktor ─────────────────────────────

function vyrizni(jmeno: string): string {
  const m = new RegExp(`\\n${jmeno}\\(\\) \\{[\\s\\S]*?\\n\\}\\n`).exec(DEPLOY_INIT);
  expect(m, `v coolify-deploy-init.sh chybí ${jmeno}()`).not.toBeNull();
  return m![0];
}

function bash(skript: string, env: Record<string, string>) {
  const r = spawnSync("bash", ["-c", `set -uo pipefail\n${skript}`], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH ?? "", ...env },
    timeout: 20_000,
  });
  expect(r.status, r.stderr).toBe(0);
  return r;
}

describe("deploy-init: domena_pro_coolify = domenaProCoolify (spuštěno, ne čteno)", () => {
  const PRIPADY: Array<[string, string, string]> = [
    ["gateway", `https://${H.api}:3001`, VLASTNI_EDGE],
    ["keycloak", `https://${H.auth}:80`, VLASTNI_EDGE],
    ["n8n-auth", `https://${H.n8n}:4180,https://${H.mcp}:4180,https://${H.dirigent}:4180`, VLASTNI_EDGE],
    ["n8n-auth", `https://${H.n8n}:4180, https://MCP.${L}:4180`, VLASTNI_EDGE],
    ["edge-proxy", `https://${H.api},https://${H.mcp}`, VLASTNI_EDGE],
    ["gateway", `https://${H.api}:3001`, ""],
    ["nocodb", `https://nocodb.${L}:8080`, VLASTNI_EDGE],
    // Mesh jména: vyřadí se; nezbude-li nic, odejde uvolňovací sentinel.
    ["n8n-auth", `https://zkusebni-n8n.mesh.zkusebni.internal:4180,https://${H.mcp}:4180,https://${H.dirigent}:4180`, VLASTNI_EDGE],
    ["svc-model", `https://zkusebni-svc-model.mesh.zkusebni.internal:8000`, ""],
    ["gateway", `https://zkusebni-api.mesh.zkusebni.internal:3001,https://pub.${L}:3001`, ""],
  ];
  const fn = () => vyrizni("domena_pro_coolify");

  test.each(PRIPADY)("%s = %s (vlastní: %s)", (sluzba, domena, vlastni) => {
    const r = bash(`${fn()}\ndomena_pro_coolify '${sluzba}' '${domena}'`, {
      EDGE_OWNED_HOSTS: vlastni,
      APP_NAME_PREFIX: PREFIX,
    });
    expect(r.stdout).toBe(domenaProCoolify(sluzba, domena, edgeOwnedSet(vlastni), PREFIX));
  });

  test("bez prefixu instance bash router NEuvolní a řekne to (knihovna by spadla — doktor prefix vyžaduje vždy)", () => {
    const r = bash(`${fn()}\ndomena_pro_coolify gateway 'https://${H.api}:3001'`, { EDGE_OWNED_HOSTS: VLASTNI_EDGE });
    // Prázdno = volající položku vynechá a ohlásí (set_coolify_domains).
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/APP_NAME_PREFIX chybí — router NEuvolňuji/);
    expect(() => domenaProCoolify("gateway", `https://${H.api}:3001`, edgeOwnedSet(VLASTNI_EDGE), "")).toThrow(/prefix instance chybí/);
  });

  test("set_coolify_domains odešle hodnoty už bez jmen edge (DRY_RUN)", () => {
    const stuby = 'info() { printf "%s\\n" "$*"; }\nwarn() { :; }\nok() { :; }\nerr() { :; }\n';
    const r = bash(
      `${stuby}${fn()}${vyrizni("set_coolify_domains")}\n` +
        `set_coolify_domains uuid 'gateway=https://${H.api}:3001' 'n8n-auth=https://${H.n8n}:4180,https://${H.mcp}:4180' 'edge-proxy=https://${H.api}' 'svc-model=https://zkusebni-svc-model.mesh.zkusebni.internal:8000'`,
      { EDGE_OWNED_HOSTS: VLASTNI_EDGE, APP_NAME_PREFIX: PREFIX, DRY_RUN: "1" },
    );
    const json = /docker_compose_domains = (\[.*\])/.exec(r.stdout);
    expect(json, r.stdout).not.toBeNull();
    expect(JSON.parse(json![1])).toEqual([
      { name: "gateway", domain: releaseSentinel("gateway", PREFIX) },
      { name: "n8n-auth", domain: `https://${H.n8n}:4180` },
      { name: "edge-proxy", domain: `https://${H.api}` },
      // Jen mesh jméno: dřív se položka přeskočila a starý router zůstal.
      { name: "svc-model", domain: releaseSentinel("svc-model", PREFIX) },
    ]);
  });

  test("ověření po zápisu porovnává s ODESLANOU hodnotou (jinak falešné „stale values“)", () => {
    const fnSet = vyrizni("set_coolify_domains");
    const overeni = fnSet.slice(fnSet.indexOf("local missing=() mismatched=()"));
    expect(overeni).toMatch(/svc_domain="\$\(domena_pro_coolify "\$svc_name" "\$svc_domain"\)"/);
  });
});

describe("doručení: rozhodnutí derivace dojde k oběma zapisovatelům", () => {
  const COLD_START = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");

  test("cold-start výstup derivace exportuje (deploy-init i doktor ho zdědí)", () => {
    expect(COLD_START).toMatch(/node "\$DERIVE_SCRIPT" --shell > "\$TOPOLOGY_ENV"\n\s*set -a\n[^\n]*\n\s*\. "\$TOPOLOGY_ENV"/);
  });

  test(".env.coolify ho nese i pro SAMOSTATNÝ běh doktora", () => {
    expect(COLD_START).toMatch(/\nEDGE_OWNED_HOSTS=\$\{EDGE_OWNED_HOSTS-\}\n/);
  });
});

describe("seznam tváří edge nese derivace i doktor stejně", () => {
  test("každý klíč EDGE_VEREJNE_TVARE doktor registruje u edge-proxy a nic navíc", { timeout: 90_000 }, async () => {
    const hodnoty = Object.fromEntries(EDGE_VEREJNE_TVARE.map(({ klic }, i) => [klic, `tvar${i}.${L}`]));
    const r = await doktor([app("edge-uuid", "edge", [{ name: "web", domain: `https://${H.web}` }])], {
      ...hodnoty,
      EDGE_OWNED_HOSTS: "",
    });
    const edgeProxy = hostyPatche(r, "edge-uuid").find((e) => e.name === "edge-proxy")?.domain ?? "";
    const registrovane = edgeProxy.split(",").map((d) => d.replace(/^https?:\/\//, "").split(/[:/]/)[0]).sort();
    expect(registrovane, r.vystup).toEqual(Object.values(hodnoty).sort());
  });

  test("deploy-init skládá EDGE_PROXY_DOMAINS z týchž klíčů (nic nechybí, nic nepřebývá)", () => {
    // Blok edge sedí hluboko ve smyčce přes stacky a samostatně spustit nejde;
    // čtou se proto dvě místa, kde vzniká: pevný začátek a smyčka volitelných tváří.
    const zacatek = /\n\s*EDGE_PROXY_DOMAINS="([^"\n]*)"\n/.exec(DEPLOY_INIT);
    const smycka = /for _edge_face_var in ([A-Z_ ]+); do/.exec(DEPLOY_INIT);
    expect(zacatek, "v deploy-initu chybí počáteční EDGE_PROXY_DOMAINS=").not.toBeNull();
    expect(smycka, "v deploy-initu chybí smyčka _edge_face_var").not.toBeNull();
    const klice = new Set([
      ...[...zacatek![1].matchAll(/\$\{([A-Z_]+)\}/g)].map((m) => m[1]),
      ...smycka![1].trim().split(/\s+/),
    ]);
    expect([...klice].sort()).toEqual(EDGE_VEREJNE_TVARE.map((t) => t.klic).sort());
  });
});
