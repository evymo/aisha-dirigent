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
      'echo "$*" >> "$ZAPIS.vse"',
      'case ",${SELZE:-}," in *",$1,"*) echo "selhalo $1"; exit 1 ;; esac',
      'case ",${PREDA:-}," in *",$1,"*) echo "::warning title=předáno pokračování::$1"; exit 4 ;; esac',
      'case ",${MLCI:-}," in *",$1,"*) echo "nasazeno $1"; exit 0 ;; esac',
      'case ",${PO_OPAKOVANI:-}," in *",$1,"*) echo "::error title=pád i po opakování::$1 — spadlo i po opakování v pokračovací úloze; další opakování nepomůže, oprav příčinu. Třída: sit-registru (přechodná): ECONNRESET"; exit 1 ;; esac',
      'case " $* " in *" --navazat-od "*) echo "pokračování-výsledek: navázáno na běžící nas-$1 (in_progress) → ověřeno nasazení nas-$1" ;; esac',
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
  const vse = existsSync(`${zapis}.vse`) ? readFileSync(`${zapis}.vse`, "utf8").trim().split("\n").filter(Boolean) : [];
  const vystupy = env.GITHUB_OUTPUT && existsSync(env.GITHUB_OUTPUT) ? readFileSync(env.GITHUB_OUTPUT, "utf8") : "";
  return { rc: r.status, vystup: `${r.stdout}\n${r.stderr}`, volani, vse, vystupy, aplikace: volani.map((v) => v.split(" ")[0]) };
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

/**
 * MĚKKÝ TERMÍN A POKRAČOVÁNÍ (2026-10-01). Vlna s mnoha appkami trvá 35–49 min
 * a runner job utne na stropu UPROSTŘED operace (2026-09-30: v 60. min, vlna 8
 * nedohlídána). Vlnový job proto na měkkém termínu předá rozpracované appky
 * pokračovacímu jobu (output `predano=true`) — ale skutečná chyba appky zůstává
 * pádem a bez --predat je termín pád se seznamem (pokračování je jen jedno).
 */
