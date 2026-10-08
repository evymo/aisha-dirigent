/**
 * generate-secrets: tajemství modelového meshe forku jsou STAVOVÁ jen tam, kde jeho stack UŽ STOJÍ.
 *
 * ⛔ NAMĚŘENO 2026-10-06 (suchý `cold-start --skip-create` nad main ≥ e5d41c82f, fork bez
 * modelového meshe): NETBIRD_MODEL_* se vyráběla nepodmíněně jako stavová, takže nad existujícím
 * stackem bez vstupu závora „stavová tajemství bez vstupu“ odmítla běh — konvergence každého forku
 * padla v kroku 2, i tam, kde lane modelového meshe vůbec není.
 *
 * Měří se skutečným během generátoru (proces, návratový kód, výstup), ne čtením zdroje:
 * základem je úplné prostředí z běhu bez `--stack-exists`, ze kterého se tajemství modelového meshe
 * odeberou — všechno ostatní je tedy „zachované“ a závora může mluvit jen o nich.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = mkdtempSync(join(tmpdir(), "gen-modelovy-mesh-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const TAJEMSTVI = [
  "NETBIRD_MODEL_OIDC_SECRET",
  "NETBIRD_MODEL_MGMT_SECRET",
  "NETBIRD_MODEL_RELAY_SECRET",
  "NETBIRD_MODEL_DATASTORE_ENC_KEY",
  "NETBIRD_MODEL_DB_PASSWORD",
];

/** Prostředí běhu bez proměnných, které by generátor přečetl z prostředí testu. */
function prostredi(lane) {
  const env = { ...process.env, APP_NAME_PREFIX: "aisha" };
  for (const k of Object.keys(env)) if (k.startsWith("NETBIRD_MODEL_") || k === "MODEL_MESH" || k === "AISHA_STACK_EXISTS" || k === "AISHA_MODEL_MESH_STACK_EXISTS") delete env[k];
  if (lane !== undefined) env.MODEL_MESH = lane;
  return env;
}

function spust(zaloha, args, lane) {
  const backup = join(TMP, `backup-${Math.random().toString(36).slice(2)}`);
  const coolify = join(TMP, `coolify-${Math.random().toString(36).slice(2)}`);
  writeFileSync(backup, zaloha.join("\n") + "\n");
  writeFileSync(coolify, "\n");
  return spawnSync(process.execPath, [join(ROOT, "scripts/generate-secrets.mjs"), "--preserve=1", `--env-backup=${backup}`, `--env-coolify=${coolify}`, ...args], {
    cwd: ROOT,
    env: prostredi(lane),
    encoding: "utf8",
  });
}
const hodnota = (out, k) => new RegExp(`^${k}='?([^'\\n]*)'?$`, "m").exec(out)?.[1];

/** Úplné prostředí instance BEZ tajemství modelového meshe (KEY=hodnota, bez uvozovek shellu). */
let zaklad = [];
beforeAll(() => {
  const r = spust([], [], "");
  expect(r.status, r.stderr).toBe(0);
  zaklad = r.stdout
    .split("\n")
    .map((l) => /^([A-Z][A-Z0-9_]*)='?([^']*)'?$/.exec(l))
    .filter((m) => m && m[2] !== "" && !m[1].startsWith("NETBIRD_MODEL_"))
    .map((m) => `${m[1]}=${m[2]}`);
  expect(zaklad.length, "základ prostředí je prázdný — test by nic neměřil").toBeGreaterThan(50);
});

