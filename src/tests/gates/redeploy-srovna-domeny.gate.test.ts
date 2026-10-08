/**
 * Brána: redeploy srovná domény v Coolify PŘED první vlnou; cold-start to
 * deklaruje sám za sebe.
 *
 * ⛔ NAMĚŘENO 2026-10-02 (boční vstupy mimo Edge). Domény v Coolify srovnával
 * JEN cold-start (deploy-init + doktor domén v kroku 4). Fork se po
 * fast-forwardu srovnává redeployem — a ten je nečetl. Změna vlastnictví
 * veřejného jména (edge jméno převezme, backend ho uvolní) tak zůstala v gitu
 * a backend dál držel vlastní router Traefiku: veřejný vstup mimo dveře
 * a evidenci Edge. Požadavek majitele: „až si udělají ff, musí to jednoduše
 * srovnat redeploy".
 *
 * Tvrzení (každé má měřidlo, které umí zčervenat):
 *   1. běh v režimu execute zavolá doktor domén JEDNOU, s `--apply`
 *      `--no-probe` a `--only=<aplikace plánu>`, PO srovnání odvozených klíčů
 *      a DŘÍV než jakýkoli POST /deploy;
 *   2. doktor dostane `.env.coolify` jako zdroj pravdy — i PRÁZDNÉ
 *      EDGE_OWNED_HOSTS přebije hodnotu zděděnou z prostředí volajícího;
 *   3. selhání doktora = „domény NESROVNÁNY" v souhrnu a návratový kód 1;
 *   4. `--bez-domen` doktor nevolá; bez `.env.coolify` se nevolá a běh to řekne;
 *   5. cold-start (krok 4 srovná domény vždy před vlnami) to vlnám deklaruje
 *      přes REDEPLOY_FLAGS, ze kterých se skládají všechny jeho fáze.
 *
 * Redeploy běží ze ZÁSTUPNÉHO kořene: skript zkopírovaný (ROOT se počítá
 * z jeho umístění), všechno ostatní odkazy na repo; doktor domén a env-doktor
 * jsou zapisující atrapy. Coolify je mock, uzel má plný disk → disková brána
 * zastaví první nasazení, takže na živé Coolify nic nedosáhne.
 *
 * Spouští se přes: npm run test:gates
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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
const UUID_REGISTRY = "fixtureregistryuuid01";
const ATRAPY = new Set(["aisha-redeploy.mjs", "coolify-domain-doctor.mjs", "aisha-env-doctor.mjs"]);

/** Výstup diskového měření uzlu (tvar, který čte lib/diskova-brana.mjs). */
function vystupMereni(volnoKb: number): string {
  return [
    `VOLNO_KB ${volnoKb}`,
    `OBRAZ ${UUID_REGISTRY} sha256:aaaaaaaaaaaa${"0".repeat(52)}`,
    "DF_V",
    "Images space usage:",
    "",
    "REPOSITORY   TAG       IMAGE ID       CREATED       SIZE      SHARED SIZE   UNIQUE SIZE   CONTAINERS",
    "fixture/img  latest    aaaaaaaaaaaa   2 weeks ago   9.9GB     1.1GB         2.1GB         1",
    "",
    "Containers space usage:",
  ].join("\n");
}

/** Zástupný kořen: kopie redeploye, atrapy doktorů, zbytek odkazy na repo. */
function postavKoren(): { koren: string; denik: string } {
  const koren = mkdtempSync(join(tmpdir(), "redeploy-domeny-"));
  for (const polozka of readdirSync(ROOT)) {
    if (polozka === "scripts" || polozka === ".env.coolify" || polozka === ".git") continue;
    symlinkSync(join(ROOT, polozka), join(koren, polozka));
  }
  const skripty = join(koren, "scripts");
  mkdirSync(skripty);
  for (const polozka of readdirSync(join(ROOT, "scripts"))) {
    if (ATRAPY.has(polozka)) continue;
    symlinkSync(join(ROOT, "scripts", polozka), join(skripty, polozka));
  }
  copyFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), join(skripty, "aisha-redeploy.mjs"));
  const denik = join(koren, "denik-atrap.jsonl");
  // Atrapa doktora domén: zapíše argv a to, co z prostředí čte, vrátí ATRAPA_DOMENY_RC.
  writeFileSync(
    join(skripty, "coolify-domain-doctor.mjs"),
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(denik)}, JSON.stringify({
  kdo: "domeny",
  argv: process.argv.slice(2),
  edgeOwned: process.env.EDGE_OWNED_HOSTS ?? null,
  znacka: process.env.ZNACKA_ZE_SOT ?? null,
}) + "\\n");
const rc = Number(process.env.ATRAPA_DOMENY_RC || "0");
if (rc) console.log("blocked: aisha-orchestration n8n-auth drží mcp.x.test (atrapa)");
process.exit(rc);
`,
  );
  writeFileSync(
    join(skripty, "aisha-env-doctor.mjs"),
    `import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(denik)}, JSON.stringify({ kdo: "env-doktor" }) + "\\n");
