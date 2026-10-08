/**
 * Brána: kontrakt-nema-dva-domovy
 *
 * INVARIANT: v kontraktu env-doktora nesmí být žádný klíč dvakrát.
 *
 * PROČ: `resolveOne()` přeskakuje položku podle `existing.has(key)` — tedy podle
 * toho, co už je v `.env.coolify` —, NIKOLI podle `resolved.has(key)`. Dvě položky
 * téhož klíče proto obě projdou a obě se přidají do `additions`. `appendKeysToFile()`
 * testuje duplicitu proti řetězci, do kterého blok teprve přidává, takže do souboru
 * skončí KLÍČ NA DVOU ŘÁDCÍCH. `collapseDuplicateKeys()` běží PŘED zápisem, takže
 * ten běh duplicitu nezahojí — až následující. Mezitím `coolify-sync-envs.sh`
 * (`parse_env_file()` nededuplikuje) pošle klíč dvakrát v jediném `envs/bulk`
 * payloadu. Chování Coolify na to není definované, a `.env.coolify` je soubor,
 * ze kterého čte celé nasazení — doktor sám tuhle třídu pojmenoval jako
 * nedefinované chování (aisha-env-doctor.mjs, sekce o 22 duplicitních klíčích).
 *
 * NAMĚŘENO 2026-08-11 (PR #880): spread `...Object.keys(IMAGE_VERSIONS)` vyloučil
 * výčtem jen `IMAGE_OAUTH2_PROXY` a `AISHA_DB_IMAGE`, jenže `config/image-versions.env`
 * nese 38 klíčů, ne 36 — kromě image pinů i `REGISTRY_PROXY`. Ten už kontrakt
 * deklaruje o 118 řádků níž jako "template", takže se do kontraktu dostal DVAKRÁT.
 * Zhoršující okolnost: `REGISTRY_PROXY` je v tom SoT souboru JEDINÁ hodnota, která
 * se rozvine na prázdno — tedy přesně ta, u které na pořadí zápisu záleží nejvíc.
 *
 * PROČ SE MĚŘÍ ZA BĚHU, NE ZE ZDROJÁKU: kontrakt se z části skládá spreadem nad
 * externím souborem. Statická analýza zdrojáku by tu polovinu nikdy neviděla a
 * mlčela by i s vadou uvnitř — proto doktor má režim `--print-contract-keys`,
 * který kontrakt vypíše a skončí PŘED jakýmkoli čtením/zápisem env souborů.
 *
 * Brána zároveň pinuje dvě tvrzení, která PR #880 dělá v komentářích, ať nezůstanou
 * jen prózou (viz `kind` u AGENT_* a doména u n8n vlastníka).
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { RESOLVER_ENV_INPUTS } from "../../../scripts/lib/derive-domains.mjs";

const ROOT = process.cwd();
const DOCTOR = path.join(ROOT, "scripts/aisha-env-doctor.mjs");
/** Jediný domov IMAGE_ pinů; doktor ho čte relativně KE SVÉMU umístění, ne k cwd. */
const SOT_PINY = path.join(ROOT, "config/image-versions.env");

/**
 * `KLÍČ\tdruh` řádky z doktora → dvojice.
 *
 * ⛔ NAMĚŘENO 2026-08-12 v CI: tenhle loader vrátil PRÁZDNÉ POLE a test pak
 * spadl na „expected 0 to be greater than 10" — tedy hláškou o kontraktu,
 * ačkoli skutečná příčina byla, že PODPROCES NIC NEVYPSAL. Komentář nad ním
 * přitom tvrdil „selže hlasitě, ne prázdným polem"; kód to nedělal.
 *
 * `execFileSync` hodí jen při nenulovém exitu. Doktor, který skončí nulou a
 * nevypíše nic (nebo píše jinam), tudy propadne jako platné měření. To je
 * třída „selhání nástroje se čte jako data": prázdný výstup vypadá jako nález.
 *
 * Teď loader dokládá, že nástroj BĚŽEL: zachytává stderr, ověří nenulový počet
 * řádků a při prázdnu vyhodí chybu, která rovnou nese exit kód i stderr —
 * takže příští běh v CI řekne PROČ, ne jen že něco nesedí.
 *
 * ⛔ DOMĚŘENO 2026-08-12 (kořen tří červených běhů): nestačí, že nástroj běžel —
 * musí dorazit CELÝ výstup. console.log do roury + process.exit() v doktorovi
 * zahodily vše za ~179. řádkem; brána pak měřila PRAVÝ PREFIX kontraktu a
 * padala hláškou o chybějících IMAGE_ pinech (ty začínají na řádku 327).
 * Důkaz: histogram druhů prvních 179 řádků == přesně to, co CI viděla.
 * Proto doktor tiskne patičku `__CONTRACT_END__\t<počet>` a tenhle loader
 * úplnost VYMÁHÁ: chybějící nebo nesedící patička = chyba s čísly, ne měření.
 */
