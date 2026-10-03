/**
 * Brána: FATAL dveří v doktoru se bere z KÓDU lib/dvere-soulad.mjs, nikdy z textu výkladu.
 *
 * ⛔ NAMĚŘENO 2026-09-26: cold-start-doctor hlásil FATAL „EDGE_DOOR_MODE=enforce
 * bez deklarovaných dveří" pokaždé, když výpis měření dveří OBSAHOVAL řetězec
 * `EDGE_DOOR_MODE=enforce` — ve fázi P (`case "✗ vada: "*EDGE_DOOR_MODE=enforce*`)
 * i v oddílu dveří (`grep -q "EDGE_DOOR_MODE=enforce"`). Ten řetězec ale stojí
 * i ve VYSVĚTLENÍ jiné vady: KNOCK_UPSTREAM „… s EDGE_DOOR_MODE=enforce by edge
 * zamkl všechny". Instance s režimem `off` tak dostala dva falešné FATALy
 * a doktor ji prohlásil za nepřipravenou ke cold-startu.
 *
 * Výpis je výklad pro člověka a jeho věty se mění. O FATALu rozhoduje
 * strukturovaný příznak `zavrenyEdgeBezDveri`, který CLI vydá jako návratový
 * kód KOD_ZAVRENY_EDGE.
 *
 * CO SE MĚŘÍ:
 *   1. producent: příznak nese jen `enforce` bez deklarace — ne vada, jejíž
 *      výklad řetězec zmiňuje (a měřidlo nejdřív ověří, že ta past existuje);
 *      CLI `--soulad` vrací kód podle příznaku, doktor zná TUTÉŽ hodnotu.
 *   2. oddíl dveří: SKUTEČNÝ doktor (`--phase B --no-network`, ENV_FILE
 *      syntetický) — režim `off` + vada KNOCK_UPSTREAM → žádný FATAL (vada
 *      zůstává varováním); kontrolní vzorek `enforce` bez dveří → FATAL, exit 1.
 *   3. fáze P: SKUTEČNÉ `dvere-soulad.mjs --coolify` proti atrapě Coolify API
 *      (HTTP) → výpis + kód → skutečná funkce doktoru dvere_na_aplikaci_verdikt.
 *      Fázi P celou pustit nejde: čte `$REPO_ROOT/.env.coolify`, který v CI
 *      není a na stroji obsluhy je ostrý.
 *
 * Spouští se přes: npm run test:gates
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KOD_ZAVRENY_EDGE, knockUpstream, vadyDveri } from "../../../scripts/lib/dvere-soulad.mjs";

const ROOT = process.cwd();
const DOKTOR = join(ROOT, "scripts/cold-start-doctor.sh");
const SOULAD = join(ROOT, "scripts/lib/dvere-soulad.mjs");
const FATAL = "EDGE_DOOR_MODE=enforce bez deklarovaných dveří";
const PREFIX = "aisha";

/**
 * Režim `off`, dveře deklarované, KNOCK_UPSTREAM ze staré výchozí hodnoty —
 * přesně stav instance, která dostala falešné FATALy.
 */
const OFF_S_VADOU_UPSTREAMU: Record<string, string> = {
  APP_NAME_PREFIX: PREFIX,
  EDGE_COMPOSE_PROFILES: "knock",
  EDGE_DOOR_MODE: "off",
  KNOCK_UPSTREAM: "http://svc-knock:3017",
  SPA_KNOCK_PUBLIC_PORT: "40123",
  SPA_DIAGNOSE: "1",
};
/** Kontrolní vzorek: edge zavřený, dveře nedeklarované. */
const ENFORCE_BEZ_DVERI: Record<string, string> = {
  APP_NAME_PREFIX: PREFIX,
  EDGE_COMPOSE_PROFILES: "",
  EDGE_DOOR_MODE: "enforce",
};

