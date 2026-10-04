/**
 * Brána: kód stacku nesmí znát jméno konkrétní instance.
 *
 * ⛔ NAMĚŘENO 2026-08-18: 27 výskytů v 16 souborech, přestože konvence
 * `<fork>-` v repu existuje a upstream ji na jiných místech dodržuje. Tři
 * z nich nebyly komentáře, ale ŽIVÝ KÓD — a jeden si přímo odporoval:
 *
 *     docker-compose.coolify-model.yml   MODEL_ALIAS=${MODEL_ALIAS:-default-lens}
 *     Dockerfile.svc-model              MODEL_ALIAS=<fork>-lens-3b     ← zapomenuto
 *                                       (v repu tam stálo jméno instance)
 *     config/services.json              „…MODEL_ALIAS … lives in the instance
 *                                        overlay, never in the stack"
 *
 * Compose se anonymizoval, Dockerfile se minul, a pravidlo o tom, že DNA modelu
 * do stacku nepatří, stálo napsané o dva soubory dál.
 *
 * ⛔ A ANI TA ANONYMIZACE NEBYLA KONEC (naměřeno 2026-09-13): neutrální default
 * je pořád DOSAZENÉ jméno. `default-lens` nesedělo na směrovací kontrakt
 * lokálního backendu (bez prefixu `local-`/`vllm-` → OpenAI, 404) a vedlejší
 * `bge-m3-embedding` / `qwen3-embedding-4b` jmenovaly modely, které instance mít
 * nemusí. Alias je dnes povinná deklarace instance bez defaultu
 * (lokalni-model-alias-je-deklarace.gate.test.ts). Prosa, kterou nikdo neměří,
 * je přání — přesně jako u `secrets:` a build-time allowlistu téhož dne.
 *
 * ⚠️ TATO BRÁNA CHYTILA SAMA SEBE (2026-08-18) a je to správně: její vlastní
 * dokumentace citovala vadu DOSLOVA. Prošla jen do chvíle, než se soubor
 * zaverzoval — univerzum je `git ls-files`, takže neverzovaná brána se sobě
 * neukáže. Důkaz proto cituje tvar, ne jméno; smysl komentáře to neubírá
 * a výjimku pro sebe si brána nedělá. Výjimka by byla díra: soubor, který
 * se nekontroluje, je přesně to, kam se instanční jméno příště schová.
 *
 * PROČ TO NENÍ KOSMETIKA
 * Fork se do upstreamu vrací JEDNÍM merge. Každé instanční jméno, které v deltě
 * zůstane, se rozšíří do všech ostatních instancí — a `MODEL_ALIAS` je případ,
 * kdy by cizí instance dostala výchozí hodnotu odkazující na model, který nemá.
 *
 * ⚠️ MĚŘIDLO SAMO BYLO ŠPATNĚ: první průchod hlásil 5 výskytů ve 4 souborech,
 * protože jsem hledal `\b<fork>-` — jenže `git grep -E` hranici `\b` nezná a tiše
 * nenašel nic. Skutečnost byla pětinásobná. Proto tahle brána univerzum
 * NEPŘEDPOKLÁDÁ: prochází soubory sledované gitem a hledá bez hranic.
 *
 * CO SE SMÍ
 * Instanční adresáře (`instances/`), data instance a testovací přípravky se
 * jménem instance pracovat MUSÍ — jsou to právě ta místa, kam identita patří.
 * Brána měří stack: skripty, zdroje, compose, Dockerfily, dokumentaci.
 *
 * ⛔ UNIVERZUM BYLO VZOREK, NE VLASTNOST (naměřeno 2026-09-12, HEAD 3025c91ec):
 * filtr adresářů `scripts|src|docs|deploy|keycloak|infra|config` + kořenové
 * compose/Dockerfile nechal MIMO měření 10 nálezů dosavadních jmen — mimo jiné
 * `services/gateway/src/server.ts` (jméno instance v komentáři generické brány),
 * `mobile-app/`, `plugins/`, `.forgejo/workflows/ci.yml`, `.claude/skills/`.
 * A `services/gateway/src/routes/public.ts` nesl jméno instance v KÓDU
 * (`source: '<fork>-api'`, hlášky logu) — generická brána, která hlásí, čí je.
 * Univerzum je proto CELÝ sledovaný strom (`git ls-files`) bez submodulů
 * (jejich obsah měří jejich repo), bez generovaných otisků (lockfile,
 * `*.baseline.json`, `_baseline.sql`, minifikace, source-mapy) a bez
 * instančních adresářů. Binární soubor se pozná PODLE OBSAHU (není platné
 * UTF-8), ne podle přípony: `services/svc-source-broker/src/clients/
 * document-registry-map.ts` má v šabloně hashe syrový bajt NUL, `grep` ho hlásí
 * jako binární a tiše přeskočí — pro tuhle bránu je to text jako každý jiný.
 *
 * ⛔ JMÉNO INSTANCE JE I PRVNÍ LABEL `public_tld` (naměřeno 2026-09-12): registr
 * bral z profilů jen `domain.subdomain_prefix`, jenže instance, která má
 * VLASTNÍ veřejnou zónu, prefix nemá (`subdomain_prefix: ""`) a její identitu
 * nese zóna sama — `auth.<jméno>.<tld>` (derive-domains, prefixProZonu:
 * „Veřejnou zónou je vlastní doména instance, ta identitu nese sama"). Dvě
 * takové instance registr NENESL a sonda `<jméno>-x` bránou prošla. Pravidlo
 * je tvar, ne seznam: prefix, když je; jinak první label `public_tld`. Fork
 * S prefixem zónu sdílí, takže její label jménem NENÍ (u jednoho forku je to
 * `staging` — prostředí, ne instance). Dopad změřen před zapnutím: +2 jména,
 * 25 nových nálezů (11 v dosavadním univerzu, 14 mimo), všechny opraveny.
 */