describe("měkký termín a pokračování (nasad-podle-vln.sh)", () => {
  const nizsi = "keycloak";
  const vyssi = "ai-chat";
  const vystupSoubor = () => join(repo, `vystup-${process.hrtime.bigint()}.txt`);

  test("pořadí: zvolená nižší appka je opravdu v dřívější vlně než vyšší", () => {
    expect(vlnaApp.get(nizsi)!).toBeLessThan(vlnaApp.get(vyssi)!);
  });

  test("bez nových přepínačů je volání deploy-and-verify beze změny", () => {
    const r = spust(["--aplikace", `${nizsi},${vyssi}`]);
    expect(r.rc, r.vystup).toBe(0);
    for (const v of r.vse) expect(v, v).not.toMatch(/--termin|--navazat-od/);
  });

  test("termín už vypršel + --predat → nic se nespustí, všechno je NESPUŠTĚNO, předáno", () => {
    const out = vystupSoubor();
    const r = spust(["--aplikace", `${nizsi},${vyssi}`, "--mekky-termin", "1000000000", "--predat"], { GITHUB_OUTPUT: out });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.aplikace).toEqual([]);
    expect(r.vystupy).toContain("predano=true");
    expect(r.vystupy).toMatch(new RegExp(`nespustene=.*${nizsi}`));
    expect(r.vystup).toContain(`${vyssi}: NESPUŠTĚNO`);
  });

  test("rozpracovaná appka na termínu → PŘEDÁNO, další vlny se nespouští, output pro pokračování", () => {
    const out = vystupSoubor();
    const termin = String(Math.floor(Date.now() / 1000) + 3600);
    const r = spust(["--aplikace", `${nizsi},${vyssi}`, "--mekky-termin", termin, "--predat"], { GITHUB_OUTPUT: out, PREDA: nizsi });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.aplikace, "vyšší vlna závisí na rozpracované — nespouští se").not.toContain(vyssi);
    expect(r.vystup).toContain(`${nizsi}: PŘEDÁNO`);
    expect(r.vystup).toContain(`${vyssi}: NESPUŠTĚNO`);
    expect(r.vystupy).toContain("predano=true");
    expect(r.vystupy).toContain(`rozpracovane=${nizsi}`);
    expect(r.vystupy).toContain(`nespustene=${vyssi}`);
    expect(r.vse.find((v) => v.startsWith(nizsi)), "termín se předá deploy-and-verify").toContain(`--termin ${termin}`);
  });

  test("bez --predat je vypršený termín PÁD se seznamem (pokračování je jen jedno)", () => {
    const termin = String(Math.floor(Date.now() / 1000) + 3600);
    const r = spust(["--aplikace", nizsi, "--mekky-termin", termin], { PREDA: nizsi });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.vystup).toMatch(/měkký termín vypršel::nedokončeno — rozpracované: keycloak/);
  });

  test("skutečná chyba appky je pád i tehdy, když se jiná appka vlny předává", () => {
    // Dvě appky TÉŽE vlny (z reálného pořadí): jedna se předává, druhá skutečně selže.
    const poVlnach = new Map<number, string[]>();
    for (const [a, v] of vlnaApp) poVlnach.set(v, [...(poVlnach.get(v) ?? []), a]);
    const dvojice = [...poVlnach.values()].find((xs) => xs.length >= 2);
    expect(dvojice, "žádná vlna nemá dvě appky — test potřebuje dvě").toBeTruthy();
    const [predava, selze] = dvojice!;
    const out = vystupSoubor();
    const termin = String(Math.floor(Date.now() / 1000) + 3600);
    const r = spust(["--aplikace", `${predava},${selze}`, "--mekky-termin", termin, "--predat"], { GITHUB_OUTPUT: out, PREDA: predava, SELZE: selze });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.vystup).toMatch(/vlna \d+ selhala/);
    expect(r.vystupy).not.toContain("predano=true");
  });

  test("--navazat-od: předá se deploy-and-verify a souhrn říká, co pokračování udělalo", () => {
    const r = spust(["--aplikace", nizsi, "--navazat-od", "1790000000"]);
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vse[0]).toContain("--navazat-od 1790000000");
    expect(r.vystup).toContain(`${nizsi}: navázáno na běžící nas-${nizsi}`);
  });

  test("--navazat-od: pokračování skončí nulou, ale neřekne, co udělalo → NEJASNÉ a pád, ne „ověřeno“", () => {
    const r = spust(["--aplikace", nizsi, "--navazat-od", "1790000000"], { MLCI: nizsi });
    expect(r.rc, r.vystup).toBe(1);
    expect(r.vystup).toContain(`${nizsi}: NEJASNÉ`);
    expect(r.vystup).not.toContain(`${nizsi}: nasazeno a ověřeno`);
  });

  test("⛔ pokračování spadlo i po opakování → souhrn to řekne výslovně i s třídou (ne „SELHALO“ jako přechodné)", () => {
    const r = spust(["--aplikace", nizsi, "--navazat-od", "1790000000"], { PO_OPAKOVANI: nizsi });
    expect(r.rc).toBe(1);
    expect(r.vystup).toContain(`${nizsi}: PÁD I PO OPAKOVÁNÍ (rc=1) — třída: sit-registru (přechodná): ECONNRESET`);
  });

  test("bez --navazat-od zůstává souhrn „nasazeno a ověřeno“", () => {
    const r = spust(["--aplikace", nizsi]);
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vystup).toContain(`${nizsi}: nasazeno a ověřeno`);
  });

  test("--predat bez termínu a nečíselné razítko jsou chyba zadání", () => {
    expect(spust(["--aplikace", nizsi, "--predat"]).rc).toBe(2);
    expect(spust(["--aplikace", nizsi, "--mekky-termin", "zitra"]).rc).toBe(2);
  });
});

