/**
 * CI nasazuje dotčené aplikace PO VLNÁCH — týmž řádem jako cold-start.
 *
 * ⛔ NAMĚŘENO 2026-09-16: po merge #993 detektor označil 11 aplikací se změněnou
 * stavbou, CI mělo úlohu jen pro část z nich a baseline `stack-bez-deploy-ulohy`
 * vedla 22 stacků jako „nasazují se ručně". Majitel: „nasadit nechceme nic ručně,
 * ale vše automaticky" — všechny dotčené stacky, ve vlnách, trezor mimo CI.
 *
 * ⭐ Brána SPOUŠTÍ `scripts/ci/nasad-podle-vln.sh` nad SKUTEČNÝM pořadím
 * (`aisha-redeploy.mjs --print-waves` — pole WAVES, ze kterého nasazuje
 * cold-start) a s podvrženým `deploy-and-verify.sh`, který jen zapisuje, koho
 * a kdy nasadil. Měří se chování, ne text skriptu.
 */
import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";

const ROOT = process.cwd();
let repo: string;
let vlnaApp: Map<string, number>;

beforeAll(() => {
  // Pořadí z reality: tentýž výstup, který v CI čte skript.
  const poradi = execFileSync(process.execPath, [join(ROOT, "scripts/aisha-redeploy.mjs"), "--print-waves"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  vlnaApp = new Map(
    poradi.trim().split("\n").map((r) => {
      const [cislo, app] = r.split("\t");
      return [app, Number(cislo)] as [string, number];
    }),
  );

  repo = mkdtempSync(join(tmpdir(), "nasad-podle-vln-"));
  mkdirSync(join(repo, "scripts/ci"), { recursive: true });
  copyFileSync(join(ROOT, "scripts/ci/nasad-podle-vln.sh"), join(repo, "scripts/ci/nasad-podle-vln.sh"));
  writeFileSync(
    join(repo, "scripts/aisha-redeploy.mjs"),
    `if (!process.argv.includes("--print-waves")) process.exit(9);\nprocess.stdout.write(${JSON.stringify(poradi)});\n`,
  );
  const stub = join(repo, "scripts/ci/deploy-and-verify.sh");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env bash",
      'echo "$1 $2" >> "$ZAPIS"',
      'case ",${SELZE:-}," in *",$1,"*) echo "selhalo $1"; exit 1 ;; esac',
      'case ",${NEDOBEHNE:-}," in *",$1,"*) echo "::error title=nasazení NEDOBĚHLO V ČASE::$1"; exit 4 ;; esac',
      'case ",${CHYBI:-}," in *",$1,"*) echo "::warning title=appka není nasazena::\'$1\' v Coolify není"; exit 0 ;; esac',
      'echo "nasazeno $1"',
    ].join("\n") + "\n",
  );
  chmodSync(stub, 0o755);
});

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

function spust(args: string[], env: Record<string, string> = {}) {
  const zapis = join(repo, `zapis-${process.hrtime.bigint()}.txt`);
  const r = spawnSync("bash", ["scripts/ci/nasad-podle-vln.sh", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: envWithoutGitLocation({ PATH: process.env.PATH ?? "", ZAPIS: zapis, ...env }),
    timeout: 30_000,
  });
  const volani = existsSync(zapis) ? readFileSync(zapis, "utf8").trim().split("\n").filter(Boolean) : [];
  return { rc: r.status, vystup: `${r.stdout}\n${r.stderr}`, volani, aplikace: volani.map((v) => v.split(" ")[0]) };
}