describe("generate-secrets: tajemství modelového meshe stavová jen se stojícím stackem", () => {
  test("kotva: základ prostředí sám nad existujícím stackem projde (závora mluví jen o modelovém meshi)", () => {
    const r = spust(zaklad, ["--stack-exists=1"], "");
    expect(r.status, r.stderr).toBe(0);
  });

  test("lane ZAVŘENÁ + existující stack bez vstupu → projde, tajemství se nevyrábějí (regrese 2026-10-06)", () => {
    const r = spust(zaklad, ["--stack-exists=1"], "");
    expect(r.status, r.stderr).toBe(0);
    // vydá se PRÁZDNÝ: heredoc cold-startu klíč váže a nevázaný by zápis .env.coolify přerušil
    for (const k of TAJEMSTVI) expect(hodnota(r.stdout, k), `${k} se při zavřené lane vyrobil`).toBe("");
    expect(r.stderr).not.toMatch(/ODMÍTÁM/);
  });

  test("lane ZAVŘENÁ, hodnota z minula existuje → zachová se beze změny", () => {
    const stara = "zachovane-heslo-db-modeloveho-meshe-0123456789";
    const r = spust([...zaklad, `NETBIRD_MODEL_DB_PASSWORD=${stara}`], ["--stack-exists=1"], "");
    expect(r.status, r.stderr).toBe(0);
    expect(hodnota(r.stdout, "NETBIRD_MODEL_DB_PASSWORD")).toBe(stara);
  });

  test("lane OTEVŘENÁ + stack modelového meshe STOJÍ + bez vstupu → odmítne nahlas (jako dřív)", () => {
    const r = spust(zaklad, ["--stack-exists=1", "--model-mesh-stack-exists=1"], "gpu");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ODMÍTÁM/);
    expect(r.stderr).toMatch(/NETBIRD_MODEL_DB_PASSWORD/);
  });

  test("lane OTEVŘENÁ + stack modelového meshe změřeně NESTOJÍ → první výroba (silné hodnoty)", () => {
    const r = spust(zaklad, ["--stack-exists=1", "--model-mesh-stack-exists=0"], "gpu");
    expect(r.status, r.stderr).toBe(0);
    for (const k of TAJEMSTVI) expect(hodnota(r.stdout, k)?.length ?? 0, k).toBeGreaterThanOrEqual(32);
  });

  test("lane OTEVŘENÁ + existence stacku NEZMĚŘENÁ → fail-closed (odmítne)", () => {
    const r = spust(zaklad, ["--stack-exists=1"], "gpu");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ODMÍTÁM/);
  });

  test("lane NEODVOZENÁ (MODEL_MESH chybí) → fail-closed (odmítne)", () => {
    const r = spust(zaklad, ["--stack-exists=1"], undefined);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ODMÍTÁM/);
  });

  test("neplatná hodnota přepínače → kód 2, nic se nevyrobí", () => {
    const r = spust(zaklad, ["--stack-exists=1", "--model-mesh-stack-exists=ano"], "gpu");
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
  });
});

/**
 * Doktor (fáze C) pouští týž generátor nad existujícím stackem bez zápisu. Pod cold-startem
 * dědí MODEL_MESH z topologie; samostatně spuštěný si ho musí vzít z TÉŽE derivace — jinak
 * hlásil falešný FATAL na NETBIRD_MODEL_* i u forku bez lane (naměřeno 2026-10-06).
 */