import { describe, it, expect } from "vitest";
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Jména instancí a tvar nálezu žijí v JEDNOM domově (lib/jmena-instanci.ts):
// n8n brány měří touž vlastnost nad adresami uzlů a měly vlastní literál se
// jménem skutečné instance — vzorek, ne vlastnost (naměřeno 2026-09-12).
import { envWithoutGitLocation } from "../../../scripts/lib/git-worktree-health.mjs";
import {
  JMENO_PLATFORMY,
  ROOT,
  jmenaInstanci,
  jmenaZRepozitaru,
  jmenoZPrefixu,
  jmenoZProfilu,
  najdiJmena,
  znamaJmenaInstanci,
  type Repo,
  duvodNezmereno,
} from "./lib/jmena-instanci";

/**
 * Univerzum: CELÝ sledovaný strom. Vynechává se jen to, co jménem instance
 * nemůže být VOLBA tohoto repa — submoduly (měří je jejich repo), generované
 * otisky (lockfile, `*.baseline.json`, `_baseline.sql`, minifikace, source-mapy)
 * a instanční adresáře. Vše ostatní se ČTE; binární se pozná podle obsahu.
 */
export function souboryStromu(): string[] {
  // ~12 000 cest → přes 1 MB; výchozí maxBuffer (1 MB) padá na ENOBUFS.
  const radky = execFileSync("git", ["ls-files", "--stage"], { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
  const submoduly: string[] = [];
  const cesty: string[] = [];
  for (const radek of radky) {
    const m = radek.match(/^(\d{6}) \S+ \d\t(.*)$/);
    if (!m) continue;
    if (m[1] === "160000") submoduly.push(m[2]);
    else cesty.push(m[2]);
  }
  return cesty
    .filter((p) => !submoduly.some((s) => p === s || p.startsWith(`${s}/`)))
    .filter((p) => !/^instances\//.test(p))
    // ⛔ NAMĚŘENO 2026-09-12 na forku <fork>. `.gitmodules` je DEKLARACE
    // týchž cest, které řádek výš vynecháváme jako „měří je jejich repo" —
    // a URL submodulu neutrální BÝT NEMŮŽE: submodul musí svůj repozitář
    // pojmenovat. Vynechat obsah a přitom trvat na deklaraci je tentýž fakt
    // měřený dvakrát, jednou s výjimkou a jednou bez.
    // Navíc je to strukturálně hranice fork↔upstream: `.gitmodules` je JEDINÝ
    // soubor, na kterém sync forku do upstreamu kolidoval (měřeno 2026-09-01,
    // merge dry-run origin/main × upstream = 1 konflikt), takže se jméno touhle
    // cestou do cizích instancí nerozšíří — na to je ten sync, ne tahle brána.
    .filter((p) => p !== ".gitmodules")
    // Generované otisky: jméno v nich je ozvěna zdroje, ne volba — měří se zdroj.
    .filter((p) => !/(^|\/)package-lock\.json$|\.baseline\.json$|_baseline\.sql$|\.min\.|\.map$/.test(p));
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Obsah souboru jako text, nebo `null`, když to text NENÍ — rozhoduje OBSAH
 * (platné UTF-8), ne přípona ani bajt NUL: `.ts` se syrovým NUL v šabloně je
 * pořád zdroj, který jméno instance nést nesmí. Symlink na adresář se
 * přeskakuje — jeho cíle jsou ve stromu jako vlastní soubory.
 */
export function textSouboru(cesta: string): string | null {
  let bajty: Buffer;
  try {
    if (lstatSync(cesta).isSymbolicLink() && statSync(cesta).isDirectory()) return null;
    bajty = readFileSync(cesta);
  } catch {
    return null; // rozbitý symlink apod. — řeší jiná brána
  }
  try {
    return UTF8.decode(bajty);
  } catch {
    return null; // binární podle obsahu
  }
}

/**
 * Workspace v lockfile, jehož cesta ve stromu není.
 *
 * ⛔ NAMĚŘENO 2026-09-12 (HEAD 239361626): lockfile brána vynechává jako
 * ozvěnu zdroje — jméno v něm je opis `package.json` workspace, měří se zdroj.
 * Jenže ozvěna BEZ zdroje je vada sama o sobě: `package-lock.json` nesl čtyři
 * záznamy `"<cesta>": { "extraneous": true }` pro workspace, které ve stromu
 * nejsou (`git ls-files <cesta>` = 0) — jeden z nich se jménem instance.
 * Instanční jméno tak leželo v upstreamu na místě, kam se brána nedívá, a
 * nikdo ho tam nedržel: npm (10.9.8) takové položky sám NEODSTRANÍ —
 * `install --package-lock-only`, `prune`, plný `install`, `dedupe` i
 * `uninstall` je nechají být (arborist prořezává `parent = null`, což je pro
 * uzel mimo `node_modules` prázdný krok). Vlastnost, ne jméno: KAŽDÝ
 * workspace-záznam lockfile (klíč mimo `node_modules/`, ne kořen) musí mít ve
 * sledovaném stromu svůj `package.json`.
 */
export function workspacyBezZdroje(lock: unknown, jeVeStromu: (cesta: string) => boolean): string[] {
  const packages = (lock as { packages?: Record<string, unknown> } | null)?.packages ?? {};
  return Object.keys(packages)
    .filter((cesta) => cesta !== "" && !cesta.split("/").includes("node_modules"))
    .filter((cesta) => !jeVeStromu(`${cesta}/package.json`))
    .sort();
}

/** jq filtr kroku CI „Registr forků" — druhý domov pravidla `jmenoZProfilu`, čte se z ci.yml, ne opisuje. */
function jqFiltrZCi(): string | null {
  const ci = readFileSync(join(ROOT, ".forgejo/workflows/ci.yml"), "utf8");
  return ci.match(/JQ_JMENO_Z_PROFILU='([^']+)'/)?.[1] ?? null;
}

const ZNAMA = await znamaJmenaInstanci();
const REGISTR = ZNAMA.registr;
const ZNAMA_JMENA = ZNAMA.jmena;
// Důvod přeskočení patří do NÁZVU testu — jako u n8n bran nad týmž modulem;
// „skipped" bez důvodu je odpověď jen napůl.
const NEZMERENO = duvodNezmereno(ZNAMA);

describe("kód stacku nesmí znát jméno konkrétní instance", () => {
  // Kanál registru se HLÁSÍ: buď dodal jména, nebo se ví, proč ne. Přeskočený
  // test s důvodem je poctivá odpověď; tichá zelená ne.
  it.skipIf(REGISTR.nezmereno !== null)(
    `registr forků (organizace za \`origin\`) je změřený${REGISTR.nezmereno ? ` — NEZMĚŘENO: ${REGISTR.nezmereno}` : ""}`,
    () => {
      expect(
        REGISTR.jmena.length,
        "registr forků odpověděl, ale nevydal žádné jméno — organizace bez forků a bez `*-instance-data` je vada měřidla, ne čistý stav",
      ).toBeGreaterThan(0);
    },
  );

  // ⛔ TŘI HODNOTY, NE DVĚ. Strom bez identity forku (čistý upstream, offline)
  // nemá co prozradit — tam tahle brána NEMÁ CO MĚŘIT. Prohlásit to za „čisto"
  // by byl fail-open; spadnout by zablokovalo upstream CI za něco, co není vada.
  // `skipIf` je poctivá třetí odpověď: v reportu stojí SKIPPED, ne PASSED,
  // a `skipped ≠ success` je v tomhle repu tvrdé pravidlo. S registrem forků
  // (online) je množina v CI upstreamu neprázdná, takže se tam brána poprvé
  // skutečně měří.
  it.skipIf(NEZMERENO !== null)(
    `žádný soubor stacku nejmenuje instanci — od toho je \`<fork>-\`${NEZMERENO ? ` — NEZMĚŘENO: ${NEZMERENO}` : ""}`, () => {
    const jmena = ZNAMA_JMENA;

    const soubory = souboryStromu();
    // Naměřeno 2026-09-12: 11 929 sledovaných cest bez submodulů, 11 828 textových.
    expect(soubory.length, "seznam souborů stromu je prázdný — brána by měřila prázdno").toBeGreaterThan(5000);

    const nalezy: string[] = [];
    let textovych = 0;
    for (const soubor of soubory) {
      const obsah = textSouboru(join(ROOT, soubor));
      if (obsah === null) continue;
      textovych++;
      for (const { radek, text } of najdiJmena(obsah, jmena)) {
        nalezy.push(`${soubor}:${radek}: ${text.trim().slice(0, 110)}`);
      }
    }
    // Binární podle obsahu je ve stromu ~0,4 % (42 z 11 870); kdyby „text" vyšel
    // pod tři čtvrtiny, měřidlo čte špatně, ne strom.
    expect(textovych, "většina sledovaných souborů se nečte jako UTF-8 text — vada měřidla").toBeGreaterThan(soubory.length * 0.75);

    expect(
      nalezy,
      "Kód stacku jmenuje konkrétní instanci. Fork se do upstreamu vrací JEDNÍM\n" +
        "merge, takže se to jméno rozšíří do všech ostatních instancí — a u výchozích\n" +
        "hodnot (např. MODEL_ALIAS) by cizí instance dostala odkaz na něco, co nemá.\n" +
        "Náprava: v komentářích a próze psát `<fork>-`, v kódu hodnotu vůbec nedosazovat —\n" +
        "deklaruje ji instance (compose: `${MODEL_ALIAS:-}`, ověří entrypoint), v testech `testfork`.\n" +
        `Instance, které brána zná: ${jmena.join(", ")}\n  ` +
        nalezy.join("\n  "),
    ).toEqual([]);
  });

  // Měřidlo se měří samo: odvození jmen z tvaru repozitářů nad fixturou —
  // fork `<jméno>-orchestrator`, fork `<org>-<jméno>`, data `<jméno>-instance-data`,
  // deklarovaný prefix v instance-data (i s koncovým oddělovačem, i prázdný),
  // a co se odvodit NESMÍ (cizí fork, upstream sám, obyčejné repo, prefix
  // u repa, které není instance-data).
  it("negativní sonda: jména se odvozují z TVARU repozitářů a z DEKLARACE v instance-data, ne ze seznamu", () => {
    const repa: Repo[] = [
      { name: "testfork-orchestrator", fork: true, parent: { full_name: "org/upstream" } },
      { name: "org-druhy", fork: true, parent: { full_name: "org/upstream" } },
      { name: "cizi-orchestrator", fork: true, parent: { full_name: "jiny/upstream" } },
      { name: "treti-instance-data", fork: false, parent: null, jmena_z_profilu: ["nasazeny-"] },
      { name: "org-druhy-instance-data", fork: false, parent: null, jmena_z_profilu: ["", "  ", null, "Ctvrty."] },
      { name: "org-instance-data", fork: false, parent: null },
      { name: "upstream", fork: false, parent: null, jmena_z_profilu: ["nepatri-sem"] },
      { name: "nejaka-knihovna", fork: false, parent: null },
    ];
    expect(jmenaZRepozitaru(repa, "org", "upstream")).toEqual([
      "ctvrty",
      "druhy",
      "nasazeny",
      "org-druhy",
      "testfork",
      "treti",
    ]);
    expect(jmenoZPrefixu("testfork-")).toBe("testfork");
    expect(jmenoZPrefixu(undefined)).toBe("");
  });

  // Fixtura profilů: prefix vítězí; bez prefixu první label vlastní zóny;
  // fork s prefixem NEDÁVÁ label sdílené zóny; profil bez obojího nedává nic.
  const PROFILY_FIXTURA: [unknown, string][] = [
    [{ domain: { subdomain_prefix: "sdileny-", public_tld: "staging.zona.example" } }, "sdileny"],
    [{ domain: { subdomain_prefix: "", public_tld: "vlastni.example" } }, "vlastni"],
    [{ domain: { public_tld: "Druhy.Example.Net" } }, "druhy"],
    [{ domain: { subdomain_prefix: "  Treti.  ", public_tld: "" } }, "treti"],
    [{ domain: { subdomain_prefix: "", public_tld: "" } }, ""],
    [{ domain: {} }, ""],
    [{}, ""],
    [null, ""],
  ];

  it("negativní sonda: jméno z profilu = prefix, jinak první label vlastní veřejné zóny; label sdílené zóny ne", () => {
    for (const [profil, jmeno] of PROFILY_FIXTURA) expect(jmenoZProfilu(profil), JSON.stringify(profil)).toBe(jmeno);
    expect(
      jmenaZRepozitaru(
        [{ name: "vlastni-instance-data", jmena_z_profilu: ["vlastni"] }, { name: "x-instance-data", jmena_z_profilu: ["testfork"] }],
        "org",
        "upstream",
      ),
    ).toEqual(["testfork", "vlastni", "x"]);
  });

  // Dva domovy jednoho pravidla se srovnávají nad touž fixturou: jq filtr
  // kroku CI se ČTE z ci.yml (ne opisuje) a spouští se skutečným jq.
  const JQ = jqFiltrZCi();
  let jqDostupne = true;
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore" });
  } catch {
    jqDostupne = false;
  }
  it.skipIf(!jqDostupne)(
    `negativní sonda: jq filtr kroku CI „Registr forků" dává totéž jako jmenoZProfilu${jqDostupne ? "" : " — NEZMĚŘENO: jq není v PATH"}`,
    () => {
      expect(JQ, "v .forgejo/workflows/ci.yml chybí JQ_JMENO_Z_PROFILU='…' — pravidlo má mít dva sladěné domovy, ne jeden").toBeTruthy();
      for (const [profil, jmeno] of PROFILY_FIXTURA) {
        const zJq = execFileSync("jq", ["-r", JQ as string], { input: JSON.stringify(profil ?? null), encoding: "utf-8" }).trim();
        expect(zJq, `jq nad ${JSON.stringify(profil)}`).toBe(jmeno);
      }
    },
  );

  // Fixtura jmenuje jen FIXTURY (`testfork`, …): brána měří i sebe, takže
  // skutečné jméno instance sem nepatří ani jako sonda.
  //
  // ⛔ NAMĚŘENO 2026-09-12: tvar `(<jméno>)-[a-z]` byl vzorek — `/testfork-/`,
  // `` `testfork-` ``, `"testfork-"`, `|testfork-|` prošly, `mtestfork-x` (jméno
  // uvnitř cizího slova) naopak zčervenalo. Sonda proto měří HRANICI před
  // jménem, ne písmeno za pomlčkou — a delší jméno obsahující kratší
  // (`org-testfork` × `testfork`) dá na řádku JEDEN nález, ne dva.
  it("negativní sonda: `<jméno>-` zčervená za každou hranicí, `<jméno>.`, cizí jméno a jméno uvnitř slova ne", () => {
    const jmena = ["testfork", "druhyfork", "tretifork"];
    const obsah = [
      "testfork-x", // 1 — holé jméno na začátku řádku
      "nic", // 2
      "druhyfork-x", // 3
      "tretifork.", // 4 — tečka není pomlčka
      "tretifork-x", // 5
      "cizifork-x", // 6 — cizí jméno
      "Testfork-x", // 7 — jiné velikosti písmen = jiné jméno
      "/testfork-/", // 8 — cesta
      "`druhyfork-`", // 9 — próza v backticku
      '"tretifork-"', // 10 — řetězec
      "|testfork-|", // 11 — tabulka
      "mtestfork-x", // 12 — jméno UVNITŘ cizího slova: NENÍ nález
      "Mtestfork-x", // 13 — totéž s velkým písmenem před ním
      "9testfork-x", // 14 — číslice před jménem je taky slovo
      "x_testfork-y", // 15 — podtržítko je oddělovač: nález
      "http://testfork-svc:3030", // 16 — adresa
      "ětestfork-x", // 17 — písmeno s diakritikou před jménem je taky slovo (česká próza): NENÍ nález
      "→testfork-x", // 18 — ne-písmenný znak mimo ASCII je hranice: nález
    ].join("\n");
    expect(najdiJmena(obsah, jmena).map((n) => n.radek)).toEqual([1, 3, 5, 8, 9, 10, 11, 15, 16, 18]);
    expect(najdiJmena(obsah, [])).toEqual([]);
    expect(najdiJmena("a.b-c", ["a.b"]).length).toBe(1); // tečka se escapuje, nečte jako „cokoli"
    // Delší jméno obsahující kratší: jeden řádek = jeden nález, a kratší samo o sobě nález je.
    expect(najdiJmena("org-testfork-x\ntestfork-x\norg-x", ["org-testfork", "testfork"]).map((n) => n.radek)).toEqual([1, 2]);
  });

  // Lockfile je ozvěna zdroje — vynechává se z měření jmen, ale ozvěna bez
  // zdroje je vada (viz workspacyBezZdroje). Měří se skutečný lockfile nad
  // skutečným `git ls-files`; sonda níž měří pravidlo nad fixturou.
  it("lockfile nenese workspace, jehož cesta ve stromu není", () => {
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    const sledovane = new Set(
      execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 }).split("\n"),
    );
    const workspacy = Object.keys(lock.packages ?? {}).filter((c) => c !== "" && !c.split("/").includes("node_modules"));
    expect(workspacy.length, "lockfile nemá žádný workspace-záznam — měřidlo čte špatný soubor").toBeGreaterThan(10);
    expect(
      workspacyBezZdroje(lock, (cesta) => sledovane.has(cesta)),
      "package-lock.json nese workspace bez zdroje ve stromu (`extraneous` ozvěna smazaného adresáře).\n" +
        "npm takový záznam sám neodstraní (naměřeno 2026-09-12, npm 10.9.8: install --package-lock-only,\n" +
        "prune, plný install, dedupe, uninstall — vše beze změny; arborist prořezává `parent = null`, což je\n" +
        "pro uzel mimo node_modules prázdný krok). Náprava: záznam odstranit a doložit idempotenci —\n" +
        "`npm install --package-lock-only --ignore-scripts` nad výsledkem musí dát prázdný diff.",
    ).toEqual([]);
  });

  it("negativní sonda: workspace bez `package.json` ve stromu je nález; kořen, node_modules a živý workspace ne", () => {
    const lock = {
      packages: {
        "": { name: "root" },
        "node_modules/neco": { version: "1.0.0" },
        "packages/zivy": { name: "@x/zivy" },
        "packages/zivy/node_modules/dep": { version: "1.0.0" },
        "plugins/testfork-source": { name: "@x/plugin-testfork-source", extraneous: true },
        "apps/mrtvy": { extraneous: true },
      },
    };
    const strom = new Set(["package.json", "packages/zivy/package.json", "packages/zivy/src/index.ts"]);
    expect(workspacyBezZdroje(lock, (c) => strom.has(c))).toEqual(["apps/mrtvy", "plugins/testfork-source"]);
    expect(workspacyBezZdroje({}, () => false)).toEqual([]);
    expect(workspacyBezZdroje(null, () => false)).toEqual([]);
  });

  it("negativní sonda: text se pozná podle obsahu — syrový NUL v UTF-8 je text, ne-UTF-8 je binární", () => {
    const dir = mkdtempSync(join(tmpdir(), "jmeno-instance-"));
    try {
      writeFileSync(join(dir, "nul.ts"), "const a = `x\u0000y`; // testfork-x\n");
      writeFileSync(join(dir, "bin.dat"), Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28]));
      expect(najdiJmena(textSouboru(join(dir, "nul.ts")) ?? "", ["testfork"]).length).toBe(1);
      expect(textSouboru(join(dir, "bin.dat"))).toBeNull();
      expect(textSouboru(join(dir, "neni"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Veřejné zrcadlo upstreamu je `<platforma>-orchestrator` — jméno PLATFORMY,
  // ne forku. Bez výjimky v kanálu remotů z něj vyšla „instance" `aisha`.
  it("negativní sonda: remote `<platforma>-orchestrator` instanci nedává, `<fork>-orchestrator` ano", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jmeno-remote-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: envWithoutGitLocation() });
    try {
      git("init", "-q");
      // jmenaInstanci() čte identitu stromu resolverem z <root>/scripts/lib.
      symlinkSync(join(ROOT, "scripts"), join(dir, "scripts"));
      git("remote", "add", "zrcadlo", `https://github.example/org/${JMENO_PLATFORMY}-orchestrator.git`);
      expect(await jmenaInstanci(dir)).not.toContain(JMENO_PLATFORMY);
      git("remote", "add", "fork", "https://forge.example/org/testfork-orchestrator.git");
      expect(await jmenaInstanci(dir)).toContain("testfork");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
