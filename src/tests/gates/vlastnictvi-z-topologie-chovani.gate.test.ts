/**
 * Brána: EXTERNÍ SLUŽBA SE V PROSTŘEDÍ NEZALOŽÍ, NENASADÍ ANI NESMAŽE — měřeno chováním
 *
 * ⛔ ZMĚŘENO ČTENÍM 2026-10-04: manifest instance je INVENTÁŘ, jeden pro všechna její
 * prostředí. Staging, který konzumuje sdílený Keycloak jiné instance, a produkce, která
 * Keycloak vlastní, tedy čtou TÝŽ řádek `app: keycloak:…`. Nástroje o vlastnictví
 * rozhodovaly z manifestu, takže staging by cizí Keycloak založil (aplikace na doméně
 * cizí instance), přenasadil, srovnal mu git/compose a při `--wipe` smazal i se svazky.
 * Co je v prostředí naše, říká profil prostředí (`service_overrides.<id>.external_domain`)
 * a odpověď dává jediný domov (scripts/lib/vlastnictvi-aplikaci.mjs, shell lib/vlastnictvi.sh).
 *
 * Statickou vlastnost („řádky `app:` čte jen domov“) hlídá lehká brána
 * vlastnictvi-z-topologie. Tady se pouštějí SKUTEČNÉ nástroje proti FALEŠNÉMU Coolify
 * (jen loopback) a měří se, co by se v Coolify stalo. Každý případ má KOTVU: týž profil,
 * jen s VÝSLOVNĚ PRÁZDNOU hodnotou proměnné, kterou profil dosazuje
 * (`external_domain: "${KC_EXTERNI}"`, `KC_EXTERNI=`) — tedy produkce téže instance. Kotva
 * musí volání VIDĚT; jinak by zelená externího případu mohla být jen slepé měřidlo.
 * NENASTAVENÁ proměnná není kotva, ale „nevím“: nástroj skončí dřív, než se Coolify dotkne
 * (revize integrátora 2026-10-04, bod 2 — dřív se nenastavená četla jako „vlastní“).
 *   (a) story-init: externí Keycloak → žádné POST /applications/public s jeho jménem,
 *       žádné PATCH (srovnání git/compose) ani čtení na jeho UUID; core se založí;
 *       výpis „NEZAKLÁDÁM ani NESROVNÁVÁM“. Kotva: založí ho / srovná ho.
 *   (b) aisha-redeploy: externí Keycloak (v projektu EXISTUJE) → žádný restart/deploy
 *       na jeho UUID, jeho brána vlnu neblokuje (ani když je `exited`); core a messaging
 *       ano; výslovné cílení (`--only`, `--canary`) = kód KOD_EXTERNI (101) bez mutace.
 *       Kotva: vlastněný Keycloak se restartuje a jeho nezdravá tvrdá brána vlnu zastaví.
 *   (c) studený start, wipe: funkce vyříznuté ze SKUTEČNÉHO aisha-cold-start.sh
 *       (tvar jako v drzeni-plati-mimo-ci) → DELETE jen na core, na Keycloak ani čtení;
 *       nenalezený profil i nenastavená proměnná = konec dřív, než se cokoli smaže.
 *       Kotva: vlastněný se smaže.
 *       Rewarmup (revize integrátora, bod 1): `--rewarmup=<prefix>-keycloak` na externí
 *       službu = STOP strážce dřív, než krok 2d cokoli najde a smaže (i se svazky), přestože
 *       aplikace jejího jména v projektu zbyla. Kotva: vlastněný cíl strážcem projde.
 *
 * Jména jsou syntetická (prefix `fixture`, adresy *.invalid / *.example); data žádné
 * instance se nečtou — overlay i manifest vznikají v dočasném adresáři testu.
 *
 * Spouští se přes: npm run test:gates (těžká dráha — podprocesy a čekání na zdraví)
 */
import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jeMutujici, type Pozadavek } from "./_falesny-coolify";
import { KOD_EXTERNI } from "../../../scripts/lib/vlastnictvi-aplikaci.mjs";

const ROOT = process.cwd();
const HAS_JQ = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;

const PREFIX = "fixture";
const PROFIL = "fixture-profil";
/** Adresa cizího Keycloaku — dosadí ji profil z prostředí (`${KC_EXTERNI}`). */
const KC_CIZI = "auth.cizi.example";
const GIT = "https://forgejo.fixture.invalid/vlastnik/fixture-repo.git";
const COMPOSE: Record<string, string> = {
  core: "docker-compose.coolify.yml",
  keycloak: "docker-compose.coolify-keycloak.yml",
  messaging: "docker-compose.coolify-matrix.yml",
};
const uuid = (role: string) => `uuid${role.replace(/-/g, "")}fixture01`;
const jmeno = (role: string) => `${PREFIX}-${role}`;
const HLASKA_KC = new RegExp(
  `EXTERNÍ: keycloak — ${KC_CIZI.replace(/\./g, "\\.")} — v tomhle prostředí služba není naše \\(profil ${PROFIL}: external_domain\\), nevlastním`,
);

