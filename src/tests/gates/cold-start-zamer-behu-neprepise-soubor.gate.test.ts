/**
 * Brána: záměr běhu cold-startu (--dry-run, --wipe, …) žádný soubor nepřepíše.
 *
 * NAMĚŘENO 2026-09-24 ve forku, staging na sdíleném Coolify:
 *
 *   AISHA_ENV=staging bash scripts/aisha-cold-start-env.sh --dry-run --wipe
 *
 * běžel NAOSTRO. Obal bootstrapnul zálohu z env aplikací v Coolify a stáhl
 * i `DRY_RUN=0` (netinit má v compose `DRY_RUN: ${DRY_RUN:-0}`). Cold-start pak
 * `load_env_file_keys "$ENV_PROD_BACKUP" overwrite` vrátil `DRY_RUN=0` do
 * prostředí a příznak z příkazové řádky zmizel. Doktor, generování secretů
 * i zápis env souborů proběhly doopravdy; zastavila to až pojistka zástupných
 * hodnot těsně před wipem.
 *
 * CO SE TU MĚŘÍ — chování, ne text:
 *   1. `load_env_file_keys` se SPUSTÍ nad souborem s DRY_RUN=0/WIPE=1 a měří se,
 *      co zůstane v prostředí (v obou režimech);
 *   2. bootstrap zálohy se SPUSTÍ proti falešnému Coolify, jehož aplikace nese
 *      DRY_RUN, a měří se, co skončí v zapsané záloze;
 *   3. oba seznamy řídicích proměnných (bash i JS) jsou tytéž;
 *   4. cold-start knihovnu opravdu používá a záměr zamkne DŘÍV, než poprvé
 *      načte soubor.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const LIB = join(ROOT, "scripts/lib/env-file-keys.sh");
const BOOTSTRAP = join(ROOT, "scripts/lib/bootstrap-env-from-coolify.mjs");
const COLD_START = join(ROOT, "scripts/aisha-cold-start.sh");

function nactiSouborem(obsah: string, rezim: "overwrite" | "if-unset") {
  const dir = mkdtempSync(join(tmpdir(), "zamer-behu-"));
  const soubor = join(dir, "zaloha.env");
  writeFileSync(soubor, obsah);
  const skript = [
    // stderr do téhož proudu pro CELÝ skript (varování knihovny jde na stderr);
    // `… 2>&1` na konci by platilo jen pro poslední příkaz.
    "exec 2>&1",
    "set -uo pipefail",
    `. "${LIB}"`,
    "export DRY_RUN=1 WIPE=0 WIPE_VOLUMES=1",
    `load_env_file_keys "${soubor}" ${rezim}`,
    'printf "DRY_RUN=%s WIPE=%s WIPE_VOLUMES=%s FOO=%s BAZ=%s\\n" "$DRY_RUN" "$WIPE" "$WIPE_VOLUMES" "${FOO:-}" "${BAZ:-}"',
  ].join("\n");
  const out = execFileSync("bash", ["-c", skript], { encoding: "utf8" });
  return out;
}

describe("load_env_file_keys — řídicí proměnné ze souboru neprojdou", () => {
  const ZALOHA = "DRY_RUN='0'\nWIPE=1\nWIPE_VOLUMES=0\nFOO=bar\n";

  test("overwrite: DRY_RUN/WIPE zůstanou z příkazové řádky, konfigurace se načte", () => {
    const out = nactiSouborem(ZALOHA, "overwrite");
    expect(out).toContain("DRY_RUN=1 WIPE=0 WIPE_VOLUMES=1 FOO=bar");
  });

  test("if-unset: totéž", () => {
    const out = nactiSouborem(ZALOHA, "if-unset");
    expect(out).toContain("DRY_RUN=1 WIPE=0 WIPE_VOLUMES=1 FOO=bar");
  });

  test("znečištěná záloha se OHLÁSÍ, ne jen tiše přeskočí", () => {
    const out = nactiSouborem(ZALOHA, "overwrite");
    expect(out).toMatch(/nese řídicí proměnnou DRY_RUN/);
  });

  // Parser rozloží uvozovky jako bash — uvozovaná hodnota se PŘEČTE a zastaví ji stráž.
  test('uvozovaná hodnota DRY_RUN="0" / WIPE=\'1\' se přečte a stráž ji zastaví', () => {
    const out = nactiSouborem('DRY_RUN="0"\nWIPE=\'1\'\nFOO="bar"\n', "overwrite");
    expect(out).toContain("DRY_RUN=1 WIPE=0 WIPE_VOLUMES=1 FOO=bar");
    expect(out).toMatch(/nese řídicí proměnnou DRY_RUN/);
    expect(out).toMatch(/nese řídicí proměnnou WIPE/);
  });

  // Tvar `export KLÍČ=…` parser NEČTE vůbec (klíč s mezerou neprojde) — bezpečné proto,
  // že se řádek nepřečte, ne proto, že by ho zastavila stráž. Tvrdíme, co opravdu platí.
  test("tvar `export DRY_RUN=0` parser vůbec nepřečte — ani ohlášení, ani hodnota", () => {
    const out = nactiSouborem("export DRY_RUN=0\nexport FOO=bar\nBAZ=qux\n", "overwrite");
    expect(out).toContain("DRY_RUN=1 WIPE=0 WIPE_VOLUMES=1 FOO= BAZ=qux"); // BAZ = kontrola měřidla
    expect(out).not.toMatch(/nese řídicí proměnnou/);
  });
});

/** Falešný Coolify: jeden projekt, jedna aplikace, jejíž env nese DRY_RUN. */
async function falesnyCoolify(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/v1/projects/proj-stg") return json({ environments: [{ id: 7, name: "production" }] });
    if (req.url === "/api/v1/applications") return json([{ uuid: "app-netinit", name: "inst-netinit", environment_id: 7 }]);
    if (req.url === "/api/v1/applications/app-netinit/envs") {
      return json([
        { key: "DRY_RUN", value: "0" },
        { key: "WIPE", value: "1" },
        { key: "FOO", value: "bar" },
      ]);
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe("bootstrap zálohy z Coolify — řídicí proměnné do zálohy nezapíše", () => {
  test("aplikace nese DRY_RUN=0 → v záloze NENÍ, konfigurace ano", async () => {
    const { server, url } = await falesnyCoolify();
    try {
      const dir = mkdtempSync(join(tmpdir(), "bootstrap-"));
      const vystup = join(dir, ".env-staging-backup");
      const kod = await new Promise<number>((ok) => {
        const p = spawn(process.execPath, [BOOTSTRAP, `--coolify-url=${url}`, "--project-uuid=proj-stg", `--output=${vystup}`], {
          env: { ...process.env, COOLIFY_API_TOKEN: "test" },
          stdio: ["ignore", "ignore", "ignore"],
        });
        p.on("exit", (c) => ok(c ?? 1));
      });
      expect(kod).toBe(0);
      expect(existsSync(vystup)).toBe(true);
      const zaloha = readFileSync(vystup, "utf8");
      expect(zaloha).toMatch(/^FOO=/m); // postroj opravdu něco zapsal
      expect(zaloha).not.toMatch(/^DRY_RUN=/m);
      expect(zaloha).not.toMatch(/^WIPE=/m);
    } finally {
      server.close();
    }
  });
});

describe("jeden seznam řídicích proměnných", () => {
  test("bash (env-file-keys.sh) a JS (bootstrap) nesou tytéž názvy", () => {
    const bash = readFileSync(LIB, "utf8").match(/CS_RIDICI_PROMENNE=\(([\s\S]*?)\)/);
    const js = readFileSync(BOOTSTRAP, "utf8").match(/RIDICI_PROMENNE = new Set\(\[([\s\S]*?)\]\)/);
    expect(bash).not.toBeNull();
    expect(js).not.toBeNull();
    const zBashe = bash![1].split(/\s+/).filter(Boolean).sort();
    const zJs = [...js![1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort();
    expect(zJs).toEqual(zBashe);
  });
});

describe("cold-start knihovnu používá a záměr zamkne dřív, než načte soubor", () => {
  const cs = readFileSync(COLD_START, "utf8");

  test("vlastní kopii load_env_file_keys už nemá — načítá knihovnu", () => {
    expect(cs).not.toMatch(/^load_env_file_keys\(\)/m);
    expect(cs).toMatch(/^\. "\$\{SCRIPT_DIR\}\/lib\/env-file-keys\.sh"$/m);
  });

  test("readonly záměru stojí za parsováním argumentů a před prvním načtením souboru", () => {
    const radky = cs.split("\n");
    const konecArgumentu = radky.findIndex((r, i) => r === "done" && radky.slice(0, i).some((x) => x.includes("--dry-run)")));
    const zamek = radky.findIndex((r) => /^readonly DRY_RUN\b/.test(r));
    const prvniNacteni = radky.findIndex((r) => /^\s*load_env_file_keys\s+"/.test(r));
    expect(konecArgumentu).toBeGreaterThan(0);
    expect(zamek).toBeGreaterThan(konecArgumentu);
    expect(prvniNacteni).toBeGreaterThan(zamek);
    for (const p of ["DRY_RUN", "WIPE", "WIPE_VOLUMES", "SKIP_ORPHAN_CLEANUP", "SKIP_CREATE", "SKIP_DEPLOY"]) {
      expect(radky[zamek]).toMatch(new RegExp(`\\b${p}\\b`));
    }
  });
});
