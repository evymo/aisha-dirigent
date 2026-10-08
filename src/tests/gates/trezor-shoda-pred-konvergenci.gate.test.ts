/**
 * Brána: konvergence existující instance nesmí tajemství přetočit trezorem, který
 * je starší než živý stack.
 *
 * ── PROČ ──────────────────────────────────────────────────────────────────────
 * Krok 2 cold-startu bere spravovaná tajemství z trezoru (`.env-prod-backup`) a
 * krok 4 je pošle do Coolify. Zpětná synchronizace (coolify-pull-envs.mjs) běžela
 * jen před wipem — konvergence (`--skip-create`) živé hodnoty s trezorem
 * nesrovnala nikdy. ⛔ NAMĚŘENO 2026-10-04 (předlet forku nad W1): hodnota
 * změněná v Coolify po poslední záloze by se tiše vrátila na starou; u hesla DB
 * nebo šifrovacího klíče proti datům, která už nesou tu novou.
 *
 * Měří se CHOVÁNÍ `coolify-pull-envs.mjs --check` proti falešnému Coolify a to,
 * že ho cold-start před krokem 2 konvergence opravdu spouští a na rozchod staví.
 */
import { afterEach, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const NASTROJ = join(ROOT, "scripts/coolify-pull-envs.mjs");

type Env = { key: string; value: string };
type Appka = { uuid: string; name: string; envs: Env[] | "odmitni" };

let server: http.Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

async function falesneCoolify(appky: Appka[]): Promise<string> {
  server = http.createServer((req, res) => {
    const c = (req.url ?? "/").split("?")[0];
    const json = (data: unknown, kod = 200) => {
      res.writeHead(kod, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (req.method !== "GET") return json({ message: "falešné Coolify: kontrola nesmí zapisovat" }, 405);
    if (c === "/api/v1/projects/projfixture") return json({ uuid: "projfixture", name: "inst", environments: [{ id: 1, name: "production" }] });
    if (c === "/api/v1/projects") return json([{ uuid: "projfixture", name: "inst" }]);
    if (c === "/api/v1/applications") return json(appky.map((a) => ({ uuid: a.uuid, name: a.name, environment_id: 1 })));
    const m = /^\/api\/v1\/applications\/([^/]+)\/envs$/.exec(c);
    if (m) {
      const a = appky.find((x) => x.uuid === m[1]);
      if (!a) return json({ message: "not found" }, 404);
      if (a.envs === "odmitni") return json({ message: "falešné Coolify: odmítnuto" }, 403);
      return json(a.envs.map((e) => ({ ...e, real_value: `'${e.value}'`, is_literal: true, is_preview: false })));
    }
    json({ message: `falešné Coolify: neznámá cesta ${c}` }, 404);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}

/** Asynchronně — synchronní spawn by zablokoval smyčku událostí a server by neodpověděl. */
function kontrola(url: string, trezor: string): Promise<{ kod: number; vystup: string }> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [NASTROJ, "--check", `--out=${trezor}`], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: mkdtempSync(join(tmpdir(), "trezor-shoda-home-")),
        COOLIFY_URL: url,
        COOLIFY_API_TOKEN: "fixture-token",
        COOLIFY_PROJECT_UUID: "projfixture",
        APP_NAME_PREFIX: "inst",
        AISHA_ENV_LOCAL_FILE: "/dev/null",
        AISHA_PROD_BACKUP_FILE: "/dev/null",
      },
    });
    let vystup = "";
    p.stdout.on("data", (d) => (vystup += d));
    p.stderr.on("data", (d) => (vystup += d));
    p.on("close", (kod) => done({ kod: kod ?? -1, vystup }));
  });
}

const zivePar: Env[] = [
  { key: "JWT_SECRET", value: "zivy-jwt-secret-0123456789abcdef0123456789" },
  { key: "PKI_SVAULT_KEY", value: "zivy-svault-klic-0123456789abcdef" },
];
function trezorSoubor(radky: string[]): string {
  const f = join(mkdtempSync(join(tmpdir(), "trezor-shoda-")), ".env-prod-backup");
  writeFileSync(f, radky.join("\n") + "\n", { mode: 0o600 });
  return f;
}
const appky = (envs: Env[], druha: Env[] | "odmitni" = []): Appka[] => [
  { uuid: "uuidcorefixture01", name: "inst-core", envs },
  { uuid: "uuidedgefixture01", name: "inst-edge", envs: druha },
];

