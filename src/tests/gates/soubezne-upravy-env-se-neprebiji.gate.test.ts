/**
 * Souběžné úpravy sdíleného souboru se nesmějí přebíjet (CLASS gate)
 *
 * TŘÍDA VADY: víc kroků mutuje TÝŽ soubor postupem přečti-uprav-zapiš, a běží
 * souběžně. Každý si ho přečte dřív, než ho ten druhý změní, takže poslední
 * zápis cizí práci smaže. Navenek přitom oba hlásí úspěch.
 *
 * Naměřeno 2026-08-27 na ostrém běhu vln:
 *   · vlna spouští aplikace souběžně (`Promise.all`);
 *   · `mesh refresh` zapsal do .env.coolify CORE_MESH_IP=100.126.196.201;
 *   · přepočet složenin ho vzápětí přepsal svou STARŠÍ kopií souboru;
 *   · edge pak odmítl deploy: „CORE_MESH_IP je prázdné" → api zůstalo 502.
 *   · Zálohy, které si ty kroky samy dělají, tu hodnotu NEOBSAHOVALY ani jedna
 *     — což je důkaz, že druhý zapisovatel četl stav před prvním zápisem.
 *
 * DRUHÁ POLOVINA — hlášení tvrdilo ZÁMĚR, ne VÝSLEDEK:
 *     out = out.replace(re, `${key}=${ip}`);
 *     filled.push(`${key}=${ip}`);      // ← bez ohledu na to, jestli náhrada zabrala
 * `✓ mesh refresh: CORE_MESH_IP=…` se tedy vypsalo i tehdy, když se nezapsalo
 * nic. Úspěch, který netvrdí nic o skutečnosti, vede vyšetřování opačným směrem.
 *
 * INVARIANT:
 *   1. mutace .env.coolify jde JEDINÝM místem, které čte AŽ UVNITŘ zámku;
 *   2. souběžné úpravy se skládají — žádná nezmizí;
 *   3. hlášení o zápisu je podmíněné zpětným ověřením.
 *
 * Spouští se přes: npm run test:gates
 */

import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const REDEPLOY = join(ROOT, "scripts", "aisha-redeploy.mjs");
const src = () => readFileSync(REDEPLOY, "utf-8");