// ── Instance na disku: overlay s profilem prostředí + manifest (inventář) ──────
/**
 * Profil prostředí = šablona `cloud-multi` z repa (generická, bez instance) + Keycloak
 * jako externí služba s adresou z PROSTŘEDÍ. `KC_EXTERNI=` (výslovně prázdná) → Keycloak je
 * vlastní (kotva = produkce téže instance, týž soubor profilu); nenastavená = „nevím“.
 */
function instance(tmp: string, role: string[]) {
  const overlay = join(tmp, "overlay");
  mkdirSync(join(overlay, "profiles"), { recursive: true });
  const profil = JSON.parse(readFileSync(join(ROOT, "config/profiles/cloud-multi.json"), "utf8")) as {
    $schema?: string;
    id: string;
    service_overrides: Record<string, Record<string, unknown>>;
  };
  delete profil.$schema;
  profil.id = PROFIL;
  profil.service_overrides.keycloak = { ...profil.service_overrides.keycloak, external_domain: "${KC_EXTERNI}" };
  writeFileSync(join(overlay, "profiles", `${PROFIL}.json`), JSON.stringify(profil, null, 2));
  const manifest = join(tmp, `${PREFIX}.manifest`);
  writeFileSync(
    manifest,
    [
      `story: ${PREFIX}`,
      "repo: vlastnik/fixture-repo",
      "branch: main",
      ...role.map((r) => `app: ${r}:backend:${COMPOSE[r]}`),
      "",
    ].join("\n"),
  );
  return { overlay, manifest };
}

/** Prostředí běhu: nic se nedědí (žádný token, žádná záloha obsluhy), vše míří na falešné Coolify. */
function prostredi(o: { tmp: string; overlay: string; manifest: string; url: string; externi: boolean; nenastaveno?: boolean }): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: o.tmp,
    TMPDIR: process.env.TMPDIR ?? "",
    AISHA_INSTANCE_CONFIG_DIR: o.overlay,
    AISHA_PROFILE: PROFIL,
    // vlastní = VÝSLOVNĚ prázdná (deklarace prostředí); nenastavená = „nevím“
    ...(o.nenastaveno ? {} : { KC_EXTERNI: o.externi ? KC_CIZI : "" }),
    MANIFEST_FILE: o.manifest,
    APP_NAME_PREFIX: PREFIX,
    // záloha obsluhy se nečte (ani ta v kořeni stromu, kdyby tam ležela)
    ENV_PROD_BACKUP: "/dev/null",
    COOLIFY_URL: o.url,
    COOLIFY_BASE_URL: o.url,
    COOLIFY_API_TOKEN: "fixture-token",
    COOLIFY_PROJECT_UUID: "projfixture",
    COOLIFY_ENVIRONMENT: "production",
    NO_COLOR: "1",
  };
}

// ── Falešné Coolify: odpovídá jako skutečné tam, kde se nástroje ptají, a PAMATUJE si vše ──
type Aplikace = { role: string; status?: string };
type App = {
  uuid: string;
  name: string;
  status: string;
  environment_id: number;
  destination: { server: { name: string } };
  git_repository: string;
  docker_compose_location: string;
  docker_compose_raw: string;
};

let server: http.Server | null = null;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