`,
  );
  return { koren, denik };
}

let server: http.Server;
let base = "";
let posty = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    const json = (obj: unknown, s = 200) => {
      res.writeHead(s, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && url.startsWith("/api/v1/deploy")) {
      posty++;
      return json({ deployments: [{ deployment_uuid: "dep-e2e" }] });
    }
    if (url === "/api/v1/projects/projfixture") return json({ environments: [{ id: 1, name: "production" }] });
    if (url === "/api/v1/projects/projfixture/production") {
      return json({
        applications: [{
          uuid: UUID_REGISTRY, name: "fixture-registry", status: "running:healthy",
          environment_id: 1, destination: { server: { name: "uzel-test" } },
        }],
      });
    }
    json({ message: "not found" }, 404);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const adresa = server.address();
  base = `http://127.0.0.1:${typeof adresa === "object" && adresa ? adresa.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

type Zaznam = { kdo: string; argv?: string[]; edgeOwned?: string | null; znacka?: string | null };

async function spust(o: { envCoolify?: string | null; argv?: string[]; env?: Record<string, string> }) {
  const { koren, denik } = postavKoren();
  // Pomocné soubory běhu MIMO zástupný kořen — ten zrcadlí repo (i jeho `bin/`).
  const pomocne = mkdtempSync(join(tmpdir(), "redeploy-domeny-pomocne-"));
  try {
    if (o.envCoolify !== null) {
      writeFileSync(join(koren, ".env.coolify"), o.envCoolify ?? "ZNACKA_ZE_SOT=ze-sot\nEDGE_OWNED_HOSTS=api.x.test,mcp.x.test\n");
    }
    const manifest = join(pomocne, "fixture.manifest");
    writeFileSync(manifest, "app: registry:frontend:docker-compose.coolify-registry.yml\n");
    const bin = join(pomocne, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "ssh"), `#!/bin/sh\ncat <<'EOF'\n${vystupMereni(1024 * 1024)}\nEOF\n`);
    chmodSync(join(bin, "ssh"), 0o755);
    const overlay = join(pomocne, "overlay");
    mkdirSync(join(overlay, "profiles"), { recursive: true });
    writeFileSync(join(overlay, "profiles", "fixture-profil.json"), JSON.stringify({ id: "fixture-profil" }));

    const postyPred = posty;
    const env: Record<string, string> = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: pomocne,
      COOLIFY_BASE_URL: base,
      COOLIFY_URL: base,
      COOLIFY_API_TOKEN: "fixture-token",
      COOLIFY_PROJECT_UUID: "projfixture",
      COOLIFY_ENVIRONMENT: "production",
      APP_NAME_PREFIX: "fixture",
      MANIFEST_FILE: manifest,
      AISHA_PROFILE: "fixture-profil",
      AISHA_INSTANCE_CONFIG_DIR: overlay,
      AISHA_NODE_SSH: "uzel-test=fixture@stub",
      AISHA_SNAPSHOT_DIR: join(pomocne, "snap"),
      AISHA_HEALTH_POLL_S: "1",
      NO_COLOR: "1",
      ...(o.env ?? {}),
    };
    // Zástupný kořen leží mimo repo: zděděná git lokace (pre-push hook nastavuje
    // GIT_DIR) by podprocesu podstrčila cizí repo — prostředí jde bez ní.
    const p = spawn(process.execPath, [join(koren, "scripts/aisha-redeploy.mjs"), "--only=registry", ...(o.argv ?? [])], {
      cwd: koren,
      env: envWithoutGitLocation(env),
    });
    let vystup = "";
    p.stdout.on("data", (d) => (vystup += d));
    p.stderr.on("data", (d) => (vystup += d));
    const kod = await new Promise<number | null>((r) => p.on("close", r));
    const zaznamy: Zaznam[] = existsSync(denik)
      ? readFileSync(denik, "utf8").split("\n").filter(Boolean).map((r) => JSON.parse(r) as Zaznam)
      : [];
    return { kod, vystup, zaznamy, postyBehu: posty - postyPred };
  } finally {
    rmSync(koren, { recursive: true, force: true });
    rmSync(pomocne, { recursive: true, force: true });
  }
}