let posledniStderr = "";

/**
 * Doktor nad PRÁZDNÝM vstupem, ne nad trezorem toho, kdo bránu pouští.
 *
 * ⛔ NAMĚŘENO 2026-09-14 v pracovní kopii operátora: doktor si načte
 * `.env-prod-backup` i cílový `.env.coolify` ze souborů (ne z prostředí) a
 * od chvíle, kdy instance s deklarovaným overlayem bez cesty k němu odmítá
 * odvozovat (instance-overlay.mjs), brána spadla — v CI prošla, protože tam
 * trezor není. Verdikt tak řídil trezor, ne kód. Temp ENV_FILE + `--no-external`
 * + bez vstupů resolveru = totéž stanoviště lokálně i v CI.
 */
function izolovaneProstredi(envFile: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of [...RESOLVER_ENV_INPUTS, "ENV_FILE", "AISHA_STORY"]) delete env[k];
  return { ...env, ENV_FILE: envFile, AISHA_PROFILE: process.env.AISHA_PROFILE || "cloud-multi" };
}

const SENTINEL = "__CONTRACT_END__";

function nactiKontrakt(): Array<{ klic: string; druh: string }> {
  const envFile = path.join(mkdtempSync(path.join(tmpdir(), "aisha-kontrakt-")), "env.coolify");
  writeFileSync(envFile, "");
  const r = spawnSync(process.execPath, [DOCTOR, "--print-contract-keys", "--no-external"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: izolovaneProstredi(envFile),
  });
  posledniStderr = r.stderr ?? "";
  const radky = (r.stdout ?? "").split("\n").filter((x) => x.includes("\t"));
  const dvojice = radky
    .filter((x) => !x.startsWith(`${SENTINEL}\t`))
    .map((x) => {
      const [klic, druh] = x.split("\t");
      return { klic, druh };
    });

  if (r.error || r.status !== 0 || dvojice.length === 0) {
    throw new Error(
      "env-doctor --print-contract-keys nevydal kontrakt — brána NEMÁ CO MĚŘIT.\n" +
        `  exit=${r.status} signal=${r.signal ?? "—"} error=${r.error?.message ?? "—"}\n` +
        `  řádků s tabulátorem: ${radky.length}\n` +
        `  stdout (prvních 400 B): ${(r.stdout ?? "").slice(0, 400)}\n` +
        `  stderr (prvních 800 B): ${(r.stderr ?? "").slice(0, 800)}`,
    );
  }

  const paticka = radky.find((x) => x.startsWith(`${SENTINEL}\t`));
  const ohlaseno = paticka ? Number(paticka.split("\t")[1]) : NaN;
  if (!paticka || ohlaseno !== dvojice.length) {
    throw new Error(
      "env-doctor --print-contract-keys dorazil UŘÍZNUTÝ — prefix kontraktu není kontrakt.\n" +
        `  patička: ${paticka ?? "CHYBÍ"} | dorazilo dvojic: ${dvojice.length}\n` +
        "  Tohle je třída: console.log do roury + process.exit zahodí zbytek.\n" +
        "  Producent má tisknout jedním zápisem s callbackem (viz aisha-env-doctor.mjs).",
    );
  }
  return dvojice;
}

