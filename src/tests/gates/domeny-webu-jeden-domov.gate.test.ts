/**
 * Brána: VEŘEJNÉ DOMÉNY WEBU MAJÍ JEDEN VÝKLAD — a doktor domén je nezúží.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (ostrý cold-start forku s víc značkami): krok 4
 * cold-startu `coolify-domain-doctor.mjs --apply` přepsal službě
 * `web` aplikace `<prefix>-edge` domény na jediné `https://${APP_DOMAIN}`
 * („domain drift: web -> …"). Deploy-init přitom o krok dřív zapsal všech
 * třináct jmen z `WEB_FQDNS` (overlay instance). Doktor `WEB_FQDNS` neznal:
 * jeho `webPublicDomains()` skládala APP_DOMAIN + aliasy + apex, deploy-init
 * `${WEB_FQDNS:-https://${APP_DOMAIN}}`. Dva výklady téže deklarace; poslední
 * zapisovatel vyhrál. Dopad: každá instance s víc značkami přišla při každém
 * cold-startu o routy značek (Traefik 404, bez certifikátu).
 *
 * CO SE MĚŘÍ:
 *   (b) JEDEN DOMOV — scripts/lib/domeny-webu.mjs:
 *       · řádek deploy-initu, který skládá WEB_DOMAINS, SPUŠTĚNÝ v bashi dá
 *         totéž co funkce domova, nad maticí vstupů;
 *       · kontrakt `web` doktoru (--json proti falešnému Coolify) dá totéž;
 *       · REŽIM APEXU: tatáž surová hodnota (`web`, `SERVE`, neznámá…) → doktor
 *         (surová, jak ji má z trezoru) i deploy-init (normalizovaná derivací
 *         i surová) dají stejný web i stejný apex u edge-proxy; apex nikdy obojí;
 *       · VLASTNOST „nikdo jiný domény webu neskládá": hodnotu WEB_FQDNS ani
 *         AISHA_WEB_PUBLIC_ALIASES nečte žádný kód mimo domov, kromě vyjmenovaných
 *         spotřebitelů, kteří Coolify routing nezapisují (každý s důvodem; ani
 *         jeden nesmí zůstat ve výčtu, když už čtení nemá); se samotestem vzoru;
 *   (c) CHOVÁNÍ doktoru --apply proti falešnému Coolify (vzor
 *       drzeni-plati-mimo-ci / domain-doctor-cizi-drzitel):
 *       · edge s 13 doménami z WEB_FQDNS → NEZÚŽÍ (žádný zápis, kód 0);
 *       · bez overlaye (WEB_FQDNS v prostředí není) → NEZAPÍŠE nic, kód ≠ 0;
 *       · kotvy: obnova po regresi (uloženo jen APP_DOMAIN → zapíše 13) a
 *         vědomě deklarovaná jedna značka (prázdný WEB_FQDNS → zapíše užší) —
 *         test zápis VIDÍ, takže „nezapsal" výš není slepé měřidlo.
 *
 * Jména instancí ani domény tu nejsou: hosty leží v `.local`, který doktor živou
 * sondou routování nezkouší.
 */
import { describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { verejneDomenyWebu } from "../../../scripts/lib/domeny-webu.mjs";
import { normalizeApexMode } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DOMOV = "scripts/lib/domeny-webu.mjs";
const DOKTOR = join(ROOT, "scripts/coolify-domain-doctor.mjs");
const DEPLOY_INIT = readFileSync(join(ROOT, "scripts/coolify-deploy-init.sh"), "utf8");

const PREFIX = "zkusebni";
const Z = "zkusebni.local";
const APP = `web.${Z}`;
/** 13 jmen jako u naměřené instance; kanonický host je jedním z nich. */
const TRINACT = [`https://${APP}`, ...Array.from({ length: 12 }, (_, i) => `https://znacka${i + 1}.${Z}`)];

/** Vstupy edge, které doktor potřebuje vedle domén webu — všechny výslovně (domains.env by dal šablony). */
const EDGE_ENV: Record<string, string> = {
  APP_DOMAIN: APP,
  PUBLIC_TLD: Z,
  AISHA_WEB_APEX_MODE: "redirect",
  API_DOMAIN_PUBLIC: `api.${Z}`,
  MCP_DOMAIN: `mcp.${Z}`,
  DIRIGENT_DOMAIN: `dirigent.${Z}`,
  KEYCLOAK_DOMAIN_PUBLIC: "",
  LIVE_DOMAIN_PUBLIC: "",
  GATEWAY_DOMAIN_PUBLIC: "",
  COMPANION_DOMAIN_PUBLIC: "",
  INGEST_DOMAIN_PUBLIC: "",
  POTOK_DOMAIN_PUBLIC: "",
  EXTRANET_DOMAIN_PUBLIC: "",
  NETBIRD_DOMAIN: "",
  NETBIRD_DOMAIN_DIRECT: "",
  EDGE_EXTERNAL_FACE_HOSTS: "",
  EDGE_OWNED_HOSTS: "",
};
/** Kontrakt edge-proxy pro EDGE_ENV (redirect: apex patří edge-proxy) — aby jediný možný drift byl `web`. */
const EDGE_PROXY = [`https://api.${Z}`, `https://mcp.${Z}`, `https://dirigent.${Z}`, `https://${Z}`].join(",");

type Zaznam = { name: string; domain: string };
type Beh = { kod: number | null; vystup: string; patche: Zaznam[][] };

function edge(web: string, edgeProxy = EDGE_PROXY): Record<string, unknown> {
  return {
    uuid: "edge-uuid",
    name: `${PREFIX}-edge`,
    environment_id: 1,
    destination: { server_id: 0 },
    build_pack: "dockercompose",
    status: "running:healthy",
    docker_compose_domains: [
      { name: "web", domain: web },
      { name: "edge-proxy", domain: edgeProxy },
    ],
  };
}

/** Skutečný doktor proti místnímu „Coolify", které každý PATCH zapíše a uloží. */
async function doktor(app: Record<string, unknown>, env: Record<string, string>, args = ["--apply"]): Promise<Beh> {
  const patche: Zaznam[][] = [];
  const server = createServer((req, res) => {
    const cesta = (req.url ?? "").replace(/^\/api\/v1/, "");
    let telo = "";
    req.on("data", (c) => (telo += c));
    req.on("end", () => {
      const json = (x: unknown) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(x));
      };
      if (req.method === "GET" && cesta === "/applications") return json([app]);
      if (req.method === "GET" && cesta === "/projects") return json([{ uuid: "projekt-nas", name: PREFIX }]);
      if (req.method === "GET" && cesta === "/projects/projekt-nas") return json({ environments: [{ id: 1 }] });
      if (cesta === `/applications/${app.uuid}` && req.method === "PATCH") {
        const b = JSON.parse(telo || "{}");
        patche.push(b.docker_compose_domains ?? []);
        app.docker_compose_domains = b.docker_compose_domains;
        return json({ uuid: app.uuid });
      }
      if (cesta === `/applications/${app.uuid}` && req.method === "GET") return json(app);
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
        [DOKTOR, ...args, "--only=edge", "--max-retries=1", "--timeout-ms=10000"],
        {
          cwd: ROOT,
          // Prostředí OD NULY: identita, adresa i token jen ty zkušební.
          env: {
            PATH: process.env.PATH ?? "",
            COOLIFY_URL: adresa,
            COOLIFY_API_TOKEN: "zkusebni-token",
            COOLIFY_PROJECT_UUID: "projekt-nas",
            APP_NAME_PREFIX: PREFIX,
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

const webVPatchi = (p: Zaznam[]) => p.find((e) => e.name === "web")?.domain ?? "";
const hosty = (csv: string) => csv.split(",").filter(Boolean);

// ══ (c) Chování doktoru --apply ═══════════════════════════════════════════════

// Běhy doktora jsou nezávislé (každý má vlastní „Coolify" na volném portu), takže
// jdou souběžně: brána s podprocesem nesmí zdražit lehkou dráhu (lanes.json).
describe.concurrent("(c) coolify-domain-doctor --apply nezúží domény webu", { timeout: 90_000 }, () => {
  test("⛔ edge s 13 doménami z WEB_FQDNS → žádný zápis, kód 0 (dřív: web → jen APP_DOMAIN)", async ({ expect }) => {
    const r = await doktor(edge(TRINACT.join(",")), { ...EDGE_ENV, WEB_FQDNS: TRINACT.join(",") });
    for (const p of r.patche) {
      const zapsano = hosty(webVPatchi(p));
      const ztracene = TRINACT.filter((d) => !zapsano.includes(d));
      expect(ztracene, `doktor zúžil web (zapsal ${zapsano.join(",")}):\n${r.vystup}`).toEqual([]);
    }
    expect(r.patche, r.vystup).toEqual([]);
    expect(r.kod, r.vystup).toBe(0);
  });

  test("⛔ bez overlaye (WEB_FQDNS v prostředí není) → NEZAPÍŠE nic, kód ≠ 0, řekne proč", async ({ expect }) => {
    const r = await doktor(edge(TRINACT.join(",")), { ...EDGE_ENV });
    expect(r.patche, `doktor zapisoval bez deklarace:\n${r.vystup}`).toEqual([]);
    expect(r.kod, r.vystup).not.toBe(0);
    expect(r.vystup).toMatch(/NEVÍM[^\n]*WEB_FQDNS/);
    expect(r.vystup).toMatch(/APPLY BLOCKED/);
  });

  test("bez overlaye ani v kontrolním běhu nehlásí „OK“ (nevím ≠ v pořádku)", async ({ expect }) => {
    const r = await doktor(edge(TRINACT.join(",")), { ...EDGE_ENV }, []);
    expect(r.patche).toEqual([]);
    expect(r.kod, r.vystup).not.toBe(0);
    expect(r.vystup).not.toMatch(/^OK\s/m);
  });

  test("kotva — obnova po regresi: uloženo jen APP_DOMAIN, deklarováno 13 → zapíše všech 13", async ({ expect }) => {
    const r = await doktor(edge(`https://${APP}`), { ...EDGE_ENV, WEB_FQDNS: TRINACT.join(",") });
    expect(r.patche.length, r.vystup).toBe(1);
    expect(webVPatchi(r.patche[0])).toBe(TRINACT.join(","));
    expect(r.kod, r.vystup).toBe(0);
  });

  test("kanonický host mimo seznam značek se přidá, nic neubude", async ({ expect }) => {
    const znacky = TRINACT.slice(1);
    const r = await doktor(edge(znacky.join(",")), { ...EDGE_ENV, WEB_FQDNS: znacky.join(",") });
    expect(r.patche.length, r.vystup).toBe(1);
    expect(hosty(webVPatchi(r.patche[0]))).toEqual([...znacky, `https://${APP}`]);
  });

  test("kotva — vědomě deklarovaná JEDNA značka (prázdný WEB_FQDNS) → užší zápis je deklarace, ne vada", async ({ expect }) => {
    const r = await doktor(edge(TRINACT.join(",")), { ...EDGE_ENV, WEB_FQDNS: "" });
    expect(r.patche.length, r.vystup).toBe(1);
    expect(webVPatchi(r.patche[0])).toBe(`https://${APP}`);
    expect(r.kod, r.vystup).toBe(0);
  });
});

// ══ (b) Jeden domov ═══════════════════════════════════════════════════════════

/** Matice vstupů: víc značek, jedna značka, aliasy, apex serve, neplatná a chybějící deklarace. */
const MATICE: Array<[string, Record<string, string>]> = [
  ["13 značek", { WEB_FQDNS: TRINACT.join(",") }],
  ["značky + aliasy + serve", { WEB_FQDNS: TRINACT.slice(1, 4).join(","), AISHA_WEB_PUBLIC_ALIASES: "corp,studio", AISHA_WEB_APEX_MODE: "serve" }],
  ["jedna značka", { WEB_FQDNS: "" }],
  ["jedna značka + alias", { WEB_FQDNS: "", AISHA_WEB_PUBLIC_ALIASES: "Corp" }],
  ["jedna značka + serve", { WEB_FQDNS: "", AISHA_WEB_APEX_MODE: "serve" }],
  ["neplatná položka", { WEB_FQDNS: `znacka1.${Z}` }],
  ["neplatný alias", { WEB_FQDNS: "", AISHA_WEB_PUBLIC_ALIASES: "co.rp" }],
  ["bez overlaye (WEB_FQDNS není)", {}],
  ["schéma a hostitel velkými", { WEB_FQDNS: `HTTPS://Znacka1.${Z.toUpperCase()}/,https://znacka2.${Z}:443` }],
  ["zástupný * v seznamu", { WEB_FQDNS: `https://*.${Z}` }],
  ["surový režim apexu web", { WEB_FQDNS: "", AISHA_WEB_APEX_MODE: "web" }],
  ["surový režim apexu SERVE + značky", { WEB_FQDNS: TRINACT.slice(1, 3).join(","), AISHA_WEB_APEX_MODE: "SERVE" }],
  ["neznámý režim apexu", { WEB_FQDNS: "", AISHA_WEB_APEX_MODE: "vypnuto" }],
];

/** Řádek(y) deploy-initu, které přiřazují WEB_DOMAINS (mimo komentáře). */
function prirazeniWebDomains(): string[] {
  return DEPLOY_INIT.split("\n").filter((r) => !/^\s*#/.test(r) && /(^|[\s;(&|])WEB_DOMAINS=/.test(r));
}

describe("(b) deploy-init skládá web domény JEN voláním domova (spuštěno, ne čteno)", () => {
  test("WEB_DOMAINS se přiřazuje právě jednou, a to výstupem CLI domova; selhání ukončí běh", () => {
    const prirazeni = prirazeniWebDomains();
    expect(prirazeni, "WEB_DOMAINS má v deploy-initu víc přiřazení — druhý výklad").toHaveLength(1);
    expect(prirazeni[0]).toContain(`lib/domeny-webu.mjs" --csv`);
    const blok = DEPLOY_INIT.slice(DEPLOY_INIT.indexOf(prirazeni[0]), DEPLOY_INIT.indexOf(prirazeni[0]) + 600);
    expect(blok, "nesložené domény musí běh ukončit, ne poslat prázdný/užší seznam").toMatch(/^\s*if ! WEB_DOMAINS=[\s\S]*?exit 1[\s\S]*?\bfi\b/m);
  });

  test("jediný zápis služby web do Coolify bere WEB_DOMAINS", () => {
    const kod = DEPLOY_INIT.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");
    const zapisy = [...kod.matchAll(/"web=([^"]*)"/g)].map((m) => m[1]);
    expect(zapisy).toEqual(["${WEB_DOMAINS}"]);
  });
});

describe.concurrent("(b) řádek deploy-initu spuštěný v bashi = funkce domova", { timeout: 60_000 }, () => {
  test.for(MATICE)("%s", async ([, vstup], { expect }) => {
    const env = { ...EDGE_ENV, ...vstup };
    // Vyřízne se SAMOTNÉ přiřazení (`WEB_DOMAINS="$(…)"`) a spustí se tak, jak ho deploy-init volá.
    const prirazeni = /WEB_DOMAINS="\$\(.*\)"/.exec(prirazeniWebDomains()[0]);
    expect(prirazeni, prirazeniWebDomains()[0]).not.toBeNull();
    const vystup = await new Promise<string>((hotovo) => {
      execFile(
        "bash",
        ["-c", `set -uo pipefail\nif ${prirazeni![0]}; then echo "OK:\${WEB_DOMAINS}"; else echo "NESLOZENO"; fi`],
        { encoding: "utf8", env: { PATH: process.env.PATH ?? "", _di_dir: join(ROOT, "scripts"), ...env }, timeout: 20_000 },
        (_err, stdout, stderr) => hotovo(`${stdout.trim()}${stderr ? `\n[stderr] ${stderr.trim()}` : ""}`),
      );
    });
    const domov = verejneDomenyWebu(env);
    expect(vystup.split("\n")[0], vystup).toBe(domov.znamo ? `OK:${domov.domeny.join(",")}` : "NESLOZENO");
  });
});

describe.concurrent("(b) doktor skládá kontrakt web z domova (spuštěno proti falešnému Coolify)", { timeout: 90_000 }, () => {
  test.for(MATICE)("%s: kontrakt web v --json = funkce domova", async ([, vstup], { expect }) => {
    const env = { ...EDGE_ENV, ...vstup };
    // Uložené jméno webu neodpovídá žádné deklaraci → kontrakt se objeví celý jako drift (nebo jako nesložený).
    const r = await doktor(edge(`https://stary.${Z}`), env, ["--json"]);
    const json = JSON.parse(r.vystup.slice(r.vystup.indexOf("{"), r.vystup.lastIndexOf("}") + 1));
    const rep = json.reports.find((x: { app: string }) => x.app === `${PREFIX}-edge`);
    const domov = verejneDomenyWebu(env);
    if (domov.znamo) {
      expect(rep.drift.find((d: Zaznam) => d.name === "web")?.domain, r.vystup).toBe(domov.domeny.join(","));
    } else {
      expect(rep.unresolved?.map((d: Zaznam) => d.name), r.vystup).toEqual(["web"]);
      expect(rep.drift.find((d: Zaznam) => d.name === "web"), "nesložený web se nesmí hlásit jako drift k zápisu").toBeUndefined();
    }
    expect(r.patche, "--json bez --apply nezapisuje").toEqual([]);
  });
});

// ── Režim apexu: jeden normalizátor pro web i edge-proxy, v obou zapisovatelích ──

/** Vyřízne z deploy-initu přiřazení `JMENO="$(…)"` (jen kód, ne komentář). */
function prirazeniVDeployInitu(jmeno: string): string {
  const m = new RegExp(`^\\s*if ! (${jmeno}="\\$\\(.*\\)"); then$`, "m").exec(DEPLOY_INIT);
  expect(m, `v deploy-initu chybí \`if ! ${jmeno}="$(…)"; then\``).not.toBeNull();
  return m![1];
}

/** Blok deploy-initu, který přidává apex k edge-proxy (podmínka + přiřazení + fi). */
function apexBlokEdgeProxy(): string {
  const m = /^(\s*if \[ "\$\{WEB_APEX_REZIM\}" != "serve" \][^\n]*\n[^\n]*\n\s*fi)$/m.exec(DEPLOY_INIT);
  expect(m, "v deploy-initu chybí apex blok edge-proxy řízený WEB_APEX_REZIM").not.toBeNull();
  return m![1];
}

/**
 * Co deploy-init složí pro web a jestli dá apex edge-proxy — spuštěné řádky deploy-initu v bashi.
 * ASYNCHRONNĚ: testy běží souběžně a falešné Coolify doktora žije v tomhle procesu —
 * spawnSync by zablokoval jeho smyčku událostí a souběžné běhy doktora by čekaly.
 */
function deployInitEdge(env: Record<string, string>): Promise<string> {
  const skript = [
    "set -uo pipefail",
    `if ! ${prirazeniVDeployInitu("WEB_APEX_REZIM")}; then echo "NESLOZENO"; exit 0; fi`,
    `if ! ${prirazeniVDeployInitu("WEB_DOMAINS")}; then echo "NESLOZENO"; exit 0; fi`,
    'EDGE_PROXY_DOMAINS=""',
    apexBlokEdgeProxy(),
    'echo "WEB=${WEB_DOMAINS}"',
    'case ",${EDGE_PROXY_DOMAINS}," in *",https://${PUBLIC_TLD},"*) APEX=ano ;; *) APEX=ne ;; esac',
    'echo "APEX_PROXY=${APEX}"',
  ].join("\n");
  return new Promise((hotovo) => {
    execFile(
      "bash",
      ["-c", skript],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "", _di_dir: join(ROOT, "scripts"), ...env }, timeout: 20_000 },
      (err, stdout, stderr) => hotovo(`${stdout.trim()}${err ? ` (kód ${err.code}: ${stderr.trim()})` : ""}`),
    );
  });
}

const SUROVE_REZIMY: Array<string | undefined> = ["serve", "redirect", "web", "spa", "SERVE", " serve ", "vypnuto", "", undefined];

describe.concurrent("(b) režim apexu: tatáž surová hodnota → doktor i deploy-init stejně", { timeout: 90_000 }, () => {
  test.for(SUROVE_REZIMY.map((r) => [JSON.stringify(r) ?? "nepřítomný", r] as const))(
    "AISHA_WEB_APEX_MODE=%s",
    async ([, surovy], { expect }) => {
      const zaklad: Record<string, string> = { ...EDGE_ENV, WEB_FQDNS: TRINACT.slice(1, 3).join(",") };
      delete zaklad.AISHA_WEB_APEX_MODE;
      const surovyEnv = surovy === undefined ? zaklad : { ...zaklad, AISHA_WEB_APEX_MODE: surovy };
      // Doktor má hodnotu SUROVOU (operátorský trezor / .env.coolify), deploy-init ji
      // po derivaci dostane NORMALIZOVANOU — obojí musí dát týž výsledek.
      const r = await doktor(edge(`https://stary.${Z}`, `https://stary-proxy.${Z}`), surovyEnv, ["--json"]);
      const json = JSON.parse(r.vystup.slice(r.vystup.indexOf("{"), r.vystup.lastIndexOf("}") + 1));
      const rep = json.reports.find((x: { app: string }) => x.app === `${PREFIX}-edge`);
      const web = rep.drift.find((d: Zaznam) => d.name === "web")?.domain ?? "";
      const proxy = rep.drift.find((d: Zaznam) => d.name === "edge-proxy")?.domain ?? "";
      const apexWeb = hosty(web).includes(`https://${Z}`);
      const apexProxy = hosty(proxy).includes(`https://${Z}`);
      expect(apexWeb !== apexProxy, `apex musí mít PRÁVĚ jeden z web / edge-proxy:\n${r.vystup}`).toBe(true);
      expect(apexWeb, "apex u webu = režim serve podle normalizátoru derivace").toBe(normalizeApexMode(surovy) === "serve");

      const ocekavano = `WEB=${web}\nAPEX_PROXY=${apexProxy ? "ano" : "ne"}`;
      const [sSurovou, sDerivaci] = await Promise.all([
        deployInitEdge(surovyEnv),
        deployInitEdge({ ...zaklad, AISHA_WEB_APEX_MODE: normalizeApexMode(surovy) }),
      ]);
      expect(sSurovou, "deploy-init se SUROVOU hodnotou").toBe(ocekavano);
      expect(sDerivaci, "deploy-init s hodnotou z derivace").toBe(ocekavano);
    },
  );
});

// ── Vlastnost: nikdo jiný hodnotu deklarace webu nečte ───────────────────────

const KLICE = ["WEB_FQDNS", "AISHA_WEB_PUBLIC_ALIASES"] as const;
const KLIC = KLICE.join("|");
/** Čtení HODNOTY v JS/TS (i v JSON řetězci n8n): `env.KLIC`, `$env.KLIC`, `cokoli?.KLIC`, `x["KLIC"]`, `x[\"KLIC\"]`. */
const CTENI_JS = new RegExp(`(?:[\\w$\\])]\\??\\.(?:${KLIC})\\b)|(?:\\[\\s*\\\\?["'\`](?:${KLIC})\\\\?["'\`]\\s*\\])`);
/** Rozbalení HODNOTY v shellu/YAML: `$KLIC`, `${KLIC…}`. */
const CTENI_SH = new RegExp(`\\$\\{?(?:${KLIC})\\b`);
/** Průchod beze změny (heredoc .env.coolify, šablona domains.env): `KLIC=${KLIC}` / `${KLIC:-}` / `${KLIC-}`. */
const PRUCHOD_SH = new RegExp(`^\\s*(${KLIC})=\\$\\{\\1(?::?-)?\\}\\s*$`);

function cteniVRadku(soubor: string, radek: string): boolean {
  const t = radek.trim();
  // n8n workflow = JSON s kódem uzlů v řetězcích: jen tvary čtení z JS, žádné komentáře.
  if (/\.json$/.test(soubor)) return CTENI_JS.test(radek);
  const js = /\.(m?js|cjs|ts|mts|tsx)$/.test(soubor);
  if (js && (/^(\/\/|\*|\/\*)/.test(t))) return false;
  if (!js && t.startsWith("#")) return false;
  if (js) return CTENI_JS.test(radek);
  if (PRUCHOD_SH.test(radek)) return false;
  return CTENI_SH.test(radek) || (/\.ya?ml$/.test(soubor) && CTENI_JS.test(radek));
}

/**
 * Spotřebitelé deklarace, kteří Coolify routing NEZAPISUJÍ. Každý s důvodem;
 * nový čtenář = rozhodnutí (převést na domov, nebo sem s důvodem), ne tichý další výklad.
 */
const SPOTREBITELE: Record<string, string> = {
  "scripts/aisha-env-doctor.mjs":
    "AISHA_WEB_PUBLIC_ALIASES jen DORUČUJE beze změny (operátor → .env.coolify), aby ji domov dostal i v samostatném běhu; nic neskládá",
  "scripts/lib/domenovy-overlay.mjs":
    "ZDROJ deklarace: čte WEB_FQDNS z doménového overlaye instance (vrstvy jako cold-start) pro env-doktora, " +
    "který ho zapíše jako odvozený klíč .env.coolify; domény neskládá — to dělá jen domov",
  "scripts/keycloak/sync-aisha-app-redirects.mjs":
    "redirect URI a webOrigins Keycloaku z WEB_FQDNS (jen PŘIDÁVÁ, nikdy neubírá) — mimo kontrakt Coolify. " +
    "NÁSLEDNÁ PRÁCE: obsluhované hosty brát z domova (dnes nezná APP_DOMAIN ani aliasy) a rozhodnout, co je u něj „nevím“",
};

function ctenariMimoDomov(): Map<string, string[]> {
  // Kořenové docker-compose*.yml (služba, která by WEB_FQDNS dostala, je další čtenář)
  // a n8n/ (kód uzlů v JSON) patří do vesmíru stejně jako skripty.
  const soubory = spawnSync(
    "git",
    ["ls-files", "-z", "--", "scripts", ".forgejo", "packages", "services", "infra", "config", "n8n", ":(glob)docker-compose*.yml"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .stdout.split("\0")
    .filter((f) => /\.(m?js|cjs|ts|mts|tsx|sh|bash|ya?ml)$/.test(f) || (f.startsWith("n8n/") && f.endsWith(".json")))
    .filter((f) => !/(^|\/)(node_modules|dist)\//.test(f) && !/\.test\.(m?js|ts)$/.test(f) && !/(^|\/)__tests__\//.test(f))
    .filter((f) => f !== DOMOV);
  const nalez = new Map<string, string[]>();
  for (const f of soubory) {
    let obsah = "";
    try {
      obsah = readFileSync(join(ROOT, f), "utf8");
    } catch {
      continue;
    }
    if (!KLICE.some((k) => obsah.includes(k))) continue;
    const radky = obsah.split("\n").map((r, i) => [i + 1, r] as const).filter(([, r]) => cteniVRadku(f, r));
    if (radky.length > 0) nalez.set(f, radky.map(([n, r]) => `${f}:${n}: ${r.trim()}`));
  }
  return nalez;
}

describe("(b) VLASTNOST: hodnotu deklarace webu mimo domov nikdo nečte (kromě vyjmenovaných spotřebitelů)", () => {
  const nalez = ctenariMimoDomov();

  test("čtenáři mimo domov = jen vyjmenovaní spotřebitelé", () => {
    const navic = [...nalez.entries()].filter(([f]) => !(f in SPOTREBITELE)).flatMap(([, r]) => r);
    expect(
      navic,
      "kód mimo scripts/lib/domeny-webu.mjs čte deklaraci domén webu — druhý výklad téže deklarace " +
        "(přesně ten tvar zúžil 2026-10-04 web na APP_DOMAIN). Skládej přes verejneDomenyWebu() / `domeny-webu.mjs --csv`.",
    ).toEqual([]);
  });

  test("výčet spotřebitelů nepřežil svou premisu — každý čtení opravdu má", () => {
    for (const f of Object.keys(SPOTREBITELE)) expect(nalez.has(f), `${f} už deklaraci nečte — smaž ho z výčtu`).toBe(true);
  });

  test("doktor ani deploy-init mezi čtenáři nejsou a doktor bere kontrakt z domova", () => {
    expect(nalez.has("scripts/coolify-domain-doctor.mjs"), (nalez.get("scripts/coolify-domain-doctor.mjs") ?? []).join("\n")).toBe(false);
    expect(nalez.has("scripts/coolify-deploy-init.sh"), (nalez.get("scripts/coolify-deploy-init.sh") ?? []).join("\n")).toBe(false);
    const doktor = readFileSync(DOKTOR, "utf8");
    expect(doktor).toMatch(/import \{[^}]*\bverejneDomenyWebu\b[^}]*\} from "\.\/lib\/domeny-webu\.mjs"/);
    expect([...doktor.matchAll(/name: "web"/g)], "doktor má víc kontraktů služby web").toHaveLength(1);
  });

  test("samotest vzoru: čtení se pozná ve všech tvarech, průchod, komentář ani jméno klíče ne", () => {
    const ano: Array<[string, string]> = [
      ["x.mjs", "const a = env.WEB_FQDNS;"],
      ["x.mjs", "  ...parseCsv(env.AISHA_WEB_PUBLIC_ALIASES)) {"],
      ["x.mjs", 'const b = process.env["WEB_FQDNS"] ?? "";'],
      ["x.mjs", "splitList(process.env.WEB_FQDNS ?? envFile.WEB_FQDNS)"],
      ["x.ts", "const c = cfg?.AISHA_WEB_PUBLIC_ALIASES;"],
      ["x.sh", 'WEB_DOMAINS="${WEB_FQDNS:-https://${APP_DOMAIN}}"'],
      ["x.sh", 'IFS=, read -r -a a <<< "$AISHA_WEB_PUBLIC_ALIASES"'],
      ["x.sh", 'if [ -z "${WEB_FQDNS:-}" ]; then'],
      ["x.yml", "        run: echo ${{ env.WEB_FQDNS }}"],
      ["docker-compose.x.yml", "      - WEB_FQDNS=${WEB_FQDNS:-}"],
      ["docker-compose.x.yml", "      AISHA_WEB_PUBLIC_ALIASES: ${AISHA_WEB_PUBLIC_ALIASES}"],
      ["n8n/x.json", '        "jsCode": "const d = $env.WEB_FQDNS.split(\',\');"'],
      ["n8n/x.json", '        "value": "={{ $env[\\"AISHA_WEB_PUBLIC_ALIASES\\"] }}"'],
    ];
    const ne: Array<[string, string]> = [
      ["x.mjs", "// env.WEB_FQDNS se tu dřív četlo"],
      ["x.mjs", " * doktor neznal `env.WEB_FQDNS`"],
      ["x.mjs", '  "AISHA_WEB_PUBLIC_ALIASES",'],
      ["x.mjs", "const WEB_FQDNS_X = 1;"],
      ["x.sh", "AISHA_WEB_PUBLIC_ALIASES=${AISHA_WEB_PUBLIC_ALIASES:-}"],
      ["x.sh", "WEB_FQDNS=${WEB_FQDNS:-}"],
      ["x.sh", "EDGE_OWNED_HOSTS=${EDGE_OWNED_HOSTS-}"],
      ["x.sh", "# ${WEB_FQDNS:-https://${APP_DOMAIN}} — starý výklad"],
      ["x.sh", "echo WEB_FQDNS_JINY=${WEB_FQDNS_JINY}"],
      ["n8n/x.json", '        "name": "WEB_FQDNS",'],
    ];
    for (const [f, r] of ano) expect(cteniVRadku(f, r), `nepoznáno: ${f}: ${r}`).toBe(true);
    for (const [f, r] of ne) expect(cteniVRadku(f, r), `falešný nález: ${f}: ${r}`).toBe(false);
  });
});