async function falesneCoolify(aplikace: Aplikace[]) {
  const pozadavky: Pozadavek[] = [];
  const zaznam = (uuidAplikace: string, name: string, status: string, compose: string): App => ({
    uuid: uuidAplikace,
    name,
    status,
    environment_id: 1,
    destination: { server: { name: "uzel-test" } },
    git_repository: GIT,
    docker_compose_location: compose,
    // neprázdný compose i https git: story-init pak na nic nečeká (žádná vlastní smyčka)
    docker_compose_raw: "services: {}\n",
  });
  const apps: App[] = aplikace.map((a) => zaznam(uuid(a.role), jmeno(a.role), a.status ?? "running:healthy", `/${COMPOSE[a.role]}`));
  let n = 0;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url ?? "/";
      const method = req.method ?? "GET";
      pozadavky.push({ method, path, body });
      const json = (data: unknown, kod = 200) => {
        res.writeHead(kod, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      };
      const c = path.split("?")[0];
      const app = /^\/api\/v1\/applications\/([^/]+)$/.exec(c);
      if (method === "POST" && c === "/api/v1/applications/public") {
        const t = JSON.parse(body || "{}") as { name?: string; docker_compose_location?: string };
        const nova = zaznam(`nova${++n}zalozena`, String(t.name ?? ""), "exited:unhealthy", String(t.docker_compose_location ?? ""));
        apps.push(nova);
        return json({ uuid: nova.uuid }, 201);
      }
      if (method === "PATCH" && app) {
        const a = apps.find((x) => x.uuid === app[1]);
        return a ? json({ uuid: a.uuid }) : json({ message: "not found" }, 404);
      }
      if (method !== "GET") {
        if (c === "/api/v1/deploy") return json({ deployments: [{ message: "queued", deployment_uuid: `dep${++n}` }] });
        if (/\/applications\/[^/]+\/(restart|start|stop)$/.test(c)) return json({ message: "queued", deployment_uuid: `dep${++n}` });
        return json([{ uuid: `zapis${++n}` }]);
      }
      if (c === "/api/v1/projects") return json([{ uuid: "projfixture", name: PREFIX }]);
      if (c === "/api/v1/projects/projfixture") return json({ uuid: "projfixture", name: PREFIX, environments: [{ id: 1, name: "production" }] });
      if (c === "/api/v1/projects/projfixture/production") return json({ id: 1, name: "production", applications: apps });
      if (c === "/api/v1/applications") return json(apps);
      if (/^\/api\/v1\/applications\/[^/]+\/envs$/.test(c)) return json([]);
      if (app) {
        const a = apps.find((x) => x.uuid === app[1]);
        return a ? json(a) : json({ message: "not found" }, 404);
      }
      if (/^\/api\/v1\/deployments\/applications\//.test(c)) return json({ deployments: [] });
      if (c === "/api/v1/deployments") return json([]);
      if (/^\/api\/v1\/deployments\/dep\d+$/.test(c)) return json({ status: "finished" });
      json({ message: "falešné Coolify: neznámá cesta" }, 404);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  const adresa = server.address();
  const url = `http://127.0.0.1:${typeof adresa === "object" && adresa ? adresa.port : 0}`;
  /** Mutující požadavky na UUID dané role (deploy přes dotaz, restart/start/stop/PATCH přes cestu). */
  const mutaceNa = (role: string) => pozadavky.filter((p) => jeMutujici(p) && p.path.includes(uuid(role))).map((p) => `${p.method} ${p.path}`);
  /** VŠECHNY požadavky (i čtení) na UUID dané role. */
  const cokoliNa = (role: string) => pozadavky.filter((p) => p.path.includes(uuid(role))).map((p) => `${p.method} ${p.path}`);
  const mutace = () => pozadavky.filter(jeMutujici).map((p) => `${p.method} ${p.path}`);
  /** Jména aplikací, které by Coolify založilo (tělo POST /applications/public). */
  const zalozene = () =>
    pozadavky
      .filter((p) => p.method === "POST" && p.path.split("?")[0] === "/api/v1/applications/public")
      .map((p) => String((JSON.parse(p.body || "{}") as { name?: string }).name))
      .sort();
  /** Jména aplikací, kterým by se srovnal git/compose (PATCH /applications/{uuid}). */
  const srovnane = () =>
    pozadavky
      .filter((p) => p.method === "PATCH" && /^\/api\/v1\/applications\/[^/]+$/.test(p.path.split("?")[0]))
      .map((p) => apps.find((a) => p.path.split("?")[0].endsWith(`/${a.uuid}`))?.name ?? `? ${p.path}`)
      .sort();
  return { url, pozadavky, mutaceNa, cokoliNa, mutace, zalozene, srovnane };
}

/** Spustí příkaz, sbírá výstup (bez barev) a nečeká synchronně — falešné Coolify běží v témže procesu. */
function spust(prikaz: string, args: string[], env: Record<string, string>, timeoutMs = 120_000) {
  return new Promise<{ kod: number | null; vystup: string }>((ok) => {
    const p = spawn(prikaz, args, { cwd: ROOT, env });
    let vystup = "";
    p.stdout.on("data", (d) => (vystup += d));
    p.stderr.on("data", (d) => (vystup += d));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (kod) => {
      clearTimeout(t);
      // eslint-disable-next-line no-control-regex
      ok({ kod, vystup: vystup.replace(/\x1b\[[0-9;]*m/g, "") });
    });
  });
}

// ══ (a) coolify-story-init.sh — krok 3 studeného startu ══
async function storyInit(o: { externi: boolean; vProjektu?: Aplikace[] }) {
  const cf = await falesneCoolify(o.vProjektu ?? []);
  const tmp = mkdtempSync(join(tmpdir(), "vlastnictvi-story-init-"));
  const { overlay, manifest } = instance(tmp, ["core", "keycloak"]);
  // `sleep` v opakováních story-initu postroj nečeká (selhání má být rychlé, ne pomalé)
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "sleep"), 0o755);
  const env = prostredi({ tmp, overlay, manifest, url: cf.url, externi: o.externi });
  const r = await spust("bash", [join(ROOT, "scripts/coolify-story-init.sh"), "--manifest", manifest], {
    ...env,
    PATH: `${bin}:${env.PATH}`,
    // Forgejo: adresa deklarovaná, token NE (story-init pak nesahá na secrets ani CI kontrakt)
    FORGEJO_URL: "https://forgejo.fixture.invalid",
    COOLIFY_SERVER_UUID_BACKEND: "srvbackendfixture",
    PUBLIC_TLD: "fixture.invalid",
    INTERNAL_TLD: "interni.invalid",
    MESH_TLD: "mesh.invalid",
    OAUTH2_COOKIE_DOMAINS: ".fixture.invalid",
    OAUTH2_WHITELIST_DOMAINS: ".fixture.invalid",
  });
  return { ...r, ...cf };
}

