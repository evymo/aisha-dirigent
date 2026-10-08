/**
 * Brána: redeploy zná domény webu instance — SKUTEČNÝ aisha-redeploy, skutečný
 * env-doktor, skutečný doktor domén proti falešnému Coolify.
 *
 * ⛔ NAMĚŘENO 2026-10-05 při sloučení fix/bocni-vstupy-konvergence (redeploy
 * srovnává domény: env-doktor → doktor domén --apply --no-probe s prostředím
 * z `.env.coolify`) s fix/domeny-webu-jeden-vyklad (doktor bez WEB_FQDNS „neví"
 * a edge nezapíše). WEB_FQDNS žil jen v doménovém overlayi instance; do
 * `.env.coolify` ho nepsal nikdo a env-doktor overlay najít neuměl. Srovnání
 * domén v redeployi by tak padalo u KAŽDÉHO forku, nejen u forku se značkami.
 *
 * Teď je WEB_FQDNS odvozený klíč env-doktora: overlay najde týž rozklad jako obal
 * cold-startu a cold-start (lib/domenovy-overlay.mjs), hodnota se odvodí při
 * každém běhu znovu a „nevím" se nezapíše vůbec.
 *
 * Tvrzení:
 *   (a) overlay se 3 značkami → env-doktor přepíše i STAROU hodnotu v .env.coolify
 *       a doktor v redeployi zapíše do Coolify všechny značky;
 *   (b) instance bez vícebrandovosti → WEB_FQDNS prázdný (zapsaný), domény
 *       srovnané jako dnes, web = kanonický host;
 *   (c) deklarace neznámá (overlay vyžádaný a nenalezený) → aplikace se NASADÍ
 *       (env-doktor vrátí vlastní kód „WEB_FQDNS nevím", ostatní klíče zapsal),
 *       srovnání domén neproběhne — NULA zápisů domén, příčina pojmenovaná ve
 *       výpisu a redeploy skončí nenulou (revize 08f6f66de, bod C);
 *   (e) dopočtený požadavek (bez cold-startu) by ubral uložené značky → NEVÍM,
 *       nula zápisů; kotva: výslovný požadavek cold-startu s prázdnou deklarací
 *       zúžit smí (revize 08f6f66de, bod B2);
 *   (f) klíč v .env.coolify CHYBÍ (první redeploy po zavedení, obnova bez něj)
 *       + dopočtený požadavek → NEVÍM, nula zápisů — i když trezor nese
 *       DOMAINS_OVERLAY_REQUESTED (výslovnost jen od cold-startu); kotva: výslovný
 *       požadavek cold-startu klíč založí (revize 27d6f3f5e);
 *   (d) mutant: env-doktor zapíše prázdné místo „nevím" → v situaci (c) doktor
 *       zúží web — měřidlo (c) by zčervenalo (kotva, že (c) není slepé).
 *
 * Redeploy běží ze ZÁSTUPNÉHO kořene (vzor redeploy-srovna-domeny): redeploy,
 * env-doktor i doktor domén jsou KOPIE (jejich ROOT = zástupný kořen, takže
 * zapisují jen tam), zbytek odkazy na repo. Uzel má plný disk → disková brána
 * zastaví první nasazení; na živé Coolify nic nedosáhne. Hosty jsou v `.test`
 * a doktor běží s --no-probe.
 *
 * Spouští se přes: npm run test:gates (těžká dráha)
 */
import { describe, expect, test } from "vitest";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = process.cwd();
const Z = "zkouska.test";
const APP = `web.${Z}`;
const ZNACKY = ["a", "b", "c"].map((x) => `https://znacka-${x}.${Z}`);
const UUID_EDGE = "fixtureedgeuuid000001";
const KOPIE = ["aisha-redeploy.mjs", "aisha-env-doctor.mjs", "coolify-domain-doctor.mjs"];
// V zástupném kořeni se NIC nesmí zapsat do pracovní kopie: zálohy env-doktora,
// trezor operátora ani SoT se proto neodkazují.
const NEODKAZOVAT = new Set(["scripts", ".git", ".env.coolify", ".env-prod-backup", ".backup"]);

/** Vstupy derivace, jak je operátor dává do trezoru (vzor doktor-samostatne-jako-cold-start). */
const VSTUP: Record<string, string> = {
  AISHA_PROFILE: "cloud-single",
  PUBLIC_TLD: Z,
  APP_NAME_PREFIX: "fixture",
  OAUTH2_COOKIE_DOMAINS: `.${Z}`,
  OAUTH2_WHITELIST_DOMAINS: `.${Z}`,
};