describe("CI nasazuje po vlnách (nasad-podle-vln.sh)", () => {
  test("pořadí z reality není prázdné a obsahuje kořen i konzumenty", () => {
    expect(vlnaApp.size, "--print-waves nevydal aplikace — brána by měřila prázdno").toBeGreaterThan(10);
    for (const app of ["pki", "core", "keycloak", "ai-chat"]) expect(vlnaApp.has(app), app).toBe(true);
    expect(vlnaApp.get("pki")!).toBeLessThan(vlnaApp.get("ai-chat")!);
  });

  test("aplikace se nasazují ve vzestupném pořadí vln, každá s --optional", () => {
    const cile = ["ai-chat", "keycloak", "pki", "exec", "core"];
    const r = spust(["--aplikace", `,${cile.join(",")},`]);
    expect(r.rc, r.vystup).toBe(0);
    expect([...r.aplikace].sort()).toEqual([...cile].sort());
    const vlny = r.aplikace.map((a) => vlnaApp.get(a)!);
    expect(vlny, `pořadí ${r.aplikace.join(" → ")}`).toEqual([...vlny].sort((a, b) => a - b));
    for (const v of r.volani) expect(v.endsWith(" --optional"), v).toBe(true);
  });

  test("--vynech: aplikaci s vlastní úlohou nenasadí a souhrn to řekne", () => {
    const r = spust(["--aplikace", "core,ai-chat", "--vynech", "core"]);
    expect(r.rc, r.vystup).toBe(0);
    expect(r.aplikace).toEqual(["ai-chat"]);
    expect(r.vystup).toContain("core: nasazuje vlastní úloha");
  });

  test("--vlny omezí rozsah: kořen 0-2 a zbytek 3- se doplňují beze zbytku", () => {
    const cile = "pki,registry,core,keycloak,ai-chat,exec";
    const koren = spust(["--aplikace", cile, "--vlny", "0-2"]);
    const zbytek = spust(["--aplikace", cile, "--vlny", "3-"]);
    expect(koren.rc, koren.vystup).toBe(0);
    expect(zbytek.rc, zbytek.vystup).toBe(0);
    for (const a of koren.aplikace) expect(vlnaApp.get(a)!, a).toBeLessThanOrEqual(2);
    for (const a of zbytek.aplikace) expect(vlnaApp.get(a)!, a).toBeGreaterThanOrEqual(3);
    expect([...koren.aplikace, ...zbytek.aplikace].sort()).toEqual(cile.split(",").sort());
  });

  test("⛔ selhání ve vlně zastaví další vlny", () => {
    const r = spust(["--aplikace", "pki,core,ai-chat"], { SELZE: "core" });
    expect(r.rc).toBe(1);
    expect(r.aplikace).toContain("core");
    expect(r.aplikace, "po selhání vlny se nesmí nasazovat dál").not.toContain("ai-chat");
    expect(r.vystup).toMatch(/vlna \d+ selhala/);
  });

  test("⛔ nedoběhlo v čase (kód 4) NENÍ selhání — souhrn to řekne, ale další vlny stojí", () => {
    // NAMĚŘENO 2026-09-24 (běh 51874, vlna 7): tři aplikace po 1800 s stále
    // in_progress/queued → CI „SELHALO"; Coolify je všechny dokončil úspěšně.
    const r = spust(["--aplikace", "pki,core,ai-chat"], { NEDOBEHNE: "core" });
    expect(r.rc, "nejistota = STOP: úloha nesmí zezelenat").toBe(1);
    expect(r.aplikace, "neznámý výsledek závislosti = další vlny se nenasazují").not.toContain("ai-chat");
    expect(r.vystup).toMatch(/core: NEDOBĚHLO V ČASE — výsledek NEZNÁMÝ/);
    expect(r.vystup, "nedoběhlé nasazení se nesmí vydávat za selhání").not.toMatch(/core: SELHALO/);
    expect(r.vystup).toMatch(/vlna \d+ nedoběhla v čase/);
    // Jak pokračovat po ověření: od DALŠÍ vlny, ne vše znovu.
    const vlnaCore = /vlna (\d+) {2}core: NEDOBĚHLO/.exec(r.vystup)?.[1];
    expect(r.vystup).toContain(`--vlny ${Number(vlnaCore) + 1}-`);
  });

  // Od 2026-09-26 má fronta a práce každá svůj strop i svou hlášku, tedy dvě větve.
  // CHOVÁNÍ (virtuální hodiny, podstrčený Coolify) měří `nasazeni-fronta-neni-prace`;
  // tady jen, že obě větve po vypršení opravdu končí kódem 4.
  test("deploy-and-verify: po vypršení čekání ve frontě (queued) i v práci (in_progress) končí kódem 4, ne 1", () => {
    const kod = readFileSync(join(ROOT, "scripts/ci/deploy-and-verify.sh"), "utf8")
      .split("\n")
      .filter((r) => !r.trim().startsWith("#"))
      .join("\n");
    const znacka = '[ "$STAV" = "opakovat" ] && return 0';
    const po = kod.includes(znacka) ? kod.slice(kod.indexOf(znacka)) : "";
    const vetve = ["queued", "in_progress"].map((s) => new RegExp(`\\n\\s*${s}\\)([\\s\\S]*?);;`).exec(po)?.[1] ?? "");
    expect(vetve.map((v) => ({ vetev: v.length > 0, kod4: /\bexit 4\b/.test(v) }))).toEqual([
      { vetev: true, kod4: true },
      { vetev: true, kod4: true },
    ]);
  });

  test("⛔ aplikace bez vlny: nenasadí se NIC", () => {
    const r = spust(["--aplikace", "core,neexistujici-aplikace"]);
    expect(r.rc).toBe(1);
    expect(r.volani, "hádané pořadí se nesmí ani začít").toEqual([]);
    expect(r.vystup).toContain("neexistujici-aplikace");
  });

  test("volitelná aplikace, která v Coolify není, NENÍ v souhrnu „ověřena“", () => {
    const r = spust(["--aplikace", "exec"], { CHYBI: "exec" });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vystup).toContain("exec: NENASAZENO");
    expect(r.vystup).not.toContain("exec: nasazeno a ověřeno");
  });

  test("prázdný seznam: nic se nenasadí a úloha nespadne", () => {
    const r = spust(["--aplikace", ",,"]);
    expect(r.rc, r.vystup).toBe(0);
    expect(r.volani).toEqual([]);
  });
});
