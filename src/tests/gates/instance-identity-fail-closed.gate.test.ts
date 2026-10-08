/**
 * Gate: identita instance se nikdy nedosazuje — nedeklarovaná je CHYBA.
 *
 * PROČ (2026-08-04, dva incidenty téhož dne)
 * ------------------------------------------
 * Na jednom Coolify stojí vedle sebe produkce několika zákazníků (`aisha-*`,
 * `<forkA>-*`, `<forkB>-*`, …) a
 * **jméno aplikace je jediné, co je odlišuje**. Každý `${APP_NAME_PREFIX:-aisha}`
 * proto znamená: „když nevím, sáhni na upstream".
 *
 * Ráno tak `workflow_dispatch` z forku nasadil
 * `aisha-core` — jinou instanci, jiného zákazníka. Že se nic nerozbilo, byla
 * náhoda: build spadl na chybějícím `NETBIRD_DNS_IP` dřív, než došlo na výměnu
 * kontejnerů.
 *
 * Odpoledne se ukázalo, že táž vlastnost řídí i **rozsah WIPE**:
 * `aisha-cold-start.sh` vybíral podle `${APP_NAME_PREFIX:-aisha}` regex, podle
 * kterého se aplikace MAŽOU. Tam by druhá náhoda nepřišla.
 *
 * PR #125 opravil `coolify-resolve-uuid.sh` fail-closed, ale ne třídu — zbylo
 * sedm dalších míst ve čtyřech souborech, a `coolify-deploy-init.sh` nesl týž
 * fallback DVAKRÁT. To je přesně „poučení opravené v jednom souboru není
 * opravené v systému".
 *
 * CO SE ZÁMĚRNĚ NEKONTROLUJE
 * --------------------------
 * - Konstanty stacku: `aisha-db`, `aisha-keycloak`, `aisha-postgrest` jsou jména
 *   kontejnerů AISHA stacku, ne jméno zákazníka — ta zůstávají `aisha-*` v každé
 *   instanci a `${X:-aisha-postgrest:3000}` je správně.
 * - Jména kontejnerů AISHA stacku (viz výše). `KC_REALM:-<realm>` je PARAMETR
 *   sondy, ne identita — jeho výchozí hodnota je `KEYCLOAK_REALM`, a ta už
 *   fail-closed je.
 *
 * ⛔ CO SE PŘESUNULO MEZI HLÍDANÉ (2026-08-25): `KEYCLOAK_REALM`.
 * Stálo tu, že „realm se jmenuje `aisha` u všech instancí, je to platformní
 * konstanta". To byla pravda jen proto, že `keycloak/aisha-realm.json` neslo
 * jméno realmu jako LITERÁL — deklarace `KEYCLOAK_REALM` se tedy nikam
 * nedoručila a všech osmnáct `${KEYCLOAK_REALM:-aisha}` v devíti souborech
 * dosazovalo tutéž hodnotu, takže se rozpor nikdy neprojevil. Od chvíle, kdy
 * šablona nese `"realm": "${KEYCLOAK_REALM}"`, je jméno realmu identita
 * instance jako každá jiná: dosazená náhrada znamená vydávat tokeny z realmu,
 * který instanci nepatří, a pozná se to až tím, že se nikdo nepřihlásí.
 * - Komentáře a dokumentace. Prózu o té pasti musí jít napsat, aniž ji brána
 *   nahlásí jako pastí samotnou.
 *
 * Kontroluje se JEDNA vlastnost: proměnná, která nese identitu instance,
 * nesmí mít dosazenou výchozí hodnotu.
 *
 * Spouští se přes: npm run test:gates
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Proměnné, které nesou IDENTITU INSTANCE (ne jména kontejnerů AISHA stacku). */
const IDENTITY_VARS = [
  "APP_NAME_PREFIX",
  "AISHA_STORY",
  "AISHA_INSTANCE",
  "AISHA_INSTANCE_SLUG",
  "AISHA_IMPLEMENTATION",
  "COOLIFY_PROJECT_NAME",
  "NETBIRD_NS",
  // Realm vydává tokeny JMÉNEM instance — viz hlavička, proč tu do 2026-08-25
  // nebyl a co se změnilo.
  "KEYCLOAK_REALM",
];

/**
 * Univerzum jsou GITEM SLEDOVANÉ skripty a CI. Ne `readdir`: pracovní strom nese
 * i netrackované soubory (u mě `scripts/lib/story-app.sh`), a brána, která je
 * měří, hlásí nálezy o kódu, který v repu není.
 */
function scannedFiles(): string[] {
  // Univerzum je CELÝ repozitář, ne `scripts/` + `.github/`. Ten užší výběr byl
  // díra: `infra/pki/pki-renewer.sh` leží mimo něj, a tak si tam dva `${APP_NAME
  // _PREFIX:-aisha}` běžely se zelenou bránou — renewer by na sdíleném Coolify
  // doručil cert CIZÍ instanci. Brána, která hlídá vlastnost, ji musí hlídat
  // všude, jinak měří jen adresář, kde ji kdysi někdo našel poprvé.
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const files = out.split("\0").filter((f) => /\.(sh|mjs|js|ya?ml)$/.test(f));
  if (files.length === 0) {
    throw new Error("git ls-files nevrátil žádný skript — brána by měřila vzduch");
  }
  // `git ls-files` vypisuje INDEX, ne disk. Soubor smazaný a ještě nezapsaný
  // v něm tedy je, ale `readFileSync` na něj spadne na ENOENT — a brána místo
  // měření hlásí pád (naměřeno 2026-08-13 při mazání mrtvého compose souboru).
  // Rozdíl mezi „nenašel jsem nález" a „nedoběhl jsem" musí zůstat čitelný.
  const naDisku = files.map((f) => resolve(ROOT, f)).filter((p) => existsSync(p));
  if (naDisku.length === 0) {
    throw new Error("žádný ze souborů v indexu neexistuje na disku — brána neměří strom, který se testuje");
  }
  return naDisku;
}