function vystupMereni(volnoKb: number): string {
  return [
    `VOLNO_KB ${volnoKb}`,
    `OBRAZ ${UUID_EDGE} sha256:aaaaaaaaaaaa${"0".repeat(52)}`,
    "DF_V",
    "Images space usage:",
    "",
    "REPOSITORY   TAG       IMAGE ID       CREATED       SIZE      SHARED SIZE   UNIQUE SIZE   CONTAINERS",
    "fixture/img  latest    aaaaaaaaaaaa   2 weeks ago   9.9GB     1.1GB         2.1GB         1",
    "",
    "Containers space usage:",
  ].join("\n");
}

/** Zástupný kořen; `mutace` přepíše kopii env-doktora (kotva d). */
function postavKoren(mutace?: (zdroj: string) => string): string {
  const koren = mkdtempSync(join(tmpdir(), "redeploy-web-"));
  for (const polozka of readdirSync(ROOT)) {
    if (NEODKAZOVAT.has(polozka)) continue;
    symlinkSync(join(ROOT, polozka), join(koren, polozka));
  }
  mkdirSync(join(koren, "scripts"));
  for (const polozka of readdirSync(join(ROOT, "scripts"))) {
    if (KOPIE.includes(polozka)) continue;
    symlinkSync(join(ROOT, "scripts", polozka), join(koren, "scripts", polozka));
  }
  for (const k of KOPIE) copyFileSync(join(ROOT, "scripts", k), join(koren, "scripts", k));
  if (mutace) {
    const cesta = join(koren, "scripts/aisha-env-doctor.mjs");
    writeFileSync(cesta, mutace(readFileSync(cesta, "utf8")));
  }
  return koren;
}

// ── Falešné Coolify: odpovídá redeployi i doktoru domén a zapisuje každý PATCH ──
// Každý běh má VLASTNÍ server (testy jdou souběžně — brána nese skutečného env-doktora).
type Zaznam = { name: string; domain: string };
type Coolify = { base: string; patche: Zaznam[][]; posty: () => number; zavri: () => Promise<void> };

