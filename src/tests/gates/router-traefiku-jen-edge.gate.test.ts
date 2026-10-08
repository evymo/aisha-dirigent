/**
 * Brána (třída): veřejný router Traefiku vlastní JEN edge — a výslovné výjimky
 * s důvodem. Ráčna: výjimek nesmí přibýt.
 *
 * Pravidlo majitele (2026-10-02, opakovaně): „vše jen v meshi a přes edge,
 * kvůli zabezpečení a kontrole přístupu". Veřejný provoz vstupuje jen dveřmi
 * edge (evidence, hlavičky, knock), dovnitř jde meshem.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (živý soupis na <fork>, tabule soupisu bočních
 * vstupů mimo Edge): n8n-auth na uzlu backendu držel routery
 * veřejných `mcp`/`dirigent` — boční vstup mimo dveře edge, ačkoli edge k nim
 * jde meshem. Opraveno derivací (EDGE_OWNED_HOSTS) a uvolněním v doktorovi;
 * tahle brána drží TŘÍDU, ne instanci: kterákoli služba, která by si veřejné
 * jméno zaregistrovala bokem, ji shodí.
 *
 * Měřidlo: SKUTEČNÁ derivace (`derive-domains --shell`) nad profily, rozvinutá
 * jako v cold-startu (topologie → `config/domains.env` → topologie znovu), a
 * SKUTEČNÝ doktor domén `--apply --no-probe` proti místnímu „Coolify", kde
 * existují všechny aplikace manifestu bez domén. Co doktor odešle, to Coolify
 * udělá routerem — měří se tedy přesně vstup Traefiku, ne text.
 *
 * Rozsah: topologie s meshem (tak platforma běží). Bez meshe jde edge na
 * upstreamy přes jejich veřejné tváře — to je jiná třída a tady se neměří.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DERIVE = join(ROOT, "scripts/lib/derive-domains.mjs");
const DOKTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");
const PREFIX = "acme";
const REF = {
  PUBLIC_TLD: "zona.example",
  INTERNAL_TLD: "vnitrni.example",
  MESH_TLD: "mesh.acme.internal",
  APP_NAME_PREFIX: PREFIX,
};

/** Služby edge — jediné, kdo smí veřejné jméno registrovat jako router. */
const EDGE = new Set(["edge/edge-proxy", "edge/web"]);

/**
 * VÝJIMKY s důvodem. RÁČNA: přidat sem položku = vědomé rozhodnutí v revizi,
 * s důvodem a cílem. Odebrat = cíl splněn (brána pak hlídá, že se nevrátí).
 */
const VYJIMKY: Record<string, string> = {
  "netbird/netbird-proxy":
    "řídicí rovina meshe — mesh ji potřebuje, aby vůbec vznikl (bootstrap); jediná trvalá výjimka",
  "keycloak/keycloak":
    "přímá tvář OIDC pro zápis peerů do meshe (NetBird management) před meshem — CÍL: management na interní adresu KC meshem",
  "pki/pki-bridge":
    "vydání certifikátů *.mesh dřív, než mesh stojí (bootstrap PKI) — CÍL: po bootstrapu jen meshem",
  "registry/registry-cache":
    "veřejný ZÁMĚRNĚ — rozhodnutí majitele 2026-10-02: obrazy si stahují i vývojáři k sobě (+ build servery, GPU uzel); pull-through s účtem Docker Hub instance, jen čtení (DELETE odmítá proxy režim, změřeno 405)",
};

const manifest = readFileSync(join(ROOT, "coolify/manifests/aisha.manifest"), "utf8")
  .split("\n")
  .filter((r) => r.startsWith("app: "))
  .map((r) => r.slice(5).split(":") as [string, string, string]);

let overlay = "";
beforeAll(() => {
  overlay = mkdtempSync(join(tmpdir(), "router-jen-edge-"));
  mkdirSync(join(overlay, "profiles"));
  const sablona = JSON.parse(readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf8"));
  const profil = (id: string, bindings: Record<string, string>) =>
    writeFileSync(join(overlay, `profiles/${id}.json`), JSON.stringify({ ...sablona, id, server_bindings: bindings }));
  profil("vic-uzlu", { frontend: "uzel-a", backend: "uzel-b", experimental: "uzel-c" });
  profil("jeden-uzel", { frontend: "uzel-a", backend: "uzel-a", experimental: "uzel-a" });
});
afterAll(() => {
  if (overlay) rmSync(overlay, { recursive: true, force: true });
});

/** Prostředí jako v cold-startu: topologie → domains.env → topologie znovu (aisha-cold-start.sh). */
function prostredi(profil: string): Record<string, string> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const k of RESOLVER_ENV_INPUTS) delete env[k];
  const r = spawnSync(
    "bash",
    [
      "-c",
      `set -e; topo=$(mktemp); trap 'rm -f "$topo"' EXIT
       node "${DERIVE}" --profile="${profil}" --mesh=on --shell > "$topo"
       set -a; . "$topo"; . "${join(ROOT, "config/domains.env")}"; . "$topo"; set +a
       env -0`,
    ],
    { cwd: ROOT, env: { ...env, ...REF, AISHA_INSTANCE_CONFIG_DIR: overlay } },
  );
  expect(r.status, String(r.stderr)).toBe(0);
  const out: Record<string, string> = {};
  for (const radek of String(r.stdout).split("\0")) {
    const i = radek.indexOf("=");
    if (i > 0) out[radek.slice(0, i)] = radek.slice(i + 1);
  }
  return out;
}

type Dcd = Array<{ name: string; domain: string }>;

