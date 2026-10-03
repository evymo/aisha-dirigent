/**
 * Brána: SKRIPT MUSÍ JÍT SPUSTIT (CLASS gate)
 *
 * ⛔ TŘÍDA VADY (naměřeno 2026-08-22, dvakrát v jedné vlně, obojí moje):
 * vysvětlující komentář vložený DOPROSTŘED volání amputuje to volání.
 *
 *     _gen_tmp=$(node scripts/generate-secrets.mjs \
 *       --env-coolify="..." \
 *       # ── Straze NAD vysledkem ──          <- pokracovani se spoji s timhle
 *       ...                                       radkem a `#` sezere ZBYTEK
 *       --env-backup="..." \                  <- bash to bere jako PRIKAZ
 *
 * Zpetne lomitko se odstranuje PRED tokenizaci, takze `cmd arg \` + `# text`
 * je proste `cmd arg # text` — prikaz se SPUSTI, jen s cásti argumentu.
 *
 * ⭐ PROC TO NENI VIDET: `bash -n` to nechyti, protoze je to syntakticky
 * bezvadne. Amputace neni chyba pravopisu, je to chyba HRANICE. V cold-startu
 * spadla jen nahodou (zbytek zacinal na `--`, coz neni jmeno prikazu → 127);
 * ve warmupu neSPADLA VUBEC: `run_cmd "popis"` bez prikazu → po `shift`
 * prazdne "$@" → prazdny prikaz v shellu vraci 0 → vytisklo se zelene `ok`.
 *
 * TRI VRSTVY, protoze zadna sama nestaci — kazda z nich prehlidne prave to,
 * co vidi ta druha:
 *   1. SYNTAXE   — `bash -n` nad kazdym sledovanym skriptem. Nemereno DODNES:
 *                  `scripts/security/cosign-verify.sh` se nedal precist (apostrof
 *                  v `${VAR:?...provider's...}` — uvnitr expanze jsou apostrofy
 *                  vyznamne i ve dvojitych uvozovkach). Blokace nasazeni
 *                  nepodepsaneho obrazu, ktera nikdy nesla spustit.
 *   2. HRANICE   — amputace volani komentarem. `bash -n` na to NESTACI: je to
 *                  syntakticky bezvadne.
 *   3. BEH       — `run_cmd` fail-closne bez prikazu. Ani jedna staticka vrstva
 *                  nezachyti amputaci vzniklou az za behu.
 *
 * Detektor je vytazeny ven a ma ZAPORNE testy — brana, kterou nejde zcervenat,
 * nemeri, jen mlci.
 *
 * HRANICE UNIVERZA (priznana, ne zamlcena): meri se `git ls-files '*.sh'`.
 * Shell zije i v `RUN` Dockerfilu a v `run:` blocich CI — obe mnoziny jsem
 * 2026-08-22 zmeril rucne a jsou CISTE (0 z 59 Dockerfilu, 0 z 520 YAML).
 * Do brany je nedavam, protoze BuildKit komentarove radky uvnitr pokracovani
 * odstranuje, takze tam plati JINE pravidlo, nez ktere tahle brana tvrdi.
 * Tvrdit nemerenou semantiku je horsi nez ji nemerit.
 *
 * Spousti se pres: npm run test:gates
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const HEREDOC = /<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)["']?/;

/**
 * Vrátí 1-based čísla řádků, kde pokračování příkazu ukousl komentář.
 *
 * Vynechává se:
 *   · tělo heredocu (tam `#` není komentář),
 *   · logický řádek, který SÁM začíná komentářem (ukázky použití v hlavičkách),
 *   · pozice uvnitř apostrofového řetězce (`sed '…/a\'` a spol.).
 *
 * ⭐ Parita apostrofů se počítá JEN v rámci jednoho logického řádku. Přes celý
 * soubor se rozsypala u 24 z 218 skriptů — mimo jiné u `aisha-cold-start.sh`,
 * tedy zrovna tam, kde vada byla. Měřidlo, které se umí mlčky vypnout nad
 * souborem, o kterém má vypovídat, není měřidlo.
 */