async function falesneCoolify(edge: Record<string, unknown>): Promise<Coolify> {
  const patche: Zaznam[][] = [];
  let posty = 0;
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    let telo = "";
    req.on("data", (c) => (telo += c));
    req.on("end", () => {
      const json = (obj: unknown, s = 200) => {
        res.writeHead(s, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method === "POST" && url.startsWith("/api/v1/deploy")) {
        posty++;
        return json({ deployments: [{ deployment_uuid: "dep-e2e" }] });
      }
      if (url === `/api/v1/applications/${UUID_EDGE}` && req.method === "PATCH") {
        const b = JSON.parse(telo || "{}");
        if (b.docker_compose_domains) {
          patche.push(b.docker_compose_domains);
          edge.docker_compose_domains = b.docker_compose_domains;
        }
        return json({ uuid: UUID_EDGE });
      }
      if (url === `/api/v1/applications/${UUID_EDGE}`) return json(edge);
      if (url === "/api/v1/applications") return json([edge]);
      if (url === "/api/v1/projects") return json([{ uuid: "projfixture", name: "fixture" }]);
      if (url === "/api/v1/projects/projfixture") return json({ uuid: "projfixture", environments: [{ id: 1, name: "production" }] });
      if (url === "/api/v1/projects/projfixture/production") return json({ id: 1, name: "production", applications: [edge] });
      if (/^\/api\/v1\/applications\/[^/]+\/envs/.test(url)) return json([]);
      if (/^\/api\/v1\/deployments\/applications\//.test(url)) return json({ deployments: [] });
      if (url === "/api/v1/deployments") return json([]);
      if (/^\/api\/v1\/deployments\/dep[\w-]+$/.test(url)) return json({ status: "finished" });
      json({ message: "not found" }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adresa = server.address();
  return {
    base: `http://127.0.0.1:${typeof adresa === "object" && adresa ? adresa.port : 0}`,
    patche,
    posty: () => posty,
    zavri: () => new Promise<void>((r) => server.close(() => r())),
  };
}

type Beh = { kod: number | null; vystup: string; patche: Zaznam[][]; postyBehu: number; sot: string };

async function redeploy(o: {
  ulozenyWeb: string;
  overlayDomeny?: string | null;
  sot?: string;
  env?: Record<string, string>;
  mutace?: (zdroj: string) => string;
  /** Volný disk: nasazení projde diskovou bránou (sync prostředí je pak atrapa, zapisuje deník). */
  nasadit?: boolean;
  /** Operátorský trezor (.env-prod-backup) zástupného kořene. */
  trezor?: string;
}): Promise<Beh> {
  const koren = postavKoren(o.mutace);
  if (o.trezor !== undefined) writeFileSync(join(koren, ".env-prod-backup"), o.trezor);
  if (o.nasadit) {
    // Atrapa syncu prostředí: měří se, že spouštěč za env-doktorem POKRAČUJE, ne doručení env.
    rmSync(join(koren, "scripts/coolify-sync-envs.sh"));
    writeFileSync(join(koren, "scripts/coolify-sync-envs.sh"), "#!/bin/bash\necho \"[atrapa sync] $*\"\nexit 0\n");
    chmodSync(join(koren, "scripts/coolify-sync-envs.sh"), 0o755);
  }
  const pomocne = mkdtempSync(join(tmpdir(), "redeploy-web-pomocne-"));
  const edge: Record<string, unknown> = {
    uuid: UUID_EDGE,
    name: "fixture-edge",
    status: "running:healthy",
    environment_id: 1,
    build_pack: "dockercompose",
    destination: { server_id: 0, server: { name: "uzel-test" } },
    docker_compose_domains: [{ name: "web", domain: o.ulozenyWeb }],
  };
  const cf = await falesneCoolify(edge);
  const base = cf.base;
  try {
    writeFileSync(join(koren, ".env.coolify"), o.sot ?? `ZNACKA_ZE_SOT=ze-sot\nWEB_FQDNS=https://stara.${Z}\n`);
    const manifest = join(pomocne, "fixture.manifest");
    writeFileSync(manifest, "app: edge:frontend:docker-compose.coolify-prebuilt.yml\n");
    const bin = join(pomocne, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "ssh"), `#!/bin/sh\ncat <<'EOF'\n${vystupMereni(o.nasadit ? 500 * 1024 * 1024 : 1024 * 1024)}\nEOF\n`);
    chmodSync(join(bin, "ssh"), 0o755);
    // Overlay instance: keycloak/ (env-doktor ho u deklarovaného overlaye vyžaduje)
    // a volitelně config/domains.env — produkční výchozí doménový overlay.
    const overlay = join(pomocne, "overlay");
    mkdirSync(join(overlay, "keycloak"), { recursive: true });
    if (o.overlayDomeny != null) {
      mkdirSync(join(overlay, "config"));
      writeFileSync(join(overlay, "config/domains.env"), o.overlayDomeny);
    }
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: pomocne,
      ...VSTUP,
      COOLIFY_BASE_URL: base,
      COOLIFY_URL: base,
      COOLIFY_API_TOKEN: "fixture-token",
      COOLIFY_PROJECT_UUID: "projfixture",
      COOLIFY_ENVIRONMENT: "production",
      MANIFEST_FILE: manifest,
      AISHA_INSTANCE_CONFIG_DIR: overlay,
      AISHA_NODE_SSH: "uzel-test=fixture@stub",
      AISHA_SNAPSHOT_DIR: join(pomocne, "snap"),
      AISHA_HEALTH_POLL_S: "1",
      AISHA_STABLE_POLLS: "1",
      NO_COLOR: "1",
      ...(o.env ?? {}),
    };
    const p = spawn(process.execPath, [join(koren, "scripts/aisha-redeploy.mjs"), "--only=edge"], {
      cwd: koren,
      env: envWithoutGitLocation(env),
    });
    let vystup = "";
    p.stdout.on("data", (d) => (vystup += d));
    p.stderr.on("data", (d) => (vystup += d));
    const kod = await new Promise<number | null>((r) => p.on("close", r));
    const sot = existsSync(join(koren, ".env.coolify")) ? readFileSync(join(koren, ".env.coolify"), "utf8") : "";
    return { kod, vystup, patche: [...cf.patche], postyBehu: cf.posty(), sot };
  } finally {
    await cf.zavri();
    rmSync(koren, { recursive: true, force: true });
    rmSync(pomocne, { recursive: true, force: true });
  }
}

const webVPatchi = (p: Zaznam[]) => p.find((e) => e.name === "web")?.domain ?? "";
const hosty = (csv: string) => csv.split(",").filter(Boolean);
const webFqdnsVSot = (sot: string) => /^WEB_FQDNS=(.*)$/m.exec(sot)?.[1];

// Mutant (d): env-doktor bez rozlišení „nevím" — neznámou deklaraci zapíše prázdnou a skončí 0.
const KOTVA_NEVIM = "      if (!WEB_DEKLARACE.znamo) return;\n";
const KOTVA_KOD = "const webNevimKod = !WEB_DEKLARACE.znamo && !REPORT_ONLY && !DRY_RUN;";
function mutantPrazdne(zdroj: string): string {
  expect(zdroj, "kotva mutantu zmizela — env-doktor rozlišuje „nevím“ jinak; přepiš mutanta").toContain(KOTVA_NEVIM);
  expect(zdroj, "kotva mutantu zmizela (kód konce)").toContain(KOTVA_KOD);
  return zdroj.replace(KOTVA_NEVIM, "").replace(KOTVA_KOD, "const webNevimKod = false;");
}

// Běhy jsou nezávislé (vlastní kořen, vlastní Coolify) — jdou souběžně.
describe.concurrent("redeploy: domény webu z doménového overlaye instance", { timeout: 300_000 }, () => {
  test("(a) overlay se 3 značkami → starý (užší) seznam v SoT rozšířen, doktor zapíše všechny", async ({ expect }) => {
    // V SoT leží STARÝ seznam (jen první značka) — env-doktor ho při redeployi rozšíří.
    const r = await redeploy({
      ulozenyWeb: `https://${APP}`,
      overlayDomeny: `WEB_FQDNS=${ZNACKY.join(",")}\n`,
      sot: `ZNACKA_ZE_SOT=ze-sot\nWEB_FQDNS=${ZNACKY[0]}\n`,
    });
    expect(webFqdnsVSot(r.sot), `env-doktor neodvodil WEB_FQDNS z overlaye:\n${r.vystup.slice(-2500)}`).toBe(ZNACKY.join(","));
    expect(webFqdnsVSot(r.sot), "stará hodnota se v SoT udržela").not.toBe(ZNACKY[0]);
    expect(r.patche.length, r.vystup.slice(-2500)).toBeGreaterThanOrEqual(1);
    const zapsano = hosty(webVPatchi(r.patche.at(-1)!));
    expect(zapsano, "doktor v redeployi nezapsal všechny značky").toEqual(expect.arrayContaining([...ZNACKY, `https://${APP}`]));
    expect(r.vystup).toMatch(/Domény v Coolify srovnané s derivací/);
    expect(r.postyBehu, "disková brána měla zastavit nasazení").toBe(0);
  });

  test("(b) instance bez vícebrandovosti (klíč založil cold-start prázdný) → zůstane prázdný, domény srovnané", async ({ expect }) => {
    const r = await redeploy({ ulozenyWeb: `https://${APP}`, overlayDomeny: null, sot: "ZNACKA_ZE_SOT=ze-sot\nWEB_FQDNS=\n" });
    expect(webFqdnsVSot(r.sot), `WEB_FQDNS se do SoT nezapsal (prázdný = jedna značka):\n${r.vystup.slice(-2500)}`).toBe("");
    for (const p of r.patche) expect(webVPatchi(p) || `https://${APP}`, "web má jen kanonický host").toBe(`https://${APP}`);
    expect(r.vystup, r.vystup.slice(-2500)).toMatch(/Domény v Coolify srovnané s derivací/);
    expect(r.vystup).not.toMatch(/domény NESROVNÁNY/);
  });

  test("⛔ (c) deklarace neznámá → aplikace NASAZENA, domény nesrovnané, kód ≠ 0, příčina ve výpisu", async ({ expect }) => {
    const r = await redeploy({
      ulozenyWeb: ZNACKY.join(","),
      overlayDomeny: null,
      env: { COOLIFY_PROD_DOMAINS_FILE: "config/domains-nenalezeny.env" },
      nasadit: true,
    });
    expect(r.patche, `doktor zapsal domény bez známé deklarace:\n${r.vystup.slice(-2500)}`).toEqual([]);
    expect(r.vystup).toMatch(/WEB_FQDNS \(domény webu\) NEZNÁM[^\n]*domains-nenalezeny\.env/);
    expect(r.vystup).toMatch(/domény NESROVNÁNY/);
    expect(r.vystup, "env-doktor „nevím“ zablokoval spouštěč aplikace").not.toMatch(/env-doktor \(srovnání odvozených klíčů\) selhal/);
    expect(r.postyBehu, `aplikace se nenasadila:\n${r.vystup.slice(-2500)}`).toBeGreaterThanOrEqual(1);
    expect(r.kod, r.vystup.slice(-2500)).not.toBe(0);
    expect(webFqdnsVSot(r.sot), "neznámá deklarace se zapsala").toBe(`https://stara.${Z}`);
  });

  test("⛔ (e) dopočtený požadavek bez overlaye + uložených 13 značek → NEVÍM, nula zápisů domén", async ({ expect }) => {
    const trinact = Array.from({ length: 13 }, (_, i) => `https://znacka${i}.${Z}`).join(",");
    const r = await redeploy({ ulozenyWeb: trinact, overlayDomeny: null, sot: `ZNACKA_ZE_SOT=ze-sot\nWEB_FQDNS=${trinact}\n` });
    expect(r.patche, `dopočtený požadavek zúžil web:\n${r.vystup.slice(-2500)}`).toEqual([]);
    expect(r.vystup).toMatch(/WEB_FQDNS \(domény webu\) NEZNÁM[^\n]*DOPOČTENÝ/);
    expect(webFqdnsVSot(r.sot), "uložený seznam se přepsal").toBe(trinact);
  });

  test("kotva (e): výslovný požadavek cold-startu s prázdnou deklarací zúžit SMÍ", async ({ expect }) => {
    const trinact = Array.from({ length: 13 }, (_, i) => `https://znacka${i}.${Z}`).join(",");
    const r = await redeploy({
      ulozenyWeb: trinact,
      overlayDomeny: null,
      sot: `ZNACKA_ZE_SOT=ze-sot\nWEB_FQDNS=${trinact}\n`,
      env: { DOMAINS_OVERLAY_REQUESTED: "config/domains.env" },
    });
    expect(webFqdnsVSot(r.sot), r.vystup.slice(-2500)).toBe("");
    expect(r.patche.length, r.vystup.slice(-2500)).toBeGreaterThanOrEqual(1);
    expect(hosty(webVPatchi(r.patche.at(-1)!))).toEqual([`https://${APP}`]);
  });

  test("⛔ (f) klíč v .env.coolify CHYBÍ + dopočtený požadavek → NEVÍM, nula zápisů (i s požadavkem v trezoru)", async ({ expect }) => {
    for (const trezor of [undefined, "DOMAINS_OVERLAY_REQUESTED=config/domains.env\n"]) {
      const r = await redeploy({ ulozenyWeb: ZNACKY.join(","), overlayDomeny: null, sot: "ZNACKA_ZE_SOT=ze-sot\n", trezor });
      expect(r.patche, `zapsáno bez uložené hodnoty (trezor: ${trezor ?? "—"}):\n${r.vystup.slice(-2500)}`).toEqual([]);
      expect(r.vystup).toMatch(/WEB_FQDNS \(domény webu\) NEZNÁM[^\n]*CHYBÍ/);
      expect(webFqdnsVSot(r.sot), "chybějící klíč se založil bez cold-startu").toBeUndefined();
    }
  });

  test("kotva (f): výslovný požadavek cold-startu chybějící klíč ZALOŽÍ", async ({ expect }) => {
    const r = await redeploy({
      ulozenyWeb: `https://${APP}`,
      overlayDomeny: null,
      sot: "ZNACKA_ZE_SOT=ze-sot\n",
      env: { DOMAINS_OVERLAY_REQUESTED: "config/domains.env" },
    });
    expect(webFqdnsVSot(r.sot), r.vystup.slice(-2500)).toBe("");
    expect(r.vystup).toMatch(/Domény v Coolify srovnané s derivací/);
  });

  test("(d) kotva: mutant „prázdné místo nevím“ by v situaci (c) zúžil web — měřidlo (c) to vidí", async ({ expect }) => {
    const r = await redeploy({
      ulozenyWeb: ZNACKY.join(","),
      overlayDomeny: null,
      env: { COOLIFY_PROD_DOMAINS_FILE: "config/domains-nenalezeny.env" },
      mutace: mutantPrazdne,
    });
    expect(webFqdnsVSot(r.sot), r.vystup.slice(-2500)).toBe("");
    expect(r.patche.length, "mutant nezapsal — kotva nic neměří").toBeGreaterThanOrEqual(1);
    const zapsano = hosty(webVPatchi(r.patche.at(-1)!));
    expect(ZNACKY.filter((z) => !zapsano.includes(z)), "mutant měl značky smazat").toEqual(ZNACKY);
  });
});