describe.skipIf(!HAS_JQ)("(a) story-init proti falešnému Coolify", { timeout: 180_000 }, () => {
  it("kotva: Keycloak vlastní (KC_EXTERNI prázdné) → založí core I keycloak", async () => {
    const r = await storyInit({ externi: false });
    expect(r.kod, r.vystup).toBe(0);
    expect(r.zalozene(), r.vystup).toEqual([jmeno("core"), jmeno("keycloak")]);
    expect(r.vystup).toMatch(/Vlastnictví aplikací: profil fixture-profil: vlastní 2, externí 0/);
    expect(r.vystup).not.toMatch(/EXTERNÍ/);
  });

  it("⛔ externí Keycloak se NEZALOŽÍ ani nesrovná — core ano; výpis to řekne", async () => {
    const r = await storyInit({ externi: true });
    expect(r.kod, r.vystup).toBe(0);
    expect(r.zalozene(), r.vystup).toEqual([jmeno("core")]);
    // srovnává se jen to, co tenhle běh založil (core), nic jiného
    expect(r.srovnane(), r.vystup).toEqual([jmeno("core")]);
    expect(r.vystup).toMatch(/Vlastnictví aplikací: profil fixture-profil: vlastní 1, externí 1 \(keycloak\)/);
    expect(r.vystup).toMatch(new RegExp(`${HLASKA_KC.source}\\. ${jmeno("keycloak")} NEZAKLÁDÁM ani NESROVNÁVÁM\\.`));
    expect(r.vystup).toMatch(/EXTERNÍ \(1\) — v tomhle prostředí nejsou naše, nezaloženo ani nesrovnáno: keycloak \(profil prostředí: external_domain\)/);
    expect(r.vystup).toMatch(/provisioned: 1\/1 apps/);
  });

  it("kotva: Keycloak už v projektu je a je vlastní → story-init mu SROVNÁ git/compose (PATCH na jeho UUID)", async () => {
    const r = await storyInit({ externi: false, vProjektu: [{ role: "keycloak" }] });
    expect(r.kod, r.vystup).toBe(0);
    expect(r.zalozene(), r.vystup).toEqual([jmeno("core")]);
    expect(r.mutaceNa("keycloak"), r.vystup).toEqual([`PATCH /api/v1/applications/${uuid("keycloak")}`]);
    const patch = r.pozadavky.find((p) => p.method === "PATCH" && p.path.includes(uuid("keycloak")));
    expect(JSON.parse(patch!.body)).toMatchObject({ git_branch: "main", docker_compose_location: `/${COMPOSE.keycloak}` });
  });

  it("⛔ externí Keycloak, který v projektu EXISTUJE: žádný PATCH, ba ani čtení na jeho UUID", async () => {
    const r = await storyInit({ externi: true, vProjektu: [{ role: "keycloak" }] });
    expect(r.kod, r.vystup).toBe(0);
    expect(r.cokoliNa("keycloak"), r.vystup).toEqual([]);
    expect(r.zalozene(), r.vystup).toEqual([jmeno("core")]);
    expect(r.srovnane(), r.vystup).toEqual([jmeno("core")]);
    expect(r.vystup).toMatch(new RegExp(`${jmeno("keycloak")} NEZAKLÁDÁM ani NESROVNÁVÁM`));
    expect(r.vystup).not.toMatch(new RegExp(`Already exists: ${jmeno("keycloak")}`));
  });
});