describe("souběžné úpravy .env.coolify se skládají, nepřebíjejí", () => {
  test("obsah .env.coolify mění JEDINÉ místo", () => {
    // Vlastnost je „kolik míst ten soubor MĚNÍ", ne „kolik volá writeFileSync".
    // Po přechodu na atomický zápis se mění přejmenováním; kdyby brána trvala
    // na starém tvaru, spadla by po správné opravě — a to je přesně ta past,
    // které se říká „brána, co drží vadu".
    const zmeny = src()
      .split("\n")
      .map((l, i) => [l.trim(), i + 1] as [string, number])
      .filter(([l]) => !l.startsWith("//") && !l.startsWith("*"))
      .filter(
        ([l]) =>
          /writeFileSync\(ENV_COOLIFY[,)]/.test(l) ||
          /renameSync\([^)]*,\s*ENV_COOLIFY\s*\)/.test(l) ||
          // Od 2026-09-15 jde atomický zápis přes lib/zapis-env-atomicky.mjs
          // (symlink přežije) — je to TÝŽ zapisovatel, jen jinak zapsaný.
          /nahradObsahAtomicky\(ENV_COOLIFY[,)]/.test(l),
      );
    expect(
      zmeny.length,
      "Každý další zapisovatel je další účastník souboje. Mutace musí téct " +
        `jedinou funkcí (upravEnvCoolify). Nalezeno na řádcích: ${zmeny.map(([, n]) => n).join(", ")}`,
    ).toBe(1);
  });

  test("ten jediný zapisovatel čte soubor AŽ UVNITŘ zámku", () => {
    const t = src();
    const i = t.indexOf("async function upravEnvCoolify");
    expect(i, "upravEnvCoolify musí existovat").toBeGreaterThan(-1);
    const telo = t.slice(i, t.indexOf("\n}\n", i));
    expect(telo, "zámek se drží frontou příslibů").toContain("_envZamek");
    const cteni = telo.indexOf("readEnvCoolify()");
    const zamek = telo.indexOf("_envZamek.then");
    expect(
      cteni > zamek && zamek > -1,
      "čtení musí být UVNITŘ zámku — čtení před zámkem serializuje jen zápis, " +
        "ne rozhodnutí, a souboj zůstane",
    ).toBe(true);
    expect(telo, "výsledek se ověřuje zpětným čtením").toMatch(/zpet\s*===\s*out|out\s*===\s*zpet/);
  });

  test("úpravy se skládají — druhá nesmaže první (chování, ne tvar)", async () => {
    const { mkdtempSync, writeFileSync: w, readFileSync: r } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const soubor = join(mkdtempSync(join(tmpdir(), "env-")), ".env.coolify");
    w(soubor, "A=\nB=\n");

    // Táž mechanika jako v aisha-redeploy: fronta příslibů, čtení uvnitř.
    let zamek = Promise.resolve();
    const uprav = (fn: (s: string) => string) => {
      const beh = zamek.then(async () => {
        const s = r(soubor, "utf-8");
        await new Promise((res) => setTimeout(res, 5)); // okno pro souběh
        const out = fn(s);
        w(soubor, out);
        return r(soubor, "utf-8") === out;
      });
      zamek = beh.then(() => {}, () => {});
      return beh;
    };

    const vysledky = await Promise.all([
      uprav((s) => s.replace(/^A=$/m, "A=prvni")),
      uprav((s) => s.replace(/^B=$/m, "B=druhy")),
    ]);
    expect(vysledky.every(Boolean), "oba zápisy musí být ověřené").toBe(true);
    const finalni = r(soubor, "utf-8");
    expect(finalni, "první úprava přežila").toContain("A=prvni");
    expect(
      finalni,
      "druhá úprava přežila — přesně tohle selhalo v ostrém běhu, kde " +
        "přepočet složenin smazal CORE_MESH_IP zapsanou mesh refreshem",
    ).toContain("B=druhy");
  });

  test("zápis je ATOMICKÝ — potomek nikdy neuvidí rozepsaný soubor", async () => {
    const t = src();
    const i = t.indexOf("async function upravEnvCoolify");
    const telo = t.slice(i, t.indexOf("\n}\n", i));
    expect(
      telo,
      "Zámek serializuje jen zapisovatele V TOMHLE procesu. `.env.coolify` ale " +
        "současně čtou POTOMCI (netbird-peer-discover si z něj bere NETBIRD_DOMAIN). " +
        "Přímý zápis soubor nejdřív zkrátí a pak plní. Zátěžová zkouška " +
        "(2026-08-27) ukázala, že neúplné čtení JDE zahlédnout; v provozu je " +
        "to ale řádově vzácnější a nevysvětluje hromadné pády discovery. " +
        "`rename` je atomický a nestojí nic — riziko pryč, ne diagnóza.",
    ).toMatch(/renameSync|nahradObsahAtomicky\(ENV_COOLIFY/);
    // Zápis přes knihovnu musí zůstat atomický (rename) a jít na SKUTEČNOU cestu
    // — jinak rename nahradí symlink v worktree a trezor se rozštěpí
    // (naměřeno 2026-09-15; brána zapis-env-prezije-symlink).
    if (telo.includes("nahradObsahAtomicky")) {
      const lib = readFileSync(join(ROOT, "scripts/lib/zapis-env-atomicky.mjs"), "utf-8");
      expect(lib, "knihovna zapisuje přejmenováním").toContain("renameSync");
      expect(lib, "knihovna přejmenovává na skutečnou cestu").toContain("realpathSync");
    }

    // Chování, ne jen tvar: s přejmenováním musí být neúplných čtení PŘESNĚ nula.
    // Tenhle směr je deterministický (proto se neměří opačný, ten by byl náhodný).
    const { writeFileSync: w, renameSync: mv, readFileSync: r, mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const soubor = join(mkdtempSync(join(tmpdir(), "atom-")), "env");
    const obsah = Array.from({ length: 3000 }, (_, n) => `K_${n}=v${n}`).join("\n") + "\n";
    w(soubor, obsah);
    let neuplnych = 0;
    let poradi = 0;
    const konec = Date.now() + 400;
    while (Date.now() < konec) {
      const tmp = `${soubor}.tmp${++poradi}`;
      w(tmp, obsah);
      mv(tmp, soubor);
      if (r(soubor, "utf-8").length !== obsah.length) neuplnych++;
    }
    expect(neuplnych, "atomický zápis nesmí vydat neúplný obsah ANI JEDNOU").toBe(0);
  });

  test("hlášení o zápisu je podmíněné jeho ověřením", () => {
    const t = src();
    const i = t.indexOf("mesh refresh: ${filled");
    expect(i, "hlášení mesh refreshe musí existovat").toBeGreaterThan(-1);
    const okolo = t.slice(Math.max(0, i - 400), i);
    expect(
      okolo,
      "`✓ mesh refresh` se smí vypsat jen když zápis PROBĚHL. Dřív se klíč " +
        "přidával do seznamu bez ohledu na to, jestli náhrada zabrala.",
    ).toContain("zapis.zapsano");
  });

  test("chyba potomka se předává, ne uřezává", () => {
    const t = src();
    const i = t.indexOf("const _duvod =");
    expect(i, "sestavení důvodu musí existovat").toBeGreaterThan(-1);
    const okolo = t.slice(Math.max(0, i - 600), i + 200);
    expect(
      okolo,
      "u execFile je e.message vždy jen Command failed: … — skutečnou " +
        "příčinu píše potomek na stderr a volající ji musí předat.",
    ).toContain("e?.stderr");
  });
});

/**
 * DRUHÁ TŘÍDA TÉŽE VADY — zapisovatel v JINÉM PROCESU (naměřeno 2026-09-15).
 *
 * Redeploy pouštěl env-doktora (apply) mimo zámek. Doktor zapisoval holým
 * `writeFileSync` (zkrátí, pak plní), rodič v té chvíli přečetl PRÁZDNÝ soubor,
 * přidal složeniny a zapsal ho zpět. Z trezoru zbylo pár řádků, další běhy
 * doktora vygenerovaly tajemství NANOVO a sync je roznesl do Coolify
 * (201 klíčů v 18 aplikacích). Poškozená kopie navíc nesla 74 hodnot
 * `${KLIC:-}` a sync je poslal jako doslovný text.
 *
 * INVARIANT:
 *   4. potomek, který SoT zapisuje, běží pod týmž zámkem jako zápisy rodiče;
 *   5. doktor zapisuje atomicky a jen nad obsahem, ze kterého rozhodoval;
 *      existující SoT bez klíčů nedoplňuje (vyrobil by nová tajemství);
 *   6. klíče SoT během běhu redeploye jen přibývají — zápis ani sync nad
 *      SoT, který o klíč přišel, neprojde;
 *   7. sync nerozesílá hodnotu s nerozbaleným `${`.
 */
const DOKTOR = join(ROOT, "scripts", "aisha-env-doctor.mjs");
const SYNC = join(ROOT, "scripts", "coolify-sync-envs.sh");

/** Tělo funkce od hlavičky po první `}` na začátku řádku. */
function teloFunkce(t: string, hlavicka: string): string {
  const i = t.indexOf(hlavicka);
  expect(i, `${hlavicka} musí existovat`).toBeGreaterThan(-1);
  return t.slice(i, t.indexOf("\n}\n", i));
}

describe("zapisovatel v jiném procesu se nepřebíjí s rodičem", () => {
  test("každé spuštění doktora, které SMÍ zapisovat, je pod zámkem rodiče", () => {
    const t = src();
    // Vlastnost: volání doktora BEZ přepínače jen pro čtení je zapisovatel.
    const volani = [...t.matchAll(/execFileP\([^[\]]*\[[^[\]]*aisha-env-doctor\.mjs"\)([^\]]*)\]/g)];
    const zapisovatele = volani.filter((m) => !/--print-contract-keys|--report|--dry-run/.test(m[1]));
    expect(zapisovatele.length, "redeploy doktorem srovnává odvozené klíče — volání musí existovat").toBeGreaterThan(0);
    for (const m of zapisovatele) {
      const pred = t.slice(0, m.index);
      const hlavicka = [...pred.matchAll(/\n(?:async )?function (\w+)\(/g)].pop();
      expect(hlavicka, "volání doktora musí být uvnitř pojmenované funkce").toBeTruthy();
      const jmeno = hlavicka![1];
      expect(
        new RegExp(`_envZamek\\.then\\(\\s*(?:async\\s*)?\\(\\)\\s*=>\\s*${jmeno}\\(`).test(t),
        `${jmeno}() zapisuje .env.coolify z potomka — musí běžet přes _envZamek.then(() => ${jmeno}()), ` +
          "jinak rodič přečte jeho rozepsaný soubor a zapíše ho zpět (2026-09-15: trezor přišel o stovky klíčů)",
      ).toBe(true);
    }
  });

  test("doktor zapisuje SoT jen atomicky a nad obsahem, ze kterého rozhodoval", () => {
    const kod = readFileSync(DOKTOR, "utf-8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    expect(
      [...kod.matchAll(/(?:writeFileSync|copyFileSync)\(\s*(ENV_PATH|path)\b/g)].map((m) => m[0]),
      "holý zápis soubor nejdřív zkrátí — souběžný čtenář uvidí prázdný trezor",
    ).toEqual([]);
    expect([...kod.matchAll(/nahradObsahAtomicky\(ENV_PATH\b/g)].length, "SoT mění jediné atomické místo").toBe(1);
    const main = teloFunkce(kod, "async function main()");
    expect(main, "obsah se čte jednou na začátku").toMatch(/const puvodniText = /);
    const cas = main.indexOf("textPredZapisem !== puvodniText");
    const zapis = main.indexOf("nahradObsahAtomicky(ENV_PATH");
    expect(cas > -1 && cas < zapis, "před zápisem se ověří, že SoT mezitím nezměnil jiný zapisovatel").toBe(true);
  });

  test("doktor NEDOPLNÍ existující SoT bez jediného klíče (chování)", () => {
    const envFile = join(mkdtempSync(join(tmpdir(), "doktor-prazdny-")), ".env.coolify");
    writeFileSync(envFile, "");
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of [...RESOLVER_ENV_INPUTS, "ENV_FILE", "AISHA_STORY"]) delete env[k];
    const r = spawnSync(process.execPath, [DOKTOR, "--no-external"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...env, ENV_FILE: envFile, AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi" },
    });
    if (r.error || r.signal || r.status === null) {
      throw new Error(`env-doktor nedoběhl — výsledek NENÍ měření: signal=${r.signal ?? "—"} error=${r.error?.message ?? "—"}`);
    }
    expect(r.stderr, "důvod odmítnutí jde na stderr, kde ho redeploy předá").toContain("nenese jediný klíč");
    expect(r.status, "odmítnutí je selhání, ne úspěch").toBe(2);
    expect(readFileSync(envFile, "utf-8"), "prázdný SoT zůstal nedotčený — žádná nová tajemství").toBe("");
  });

  test("redeploy nezapíše ani nesynchronizuje SoT, který přišel o klíč proti startu běhu", () => {
    const t = src();
    const uprav = teloFunkce(t, "async function upravEnvCoolify");
    const kontrolaSrc = uprav.indexOf("ztraceneKliceProtiStartu(src)");
    const kontrolaOut = uprav.indexOf("ztraceneKliceProtiStartu(out)");
    const zapis = uprav.indexOf("nahradObsahAtomicky(ENV_COOLIFY");
    expect(kontrolaSrc > -1 && kontrolaSrc < uprav.indexOf("uprav(src)"), "úprava se nestaví nad poškozeným SoT").toBe(true);
    expect(kontrolaOut > -1 && kontrolaOut < zapis, "úprava, která by klíč odebrala, se nezapíše").toBe(true);

    const trigger = teloFunkce(t, "async function triggerDeploy");
    const kontrola = trigger.indexOf("ztraceneKliceProtiStartu(");
    // Kotva je VOLÁNÍ syncu, ne jeho jméno — to stojí už v komentáři hlavičky.
    const sync = trigger.indexOf('join(ROOT, "scripts/coolify-sync-envs.sh")');
    expect(kontrola > -1 && kontrola < sync, "invariant se měří PŘED syncem aplikace").toBe(true);

    const main = teloFunkce(t, "async function main()");
    expect(main, "výchozí bod invariantu se bere na startu běhu").toMatch(/_kliceNaStartu = kliceSoT\(/);
  });

  test("sync odmítne hodnotu s nerozbaleným ${ (chování skutečného výrazu ze skriptu)", () => {
    const skript = readFileSync(SYNC, "utf-8");
    const radek = skript.split("\n").find((l) => l.startsWith("NEROZBALENE=$("));
    expect(radek, "detekce nerozbalených odkazů musí být ve sync skriptu").toBeTruthy();
    expect(skript.indexOf(radek!) < skript.indexOf("BULK_PAYLOAD=$("), "měří se PŘED sestavením payloadu").toBe(true);
    const vzorek = ["A\t1", "B\t${B:-}", "C\tx ${Y} z", "D\tcena$", "E\t{{ n8n }}"].join("\n");
    const r = spawnSync("bash", ["-c", `ENV_PAIRS="$(cat)"\n${radek}\nprintf '%s' "$NEROZBALENE"`], {
      input: vzorek,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual(["B", "C"]);
  });
});