/**
 * Co doopravdy vidí PODPROCES.
 *
 * Test čte SoT přes `process.cwd()`. Doktor si ho odvozuje z UMÍSTĚNÍ SVÉHO
 * SKRIPTU (`resolve(__dirname, "..")`). Ty dvě cesty se shodovat NEMUSÍ —
 * a když se rozejdou, test vidí plný soubor a doktor prázdno, takže spor
 * vypadá jako vada kontraktu, ačkoli jde o rozchod cest. Sonda, která měří
 * jen svou vlastní stranu, tenhle rozchod nikdy nepojmenuje.
 *
 * `process.argv[1]` je v dítěti cesta k DOKTOROVI (posíláme ji jako argument),
 * takže odvození probíhá přesně tak, jak ho dělá doktor sám.
 */
function pohledPodprocesu(): string {
  const skript =
    "const {existsSync,readFileSync}=require('node:fs');const {resolve,dirname}=require('node:path');" +
    "const f=resolve(dirname(process.argv[1]||''),'..','config/image-versions.env');" +
    "const e=existsSync(f);const t=e?readFileSync(f,'utf-8'):'';" +
    "console.log(JSON.stringify({cesta:f,existuje:e,bajtu:t.length,imagePinu:(t.match(/^IMAGE_[A-Z0-9_]*=/gm)||[]).length}));";
  const r = spawnSync(process.execPath, ["-e", skript, DOCTOR], { cwd: ROOT, encoding: "utf8", timeout: 30_000 });
  return (r.stdout ?? "").trim() || `sonda selhala: exit=${r.status} stderr=${(r.stderr ?? "").slice(0, 200)}`;
}