// Každý případ pouští celou fázi C doktora (bash + derivace topologie + generátor, 3× node).
// Na sdíleném runneru CI pod zátěží 5,2–5,7 s — nad výchozím stropem vitestu 5 s (naměřeno
// 2026-10-06, PR dávky 7b, job „Web: Brány“: tytéž tři případy „timed out in 5000ms“).
// Strop výslovně, jako u ostatních sond doktora (umisteni-slotu.test.mjs, STROP_MS).
const STROP_DOKTORA_MS = 60_000;
describe("doktor: odmítnutá tajemství měří s lane modelového meshe z topologie", () => {
  const ID = mkdtempSync(join(TMP, "identita-"));
  const OK = "generate-secrets nad existujícím stackem nic neodmítne";
  function doktor({ lane, profil }) {
    const soubor = join(TMP, `doktor-env-${Math.random().toString(36).slice(2)}`);
    const radky = zaklad.map((l) => l.replace(/^([A-Z0-9_]+)=(.*)$/, "$1='$2'"));
    if (profil) radky.push(`AISHA_PROFILE=${profil}`);
    writeFileSync(soubor, radky.join("\n") + "\n");
    const env = prostredi(lane);
    for (const k of ["AISHA_PROFILE", "COOLIFY_API_KEY", "COOLIFY_API_TOKEN", "COOLIFY_URL", "FORGEJO_TOKEN", "FORGEJO_API_TOKEN"]) delete env[k];
    Object.assign(env, { ENV_FILE: soubor, AISHA_PROD_BACKUP_FILE: soubor, AISHA_ENV_LOCAL_FILE: "/dev/null", AISHA_IDENTITY_ROOT: ID });
    const r = spawnSync("bash", [join(ROOT, "scripts/cold-start-doctor.sh"), "--phase", "C", "--stack-exists", "--no-network"], { cwd: ROOT, env, encoding: "utf8" });
    return (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  }

  test("samostatný doktor, profil bez modelu na GPU (lane zavřená) → nic neodmítne (regrese 2026-10-06)", () => {
    const out = doktor({ lane: undefined, profil: "cloud-single" });
    expect(out).toContain(OK);
    expect(out).not.toMatch(/ODMÍTNE stavová tajemství bez vstupu \([^)]*NETBIRD_MODEL_/);
  }, STROP_DOKTORA_MS);

  test("lane zděděná z cold-startu prázdná → nic neodmítne", () => {
    expect(doktor({ lane: "", profil: "cloud-single" })).toContain(OK);
  }, STROP_DOKTORA_MS);

  test("lane zděděná OTEVŘENÁ vyhraje nad derivací; stack doktor neměří → stavová, odmítne", () => {
    const out = doktor({ lane: "gpu", profil: "cloud-single" });
    expect(out).toMatch(/ODMÍTNE stavová tajemství bez vstupu \([^)]*NETBIRD_MODEL_DB_PASSWORD/);
  }, STROP_DOKTORA_MS);

  test("profil nedeklarovaný → topologie lane nevydá → fail-closed, odmítne", () => {
    const out = doktor({ lane: undefined, profil: "" });
    expect(out).toMatch(/ODMÍTNE stavová tajemství bez vstupu \([^)]*NETBIRD_MODEL_/);
  }, STROP_DOKTORA_MS);
});

/**
 * Doktor (fáze C) MĚŘÍ existenci stacku modelového meshe jen čtením — tutéž otázku klade
 * cold-start v kroku 1 (aplikace netbird-model v rozsahu projektu). Bez měření byla tajemství
 * NETBIRD_MODEL_* stavová a doktor hlásil FATAL u PRVNÍ konvergence s otevřenou lane, kdy
 * stack ještě nestojí (naměřeno 2026-10-06, suchý běh guru). Atrapa Coolify odpovídá
 * na projekt a seznam aplikací; spawn je asynchronní, aby atrapa v témže procesu odpověděla.
 */
describe("doktor: existenci stacku modelového meshe měří přes Coolify (atrapa API)", () => {
  const ID = mkdtempSync(join(TMP, "identita-site-"));
  const OK = "generate-secrets nad existujícím stackem nic neodmítne";
  const ODMITNE = /ODMÍTNE stavová tajemství bez vstupu \([^)]*NETBIRD_MODEL_/;
  async function doktorSCoolify(aplikace, { selhat = false } = {}) {
    const server = createServer((req, res) => {
      const u = (req.url || "").split("?")[0];
      const json = (kod, telo) => { res.writeHead(kod, { "content-type": "application/json" }); res.end(JSON.stringify(telo)); };
      if (selhat) return json(500, { message: "atrapa selhala" });
      if (/\/projects\/p-zkouska$/.test(u)) return json(200, { uuid: "p-zkouska", environments: [{ id: 7 }] });
      if (/\/applications$/.test(u)) return json(200, aplikace.map((name, i) => ({ name, uuid: `u${i}`, environment_id: 7 })));
      return json(404, {});
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const soubor = join(TMP, `doktor-site-env-${Math.random().toString(36).slice(2)}`);
      writeFileSync(soubor, [...zaklad.map((l) => l.replace(/^([A-Z0-9_]+)=(.*)$/, "$1='$2'")), "AISHA_PROFILE=cloud-single"].join("\n") + "\n");
      const env = prostredi("gpu");
      for (const k of ["AISHA_PROFILE", "COOLIFY_API_KEY", "FORGEJO_TOKEN", "FORGEJO_API_TOKEN"]) delete env[k];
      Object.assign(env, {
        ENV_FILE: soubor, AISHA_PROD_BACKUP_FILE: soubor, AISHA_ENV_LOCAL_FILE: "/dev/null", AISHA_IDENTITY_ROOT: ID,
        COOLIFY_URL: `http://127.0.0.1:${server.address().port}`, COOLIFY_API_TOKEN: "zkouska", COOLIFY_PROJECT_UUID: "p-zkouska",
      });
      return await new Promise((resolve) => {
        const p = spawn("bash", [join(ROOT, "scripts/cold-start-doctor.sh"), "--phase", "C", "--stack-exists"], { cwd: ROOT, env });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (out += d));
        p.on("close", () => resolve(out.replace(/\x1b\[[0-9;]*m/g, "")));
      });
    } finally {
      server.close();
    }
  }

  test("lane otevřená, stack ZMĚŘENĚ nestojí (bez aplikace netbird-model) → nic neodmítne, krok 2 je vyrobí", async () => {
    const out = await doktorSCoolify(["aisha-core", "aisha-edge"]);
    expect(out).toContain(OK);
    expect(out).not.toMatch(ODMITNE);
  }, STROP_DOKTORA_MS);

  test("lane otevřená, stack STOJÍ (aplikace netbird-model v projektu) → stavová, bez vstupu odmítne", async () => {
    expect(await doktorSCoolify(["aisha-core", "aisha-netbird-model"])).toMatch(ODMITNE);
  }, STROP_DOKTORA_MS);

  test("API Coolify selže → existence NEZMĚŘENA → fail-closed, odmítne (ne „nestojí“)", async () => {
    expect(await doktorSCoolify([], { selhat: true })).toMatch(ODMITNE);
  }, STROP_DOKTORA_MS);
});
