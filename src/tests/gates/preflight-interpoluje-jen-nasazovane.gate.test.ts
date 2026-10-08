/**
 * BRÁNA: preflight compose interpoluje env jen u stacků, které instance NASADÍ —
 * opt-in služba se zavřenou lane (katalog `provision_when_env`) jde jen strukturou.
 *
 * ⛔ NAMĚŘENO 2026-10-06 (suchý běh konvergence guru). Manifest guru nese firewall
 * hostitele GPU uzlu (`accel-hostfw`, opt-in: ACCEL_FW_NODE_OWNER / ACCEL_FW_SSH),
 * který story-init bez deklarace uzlu nezaloží — uzel provozuje jiná instance.
 * Preflight ho přesto interpoloval a holý `start_period: ${ACCEL_FW_CONFIRM_S}s`
 * (hodnotu vede env-doktor jen za lane) vyšel jako `s` → cold-start padl ve 2b
 * a doktor v kroku 0 za službu, která se nenasazuje. Táž třída jako 2026-06-29
 * (source-broker), tehdy opravená výjimkou; teď jedno pravidlo z jednoho domova
 * (lib/provision-gate.mjs), stejné jako mapa env a resolver topologie.
 *
 * Měří se CHOVÁNÍ skutečného `scripts/preflight-compose.sh`: místo dockeru běží
 * atrapa, která zapíše, jak byla volána — `--no-interpolate` = jen struktura,
 * `--env-file` = interpolace. Nic se nehádá z textu skriptu.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const PREFLIGHT = path.join(ROOT, "scripts/preflight-compose.sh");
const FW = "docker-compose.coolify-accel-hostfw.yml";
const PKI = "docker-compose.coolify-pki.yml";

const docasne: string[] = [];
afterAll(() => {
  for (const d of docasne) rmSync(d, { recursive: true, force: true });
});

interface Volani {
  interpolovane: string[];
  jenStruktura: string[];
  kod: number | null;
  vystup: string;
}

/** Pustí skutečný preflight nad dvěma stacky s atrapou dockeru; vrátí, jak s nimi naložil. */
function preflight(envNavic: Record<string, string>): Volani {
  const d = mkdtempSync(path.join(tmpdir(), "preflight-nasazovane-"));
  docasne.push(d);
  const bin = path.join(d, "bin");
  const overlay = path.join(d, "overlay");
  mkdirSync(bin);
  mkdirSync(path.join(overlay, "manifests"), { recursive: true });
  const log = path.join(d, "docker.log");
  // Atrapa dockeru: zapíše argumenty a uspěje (měří se ROZHODNUTÍ preflightu, ne compose).
  writeFileSync(path.join(bin, "docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 0\n`);
  chmodSync(path.join(bin, "docker"), 0o755);
  writeFileSync(
    path.join(overlay, "manifests/zkouska.manifest"),
    [`app: accel-hostfw:gpu:${FW}`, `app: pki:backend:${PKI}`, ""].join("\n"),
  );
  const env = path.join(d, ".env.coolify");
  writeFileSync(
    env,
    ["APP_NAME_PREFIX=zkouska", ...Object.entries(envNavic).map(([k, v]) => `${k}=${v}`), ""].join("\n"),
  );
  const r = spawnSync("bash", [PREFLIGHT], {
    encoding: "utf-8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      ENV_FILE: env,
      APP_NAME_PREFIX: "zkouska",
      AISHA_INSTANCE_CONFIG_DIR: overlay,
      COMPOSE_FILES: `${path.join(ROOT, FW)} ${path.join(ROOT, PKI)}`,
    },
  });
  let radky: string[] = [];
  try {
    radky = readFileSync(log, "utf-8").trim().split("\n");
  } catch {
    radky = [];
  }
  const souborVolani = (r: string) => (r.includes(FW) ? FW : r.includes(PKI) ? PKI : "?");
  return {
    interpolovane: radky.filter((x) => x.includes("--env-file")).map(souborVolani),
    jenStruktura: radky.filter((x) => x.includes("--no-interpolate")).map(souborVolani),
    kod: r.status,
    vystup: `${r.stdout}\n${r.stderr}`,
  };
}

describe("preflight interpoluje jen nasazované stacky", () => {
  test("opt-in se zavřenou lane (firewall bez deklarace uzlu) jde jen strukturou", () => {
    const v = preflight({});
    expect(v.kod, `preflight skončil kódem ${v.kod}:\n${v.vystup}`).toBe(0);
    expect(
      v.interpolovane,
      "firewall hostitele bez deklarace uzlu se interpoloval — story-init ho nezaloží, " +
        "holé ${ACCEL_FW_CONFIRM_S}s by shodilo cold-start za službu, která se nenasazuje",
    ).not.toContain(FW);
    expect(v.jenStruktura, "zavřená lane se nemá přeskočit úplně — struktura se měří dál").toContain(FW);
    expect(v.interpolovane, "služba bez opt-in podmínky se interpoluje dál").toContain(PKI);
  });

  test("kontrolní vzorek: s deklarací uzlu (lane otevřená) se firewall interpoluje", () => {
    // Bez tohohle by brána prošla i nad preflightem, který firewall neinterpoluje nikdy.
    const v = preflight({ ACCEL_FW_NODE_OWNER: "zkouska" });
    expect(v.kod, `preflight skončil kódem ${v.kod}:\n${v.vystup}`).toBe(0);
    expect(v.interpolovane, "otevřená lane — firewall se nasadí, jeho env se MUSÍ interpolovat").toContain(FW);
  });

  test("výslovné `false` lane nezapne (jeden výklad s provision-gate)", () => {
    const v = preflight({ ACCEL_FW_NODE_OWNER: "false" });
    expect(v.interpolovane).not.toContain(FW);
  });
});