describe("kontrakt env-doktora nemá dva domovy pro týž klíč", () => {
  const kontrakt = nactiKontrakt();

  /** Fakta, kterými se doprovází neshoda — ať příští běh nese příčinu, ne jen číslo. */
  function diagnostika(sotPinu: number, vKontraktu: number): string {
    const histogram = new Map<string, number>();
    for (const { druh } of kontrakt) histogram.set(druh, (histogram.get(druh) ?? 0) + 1);
    return [
      `  SoT pohledem TESTU:   ${SOT_PINY} — pinů ${sotPinu}`,
      `  SoT pohledem DÍTĚTE:  ${pohledPodprocesu()}`,
      `  kontrakt: ${kontrakt.length} klíčů, z toho IMAGE_* v kontraktu (required-static|derived): ${vKontraktu}`,
      `  druhy: ${[...histogram.entries()].sort().map(([d, n]) => `${d}=${n}`).join(" ")}`,
      `  stderr doktora: ${posledniStderr.slice(0, 600).replace(/\n/g, " ⏎ ") || "—"}`,
    ].join("\n");
  }

  it("sonda má co měřit — kontrakt není prázdný", () => {
    // Mlčení sondy je samo nálezem: kdyby `--print-contract-keys` zmizel nebo
    // začal tisknout jinak, všechny testy níž by prošly nad prázdným polem.
    expect(kontrakt.length).toBeGreaterThan(100);
  });

  it("žádný klíč není v kontraktu dvakrát", () => {
    const pocty = new Map<string, number>();
    for (const { klic } of kontrakt) pocty.set(klic, (pocty.get(klic) ?? 0) + 1);
    const duplicitni = [...pocty.entries()].filter(([, n]) => n > 1);

    expect(
      duplicitni,
      duplicitni.length === 0
        ? ""
        : `Klíč deklarovaný dvakrát skončí na dvou řádcích v .env.coolify:\n` +
          duplicitni.map(([k, n]) => `  ${k} — ${n}× (druhy: ` +
            kontrakt.filter((p) => p.klic === k).map((p) => p.druh).join(", ") + ")").join("\n") +
          `\nSpojte je do JEDNÉ položky, nebo zužte spread, který ji přidává navíc.`,
    ).toEqual([]);
  });

  it("spread nad image-versions.env přidává jen IMAGE_* piny", () => {
    // Pozitivní filtr místo výčtu výjimek: SoT nese i ne-image klíče a výčet
    // by musel každý nový ručně uhlídat. Tenhle test je jeho náhrada.
    //
    // ⛔ NAMĚŘENO 2026-08-12 v CI: tady stálo `expect(zeSpreadu.length).toBeGreaterThan(10)`
    //    a spadlo to hláškou „expected 0 to be greater than 10". Ta věta neřekne
    //    ANI JEDNU z věcí, které potřebuju vědět: které piny chybí, kolik jich má
    //    SoT, a jestli vůbec podproces ten SoT viděl. Táž třída jako u loaderu výš:
    //    číslo místo tvrzení. Nároky se teď odvozují ZE SoT (ne z magické desítky)
    //    a hláška nese, co viděl test i co vidí dítě — pořizovat další běh CI jen
    //    kvůli tomu, abych se dozvěděl PROČ, je promarněná hodina.
    const sotText = existsSync(SOT_PINY) ? readFileSync(SOT_PINY, "utf-8") : "";
    const sotPiny = [...sotText.matchAll(/^\s*(IMAGE_[A-Z0-9_]*)=/gm)]
      .map((m) => m[1])
      .filter((k) => k !== "IMAGE_OAUTH2_PROXY");

    expect(
      sotPiny.length,
      `SoT ${SOT_PINY} nenese IMAGE_ piny — brána NEMÁ CO MĚŘIT ` +
        `(existuje=${existsSync(SOT_PINY)}, bajtů=${sotText.length}).`,
    ).toBeGreaterThan(10);

    // Vlastnost je „pin ze SoT je v kontraktu", ne „má druh required-static".
    // 2026-09-14 se piny přepnuly na `derived` (uložený pin bez prefixu cache se
    // jako required-static už nikdy nesrovnal — <fork> 23/23 z Docker Hubu přímo);
    // prázdný pin zůstává required-static. Oba druhy pin DORUČÍ.
    const zeSpreadu = kontrakt.filter(
      (p) => (p.druh === "required-static" || p.druh === "derived") && p.klic.startsWith("IMAGE_"),
    );
    const vKontraktu = new Set(zeSpreadu.map((p) => p.klic));
    const chybi = sotPiny.filter((k) => !vKontraktu.has(k));

    expect(
      chybi,
      `Pin ze SoT není v kontraktu ⇒ do .env.coolify se nedoručí a compose spadne ` +
        `na „neither an image nor a build context".\n${diagnostika(sotPiny.length, zeSpreadu.length)}`,
    ).toEqual([]);

    const neImage = kontrakt.filter(
      (p) => p.druh === "required-static" && !p.klic.startsWith("IMAGE_") && p.klic.includes("REGISTRY"),
    );
    expect(
      neImage.map((p) => p.klic),
      "REGISTRY_* nepatří mezi image piny — kontrakt ho deklaruje zvlášť jako template",
    ).toEqual([]);
  });

  it("instančně odvozené cesty exec stacku jsou required, ne static", () => {
    // Komentář u nich tvrdí, že jsou odvozené proto, aby se dvě instance
    // nepřetahovaly o týž adresář. Jako "static" by prázdná identita zapsala
    // `/var/lib//agent-runs` — týž adresář pro všechny. Tvrzení musí platit i v kódu.
    // (AGENT_REPO_PATH pryč 2026-09-24: běh si repo klonuje sám.)
    for (const klic of ["AGENT_RUNS_DIR"]) {
      const p = kontrakt.find((x) => x.klic === klic);
      expect(p, `${klic} v kontraktu chybí`).toBeDefined();
      expect(p!.druh, `${klic} musí být required-*, jinak prázdná identita projde tiše`).toMatch(/^required-/);
    }
  });

  it("cold-start vydává každý klíč do .env.coolify jen JEDNOU", () => {
    // TÉŽ UNIVERZUM, DRUHÝ VÝROBCE (naměřeno 2026-08-22). Invariant nahoře platí
    // pro kontrakt doktora; jenže `.env.coolify` píše i cold-start — heredocem
    // a `printf … >> "$TMP_ENV"`. Vydával 4 klíče DVAKRÁT.
    //
    // ⭐ Proč to nebylo vidět: v souboru byl každý klíč jednou, protože
    // `collapseDuplicateKeys()` je po zápisu sloučí. Jenže ten úklid se volá
    // s `|| warn` — když neproběhne, duplicita zůstane a `coolify-sync-envs.sh`
    // ji podle vlastního popisu NEDEDUPLIKUJE: klíč odejde do Coolify dvakrát.
    // Měřením VÝSLEDKU se vada schová; měří se proto EMITOR.
    const src = readFileSync(path.join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8").split("\n");
    const kde = new Map<string, string[]>();
    let terminator: string | null = null;
    for (let i = 0; i < src.length; i += 1) {
      const l = src[i];
      if (terminator === null) {
        const m = /cat\s*>+\s*"?\$TMP_ENV"?\s*<<-?\s*["']?([A-Za-z_][A-Za-z0-9_]*)/.exec(l);
        if (m) { terminator = m[1]; continue; }
      } else {
        if (l.trim() === terminator) { terminator = null; continue; }
        const m = /^([A-Z][A-Z0-9_]*)=/.exec(l);
        if (m) kde.set(m[1], [...(kde.get(m[1]) ?? []), `heredoc:${i + 1}`]);
      }
    }
    for (let i = 0; i < src.length; i += 1) {
      const m = /printf\s+'([A-Z][A-Z0-9_]*)=/.exec(src[i]);
      if (m && src[i].includes("TMP_ENV")) kde.set(m[1], [...(kde.get(m[1]) ?? []), `printf:${i + 1}`]);
    }

    expect(kde.size, "sonda nenašla žádné vydání — měří prázdno").toBeGreaterThan(100);
    const dvakrat = [...kde.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}  ${v.join(" + ")}`);
    expect(
      dvakrat.sort(),
      "Klíč vydaný z dvou míst skončí v .env.coolify na dvou řádcích a KTERÝ vyhraje\n" +
        "závisí na tom, kdo soubor čte. Slučování to opraví jen tehdy, když doběhne —\n" +
        "a volá se s `|| warn`. Vydej hodnotu jednou.",
    ).toEqual([]);
  });
});

/**
 * Třetí zapisovatel `.env.coolify`: průchod klíčů z `.env-prod-backup`.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na nasazené instanci. Test výš měří heredoc + `printf` dodatky; průchod
 * `grep … "$ENV_PROD_BACKUP" | grep -vE "$REGEN_KEYS" … >> "$TMP_ENV"` nevidí, protože
 * jeho výstup závisí na obsahu zálohy. A právě tam to teklo: REGEN_KEY_PATTERNS je
 * ruční seznam „co vlastní heredoc" a rozešel se s heredocem — proti záloze té instance by
 * průchod znovu zapsal 38 klíčů, které heredoc už zapsal. Zálohy env-doktora
 * (`.backup/env.coolify.bak-*`, stav PŘED slučováním) nesly do 2026-09-02 až 34
 * zdvojených klíčů, 5 s odlišnou hodnotou. Konzumenti se na výskytu neshodnou
 * (deploy-init a config-env-files: poslední neprázdný; sync-envs: pošle oba a
 * `read_env_key` čte první; aisha-redeploy `val()`: první) — změřeno nad fixturou.
 *
 * Protože obsah zálohy brána nezná, měří STRUKTURU, která vlastnost zaručí pro
 * JAKOUKOLI zálohu: průchod je POSLEDNÍ zápis do TMP_ENV, vlastnictví klíče se
 * odvozuje z toho, co v TMP_ENV UŽ JE (ne ze seznamu), a nad hotovým souborem stojí
 * stráž na zdvojený klíč, která před `mv` skončí nenulou.
 */
function jedenZapisNaKlic(sh: string): string[] {
  const kod = sh
    .split("\n")
    .filter((r) => !/^\s*#/.test(r))
    .join("\n");
  // Závěrečná náhrada souboru: holé `mv` (do 2026-09-15) nebo `env_zapis_atomicky`
  // (scripts/lib/env-zapis.sh — přežije symlink, brána zapis-env-prezije-symlink).
  // Obojí je TÝŽ krok „hotový TMP_ENV se stane .env.coolify".
  const iMvHole = kod.indexOf('mv "$TMP_ENV" "$ENV_COOLIFY"');
  const iMv = iMvHole >= 0 ? iMvHole : kod.indexOf('env_zapis_atomicky "$TMP_ENV" "$ENV_COOLIFY"');
  const iPruchod = kod.indexOf('"$ENV_PROD_BACKUP" 2>/dev/null');
  if (iMv < 0 || iPruchod < 0) return ["průchod ze zálohy nebo `mv` do .env.coolify nenalezen — měřidlo přestalo sedět"];
  const nalezy: string[] = [];
  const iKonecPruchodu = kod.indexOf('>> "$TMP_ENV"', iPruchod);
  if (iKonecPruchodu < 0 || iKonecPruchodu > iMv) return ["průchod ze zálohy do TMP_ENV nezapisuje — měřidlo přestalo sedět"];
  const zapisyPo = [...kod.slice(iKonecPruchodu + 1, iMv).matchAll(/>>\s*"\$TMP_ENV"/g)].length;
  if (zapisyPo > 0) nalezy.push(`za průchodem ze zálohy stojí ještě ${zapisyPo} zápis(ů) do TMP_ENV — průchod nevidí, co zapíšou`);
  const pruchod = kod.slice(kod.lastIndexOf("\n", iPruchod), iKonecPruchodu);
  const souborKlicu = /grep -oE '\^\[A-Z_\]\[A-Z0-9_\]\*=' "\$TMP_ENV"[^\n]*> "\$([a-z_]+)"/.exec(kod.slice(0, iPruchod));
  if (!souborKlicu || !new RegExp(`awk[\\s\\S]*NR == FNR[\\s\\S]*"\\$${souborKlicu[1]}" -`).test(pruchod))
    nalezy.push("průchod nefiltruje proti klíčům, které už TMP_ENV nese (vlastnictví podle seznamu, ne podle zápisu)");
  const straz = kod.slice(iKonecPruchodu, iMv);
  if (!/grep -oE '\^\[A-Z_\]\[A-Z0-9_\]\*=' "\$TMP_ENV" \| sort \| uniq -d/.test(straz) || !/\n\s*exit 1\b/.test(straz))
    nalezy.push("nad hotovým TMP_ENV chybí stráž na zdvojený klíč, která před `mv` skončí nenulou");
  return nalezy;
}

describe("cold-start: průchod ze zálohy nezdvojí klíč (třetí zapisovatel)", () => {
  it("průchod je poslední zápis, filtruje proti zapsanému a nad výsledkem stojí stráž", () => {
    expect(jedenZapisNaKlic(readFileSync(path.join(ROOT, "scripts/aisha-cold-start.sh"), "utf-8"))).toEqual([]);
  });

  it("sonda jde rozsvítit — tvar do 2026-09-13 by chytila", () => {
    const stary = [
      '  cat > "$TMP_ENV" <<HEADER',
      "APP_NAME_PREFIX=${APP_NAME_PREFIX:-}",
      "HEADER",
      '  grep -E "^[A-Z][A-Z0-9_]+=" "$ENV_PROD_BACKUP" 2>/dev/null \\',
      '    | grep -vE "$REGEN_KEYS" \\',
      '    >> "$TMP_ENV" || true',
      '  printf \'AISHA_OPERATORS=%s\\n\' "$OPERATORS_COMPACT" >> "$TMP_ENV"',
      '  mv "$TMP_ENV" "$ENV_COOLIFY"',
    ].join("\n");
    expect(jedenZapisNaKlic(stary)).toEqual([
      "za průchodem ze zálohy stojí ještě 1 zápis(ů) do TMP_ENV — průchod nevidí, co zapíšou",
      "průchod nefiltruje proti klíčům, které už TMP_ENV nese (vlastnictví podle seznamu, ne podle zápisu)",
      "nad hotovým TMP_ENV chybí stráž na zdvojený klíč, která před `mv` skončí nenulou",
    ]);
  });
});