// ══ (b) aisha-redeploy.mjs — krok 5 studeného startu, ruční redeploy ══
async function redeploy(o: { externi: boolean; nenastaveno?: boolean; keycloak?: string; args: string[] }) {
  const cf = await falesneCoolify([{ role: "core" }, { role: "keycloak", status: o.keycloak }, { role: "messaging" }]);
  const tmp = mkdtempSync(join(tmpdir(), "vlastnictvi-redeploy-"));
  const { overlay, manifest } = instance(tmp, ["core", "keycloak", "messaging"]);
  const env = {
    ...prostredi({ tmp, overlay, manifest, url: cf.url, externi: o.externi, nenastaveno: o.nenastaveno }),
    AISHA_SNAPSHOT_DIR: join(tmp, "snap"),
    AISHA_HEALTH_POLL_S: "1",
    AISHA_STABLE_POLLS: "1",
  };
  const r = await spust(process.execPath, [join(ROOT, "scripts/aisha-redeploy.mjs"), ...o.args], env);
  return { ...r, ...cf };
}

/**
 * Vlny 3–9 v režimu restart validace: core (vlny 3 a 6), keycloak (vlny 4 a 6),
 * messaging (vlna 9 — brány: core měkká, KEYCLOAK TVRDÁ). Krátký strop vlny, aby
 * kotva s nezdravým Keycloakem doběhla na zablokované bráně rychle.
 */
const VLNY = ["--restart-validate", "--from=3", "--until=9", "--wave-timeout=4"];
const restart = (role: string) => `POST /api/v1/applications/${uuid(role)}/restart`;

describe("(b) aisha-redeploy proti falešnému Coolify", { timeout: 180_000 }, () => {
  it("kotva: vlastněný Keycloak restartují vlny 4 a 6 — test volání na jeho UUID vidí", async () => {
    const r = await redeploy({ externi: false, args: VLNY });
    expect(r.mutaceNa("keycloak"), r.vystup).toEqual([restart("keycloak"), restart("keycloak")]);
    expect(r.mutaceNa("core"), r.vystup).toContain(restart("core"));
    expect(r.mutaceNa("messaging"), r.vystup).toEqual([restart("messaging")]);
    expect(r.vystup).not.toMatch(/EXTERNÍ/);
    expect([0, 3], r.vystup).toContain(r.kod);
  });

  it("⛔ externí Keycloak (v projektu existuje, zdravý) nedostane restart ani deploy; core a messaging ano", async () => {
    const r = await redeploy({ externi: true, args: VLNY });
    expect(r.mutaceNa("keycloak"), r.vystup).toEqual([]);
    expect(r.mutaceNa("core"), r.vystup).toContain(restart("core"));
    expect(r.mutaceNa("messaging"), r.vystup).toEqual([restart("messaging")]);
    expect(r.vystup).toMatch(new RegExp(`${HLASKA_KC.source}\\. Nerestartuji \\(v projektu přesto existuje — nesahám na ni\\); ostatní aplikace pokračují\\.`));
    expect(r.vystup).toMatch(new RegExp(`\\[gate\\] ${jmeno("keycloak")}\\s+skipped — ${HLASKA_KC.source}`));
    expect([0, 3], r.vystup).toContain(r.kod);
  });

  it("kotva: vlastněný Keycloak `exited` → jeho tvrdá brána vlnu 9 ZASTAVÍ (messaging se nerestartuje)", async () => {
    const r = await redeploy({ externi: false, keycloak: "exited:unhealthy", args: VLNY });
    expect(r.mutaceNa("messaging"), r.vystup).toEqual([]);
    expect(r.vystup).toMatch(new RegExp(`Wave 9 ABORTED — gate dependencies not ready: ${jmeno("keycloak")} \\(hard: exited:unhealthy\\)`));
    expect(r.kod, r.vystup).toBe(1);
  });

  it("⛔ externí Keycloak `exited`: na jeho bránu se nečeká — vlna 9 proběhne, na Keycloak se nesáhne", async () => {
    const r = await redeploy({ externi: true, keycloak: "exited:unhealthy", args: VLNY });
    expect(r.mutaceNa("keycloak"), r.vystup).toEqual([]);
    expect(r.mutaceNa("messaging"), r.vystup).toEqual([restart("messaging")]);
    expect(r.vystup).not.toMatch(/ABORTED/);
    expect(r.vystup).toMatch(new RegExp(`\\[gate\\] ${jmeno("keycloak")}\\s+skipped — EXTERNÍ: keycloak`));
    expect([0, 3], r.vystup).toContain(r.kod);
  });

  it("⛔ výslovné cílení na externí (--only, --canary) se ODMÍTNE kódem 101 a Coolify nedostane žádnou mutaci", async () => {
    expect(KOD_EXTERNI).toBe(101);
    const only = await redeploy({ externi: true, args: ["--only=keycloak"] });
    expect(only.mutace(), only.vystup).toEqual([]);
    expect(only.kod, only.vystup).toBe(KOD_EXTERNI);
    expect(only.vystup).toMatch(/--only jmenuje službu, která v tomhle prostředí není naše \(keycloak\) — ODMÍTNUTO, nenasazena/);

    const onlyRestart = await redeploy({ externi: true, args: ["--restart-validate", "--only=keycloak"] });
    expect(onlyRestart.mutace(), onlyRestart.vystup).toEqual([]);
    expect(onlyRestart.kod, onlyRestart.vystup).toBe(KOD_EXTERNI);

    const canary = await redeploy({ externi: true, args: ["--canary=keycloak"] });
    expect(canary.mutace(), canary.vystup).toEqual([]);
    expect(canary.kod, canary.vystup).toBe(KOD_EXTERNI);
    expect(canary.vystup).toMatch(new RegExp(`Kanárek ${jmeno("keycloak")} ODMÍTNUT — ${HLASKA_KC.source}`));
  });

  it("kotva: --only=keycloak na VLASTNĚNÝ Keycloak projde a restart odejde", async () => {
    const r = await redeploy({ externi: false, args: ["--restart-validate", "--only=keycloak"] });
    expect(r.mutaceNa("keycloak").length, r.vystup).toBeGreaterThan(0);
    expect(r.mutaceNa("keycloak").every((m) => m === restart("keycloak")), r.vystup).toBe(true);
    expect(r.mutaceNa("core"), r.vystup).toEqual([]);
    expect([0, 3], r.vystup).toContain(r.kod);
  });

  it("⛔ proměnná z external_domain NENASTAVENÁ → „nevím“: kód 2 a Coolify nedostane žádnou mutaci", async () => {
    const r = await redeploy({ externi: false, nenastaveno: true, args: VLNY });
    expect(r.kod, r.vystup).toBe(2);
    expect(r.mutace(), r.vystup).toEqual([]);
    expect(r.vystup).toMatch(/external_domain služby keycloak odkazuje na \$\{KC_EXTERNI\}, ale .* ji NEDEKLARUJE/);
  });
});