/** Doktor --apply --no-probe proti „Coolify" se všemi aplikacemi manifestu; vrátí, co by se stalo routery. */
async function routery(env: Record<string, string>, uzly: Record<string, number>) {
  const apps = manifest.map(([role, slot]) => ({
    uuid: `u-${role}`,
    name: `${PREFIX}-${role}`,
    environment_id: 1,
    destination: { server_id: uzly[slot] ?? 0 },
    build_pack: "dockercompose",
    status: "running:healthy",
    docker_compose_domains: [] as Dcd,
  }));
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
      if (req.method === "GET" && cesta === "/projects") return json([{ uuid: "projekt", name: PREFIX }]);
      if (req.method === "GET" && cesta === "/projects/projekt") return json({ environments: [{ id: 1 }] });
      const a = apps.find((x) => cesta === `/applications/${x.uuid}`);
      if (a && req.method === "PATCH") {
        const b = JSON.parse(telo || "{}");
        if (b.docker_compose_domains) a.docker_compose_domains = b.docker_compose_domains;
        return json({ uuid: a.uuid });
      }
      if (a && req.method === "GET") return json(a);
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adresa = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const vystup = await new Promise<{ kod: number | null; text: string }>((r) =>
      execFile(
        process.execPath,
        [DOKTOR, "--apply", "--no-probe", "--max-retries=1", "--timeout-ms=10000"],
        {
          cwd: ROOT,
          env: { ...env, COOLIFY_URL: adresa, COOLIFY_API_TOKEN: "t", COOLIFY_PROJECT_UUID: "projekt" },
          timeout: 120_000,
        },
        (e, so, se) => r({ kod: e ? (typeof e.code === "number" ? e.code : null) : 0, text: `${so}\n${se}` }),
      ),
    );
    const mapa = new Map<string, string[]>();
    for (const a of apps) {
      for (const e of a.docker_compose_domains) {
        const hosty = String(e.domain)
          .split(",")
          .map((d) => d.replace(/^https?:\/\//, "").split(/[:/]/)[0])
          .filter((h) => h && !h.endsWith(".invalid"));
        if (hosty.length) mapa.set(`${a.name.slice(PREFIX.length + 1)}/${e.name}`, hosty);
      }
    }
    return { mapa, vystup };
  } finally {
    server.close();
  }
}

/** Služby s routerem, které nejsou edge ani výslovná výjimka. */
export function bocniVstupy(mapa: Map<string, string[]>): string[] {
  return [...mapa.entries()]
    .filter(([sluzba]) => !EDGE.has(sluzba) && !(sluzba in VYJIMKY))
    .map(([sluzba, hosty]) => `${sluzba} → ${hosty.join(", ")}`);
}

describe("router Traefiku vlastní jen edge (+ výjimky s důvodem)", () => {
  test.each([
    ["víc uzlů", "vic-uzlu", { frontend: 0, backend: 1, experimental: 2 }],
    ["jeden uzel", "jeden-uzel", { frontend: 0, backend: 0, experimental: 0 }],
  ])("%s, mesh zapnutý", { timeout: 180_000 }, async (_popis, profil, uzly) => {
    const { mapa, vystup } = await routery(prostredi(profil), uzly);
    // Slepé měřidlo = zelená z neměření: doktor musel projít celý kontrakt.
    expect(vystup.text, "doktor narazil na nerozvinutou proměnnou — měření by bylo neúplné").not.toMatch(
      /UNRESOLVED|APPLY BLOCKED/,
    );
    expect(vystup.kod, vystup.text).toBe(0);
    // Kontrolní vzorek: edge-proxy nese veřejné tváře (bez nich by brána neměřila nic).
    expect(mapa.get("edge/edge-proxy")?.length ?? 0, "kontrolní vzorek: edge-proxy bez veřejných tváří").toBeGreaterThanOrEqual(8);
    expect(
      bocniVstupy(mapa),
      "Tyhle služby by dostaly VEŘEJNÝ router Traefiku mimo dveře edge (boční vstup).\n" +
        "Veřejné jméno patří edge (EDGE_VEREJNE_TVARE + upstream meshem, derive-domains.mjs);\n" +
        "výjimka jen do VYJIMKY s důvodem a cílem — ráčna, revize ji uvidí.",
    ).toEqual([]);
    // Ráčna dolů: výjimka, kterou už žádná topologie nepoužívá, má z VYJIMKY zmizet.
    for (const sluzba of Object.keys(VYJIMKY)) {
      expect(mapa.has(sluzba), `výjimka ${sluzba} se už nepoužívá — odeber ji z VYJIMKY (ráčna)`).toBe(true);
    }
  });

  test("negativní sonda: bez rozhodnutí derivace (prázdné EDGE_OWNED_HOSTS) se boční mcp/dirigent chytí", { timeout: 180_000 }, async () => {
    const env = { ...prostredi("vic-uzlu"), EDGE_OWNED_HOSTS: "" };
    const { mapa } = await routery(env, { frontend: 0, backend: 1, experimental: 2 });
    const nalezy = bocniVstupy(mapa);
    expect(nalezy.join("\n")).toMatch(/orchestration\/n8n-auth → .*mcp\.zona\.example/);
  });

  test("výjimek je přesně tolik, kolik ráčna dovoluje (přidání = vědomá změna tohoto čísla)", () => {
    expect(Object.keys(VYJIMKY).sort()).toEqual([
      "keycloak/keycloak",
      "netbird/netbird-proxy",
      "pki/pki-bridge",
      "registry/registry-cache",
    ]);
    for (const [sluzba, duvod] of Object.entries(VYJIMKY)) expect(duvod.length, `${sluzba}: výjimka bez důvodu`).toBeGreaterThan(30);
  });
});