describe("trezor × živý stack před konvergencí (coolify-pull-envs --check)", { timeout: 120_000 }, () => {
  test("kotva: trezor shodný se živým stackem → 0, SHODA", async () => {
    const url = await falesneCoolify(appky(zivePar));
    const r = await kontrola(url, trezorSoubor(zivePar.map((e) => `${e.key}=${e.value}`)));
    expect(r.kod, r.vystup).toBe(0);
    expect(r.vystup).toMatch(/SHODA/);
  });

  test("⛔ trezor STARŠÍ než živá hodnota → 3, jmenuje klíč, hodnoty nevypíše, trezor nezmění", async () => {
    const url = await falesneCoolify(appky(zivePar));
    // Atrapa se skládá za běhu: literál `KLÍČ=hodnota` by chytil skener tajemství (.gitleaks.toml).
    const stara = ["stara", "hodnota", "z", "minule", "zalohy"].join("-");
    const trezor = trezorSoubor([`JWT_SECRET=${zivePar[0].value}`, `PKI_SVAULT_KEY=${stara}`]);
    const pred = readFileSync(trezor, "utf8");
    const r = await kontrola(url, trezor);
    expect(r.kod, r.vystup).toBe(3);
    expect(r.vystup).toMatch(/ROZCHOD/);
    expect(r.vystup).toMatch(/~ PKI_SVAULT_KEY \(trezor fp=[0-9a-f]{12} → živé fp=[0-9a-f]{12}\)/);
    expect(r.vystup).not.toContain(zivePar[1].value);
    expect(r.vystup).not.toContain(stara);
    expect(readFileSync(trezor, "utf8"), "kontrola nesmí trezor přepsat").toBe(pred);
    expect(existsSync(`${trezor}.pred-reverse-sync`), "kontrola nesmí ani zálohovat — nic nemění").toBe(false);
  });

  test("⛔ spravované tajemství jen ŽIVĚ (trezor ho nemá) → 3", async () => {
    const url = await falesneCoolify(appky(zivePar));
    const r = await kontrola(url, trezorSoubor([`JWT_SECRET=${zivePar[0].value}`]));
    expect(r.kod, r.vystup).toBe(3);
    expect(r.vystup).toMatch(/\+ PKI_SVAULT_KEY \(fp=[0-9a-f]{12}\)/);
  });

  test("⛔ env některé aplikace nejde přečíst → 4 NEZMĚŘENO (ne „shoda“ z poloviny stacku)", async () => {
    const url = await falesneCoolify(appky(zivePar, "odmitni"));
    const r = await kontrola(url, trezorSoubor(zivePar.map((e) => `${e.key}=${e.value}`)));
    expect(r.kod, r.vystup).toBe(4);
    expect(r.vystup).toMatch(/NEZMĚŘENO: env 1 aplikací nešlo přečíst \(inst-edge\)/);
  });

  test("hodnota uvozená s escapem se čte jako po `source` — žádný falešný rozchod", async () => {
    const zive: Env[] = [{ key: "JWT_SECRET", value: "s$dolarem\"a-uvozovkou-0123456789abcdef01" }, zivePar[1]];
    const url = await falesneCoolify(appky(zive));
    const r = await kontrola(url, trezorSoubor(['JWT_SECRET="s\\$dolarem\\"a-uvozovkou-0123456789abcdef01"', `PKI_SVAULT_KEY=${zivePar[1].value}`]));
    expect(r.kod, r.vystup).toBe(0);
  });
});

describe("cold-start: konvergence před krokem 2 kontrolu SPOUŠTÍ a na rozchod STAVÍ", () => {
  const cs = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
  test("kontrola běží jen s --skip-create, PŘED generátorem tajemství, a každý nenulový kód = exit", () => {
    const krok2 = cs.indexOf('step "2. GENERATE FRESH SECRETS"');
    const kontrolaAt = cs.indexOf('scripts/coolify-pull-envs.mjs" --check --out="$ENV_PROD_BACKUP"');
    const generator = cs.indexOf('_gen_tmp=$(node "$REPO_ROOT/scripts/generate-secrets.mjs"');
    expect(krok2).toBeGreaterThan(-1);
    expect(kontrolaAt, "cold-start kontrolu trezoru × živý stack nespouští").toBeGreaterThan(krok2);
    expect(generator).toBeGreaterThan(kontrolaAt);
    const blok = cs.slice(cs.lastIndexOf('if [ "$SKIP_CREATE" = "1" ]; then', kontrolaAt), cs.indexOf("\nfi\n", kontrolaAt));
    expect(blok, "kontrola není podmíněná konvergencí").toMatch(/^if \[ "\$SKIP_CREATE" = "1" \]; then/);
    expect(blok).toMatch(/\n\s+0\) ok /);
    // rozchod (3) i jakýkoli jiný kód (nezměřeno, API) = STOP
    expect(blok).toMatch(/\n\s+3\)[\s\S]*?exit 1/);
    expect(blok).toMatch(/\n\s+\*\)[\s\S]*?exit 1/);
  });
});