/**
 * `VAR` s hranicí slova. Bez ní `AISHA_IMPLEMENTATION` chytá i
 * `AISHA_IMPLEMENTATION_HOOK` (cesta ke skriptu), `AISHA_INSTANCE` chytá
 * `AISHA_INSTANCE_ENV` a `AISHA_STORY` chytá `AISHA_STORY_ID` — tři falešné
 * nálezy o proměnných, které identitu nenesou.
 */
const VAR_ALT = `(?:${IDENTITY_VARS.join("|")})(?![A-Z0-9_])`;

/**
 * Je dosazená hodnota LITERÁL, nebo jen další článek řetězu?
 * `${A:-${B}}`, `${A:-$B}` i `${A:-$(fn)}` rozhodnutí odsouvají — poslední
 * článek pak musí selhat nahlas. Literál `aisha` je naopak odpověď, kterou
 * nikdo nedal.
 */
function isChain(fallback: string): boolean {
  return /^\$[({]/.test(fallback) || fallback.startsWith("$");
}

/**
 * Mohla by ta hodnota BÝT jménem instance? Jméno je `^[a-z][a-z0-9-]*$` — tak
 * se jmenují projekty v Coolify i prefixy aplikací.
 *
 * Cokoliv jiného je text pro člověka, ne volba instance: fail-closed cesta
 * o sobě musí umět referovat, a `${APP_NAME_PREFIX:-<nenastaven>}` uvnitř
 * `echo "::error::…"` je právě takové hlášení. Flagovat ho by znamenalo trestat
 * kód za to, že svůj vlastní fail-closed stav umí pojmenovat.
 */
function couldBeInstanceName(fallback: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(fallback.replace(/^['"]|['"]$/g, ""));
}

/**
 * Vytáhne dosazenou hodnotu z `${VAR…:-<sem>}` počítáním závorek.
 *
 * Regexem to nejde: `[^}]*` se přes vnořené `${…}` nedostane, a jakmile se mu
 * povolí jedno `}` navíc, spojí DVĚ různé expanze na témže řádku a vrátí
 * nesmysl. (Naměřeno: `if [ -n "${AISHA_STORY:-}" ]` se tak spároval s
 * `${APP_NAME_PREFIX:-}` o kus dál a brána hlásila fail-closed řádek jako vadu.)
 */
function shellFallbacks(line: string): string[] {
  const out: string[] = [];
  const open = new RegExp(String.raw`\$\{${VAR_ALT}[^:}]*:-`, "g");
  for (const m of line.matchAll(open)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < line.length && depth > 0) {
      if (line[i] === "{" && line[i - 1] === "$") depth++;
      else if (line[i] === "}") depth--;
      i++;
    }
    if (depth === 0) out.push(line.slice(start, i - 1));
  }
  return out;
}

/** Řádek s dosazenou identitou — `${VAR:-neco}` nebo `env.VAR || 'neco'`. */
function offendingLines(text: string): string[] {
  const bad: string[] = [];
  const node = new RegExp(
    String.raw`process\.env\.${VAR_ALT}[^;\n]*\|\|\s*['"]([^'"]*)['"]`,
  );

  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    // Komentáře nejsou konfigurace — o téhle pasti se musí dát psát.
    if (line.startsWith("#") || line.startsWith("//") || line.startsWith("*")) continue;

    const fallbacks = shellFallbacks(raw);
    const nodeMatch = raw.match(node);
    if (nodeMatch) fallbacks.push(nodeMatch[1] ?? "");

    for (const f of fallbacks) {
      const fallback = f.trim();
      // Prázdný default (`${X:-}` / `|| ''`) je PRÁVĚ ten fail-closed tvar:
      // hodnota zůstane prázdná a volající na ni musí zareagovat.
      if (fallback === "") continue;
      if (isChain(fallback)) continue;
      if (!couldBeInstanceName(fallback)) continue;
      bad.push(`${i + 1}: ${line}`);
      break;
    }
  }
  return bad;
}

describe("identita instance se nedosazuje", () => {
  it("univerzum se seeduje ze skutečnosti a není prázdné", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(50);
    // A opravdu se v nich ty proměnné vyskytují — jinak by brána měřila vzduch.
    const withVars = files.filter((f) =>
      IDENTITY_VARS.some((v) => readFileSync(f, "utf-8").includes(v)),
    );
    expect(withVars.length).toBeGreaterThan(5);
  });

  it("žádný skript ani CI krok nedosazuje výchozí instanci", () => {
    const violations: string[] = [];
    for (const file of scannedFiles()) {
      const rel = file.slice(ROOT.length + 1);
      for (const hit of offendingLines(readFileSync(file, "utf-8"))) {
        violations.push(`${rel}:${hit}`);
      }
    }
    expect(
      violations,
      "Dosazená identita instance znamená: když nevím, sáhni na upstream. Na " +
        "jednom Coolify stojí vedle sebe produkce několika zákazníků a jméno " +
        "aplikace je jediné, co je odlišuje — tenhle default rozhoduje i o tom, " +
        "co se SMAŽE. Nech hodnotu prázdnou a selži nahlas:\n  " +
        violations.join("\n  "),
    ).toEqual([]);
  });
});