describe("redeploy: domény v Coolify se srovnají před první vlnou", () => {
  test("execute: doktor domén JEDNOU, --apply --no-probe --only=<plán>, po env-doktorovi, před POST /deploy", async () => {
    const r = await spust({});
    const domeny = r.zaznamy.filter((z) => z.kdo === "domeny");
    expect(domeny, r.vystup).toHaveLength(1);
    expect(domeny[0].argv).toEqual(["--apply", "--no-probe", "--only=registry"]);
    const poradi = r.zaznamy.map((z) => z.kdo);
    expect(poradi.indexOf("env-doktor"), `pořadí: ${poradi.join(" → ")}`).toBeGreaterThanOrEqual(0);
    expect(poradi.indexOf("env-doktor")).toBeLessThan(poradi.indexOf("domeny"));
    // Plný disk zastaví první nasazení — doktor tedy běžel bez jediného POST /deploy.
    expect(r.postyBehu, r.vystup).toBe(0);
    expect(r.vystup).toMatch(/Domény v Coolify srovnané s derivací/);
  }, 60_000);

  test("zdroj pravdy je .env.coolify (rozparsovaný) — i prázdné EDGE_OWNED_HOSTS přebije zděděné", async () => {
    const plny = await spust({ env: { EDGE_OWNED_HOSTS: "zastarale.x.test" } });
    const d1 = plny.zaznamy.find((z) => z.kdo === "domeny");
    expect(d1?.edgeOwned, plny.vystup).toBe("api.x.test,mcp.x.test");
    expect(d1?.znacka).toBe("ze-sot");

    const prazdny = await spust({
      envCoolify: "ZNACKA_ZE_SOT=ze-sot\nEDGE_OWNED_HOSTS=\n",
      env: { EDGE_OWNED_HOSTS: "zastarale.x.test" },
    });
    const d2 = prazdny.zaznamy.find((z) => z.kdo === "domeny");
    expect(d2?.edgeOwned, "prázdné EDGE_OWNED_HOSTS v SoT = edge nevlastní nic; zděděná hodnota ho přebít nesmí").toBe("");
  }, 120_000);

  test("selhání doktora: domény NESROVNÁNY v souhrnu, výpis doktora vidět, kód 1", async () => {
    const r = await spust({ env: { ATRAPA_DOMENY_RC: "1" } });
    expect(r.zaznamy.filter((z) => z.kdo === "domeny"), r.vystup).toHaveLength(1);
    expect(r.vystup).toMatch(/domény NESROVNÁNY/);
    expect(r.vystup, "příčinu z doktora volající uřízl").toMatch(/n8n-auth drží mcp\.x\.test/);
    expect(r.kod).toBe(1);
    // Kód 1 tady dává i plný disk (ZASTAVENO), takže samotný kód nerozliší, jestli
    // domény počítají jako tvrdý problém. To drží tenhle výraz — cold-start bere
    // nenulu jako „nedokončeno", měkká trojka by nesrovnané domény schovala.
    const zdroj = readFileSync(join(ROOT, "scripts/aisha-redeploy.mjs"), "utf8");
    const tvrdy = /const tvrdyProblem =([\s\S]*?);\n/.exec(zdroj)?.[1] ?? "";
    expect(tvrdy, "měřidlo osiřelo — výraz tvrdyProblem se nenašel").toMatch(/summary\.deploy_failed/);
    expect(tvrdy, "nesrovnané domény nejsou tvrdý problém — běh by skončil 0/3").toMatch(
      /summary\.domeny_nesrovnane !== null/,
    );
  }, 60_000);

  test("--bez-domen doktor nevolá; bez .env.coolify se nevolá a běh to řekne nahlas", async () => {
    const bez = await spust({ argv: ["--bez-domen"] });
    expect(bez.zaznamy.filter((z) => z.kdo === "domeny"), bez.vystup).toHaveLength(0);

    const bezSot = await spust({ envCoolify: null });
    expect(bezSot.zaznamy.filter((z) => z.kdo === "domeny"), bezSot.vystup).toHaveLength(0);
    expect(bezSot.vystup).toMatch(/\.env\.coolify chybí — domény není podle čeho srovnat/);
    expect(bezSot.vystup).toMatch(/domény NESROVNÁNY/);
  }, 120_000);

  test("--plan doktor nevolá (jen čtení)", async () => {
    const r = await spust({ argv: ["--plan"] });
    expect(r.zaznamy.filter((z) => z.kdo === "domeny"), r.vystup).toHaveLength(0);
    expect(r.kod, r.vystup).toBe(0);
  }, 60_000);
});