export function najdiAmputace(text: string): number[] {
  const L = text.split("\n");
  const out: number[] = [];
  let terminator: string | null = null;
  let apostrofy = 0;
  let zacatek: number | null = null;
  let jeKomentar = false;

  for (let i = 0; i < L.length - 1; i++) {
    const cur = L[i];
    if (terminator !== null) {
      if (cur.trim() === terminator) terminator = null;
      continue;
    }
    if (zacatek === null) {
      zacatek = i;
      apostrofy = 0;
      jeKomentar = cur.trimStart().startsWith("#");
      if (!jeKomentar) {
        const m = HEREDOC.exec(cur);
        if (m) {
          terminator = m[1];
          zacatek = null;
          continue;
        }
      }
    }
    apostrofy = (apostrofy + (cur.match(/'/g)?.length ?? 0)) % 2;
    if (cur.trimEnd().endsWith("\\")) {
      if (!jeKomentar && apostrofy === 0 && L[i + 1].trimStart().startsWith("#")) {
        out.push(i + 1);
      }
    } else {
      zacatek = null;
    }
  }
  return out;
}

describe("skript musi jit spustit", () => {
  const shSoubory = () =>
    execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n")
      .filter((f) => f.endsWith(".sh"));

  test("KAZDY sledovany skript je syntakticky platny (bash -n)", () => {
    const soubory = shSoubory();
    expect(soubory.length, "univerzum je prazdne — brana by tvrdila cisto o nicem").toBeGreaterThan(50);

    const nalezy: string[] = [];
    for (const f of soubory) {
      try {
        execFileSync("bash", ["-n", f], { cwd: ROOT, stdio: "pipe" });
      } catch (e: unknown) {
        const err = e as { stderr?: Buffer; message?: string };
        nalezy.push(`${f}\n    ${(err.stderr?.toString() ?? err.message ?? "").trim().slice(0, 200)}`);
      }
    }

    expect(
      nalezy.sort(),
      "Skript, ktery se neda ani precist, NENI kontrola — je to zaznam o kontrole.\n" +
        "`cosign-verify.sh` takhle lezel v repu jako blokace nasazeni nepodepsaneho\n" +
        "obrazu, zapocitany do 100% pokryti OWASP, a pritom se nedal spustit.",
    ).toEqual([]);
    // Strop, ne předpoklad rychlosti (naměřeno 2026-10-01): 245 skriptů = 245 spuštění bashe.
    // Samostatně 7,6 s i při load 24; v pre-push vedle těžké dráhy a cizích slotů 65,8 s —
    // výchozích 60 s pak utne kontrolu, která nic nenašla, a push padne „stálým nálezem“.
    // Aserce je beze změny; strop jen dává kontrole doběhnout.
  }, 180_000);

  test("NIKDE ve stromu nekonci pokracovaci radek prikazu komentarem", () => {
    const soubory = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8" })
      .split("\n")
      .filter((f) => f.endsWith(".sh"));

    expect(soubory.length, "univerzum je prazdne — brana by tvrdila cisto o nicem").toBeGreaterThan(50);

    const nalezy: string[] = [];
    for (const f of soubory) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, f), "utf-8");
      } catch {
        // Necitelny SLEDOVANY soubor neni nula nalezu, je to dira v pokryti.
        throw new Error(`nelze precist sledovany soubor ${f} — brana by tvrdila cisto o neprectenem`);
      }
      const radky = text.split("\n");
      for (const n of najdiAmputace(text)) {
        nalezy.push(`${f}:${n}  ${radky[n - 1].trim().slice(0, 70)}`);
      }
    }

    expect(
      nalezy.sort(),
      "Komentar uprostred volani AMPUTUJE to volani: `\\` se odstrani pred tokenizaci,\n" +
        "takze `#` sezere zbytek argumentu. Prikaz se SPUSTI, jen zmrzacene, a\n" +
        "`bash -n` mlci, protoze je to syntakticky v poradku.\n" +
        "Vysvetlujici text patri NAD volani, ne dovnitr nej.",
    ).toEqual([]);
  });

  test("run_cmd fail-closne, kdyz nedostane prikaz", () => {
    // Behova pojistka teze tridy: prazdne "$@" je v shellu USPESNY prikaz,
    // takze helper bez teto strazi hlasi `ok` u kroku, ktery nikdy nebezel.
    const warmup = readFileSync(join(ROOT, "scripts/warmup.sh"), "utf-8");
    const telo = /run_cmd\(\)\s*\{([\s\S]*?)\n\}/.exec(warmup);
    expect(telo, "run_cmd() ve warmup.sh nenalezen — brana meri neexistujici tvar").not.toBeNull();
    expect(
      telo![1],
      "run_cmd bez strazi na prazdny prikaz je lzivy pristroj: ohlasi uspech\n" +
        "prikazu, jaky nikdy nedostal.",
    ).toMatch(/\[\s*"\$#"\s*-eq\s*0\s*\]/);
  });

  // ── Zaporne testy: detektor musi porad videt to, kvuli cemu vznikl ────────
  test("detektor vidi obe SKUTECNE vady z 2026-08-22", () => {
    const coldStart = ['x=$(node prog \\', '  --a="1" \\', "  # komentar", '  --b="2")', ""].join("\n");
    const warmup = ['run_cmd "popis" \\', "  # komentar", "  bash x.sh", ""].join("\n");
    expect(najdiAmputace(coldStart), "amputace uvnitr $( )").toEqual([2]);
    expect(najdiAmputace(warmup), "amputace volani helperu").toEqual([1]);
  });

  test("detektor nehlasi ukazku v komentari ani skript v apostrofech", () => {
    const ukazka = ["#   usage: prog \\", "#     --a 1", "real_cmd", ""].join("\n");
    const sed = ["sed -i.bak '/x/a\\", "\\", "# [PLUGIN] text\\", "' \"$F\"", ""].join("\n");
    const heredoc = ["cat <<EOF", "neco \\", "# uvnitr heredocu neni komentar", "EOF", ""].join("\n");
    expect(najdiAmputace(ukazka), "logicky radek zacal komentarem").toEqual([]);
    expect(najdiAmputace(sed), "pozice je uvnitr apostrofoveho retezce").toEqual([]);
    expect(najdiAmputace(heredoc), "telo heredocu neni kod").toEqual([]);
  });
});