let pracovni: string;
beforeAll(() => {
  pracovni = mkdtempSync(join(tmpdir(), "doktor-dvere-"));
});
afterAll(() => {
  if (pracovni) rmSync(pracovni, { recursive: true, force: true });
});

const envSoubor = (o: Record<string, string>) => {
  const p = join(mkdtempSync(join(pracovni, "env-")), ".env.coolify");
  writeFileSync(p, Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  return p;
};
// eslint-disable-next-line no-control-regex
const bezBarev = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "");

describe("producent: příznak zavřeného edge je struktura, ne věta", () => {
  test("měřidlo: výklad vady KNOCK_UPSTREAM řetězec EDGE_DOOR_MODE=enforce OBSAHUJE (past existuje)", () => {
    const r = vadyDveri((k: string) => OFF_S_VADOU_UPSTREAMU[k]);
    expect(r.vady.join("\n"), "bez téhle věty by brána měřila nic").toMatch(/EDGE_DOOR_MODE=enforce/);
    expect(r.zavrenyEdgeBezDveri, "režim off edge nezavírá").toBe(false);
  });

  test("enforce bez deklarovaných dveří → příznak ano; enforce s dveřmi → ne", () => {
    expect(vadyDveri((k: string) => ENFORCE_BEZ_DVERI[k]).zavrenyEdgeBezDveri).toBe(true);
    const sDvermi = { ...OFF_S_VADOU_UPSTREAMU, EDGE_DOOR_MODE: "enforce", KNOCK_UPSTREAM: knockUpstream(PREFIX) };
    expect(vadyDveri((k: string) => sDvermi[k]).zavrenyEdgeBezDveri).toBe(false);
  });

  test("CLI --soulad: kód podle příznaku; doktor zná TUTÉŽ hodnotu", () => {
    const kod = (o: Record<string, string>) =>
      spawnSync(process.execPath, [SOULAD, "--soulad", "--env-file", envSoubor(o)], { encoding: "utf-8" }).status;
    expect(kod(OFF_S_VADOU_UPSTREAMU), "vada bez zavřeného edge je 1").toBe(1);
    expect(kod(ENFORCE_BEZ_DVERI)).toBe(KOD_ZAVRENY_EDGE);
    const v = /^DVERE_KOD_ZAVRENY_EDGE=(\d+)$/m.exec(readFileSync(DOKTOR, "utf-8"));
    expect(v, "doktor kód zavřeného edge nedeklaruje").not.toBeNull();
    expect(Number(v![1]), "doktor a producent se na kódu rozešli").toBe(KOD_ZAVRENY_EDGE);
  });
});

describe("oddíl dveří: skutečný doktor", () => {
  /** Doktor jen s fází B (bez sítě) — oddíl dveří běží vždy, ENV_FILE je syntetický. */
  function doktor(o: Record<string, string>) {
    const env: Record<string, string | undefined> = {
      ...process.env,
      ENV_FILE: envSoubor(o),
      // Izolace identity a pověření jako v cold-start-doctor.gate.test.ts:
      // doktor nesmí sáhnout na operátorské soubory tohoto stroje.
      AISHA_PROD_BACKUP_FILE: "/dev/null",
      AISHA_ENV_LOCAL_FILE: "/dev/null",
      AISHA_IDENTITY_ROOT: mkdtempSync(join(pracovni, "identita-")),
      COOLIFY_API_KEY: "",
      COOLIFY_API_TOKEN: "",
      COOLIFY_URL: "",
      COOLIFY_BASE_URL: "",
      SOURCE_API_URL: "",
    };
    // Identitu nese jen ENV_FILE — zděděná z terminálu by si s ním odporovala.
    delete env.APP_NAME_PREFIX;
    delete env.AISHA_STORY;
    const r = spawnSync("bash", [DOKTOR, "--phase", "B", "--no-network"], { cwd: ROOT, encoding: "utf-8", env });
    const out = bezBarev((r.stdout ?? "") + (r.stderr ?? ""));
    const oddil = out.slice(out.indexOf("Dveře (SPA knock)"));
    expect(oddil.length, `doktor oddíl dveří nevypsal:\n${out}`).toBeGreaterThan(20);
    return { kod: r.status, out, oddil };
  }

  test("režim off + vada KNOCK_UPSTREAM, jejíž výklad zmiňuje enforce → ŽÁDNÝ FATAL, vada zůstává varováním", () => {
    const r = doktor(OFF_S_VADOU_UPSTREAMU);
    expect(r.oddil, "falešný FATAL — verdikt se četl z textu výkladu").not.toContain(`✗ Dveře: ${FATAL}`);
    expect(r.oddil, "vada se nesmí ztratit — jen nesmí být FATAL").toMatch(/⚠ Dveře: deklarace a hodnoty v .* nejsou v souladu/);
    expect(r.oddil).toMatch(/KNOCK_UPSTREAM nemíří/);
    expect(r.kod, `doktor skončil jako nepřipravený:\n${r.oddil}`).not.toBe(1);
  });

  test("kontrolní vzorek: enforce bez deklarovaných dveří → FATAL, exit 1", () => {
    const r = doktor(ENFORCE_BEZ_DVERI);
    expect(r.oddil).toContain(`✗ Dveře: ${FATAL}`);
    expect(r.kod).toBe(1);
  });
});