describe("doktor domén: --no-probe jen s --apply", () => {
  test("kontrola bez živé sondy se odmítne (rc 2), dřív než doktor sáhne na Coolify", async () => {
    const p = spawn(process.execPath, [join(ROOT, "scripts/coolify-domain-doctor.mjs"), "--no-probe"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", COOLIFY_URL: "http://127.0.0.1:9", COOLIFY_API_TOKEN: "x" },
    });
    let vystup = "";
    p.stderr.on("data", (d) => (vystup += d));
    const kod = await new Promise<number | null>((r) => p.on("close", r));
    expect(kod, vystup).toBe(2);
    expect(vystup).toMatch(/--no-probe jen s --apply/);
  });
});

describe("cold-start: domény srovná krok 4 a vlnám to deklaruje", () => {
  const skript = readFileSync(join(ROOT, "scripts/aisha-cold-start.sh"), "utf8");
  const bezKomentaru = skript.split("\n").filter((r) => !/^\s*#/.test(r)).join("\n");

  test("REDEPLOY_FLAGS nese --bez-domen a všechna volání redeploye v režimu nasazení z nich vycházejí", () => {
    expect(bezKomentaru).toMatch(/REDEPLOY_FLAGS="\$REDEPLOY_FLAGS --bez-domen"/);
    // Jen SKUTEČNÁ volání `(cd "$REPO_ROOT" && node scripts/aisha-redeploy.mjs …)` —
    // řádky `err "  Retry: node scripts/aisha-redeploy.mjs …"` jsou rady, ne běh.
    const volani = [
      ...bezKomentaru.matchAll(/\(cd "\$REPO_ROOT" && node scripts\/aisha-redeploy\.mjs\s*(?:\\\n)?\s*([^\n<)]*)/g),
    ].map((m) => m[1]);
    expect(volani.length, "měřidlo osiřelo — cold-start redeploy volá jinak").toBeGreaterThanOrEqual(5);
    for (const argumenty of volani) {
      if (/--restart-validate|--print-(phases|waves)|--status|--plan/.test(argumenty)) continue;
      expect(argumenty, `volání redeploye bez deklarace domén: ${argumenty}`).toMatch(
        /\$REDEPLOY_FLAGS|\$PHASE_A_FLAGS|\$_provision_flags/,
      );
    }
    // Odvozené sady z REDEPLOY_FLAGS deklaraci neodříznou.
    expect(bezKomentaru).toMatch(/PHASE_A_FLAGS="\$\(echo "\$REDEPLOY_FLAGS" \| sed 's\/--wave-timeout=\[0-9\]\*\/\/'\)/);
    expect(bezKomentaru).toMatch(/_provision_flags="\$\(printf '%s' "\$REDEPLOY_FLAGS" \| sed 's\/--skip-healthy\/\/g'\)"/);
  });

  test("krok 4 (doktor domén --apply) stojí PŘED první vlnou", () => {
    const doktor = bezKomentaru.indexOf("node scripts/coolify-domain-doctor.mjs --apply");
    const prvniVlna = bezKomentaru.indexOf("node scripts/aisha-redeploy.mjs \\");
    expect(doktor, "krok 4 už doktor domén --apply nevolá").toBeGreaterThan(0);
    expect(prvniVlna).toBeGreaterThan(0);
    expect(doktor).toBeLessThan(prvniVlna);
  });
});
