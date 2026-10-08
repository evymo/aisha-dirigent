import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Táž funkce jako coolify-sync-envs v kroku 4 (assert_placement_agrees), jen dřív.
const KOREN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKRIPT = join(KOREN, "scripts/lib/umisteni-souhlasi.sh");
const MANIFEST = join(KOREN, "coolify/manifests/aisha.manifest");

let d;
let prazdnyEnv;
const spust = (manifest, env = {}) =>
  spawnSync("bash", [SKRIPT, manifest], {
    encoding: "utf8",
    env: { ...process.env, AISHA_PROFILE: "cloud-multi", ENV_FILE: prazdnyEnv, ...env },
  }, 60_000);

beforeAll(() => {
  d = mkdtempSync(join(tmpdir(), "umisteni-"));
  prazdnyEnv = join(d, "prazdny.env");
  writeFileSync(prazdnyEnv, "");
});
afterAll(() => d && rmSync(d, { recursive: true, force: true }));

describe("umisteni-souhlasi.sh", () => {
  it("repo manifest × výchozí profil souhlasí (kontrolní vzorek)", () => {
    const r = spust(MANIFEST);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/umístění souhlasí: \d+ aplikací/);
  }, 60_000);

  it("negativní sonda: přesunutá aplikace v manifestu → rozpor (1) s výpisem", () => {
    // ⛔ NAMĚŘENO 2026-10-06 (CI PR #1160, job Web: Brány): sonda přesunula PRVNÍ řádek
    // frontend/backend (registry) a kontrola vrátila 0 — místně v čistém prostředí 1. Příčinu
    // výpis neukázal (status bez stdout/stderr). Sonda proto přesouvá aplikaci, kterou kontrola
    // v TÉMŽE prostředí opravdu porovná (derivace pro ni vydá `<ID>_PLACEMENT`), a při selhání
    // vypíše celý výstup kontroly — měří vlastnost, ne náhodu prvního řádku.
    // ⛔ NAMĚŘENO 2026-10-07 (riq main 390d72562, push běh 1808): ani to nestačilo. Derivace testu
    // `REGISTRY_PLACEMENT` vydala, a kontrola přesto hlásila „souhlasí“, protože o tom, CO kontrola
    // porovná, rozhoduje i její vlastní mapa manifestu (brány provisioningu, vlastnictví) v prostředí
    // runneru. Místně 4/4 i v `env -i`. Seznam porovnaných aplikací proto vydává SAMA kontrola
    // (`s profilem porovnáno N: …`) a sonda přesouvá jen aplikaci z něj.
    const text = readFileSync(MANIFEST, "utf8");
    const kotva = spust(MANIFEST);
    expect(kotva.status, `kontrola nad repo manifestem nesouhlasí:\n${kotva.stdout}\n${kotva.stderr}`).toBe(0);
    const vypis = /s profilem porovnáno (\d+): ([^)]*)\)/.exec(kotva.stdout);
    expect(vypis, `kontrola nevydala seznam porovnaných aplikací:\n${kotva.stdout}`).toBeTruthy();
    const porovnane = new Set(vypis[2].split(",").filter(Boolean));
    expect(porovnane.size, "kontrola v tomto prostředí neporovnala s profilem nic — sonda nemá co přesunout (měřidlo osiřelo)").toBeGreaterThan(0);
    const radek = text.split("\n").find((r) => {
      const m = /^app:\s*([\w-]+):(frontend|backend):/.exec(r);
      return m && porovnane.has(m[1]);
    });
    expect(radek, `žádná porovnaná app (${[...porovnane].join(",")}) není v manifestu na frontend/backend — sonda nemá co přesunout`).toBeTruthy();
    const [, app, slot] = /^app:\s*([\w-]+):(frontend|backend):/.exec(radek);
    const jiny = slot === "frontend" ? "backend" : "frontend";
    const mutace = join(d, "mutace.manifest");
    writeFileSync(mutace, text.replace(radek, radek.replace(`${app}:${slot}:`, `${app}:${jiny}:`)));
    const r = spust(mutace);
    expect(r.status, `přesun ${app} ${slot}→${jiny} kontrola nepoznala:\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/UMÍSTĚNÍ SE NESHODUJE/);
    expect(r.stderr).toContain(app);
  }, 60_000);

  it("bez profilu nejde změřit → 2 (NEMĚŘENO ≠ shoda) — a hláška nese DŮVOD selhání derivace", () => {
    const r = spust(MANIFEST, { AISHA_PROFILE: "" });
    expect(r.status).toBe(2);
    // Dřív: „derive-domains --shell selhal“ bez příčiny (stderr šel do /dev/null).
    // Důvod je řádek výjimky, ne poslední řádek výstupu (ten je podpis běhového prostředí).
    expect(r.stderr).toMatch(/derive-domains --shell selhal \(kód 1\): .*AISHA_PROFILE/);
    expect(r.stderr, "do hlášky nepatří zásobník ani podpis Nodu").not.toMatch(/^\s+at |Node\.js v/m);
    expect(r.stderr.trim().split("\n"), "důvod se vejde na jeden řádek (doktor ho řeže na 300 znaků)").toHaveLength(1);
  }, 60_000);

  it("neexistující manifest → 2", () => {
    expect(spust(join(d, "neni.manifest")).status).toBe(2);
  }, 60_000);
});