describe("fáze P: skutečné měření na aplikaci → skutečný verdikt doktoru", () => {
  const PROJEKT = "projekt-uuid";
  const EDGE = {
    uuid: "edge-uuid",
    name: `${PREFIX}-edge`,
    environment_id: 7,
    docker_compose_location: "/docker-compose.coolify-prebuilt.yml",
    build_pack: "dockercompose",
    destination: { server_id: 1 },
  };
  /** Hodnoty, se kterými compose edge jde interpolovat (UDP porty se měří taky). */
  const ZIVE = {
    MESH_ENABLED: "false",
    NETBIRD_PEER_CIDR: "100.64.0.0/10",
    NETBIRD_DNS_IP: "192.0.2.250",
    MESH_TLD: "mesh.test",
  };

  /** Atrapa Coolify API (jen čtení) nad envy aplikace edge. */
  async function sAtrapou<T>(envyEdge: Record<string, string>, fn: (url: string) => Promise<T>): Promise<T> {
    const server: Server = createServer((req, res) => {
      const cesta = (req.url ?? "").replace(/^\/api\/v1/, "");
      const telo =
        cesta === `/projects/${PROJEKT}`
          ? { uuid: PROJEKT, environments: [{ id: 7 }] }
          : cesta === "/applications"
            ? [EDGE]
            : cesta === `/applications/${EDGE.uuid}/envs`
              ? Object.entries(envyEdge).map(([key, value]) => ({ key, value, is_preview: false }))
              : null;
      res.writeHead(telo === null ? 404 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify(telo ?? { message: `atrapa nezná ${cesta}` }));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    try {
      return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  }

  /** `dvere-soulad.mjs --coolify` tak, jak ho volá fáze P. */
  function mereni(url: string, sot: Record<string, string>): Promise<{ vypis: string; kod: number }> {
    return new Promise((hotovo) => {
      execFile(
        process.execPath,
        [SOULAD, "--coolify", "--prefix", PREFIX, "--env-file", envSoubor(sot)],
        {
          encoding: "utf-8",
          timeout: 60_000,
          // VŠECHNY kanály adresy a pověření míří na atrapu — COOLIFY_BASE_URL
          // má v CLI přednost, zděděný z terminálu by poslal dotazy na ostrý Coolify.
          env: {
            ...process.env,
            COOLIFY_BASE_URL: url,
            COOLIFY_URL: url,
            COOLIFY_API_TOKEN: "atrapa",
            COOLIFY_API_KEY: "atrapa",
            COOLIFY_PROJECT_UUID: PROJEKT,
            APP_NAME_PREFIX: PREFIX,
          },
        },
        (err, stdout, stderr) => {
          const kod = err ? (typeof err.code === "number" ? err.code : 99) : 0;
          hotovo({ vypis: `${stdout}${stderr}`, kod });
        },
      );
    });
  }

  /**
   * Skutečná funkce doktoru (vyříznutá) nad výpisem a kódem; vrátí FAIL/WARN
   * důvody. ok/warn/fail jsou v doktoru jen výpis + čítač — tady je zaznamenají.
   */
  function verdikt(vypis: string, kod: number) {
    const soubor = join(mkdtempSync(join(pracovni, "vypis-")), "out");
    writeFileSync(soubor, vypis);
    const skript = String.raw`
      set -uo pipefail
      ok() { :; }; info() { :; }
      fail() { printf 'FAIL\t%s\n' "$*"; }
      warn() { printf 'WARN\t%s\n' "$*"; }
      eval "$(grep -E '^DVERE_(KOD|FATAL)_ZAVRENY_EDGE=' "$DOKTOR")"
      eval "$(sed -n '/^dvere_na_aplikaci_verdikt() {/,/^}/p' "$DOKTOR")"
      dvere_na_aplikaci_verdikt "$VYPIS" "$KOD"
    `;
    const r = spawnSync("bash", ["-c", skript], {
      encoding: "utf-8",
      env: { ...process.env, DOKTOR, VYPIS: soubor, KOD: String(kod) },
    });
    expect(r.status, `verdikt doktoru neproběhl:\n${r.stderr}`).toBe(0);
    const radky = r.stdout.split("\n").filter(Boolean);
    return {
      fail: radky.filter((l) => l.startsWith("FAIL\t")).map((l) => l.slice(5)),
      warn: radky.filter((l) => l.startsWith("WARN\t")).map((l) => l.slice(5)),
    };
  }

  test("režim off + vada KNOCK_UPSTREAM na aplikaci → ŽÁDNÝ FATAL, jen varování", async () => {
    const m = await sAtrapou({ ...ZIVE, ...OFF_S_VADOU_UPSTREAMU, COMPOSE_PROFILES: "knock" }, (url) =>
      mereni(url, { EDGE_COMPOSE_PROFILES: "knock" }),
    );
    expect(m.vypis, "měřidlo: výpis vadu s větou o enforce nese").toMatch(/^✗ vada: .*KNOCK_UPSTREAM.*EDGE_DOOR_MODE=enforce/m);
    expect(m.kod).toBe(1);
    const v = verdikt(m.vypis, m.kod);
    expect(v.fail, "falešný FATAL — verdikt se četl z textu výkladu").toEqual([]);
    expect(v.warn.join("\n")).toMatch(/Dveře na aplikaci: .*KNOCK_UPSTREAM nemíří/);
  });

  test("kontrolní vzorek: enforce bez deklarovaných dveří na aplikaci → FATAL", async () => {
    const m = await sAtrapou({ ...ZIVE, ...ENFORCE_BEZ_DVERI, COMPOSE_PROFILES: "" }, (url) =>
      mereni(url, { EDGE_COMPOSE_PROFILES: "" }),
    );
    expect(m.kod, `výpis:\n${m.vypis}`).toBe(KOD_ZAVRENY_EDGE);
    const v = verdikt(m.vypis, m.kod);
    expect(v.fail).toEqual([`Dveře na aplikaci: ${FATAL} — edge by se zavřel a verdikt by neměl kdo dát`]);
  });

  test("obě místa doktoru volají verdikt s KÓDEM měření", () => {
    const kod = readFileSync(DOKTOR, "utf-8")
      .split("\n")
      .filter((r) => !/^\s*#/.test(r))
      .join("\n");
    expect(kod).toMatch(/dvere_na_aplikaci_verdikt "\$_p_out" "\$_p_rc"/);
    expect(kod).toMatch(/dvere_soulad_verdikt "\$__dvere_out" "\$__dvere_rc"/);
  });
});