// ══ (c) studený start: wipe_orphan_apps vyříznutý ze SKUTEČNÉHO aisha-cold-start.sh ══
const CS = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
/** Text shellové funkce `jmeno() { … }` ze skutečného skriptu (víceřádkové i jednořádkové). */
function funkce(nazev: string): string {
  const od = CS.indexOf(`\n${nazev}() {`);
  expect(od, `funkce ${nazev} ve studeném startu chybí`).toBeGreaterThan(-1);
  const konecRadku = CS.indexOf("\n", od + 1);
  if (CS.slice(od, konecRadku).trimEnd().endsWith("}")) return CS.slice(od + 1, konecRadku);
  return CS.slice(od + 1, CS.indexOf("\n}\n", od) + 2);
}

function wipe(o: { externi: boolean; nenastaveno?: boolean; profil?: string }) {
  const tmp = mkdtempSync(join(tmpdir(), "vlastnictvi-wipe-"));
  const { overlay, manifest } = instance(tmp, ["core", "keycloak"]);
  const log = join(tmp, "coolify-volani");
  const skript = [
    "set -uo pipefail",
    'info() { echo "INFO $*"; }; ok() { echo "OK $*"; }; warn() { echo "WARN $*"; }; err() { echo "ERR $*" >&2; }',
    'GREEN=""; NC=""',
    // Coolify postroje: v projektu jsou OBĚ aplikace (i ta, která tu není naše); každé volání se zapíše
    "cs_over_izolaci_projektu() { :; }",
    `coolify_scoped_apps() { printf '${jmeno("keycloak")}\\t${uuid("keycloak")}\\n${jmeno("core")}\\t${uuid("core")}\\n'; }`,
    `coolify_api() { echo "$1 $2" >> "${log}"; echo '{}'; }`,
    `. "${join(ROOT, "scripts/lib/drzeni.sh")}"`,
    `. "${join(ROOT, "scripts/lib/vlastnictvi.sh")}"`,
    `APP_NAME_PREFIX=${PREFIX}; APP_NAME_PREFIX_RE='^${PREFIX}-'; PRESERVED_APPS_REGEX='^(${PREFIX}-registry)$'`,
    `MANIFEST='${manifest}'`,
    "WIPE_VOLUMES=1; DRY_RUN=0",
    funkce("cs_nacti_drzeni"),
    funkce("cs_nacti_vlastnictvi"),
    funkce("cs_role_aplikace"),
    funkce("wipe_orphan_apps"),
    "cs_nacti_drzeni >/dev/null",
    "cs_nacti_vlastnictvi",
    "wipe_orphan_apps",
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: tmp,
      TMPDIR: process.env.TMPDIR ?? "",
      AISHA_INSTANCE_CONFIG_DIR: overlay,
      AISHA_PROFILE: o.profil ?? PROFIL,
      ...(o.nenastaveno ? {} : { KC_EXTERNI: o.externi ? KC_CIZI : "" }),
    },
    timeout: 120_000,
  });
  let volani: string[] = [];
  try {
    volani = readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    /* žádné volání */
  }
  return { rc: r.status, vystup: `${r.stdout}\n${r.stderr}`, volani, mazani: volani.filter((v) => v.startsWith("DELETE ")).sort() };
}