describe("deklarované držení (nasad-podle-vln.sh --drzene)", () => {
  // ⛔ NAMĚŘENO 2026-10-02 (dávka #1139): web-render držený rozhodnutím majitele
  // padal preflightem při KAŽDÉM nasazení a další vlny stály. Deklarovaná držená
  // aplikace se přeskočí VIDITELNĚ a další vlny pokračují; nedeklarovaná chybějící
  // proměnná zůstává pádem.
  const nizsi = "keycloak"; // vlna 4
  const drzena = "ai-chat"; // vlna 7
  const vyssi = "exec"; // vlna 8
  const deklarace = JSON.stringify([
    { aplikace: drzena, duvod: "Coolify převádí holý bind na prázdný svazek", kdo: "majitel", datum: "2026-09-28", odkaz: "rozhodnutí 2026-09-28", vlna: 7, dni: 4 },
  ]);
  const cile = `${nizsi},${drzena},${vyssi}`;

  test("pořadí: držená appka leží mezi nižší a vyšší vlnou", () => {
    expect(vlnaApp.get(nizsi)!).toBeLessThan(vlnaApp.get(drzena)!);
    expect(vlnaApp.get(drzena)!).toBeLessThan(vlnaApp.get(vyssi)!);
  });

  test("držená appka se NEnasadí, souhrn i anotace ji vyjmenují s důvodem a stářím, další vlny pokračují", () => {
    const r = spust(["--aplikace", cile, "--drzene", deklarace]);
    expect(r.rc, r.vystup).toBe(0);
    expect(r.aplikace).toEqual([nizsi, vyssi]);
    expect(r.vystup).toContain(`${drzena}: DRŽENO — Coolify převádí holý bind na prázdný svazek (rozhodnutí majitel 2026-09-28, rozhodnutí 2026-09-28; drženo od 2026-09-28, 4 dní)`);
    expect(r.vystup).toContain(`::warning title=DRŽENO: ${drzena}::`);
    expect(r.vystup).toMatch(new RegExp(`Souhrn \\(2 nasazeno, drženo: ${drzena}\\)`));
  });

  test("prázdná deklarace ([]) = nic drženo, appka se nasadí normálně", () => {
    const r = spust(["--aplikace", cile, "--drzene", "[]"]);
    expect(r.rc, r.vystup).toBe(0);
    expect(r.aplikace).toEqual([nizsi, drzena, vyssi]);
    expect(r.vystup).not.toContain("DRŽENO");
  });

  test("⛔ nedeklarovaná chyba zůstává pádem i vedle držené appky", () => {
    const r = spust(["--aplikace", cile, "--drzene", deklarace], { SELZE: nizsi });
    expect(r.rc).toBe(1);
    expect(r.aplikace).toEqual([nizsi]);
    expect(r.vystup).toMatch(/vlna \d+ selhala/);
  });

  test("⛔ prázdná nebo nečitelná hodnota --drzene = chyba zadání, nenasadí se nic", () => {
    for (const spatne of ["", "{", '{"aplikace":"x"}', '[{"aplikace":"x"}]']) {
      const r = spust(["--aplikace", cile, "--drzene", spatne]);
      expect(r.rc, `--drzene '${spatne}'`).toBe(2);
      expect(r.aplikace, `--drzene '${spatne}'`).toEqual([]);
    }
  });

  test("držená appka není v seznamu NESPUŠTĚNÝCH po měkkém termínu (pokračování ji nemá dohánět)", () => {
    const out = join(repo, `vystup-drzene-${process.hrtime.bigint()}.txt`);
    const r = spust(["--aplikace", cile, "--drzene", deklarace, "--mekky-termin", "1000000000", "--predat"], { GITHUB_OUTPUT: out });
    expect(r.rc, r.vystup).toBe(0);
    expect(r.vystupy).toMatch(new RegExp(`nespustene=.*${nizsi}`));
    expect(r.vystupy).not.toMatch(new RegExp(`nespustene=.*${drzena}`));
  });
});