const SMAZ = (role: string) => `DELETE /applications/${uuid(role)}?delete_volumes=true&delete_configurations=true&delete_connected_networks=true`;

describe.skipIf(!HAS_JQ)("(c) funkce ze skutečného aisha-cold-start.sh — wipe", { timeout: 180_000 }, () => {
  it("kotva: vlastněný Keycloak JE kandidát ke smazání (i se svazky)", () => {
    const r = wipe({ externi: false });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.mazani, r.vystup).toEqual([SMAZ("core"), SMAZ("keycloak")].sort());
    expect(r.vystup).not.toMatch(/EXTERNÍ/);
  });

  it("⛔ externí Keycloak se NESMAŽE, i když aplikace jeho jména v projektu je — core ano", () => {
    const r = wipe({ externi: true });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.mazani, r.vystup).toEqual([SMAZ("core")]);
    expect(r.volani.filter((v) => v.includes(uuid("keycloak"))), "na externí aplikaci wipe nesáhne ani čtením stavu").toEqual([]);
    expect(r.vystup).toMatch(/INFO Vlastnictví aplikací: profil fixture-profil: vlastní 1, externí 1 \(keycloak\)/);
    expect(r.vystup).toMatch(new RegExp(`WARN wipe_orphan_apps: ${HLASKA_KC.source}\\. NEMAŽU ${jmeno("keycloak")} \\(${uuid("keycloak")}\\)\\.`));
  });

  it("⛔ profil prostředí nejde najít → „nevím, co je naše“ = konec (kód 1) DŘÍV, než se cokoli smaže", () => {
    const r = wipe({ externi: true, profil: "neexistujici-profil" });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.volani, r.vystup).toEqual([]);
    expect(r.vystup).toMatch(/Vlastnictví aplikací v tomhle prostředí nejde určit/);
  });

  it("⛔ proměnná z external_domain NENASTAVENÁ → „nevím“ = konec (kód 1) dřív, než se cokoli smaže", () => {
    const r = wipe({ externi: false, nenastaveno: true });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.volani, r.vystup).toEqual([]);
    expect(r.vystup).toMatch(/odkazuje na \$\{KC_EXTERNI\}, ale .* ji NEDEKLARUJE/);
    expect(r.vystup).toMatch(/Vlastnictví aplikací v tomhle prostředí nejde určit/);
  });
});

// ══ (c) studený start, rewarmup: strážce ze SKUTEČNÉHO aisha-cold-start.sh ══
/**
 * `--rewarmup=<jméno>` najde aplikaci v projektu PODLE JMÉNA a zahodí ji i se svazky (krok 2d).
 * Externí služba (profil: external_domain) tam nemá co dělat — ale stará aplikace jejího
 * jména v projektu zbýt může (prostředí ji dřív vlastnilo). Strážce musí zastavit DŘÍV,
 * než krok cokoli najde; tady se pouští skutečná funkce i skutečné čtení vlastnictví.
 */
function rewarmup(o: { externi: boolean; cil: string }) {
  const tmp = mkdtempSync(join(tmpdir(), "vlastnictvi-rewarmup-"));
  const { overlay, manifest } = instance(tmp, ["core", "keycloak"]);
  const log = join(tmp, "coolify-volani");
  const skript = [
    "set -uo pipefail",
    'info() { echo "INFO $*"; }; ok() { echo "OK $*"; }; warn() { echo "WARN $*"; }; err() { echo "ERR $*" >&2; }',
    `coolify_api() { echo "$1 $2" >> "${log}"; echo '{}'; }`,
    `coolify_scoped_apps() { echo "scoped" >> "${log}"; printf '${jmeno("keycloak")}\t${uuid("keycloak")}\n'; }`,
    `. "${join(ROOT, "scripts/lib/drzeni.sh")}"`,
    `. "${join(ROOT, "scripts/lib/vlastnictvi.sh")}"`,
    `APP_NAME_PREFIX=${PREFIX}`,
    `MANIFEST='${manifest}'`,
    `REWARMUP_APPS='${o.cil}'`,
    funkce("cs_nacti_drzeni"),
    funkce("cs_nacti_vlastnictvi"),
    funkce("cs_role_aplikace"),
    funkce("cs_rewarmup_nesmi_drzenou"),
    "cs_nacti_drzeni >/dev/null",
    "cs_nacti_vlastnictvi",
    "cs_rewarmup_nesmi_drzenou",
    'echo "STRAZCE_PROSEL"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", skript], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: tmp,
      TMPDIR: process.env.TMPDIR ?? "",
      AISHA_INSTANCE_CONFIG_DIR: overlay,
      AISHA_PROFILE: PROFIL,
      KC_EXTERNI: o.externi ? KC_CIZI : "",
    },
    timeout: 120_000,
  });
  let volani: string[] = [];
  try {
    volani = readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    /* žádné volání */
  }
  return { rc: r.status, vystup: `${r.stdout}\n${r.stderr}`, volani };
}

describe.skipIf(!HAS_JQ)("(c) funkce ze skutečného aisha-cold-start.sh — rewarmup", { timeout: 180_000 }, () => {
  it("kotva: rewarmup VLASTNĚNÉHO Keycloaku strážcem projde (cíl je legitimní)", () => {
    const r = rewarmup({ externi: false, cil: jmeno("keycloak") });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vystup).toMatch(/STRAZCE_PROSEL/);
  });

  it("⛔ rewarmup EXTERNÍHO Keycloaku = STOP (kód 1) dřív, než se projekt vůbec čte — natož maže", () => {
    const r = rewarmup({ externi: true, cil: jmeno("keycloak") });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.vystup).not.toMatch(/STRAZCE_PROSEL/);
    expect(r.volani, r.vystup).toEqual([]);
    expect(r.vystup).toMatch(new RegExp(`ERR --rewarmup=${jmeno("keycloak")}: ${HLASKA_KC.source}\\.`));
    expect(r.vystup).toMatch(/Rewarmup by aplikaci tohoto jména zahodil VČETNĚ SVAZKŮ/);
  });

  it("⛔ seznam cílů: jeden externí mezi vlastními zastaví celý rewarmup", () => {
    const r = rewarmup({ externi: true, cil: `${jmeno("core")},${jmeno("keycloak")}` });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.vystup).not.toMatch(/STRAZCE_PROSEL/);
    expect(r.volani, r.vystup).toEqual([]);
  });

  it("vlastnictví se načítá AŽ po rozkladu souboru domén prostředí (profil může adresu deklarovat proměnnou z něj)", () => {
    const nacteni = [...CS.matchAll(/^cs_nacti_vlastnictvi$/gm)].map((m) => m.index ?? -1);
    expect(nacteni, "studený start má právě jedno volání vlastnictví na nejvyšší úrovni").toHaveLength(1);
    const domeny = CS.lastIndexOf('. "$DOMAINS_OVERLAY_FILE"', nacteni[0]);
    expect(domeny, "rozklad souboru domén prostředí musí předcházet načtení vlastnictví").toBeGreaterThan(-1);
    expect(CS.indexOf('. "$DOMAINS_OVERLAY_FILE"', nacteni[0]), "po načtení vlastnictví se soubor domén už znovu nerozkládá").toBe(-1);
    // první rozhodnutí, které vlastnictví potřebuje (strážce rewarmupu), je až za načtením
    expect(CS.indexOf("\ncs_rewarmup_nesmi_drzenou\n")).toBeGreaterThan(nacteni[0]);
  });

  it("krok 2d volá strážce DŘÍV, než pošle první DELETE (strážce není jen na začátku běhu)", () => {
    const krok = CS.indexOf('step "2d. REWARMUP');
    expect(krok, "krok 2d ve studeném startu chybí").toBeGreaterThan(-1);
    const strazce = CS.indexOf("\ncs_rewarmup_nesmi_drzenou\n", krok);
    const prvniDelete = CS.indexOf('coolify_api DELETE "/applications/${_rw_uuids', krok);
    expect(strazce, "strážce v kroku 2d chybí").toBeGreaterThan(krok);
    expect(prvniDelete, "DELETE kroku 2d nenalezen — tvar se změnil, uprav bránu").toBeGreaterThan(krok);
    expect(strazce).toBeLessThan(prvniDelete);
  });
});
