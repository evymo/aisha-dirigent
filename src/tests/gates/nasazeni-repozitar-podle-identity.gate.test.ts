/**
 * Brána TŘÍDY: nasazovaný repozitář a větev DEKLARUJE manifest, remote se vybírá
 * podle IDENTITY URL — nikdy podle jména
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, krok 4): cold-start krok 2b2 se ptal
 * `git ls-remote origin`. Ve fork checkoutu je `origin` upstream, Coolify ale staví
 * z repozitáře forku → „Nasadil by se JINÝ kód“ nad stromem, který souhlasil
 * (a stejně snadno by odhlásil shodu proti repozitáři, ze kterého se nestaví).
 *
 * ⛔ NEDŮVĚŘIVÉ ČTENÍ 2026-10-03 (nálezy 1–4): oprava kroku 2b2 třídu nezavřela.
 *   · Deklaraci četla TŘI různá pravidla (story-init, pomocník, awk doktora) — nad
 *     manifestem bez větve a s `GIT_BRANCH` v prostředí stavěl story-init z větve
 *     prostředí, zatímco krok 2b2 porovnal strom s `main`.
 *   · Tahle brána měřila ŠEST vyjmenovaných souborů a sedm příkazů gitu; doktor
 *     (`remote get-url`), měření odchylky větve i povrchy jí unikaly.
 *
 * Měří se:
 *   1. krok 2b2 bere repozitář i větev z deklarace (nasazovany-repozitar.mjs
 *      --deklarace) a čte je přes --cti (výběr remote podle identity URL);
 *   2. JEDEN VÝKLAD: tvary manifestu z čtení dají všem čtečkám týž výsledek, nebo
 *      tutéž chybu — čtečka je jedna a story-init, doktor, měření odchylky i povrchy
 *      ji VOLAJÍ; vlastní čtení řádků deklarace není nikde ve `scripts/`;
 *   3. TŘÍDA: nic v CELÉM `scripts/` (bez testů a komentářů) nemíří gitem na remote
 *      JMÉNEM (origin/upstream) — tvary A–D u detektoru níž, ne výčet podpříkazů.
 *      Výjimky jen výslovně, každá s důvodem a STROPEM výskytů: další stejný výskyt
 *      v témže souboru je nález; výjimka, která už v souboru není, bránu shodí
 *      (seznam nesmí hnít) a strop vyšší než skutečnost taky (smí se jen snižovat);
 *   4. sebetest detektorů s pozitivní kotvou — na vzorcích i na skutečném stromu.
 *
 * CO DETEKTOR NEVIDÍ (řečeno nahlas, ne zamlčeno):
 *   · Jméno uložené prostým přiřazením (`R=origin`, `const r = "origin"`) a použité
 *     o řádek níž — tvar přiřazení měřen 2026-10-04 a zamítnut: ve `scripts/` dává
 *     falešné nálezy (`session_replication_role = 'origin'` v SQL obsluze dat).
 *   · Jiná jména remote než origin/upstream (`git fetch fork`, `forgejo/main`):
 *     rozšířený výčet jmen dal falešný nález (`github.com` v adrese).
 *   · Porovnání se jménem vidí jen jako argument nebo prvek seznamu (tvar D: za
 *     literálem `,` `)` `]`). Tak se ukázal známý neopravený člen třídy v nasazovací
 *     cestě: `scripts/aisha-env-doctor.mjs`, konstanta `GIT_REMOTES` (`.sort(… ===
 *     "origin" …)`) → z prvního remote se odvozují výchozí `FORGEJO_URL` a
 *     `FORGEJO_REPO`, které doktor ZAPISUJE. Oprava čeká na rozhodnutí: bez shody
 *     remote podle identity by hodnotu nešlo vyplnit a první založení instance, které
 *     dnes vychází přes hostitele zvykového remote, by se zastavilo. Do té doby ho
 *     drží výjimka na řádek se stropem 1 — přiznaná díra, ne souhlas.
 *
 * PROSTŘEDÍ (změřeno 2026-10-04, recenze pořadí): rozpor větve s prostředím pozná
 * vykladač z `GIT_BRANCH` SVÉHO procesu, takže všichni tazatelé musí vidět totéž
 * prostředí. Krok 2b2 a doktor vidí prostředí cold-startu; story-init si ho skládá
 * sám přes `lib/resolve-domains-env.sh`. Ten četl napevno `.env-prod-backup` z KOŘENE
 * stromu — v ne-produkčním běhu jiný soubor, než načetl cold-start — a přepsal tím
 * zděděnou větev, projekt Coolify i adresu Forgeja. ZAVŘENO u zdroje: skript čte zálohu
 * prostředí běhu (`ENV_PROD_BACKUP`, jinak kořen), tedy totéž pravidlo jako cold-start
 * a doktor. Tady se hlídá jen tvar toho řádku; chování (tři tvary běhu, tři klíče,
 * skutečný začátek story-initu) měří scripts/lib/resolve-domains-env.test.mjs.
 * CO ZŮSTÁVÁ: samostatně spuštěný story-init nečte `.env.local` (cold-start a doktor
 * ano) — pod cold-startem ho dědí, samostatně ho nevidí. A sdílený řetěz souborů
 * `lib/config-env-files.mjs` jmenuje soubory v kořeni napevno; tudy jde jiný kanál
 * (doplnění jednotlivých klíčů), větev ani repozitář se jím nečtou.
 *
 * Brána nespouští podprocesy (lehká dráha): chování CLI pomocníka měří
 * scripts/lib/nasazovany-repozitar.test.mjs, měření odchylky větve nad dočasnými
 * repozitáři brána deploy-vetev-odchylka-nese-duvod.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { nasazovanyRepozitar, rozporyDeklarace, tvrzeniProstredi, zManifestu } from '../../../scripts/lib/nasazovany-repozitar.mjs';

const ROOT = process.cwd();
const POMOCNIK = 'scripts/lib/nasazovany-repozitar.mjs';
const cti = (soubor: string) => readFileSync(join(ROOT, soubor), 'utf8');

// ── univerzum: celé scripts/ ────────────────────────────────────────────────

/** Přípony čtené jako kód. */
const PRIPONY_KODU = new Set(['.sh', '.mjs', '.cjs', '.js', '.ts', '.py', '.awk']);
/** Přípony, které kód nejsou (dokumentace, data, vzhled). Cokoli třetího bránu shodí. */
const PRIPONY_NEKODU = new Set(['.md', '.txt', '.json', '.css', '.html', '.svg', '.sql', '.woff2']);

const jeTest = (cesta: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(cesta) || cesta.split('/').includes('__tests__');

/** Položka výpisu adresáře — jen to, co chůze stromem čte. */
type Polozka = { name: string; isDirectory(): boolean };
const vypisAdresare = (adresar: string): Polozka[] => readdirSync(adresar, { withFileTypes: true });

/**
 * Soubory `scripts/` roztříděné na kód a neznámé přípony (testy se přeskočí).
 * `vypis` jde podvrhnout jen kvůli sebetestu zařazení (rada d8: mutant „neznámá
 * přípona se tiše vynechá“ přežil, protože dnešní strom žádnou nemá).
 */
function souboryScripts(vypis: (adresar: string) => Polozka[] = vypisAdresare): { kod: string[]; neznamePripony: string[] } {
  const kod: string[] = [];
  const neznamePripony: string[] = [];
  const projdi = (adresar: string) => {
    for (const e of vypis(adresar)) {
      const plna = join(adresar, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') projdi(plna);
        continue;
      }
      const rel = relative(ROOT, plna).split('\\').join('/');
      if (jeTest(rel)) continue;
      const pripona = extname(e.name);
      if (PRIPONY_KODU.has(pripona)) kod.push(rel);
      else if (!PRIPONY_NEKODU.has(pripona)) neznamePripony.push(rel);
    }
  };
  projdi(join(ROOT, 'scripts'));
  return { kod: kod.sort(), neznamePripony };
}

/** Řádky kódu: komentář (`#`, `//`, `*`, `/*`) popisuje, nevolá. */
const jeKomentar = (r: string) => /^\s*(#|\/\/|\*|\/\*)/.test(r);
const radkyKodu = (text: string) => text.split('\n').filter((r) => !jeKomentar(r));

/**
 * Příkazové řádky: fyzické řádky spojené přes `\` na konci (příkaz shellu na víc
 * řádcích je JEDEN příkaz), bez celořádkových komentářů.
 */
function prikazoveRadky(text: string): string[] {
  const out: string[] = [];
  let rozpracovany: string | null = null;
  for (const r of text.split('\n')) {
    if (rozpracovany === null) {
      if (jeKomentar(r)) continue;
      rozpracovany = r;
    } else rozpracovany += ` ${r.trim()}`;
    if (/\\$/.test(rozpracovany)) {
      rozpracovany = rozpracovany.slice(0, -1);
      continue;
    }
    out.push(rozpracovany);
    rozpracovany = null;
  }
  if (rozpracovany !== null) out.push(rozpracovany);
  return out;
}

// ── detektor 1: git míří na remote JMÉNEM — TŘÍDA, ne výčet podpříkazů ──────
//
// ⛔ NAMĚŘENO 2026-10-04 (rada d8, mutační čtení W1 §2): výčet podpříkazů
// (`ls-remote|fetch|…|reset`) viděl ze 17 tvarů „git podle jména remote“ JEDEN.
// Nevidí čtení ani zápis adresy (`git config --get remote.origin.url`, `git remote
// set-url origin`), jméno ve výchozí hodnotě proměnné (`${REMOTE:-origin}`), příkaz na
// dvou řádcích ani žádný podpříkaz mimo seznam (rebase, merge, rev-list, worktree add,
// switch, branch --set-upstream-to, for-each-ref, ls-tree, archive). Třída je proto:
//   A. jméno remote jako SLOVO na příkazovém řádku, který volá git — libovolný
//      podpříkaz; volá i obal (`run("git", …)`, `tryGit(…)`);
//   B. `remote.<jméno>.` — konfigurace remote jménem;
//   C. jméno remote jako VÝCHOZÍ hodnota (`${REMOTE:-origin}`, `?? "origin"`, `|| "origin"`);
//   D. jméno remote jako argument nebo prvek seznamu (`["origin/HEAD", …]`,
//      `a.push("origin")`) v souboru, který git volá — argumenty složené mimo řádek
//      volání. Jen v takovém souboru: jinde je `'origin'` běžné slovo (HTTP, SQL).

const JMENO_REMOTE = '(?:origin|upstream)';
/** Příkazový řádek volá git: slovo `git` (ne `.git`, `git-origin`), nebo obal `xGit(`. */
const VOLA_GIT = [/(?<![\w.-])git(?![\w-])/, /[a-z]Git[A-Za-z]*\s*\(/];
/** Jméno remote jako slovo — ne část identifikátoru, proměnná (`$origin`, `${origin}`) ani `@{upstream}`. */
const SLOVO_JMENA = new RegExp(`(?<![\\w.$-])(?<!\\$\\{)(?<!@\\{)${JMENO_REMOTE}(?![\\w-])`);
const LITERAL_JMENA = `["'\`]${JMENO_REMOTE}(?:\\/[^"'\`\\n]*)?["'\`]`;
const TVARY_TRIDY: { tvar: string; jeVolani: boolean; vzor: RegExp }[] = [
  { tvar: 'B: remote.<jméno>.', jeVolani: false, vzor: new RegExp(`remote\\.${JMENO_REMOTE}\\.`) },
  {
    tvar: 'C: výchozí hodnota',
    jeVolani: false,
    vzor: new RegExp(`\\$\\{\\w+:?[-=]["']?${JMENO_REMOTE}(?![\\w-])|(?:\\?\\?|\\|\\|)\\s*${LITERAL_JMENA}`),
  },
  { tvar: 'D: argument / prvek seznamu', jeVolani: true, vzor: new RegExp(`[[,(]\\s*${LITERAL_JMENA}|${LITERAL_JMENA}(?=\\s*[,\\])])`) },
];

const volaGit = (radek: string) => VOLA_GIT.some((v) => v.test(radek));

/** Příkazové řádky, které míří gitem na remote jménem (tvary A–D; mimo komentáře). */
function gitPodleJmena(text: string): string[] {
  const radky = prikazoveRadky(text);
  const souborVolaGit = radky.some(volaGit);
  return radky
    .filter(
      (r) =>
        (volaGit(r) && SLOVO_JMENA.test(r)) ||
        TVARY_TRIDY.some((t) => (!t.jeVolani || souborVolaGit) && t.vzor.test(r)),
    )
    .map((r) => r.trim());
}

// ── výjimky: výslovně, s důvodem, se stropem a jen dokud platí ──────────────

/**
 * Výjimka míří BUĎ na řádek (úryvek), NEBO výslovně na celý soubor — a vždy nese
 * STROP `volani`: kolik výskytů v souboru omlouvá (dnešní stav). Další stejný výskyt
 * je nález (rada d8 §4: dřív výjimka na řádek kryla každý výskyt téhož textu a výjimka
 * na soubor i všechno budoucí). Vzor: nasazeni-drzene-aplikace.gate.test.ts (`volani`).
 */
type Vyjimka = { soubor: string; duvod: string; volani: number } & ({ radek: string } | { celySoubor: true });
type Nalez = { soubor: string; radek: string };

/**
 * Na ŘÁDEK jsou výjimky v souborech nasazovací cesty — cokoli dalšího v témž
 * souboru je nález. Na CELÝ SOUBOR jen nástroje, které nenasazují vůbec.
 * První tři jsou z tabulky nálezu 4 nedůvěřivého čtení; další dvě vynesl
 * rozšířený detektor (tvar pole argumentů u obalu gitu), zařazení potvrzeno
 * 2026-10-04. Poslední tři vynesla třída (tvary C a D, 2026-10-04).
 */
const VYJIMKY: Vyjimka[] = [
  {
    soubor: 'scripts/ci/deploy-and-verify.sh',
    radek: 'git ls-remote origin "$ref"',
    volani: 1,
    duvod:
      'běží v úloze CI: `origin` tam nastavuje checkout běhu na repozitář, jehož workflow se spustilo — není to zvyklost checkoutu operátora',
  },
  {
    soubor: 'scripts/aisha-cold-start.sh',
    radek: 'git push -q origin HEAD',
    volani: 1,
    duvod:
      'push v ČERSTVÉM klonu dat instance (o řádky výš ho zakládá clone_instance_data): `origin` je adresa, ze které se právě klonovalo, ne remote pracovního stromu',
  },
  {
    soubor: 'scripts/aisha-deps-update.mjs',
    celySoubor: true,
    volani: 3,
    duvod: 'vývojový nástroj (větve s aktualizací závislostí) — nenasazuje a o nasazovaném repozitáři nerozhoduje',
  },
  {
    soubor: 'scripts/cleanup-worktrees-branches.mjs',
    celySoubor: true,
    volani: 3,
    duvod: 'vývojový nástroj (úklid slitých větví a pracovních stromů vývojáře) — nenasazuje a o nasazovaném repozitáři nerozhoduje',
  },
  {
    soubor: 'scripts/acs/schema-diff.mjs',
    celySoubor: true,
    volani: 1,
    duvod:
      'kontrola zpětné kompatibility schémat v CI a při vývoji (základ srovnání; CI ho předává výslovně a `origin` tam nastavuje checkout běhu) — nenasazuje',
  },
  {
    soubor: 'scripts/aisha-env-doctor.mjs',
    radek: '.sort((a, b) => Number(b === "origin") - Number(a === "origin"))',
    volani: 1,
    duvod:
      'ZNÁMÝ NEOPRAVENÝ člen třídy v nasazovací cestě (hlavička brány, „CO DETEKTOR NEVIDÍ“): výchozí FORGEJO_URL a FORGEJO_REPO z remote řazeného `origin` napřed. Oprava čeká na rozhodnutí vlastníka — přiznaná díra, ne souhlas',
  },
  {
    soubor: 'scripts/db/refresh-baseline-from-main.mjs',
    celySoubor: true,
    volani: 1,
    duvod:
      'vývojový nástroj aktualizace PR (odvozené soubory baseline z mainu; cíl jde zadat --ref / AISHA_BASELINE_REF) — nenasazuje a o nasazovaném repozitáři nerozhoduje',
  },
  {
    soubor: 'scripts/test/brany-dotcene-spust.mjs',
    celySoubor: true,
    volani: 1,
    duvod:
      'vývojový a CI nástroj výběru dotčených bran (základ srovnání; jde zadat --base) — nenasazuje a o nasazovaném repozitáři nerozhoduje',
  },
];

const klicVyjimky = (v: Vyjimka) => `${v.soubor}: ${'celySoubor' in v ? '(celý soubor)' : v.radek}`;

function vyhodnot(nalezy: Nalez[], vyjimky: Vyjimka[]) {
  const kryje = (v: Vyjimka, n: Nalez) => v.soubor === n.soubor && ('celySoubor' in v || n.radek.includes(v.radek));
  // Výjimka omlouvá nejvýš `volani` výskytů (v pořadí v souboru); další je nález.
  const pouzito = new Map<Vyjimka, number>();
  const neomluvene: string[] = [];
  for (const n of nalezy) {
    const v = vyjimky.find((x) => kryje(x, n) && (pouzito.get(x) ?? 0) < x.volani);
    if (v) pouzito.set(v, (pouzito.get(v) ?? 0) + 1);
    else neomluvene.push(`${n.soubor}: ${n.radek}`);
  }
  return {
    neomluvene,
    mrtveVyjimky: vyjimky.filter((v) => !nalezy.some((n) => kryje(v, n))).map(klicVyjimky),
    // Strop vyšší než skutečnost by tiše omluvil budoucí výskyt — smí se jen snižovat.
    nadsazeneStropy: vyjimky
      .filter((v) => {
        const pocet = nalezy.filter((n) => kryje(v, n)).length;
        return pocet > 0 && pocet < v.volani;
      })
      .map((v) => `${klicVyjimky(v)} (strop ${v.volani}, výskytů ${nalezy.filter((n) => kryje(v, n)).length})`),
  };
}

// ── detektor 2: vlastní čtení řádků deklarace ───────────────────────────────

const KLIC = '(?:repo|branch|upstream_repo|upstream_pr)';
const TVARY_VLASTNIHO_CTENI = [
  new RegExp(`(?<![\\w-])${KLIC}:\\*\\s*\\)`), // větev `case`: repo:*)
  new RegExp(`\\$\\{\\w+#+${KLIC}:`), // ořez parametru: \${line#repo:}
  new RegExp(`\\^(?:\\\\s\\*|\\[\\[:space:\\]\\]\\*|\\[ \\\\t\\]\\*)?${KLIC}:`), // kotvený výraz: /^branch:/ (awk, grep, sed, JS)
  new RegExp(`startsWith\\(\\s*['"\`]${KLIC}:`), // JS: startsWith("branch:")
];

/** Řádky, které si deklaraci (`repo:`, `branch:`, `upstream_repo:`, `upstream_pr:`) čtou samy. */
function vlastniCteniDeklarace(text: string): string[] {
  return radkyKodu(text)
    .filter((r) => TVARY_VLASTNIHO_CTENI.some((t) => t.test(r)))
    .map((r) => r.trim());
}

// ────────────────────────────────────────────────────────────────────────────

describe('nasazení čte repozitář podle identity, ne podle jména remote', () => {
  it('krok 2b2 bere repozitář z deklarace a čte ho přes nasazovany-repozitar.mjs', () => {
    const cs = cti('scripts/aisha-cold-start.sh');
    const krok = cs.slice(cs.indexOf('step "2b2.'), cs.indexOf('step "2c.'));
    expect(krok.length, 'krok 2b2 nenalezen — brána by měřila prázdno').toBeGreaterThan(500);
    expect(krok).toMatch(/nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --deklarace/);
    expect(krok).toMatch(/nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --repo-root "\$REPO_ROOT" --cti/);
  });
});

describe('jeden výklad deklarace (rozdílový test nad tvary z nedůvěřivého čtení)', () => {
  const ENV = { FORGEJO_URL: 'https://forge.example.test' };
  /** Čtečky tak, jak se ptají: funkce za režimem CLI, který skript volá. */
  const CTECKY: Record<string, (text: string) => { vetev: string; repo: string }> = {
    'krok 2b2 a story-init (--deklarace)': (t) => {
      const d = nasazovanyRepozitar(t, ENV);
      return { vetev: d.vetev, repo: d.repo };
    },
    'doktor a měření odchylky (--vyklad)': (t) => {
      const v = zManifestu(t);
      return { vetev: v.vetev, repo: v.repo };
    },
  };
  const vysledek = (
    ctecka: (t: string) => { vetev: string; repo: string },
    text: string,
  ): { ok?: { vetev: string; repo: string }; chyba?: string } => {
    try {
      return { ok: ctecka(text) };
    } catch (e) {
      return { chyba: (e as Error).message };
    }
  };

  // Tabulka nálezu 1: co dřív dávalo tři různé odpovědi.
  const TVARY: { jmeno: string; text: string; cekam?: { vetev: string; repo: string }; chyba?: RegExp }[] = [
    { jmeno: 'hodnoty v uvozovkách', text: 'repo: "org/fork"\nbranch: "nasazeni"\n', cekam: { vetev: 'nasazeni', repo: 'org/fork' } },
    { jmeno: '`branch:` s prázdnou hodnotou', text: 'repo: org/fork\nbranch:\n', chyba: /`branch:` s PRÁZDNOU hodnotou/ },
    { jmeno: 'bez `branch:`', text: 'repo: org/fork\n', cekam: { vetev: 'main', repo: 'org/fork' } },
    { jmeno: 'dva řádky `branch:`', text: 'repo: org/fork\nbranch: prvni\nbranch: druhy\n', chyba: /2 řádky `branch:`.*nejednoznačná/ },
    { jmeno: '`branch: x   # komentář`', text: 'repo: org/fork\nbranch: x   # komentář\n', cekam: { vetev: 'x', repo: 'org/fork' } },
    // Odsazení samo úroveň nemění (story-init ho vždy toleroval) — klíč bez nadřazeného
    // kontejneru je deklarace. Vnořený klíč (řádky d8 níž) deklarace NENÍ.
    { jmeno: 'odsazený `branch:`', text: 'repo: org/fork\n  branch: odsazena\n', cekam: { vetev: 'odsazena', repo: 'org/fork' } },
    { jmeno: 'hodnota s mezerou uvnitř', text: 'repo: org/fork\nbranch: dve slova\n', chyba: /`branch:` s mezerou uvnitř/ },
    { jmeno: 'bez `repo:`', text: 'branch: main\n', chyba: /nemá `repo:`/ },
    // Neznámý tvar se odmítá, neopravuje — párové uvozovky (první řádek tabulky) projdou.
    { jmeno: 'nepárová uvozovka', text: 'repo: org/fork\nbranch: "x\n', chyba: /`branch:` s NEPÁROVOU uvozovkou/ },
    { jmeno: 'text za uzavírací uvozovkou', text: 'repo: "org/fork" navic\n', chyba: /`repo:` s textem za uzavírací uvozovkou/ },
    {
      jmeno: 'klíče upstreamu vedle deklarace',
      text: 'repo: org/fork\nbranch: nasazeni/x\nupstream_repo: org/zdroj\nupstream_pr: "PR #12"\n',
      cekam: { vetev: 'nasazeni/x', repo: 'org/fork' },
    },
    // Tabulka rady d8 (§3): tvary, které vykladač dřív přijal MLČKY.
    { jmeno: '`branch: fix#12` (dřív tiše `fix`)', text: 'repo: org/fork\nbranch: fix#12\n', chyba: /`branch:` s `#` přilepeným k hodnotě/ },
    { jmeno: '`branch: "fix#12"` — uvozená hodnota celá', text: 'repo: org/fork\nbranch: "fix#12"\n', cekam: { vetev: 'fix#12', repo: 'org/fork' } },
    { jmeno: '`branch: --upload-pack=x`', text: 'repo: org/fork\nbranch: --upload-pack=x\n', chyba: /`branch:`.*začíná `-`/ },
    { jmeno: '`repo: ../../jiny/x`', text: 'repo: ../../jiny/x\n', chyba: /`repo:`.*nevykládám/ },
    { jmeno: '`repo: https://jinde/…`', text: 'repo: https://jinde.example.test/org/x\n', chyba: /`repo:`.*nevykládám: čekám `org\/jméno`/ },
    { jmeno: 'klíč vnořený pod jiným mapováním', text: 'repo: org/fork\npovrch:\n  branch: jina\n', cekam: { vetev: 'main', repo: 'org/fork' } },
    { jmeno: 'jen vnořený `repo:`', text: 'povrch:\n  repo: jiny/x\nbranch: main\n', chyba: /nemá `repo:`/ },
    { jmeno: '`branch:` v blokovém textu', text: 'repo: org/fork\npopis: |\n  branch: z-textu\n  repo: jiny/x\n', cekam: { vetev: 'main', repo: 'org/fork' } },
    { jmeno: '`branch: ~`', text: 'repo: org/fork\nbranch: ~\n', chyba: /`branch:`.*nevykládám/ },
    { jmeno: 'typografické uvozovky', text: 'repo: org/fork\nbranch: “nasazeni”\n', chyba: /`branch:` s typografickou uvozovkou/ },
    // Otevřený bod d8 (dotažení): mezera před dvojtečkou — dřív tichý návrat k `main`.
    { jmeno: '`branch : x` (mezera před dvojtečkou)', text: 'repo: org/fork\nbranch : nasazeni\n', chyba: /klíč deklarace `branch` s mezerou před dvojtečkou/ },
  ];

  it.each(TVARY)('$jmeno → všechny čtečky týž výsledek, nebo tutéž chybu', ({ text, cekam, chyba }) => {
    const odpovedi = Object.entries(CTECKY).map(([kdo, ctecka]) => ({ kdo, ...vysledek(ctecka, text) }));
    expect(Boolean(cekam) !== Boolean(chyba), 'řádek tabulky musí čekat BUĎ výsledek, NEBO chybu').toBe(true);
    for (const o of odpovedi) {
      if (cekam) expect(o.ok, `${o.kdo}: ${o.chyba ?? ''}`).toEqual(cekam);
      if (chyba) expect(o.chyba ?? '', `${o.kdo} měl deklaraci odmítnout, vrátil ${JSON.stringify(o.ok)}`).toMatch(chyba);
    }
    // Rozdíl MEZI čtečkami je to, co se měří — ne jen shoda s očekáváním.
    const zapis = (o: { ok?: { vetev: string; repo: string }; chyba?: string }) => (o.ok ? `ok ${o.ok.vetev} ${o.ok.repo}` : `chyba ${o.chyba}`);
    expect([...new Set(odpovedi.map(zapis))], JSON.stringify(odpovedi)).toHaveLength(1);
  });

  it('bez `branch:`, v prostředí GIT_BRANCH → výklad zůstane `main` a rozpor se odmítne — už v kroku 2b2', () => {
    // Nález 1a: dřív z větve prostředí Coolify STAVĚL, zatímco krok 2b2 měřil main.
    const vyklad = zManifestu('repo: org/fork\n');
    expect(vyklad.vetev).toBe('main');
    // Co tvrdí PROSTŘEDÍ, čte vykladač sám — jedno místo ví, že tvrzením je GIT_BRANCH.
    // (Recenze 2026-10-04: znal ho jen story-init, takže běh spadl až po odloženém wipu.)
    expect(tvrzeniProstredi({ GIT_BRANCH: 'z-prostredi' })).toEqual(['branch:GIT_BRANCH v prostředí=z-prostredi']);
    expect(tvrzeniProstredi({ GIT_BRANCH: '  ' }), 'prázdná hodnota = prostředí mlčí').toEqual([]);
    expect(tvrzeniProstredi({})).toEqual([]);
    expect(rozporyDeklarace(vyklad, tvrzeniProstredi({ GIT_BRANCH: 'z-prostredi' }))[0]).toMatch(
      /GIT_BRANCH v prostředí tvrdí větev 'z-prostredi', manifest deklaruje 'main'.*větev se deklaruje v manifestu/,
    );
    expect(rozporyDeklarace(vyklad, tvrzeniProstredi({ GIT_BRANCH: 'main' })), 'shodná větev rozpor není').toEqual([]);
    // Story-init přidává jen to, co má navíc z příkazové řádky: --branch a --repo.
    const tvrdi = (vetevCli: string, repoCli: string) => rozporyDeklarace(vyklad, [`branch:--branch=${vetevCli}`, `repo:--repo=${repoCli}`]);
    expect(tvrdi('z-radky', '')[0]).toMatch(/--branch tvrdí větev 'z-radky'/);
    // Totéž pro repozitář: --repo vedle manifestu dřív manifest tiše přebil.
    expect(tvrdi('', 'jiny/repo')[0]).toMatch(
      /--repo tvrdí repozitář 'jiny\/repo', manifest deklaruje 'org\/fork'.*repozitář se deklaruje v manifestu/,
    );
    // Shodná nebo mlčící strana rozpor není.
    expect(tvrdi('main', 'org/fork')).toEqual([]);
    expect(tvrdi('', '')).toEqual([]);
    // Neznámý tvar tvrzení se odmítá.
    expect(() => rozporyDeklarace(vyklad, ['GIT_BRANCH v prostředí=x'])).toThrow(/čekám <klíč>:<kanál>=<hodnota>/);
  });

  it('story-init bere repozitář i větev JEN z pomocníka a rozpor kanálů mu předává', () => {
    const si = cti('scripts/coolify-story-init.sh');
    // Prostředí porovnává vykladač sám (čte GIT_BRANCH) — story-init mu jen vrací hodnotu,
    // která z prostředí opravdu přišla (GIT_BRANCH je tu i pracovní proměnná), a přidává
    // to, co má navíc z příkazové řádky.
    const volani = /GIT_BRANCH="\$GIT_BRANCH_Z_PROSTREDI" node "\$\{SCRIPT_DIR\}\/lib\/nasazovany-repozitar\.mjs"[\s\\]+--manifest "\$MANIFEST_FILE" --deklarace[\s\\]+--tvrdi "branch:--branch=\$\{GIT_BRANCH_Z_CLI\}"[\s\\]+--tvrdi "repo:--repo=\$\{REPO_PATH\}"/;
    expect(si, 'story-init nevolá výklad deklarace (nebo mu nepředává hodnotu z prostředí, --branch a --repo)').toMatch(volani);
    expect(radkyKodu(si).join('\n'), 'rozpor s prostředím nesmí story-init vyhodnocovat vlastním tvrzením — čte ho vykladač').not.toMatch(
      /--tvrdi "branch:GIT_BRANCH/,
    );
    // --repo se vykladači předává DŘÍV, než REPO_PATH přepíše hodnota z manifestu.
    expect(si.search(volani), 'porovnání --repo musí předejít přepsání REPO_PATH').toBeLessThan(si.indexOf('REPO_PATH="$_dekl_repo"'));
    const zaVolanim = si.slice(si.search(volani));
    expect(zaVolanim.slice(0, 900), 'nenulový kód výkladu musí story-init zastavit').toMatch(/if \[ "\$_dekl_rc" -ne 0 \]; then[\s\S]{0,300}?exit 1/);
    expect(zaVolanim.slice(0, 1200), 'repozitář a větev do Coolify musí být hodnoty z výkladu').toMatch(
      /REPO_PATH="\$_dekl_repo"\s+GIT_BRANCH="\$_dekl_vetev"/,
    );
    // Hodnota z prostředí se musí zachytit DŘÍV, než ji přepíše výchozí `main` —
    // jinak by „prostředí mlčí“ a „prostředí říká main“ nešlo rozlišit.
    const zachyt = si.indexOf('GIT_BRANCH_Z_PROSTREDI="${GIT_BRANCH:-}"');
    const vychozi = si.indexOf('GIT_BRANCH="${GIT_BRANCH:-main}"');
    expect(zachyt, 'story-init nezachytává GIT_BRANCH z prostředí').toBeGreaterThan(-1);
    expect(vychozi, 'ruční režim bez manifestu má dál výchozí větev').toBeGreaterThan(zachyt);
    expect(si, '--branch se musí zachytit jako tvrzení kanálu').toMatch(/--branch\)\s+GIT_BRANCH_Z_CLI="\$2"; GIT_BRANCH="\$2"; shift 2 ;;/);
  });

  it('story-init skládá prostředí ze zálohy BĚHU — týž soubor jako cold-start a doktor', () => {
    // Jinak vidí jinou GIT_BRANCH (a projekt, adresu Forgeja) než krok 2b2 před wipem.
    const kod = radkyKodu(cti('scripts/lib/resolve-domains-env.sh')).join('\n');
    const zaloha = /\$\{ENV_PROD_BACKUP:-\$PROJECT_ROOT\/\.env-prod-backup\}/g;
    expect(kod.match(zaloha) ?? [], 'test existence i načtení musí jmenovat TÝŽ soubor').toHaveLength(2);
    expect(kod, 'záloha se načítá příkazem source nad týmž výrazem').toMatch(
      /\n\s*\. "\$\{ENV_PROD_BACKUP:-\$PROJECT_ROOT\/\.env-prod-backup\}"/,
    );
    expect(kod, 'záloha v kořeni jmenovaná napevno = v běhu jiného prostředí cizí soubor').not.toMatch(/"\$PROJECT_ROOT\/\.env-prod-backup"/);
    expect(cti('scripts/coolify-story-init.sh'), 'story-init si prostředí skládá sdíleným skriptem').toMatch(
      /\. "\$REPO_ROOT_GUESS\/scripts\/lib\/resolve-domains-env\.sh"/,
    );
    // Cold-start zálohu běhu dětem předává.
    expect(cti('scripts/aisha-cold-start.sh')).toMatch(/export ENV_FILE="\$ENV_COOLIFY" ENV_PROD_BACKUP/);
  });

  it('doktor, měření odchylky větve a povrchy se ptají pomocníka', () => {
    const doktor = cti('scripts/cold-start-doctor.sh');
    expect(doktor, 'repo kontraktu CI z deklarace').toMatch(/nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --vyklad/);
    expect(doktor, 'rozpor deklarace s prostředím už v kroku 0 (týž vykladač jako krok 2b2 a story-init)').toMatch(
      /nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --vyklad --tvrdi-prostredi 2>"\$_dn_chyby"\)" \|\| _dn_rc=\$\?[\s\S]{0,400}?fail "deklarace nasazení nejde použít/,
    );
    expect(doktor, 'deklarovaná adresa Forgeja jedním pravidlem (FORGEJO_URL, jinak FORGEJO_DOMAIN)').toMatch(
      /nasazovany-repozitar\.mjs" --zaklad/,
    );
    const kodFazeG = radkyKodu(doktor.slice(doktor.indexOf('phase G "Forgejo'), doktor.indexOf('# Phase K'))).join('\n');
    expect(kodFazeG.length, 'fáze G nenalezena — brána by měřila prázdno').toBeGreaterThan(500);
    expect(kodFazeG, 'fáze G nesmí číst FORGEJO_URL ani FORGEJO_DOMAIN vlastním pravidlem').not.toMatch(/\$\{?FORGEJO_(URL|DOMAIN)\b/);
    expect(doktor, 'adresa Forgeja z remote podle identity').toMatch(
      /nasazovany-repozitar\.mjs" --manifest "\$MANIFEST" --repo-root "\$REPO_ROOT" --remote/,
    );
    const odchylka = cti('scripts/lib/deploy-vetev-odchylka.sh');
    expect(odchylka, 'větev z výkladu').toMatch(/nasazovany-repozitar\.mjs" --manifest "\$manifest" --vyklad/);
    expect(odchylka, 'tip z remote podle identity').toMatch(/nasazovany-repozitar\.mjs" --manifest "\$manifest" --repo-root "\$repo" --remote/);
    expect(odchylka, 'tip jen ze sledovací reference toho remote').toMatch(
      /rev-parse --verify -q "refs\/remotes\/\$\{_nas_remote\}\/\$\{_deploy_branch\}\^\{commit\}"/,
    );
    const povrchy = cti('scripts/provision-surfaces.sh');
    expect(povrchy, 'výchozí repozitář povrchu z remote podle identity').toMatch(
      /nasazovany-repozitar\.mjs" --manifest "\$_ps_manifest" --repo-root "\$_ps_koren" --remote/,
    );
    expect(povrchy, 'výchozí větev povrchu z deklarace manifestu').toMatch(/nasazovany-repozitar\.mjs" --manifest "\$_ps_manifest" --vyklad/);
    expect(radkyKodu(povrchy).join('\n'), 'větev povrchu nesmí mít pevnou výchozí hodnotu').not.toMatch(/AISHA_SURFACE_BRANCH:-\w/);
  });

  it('vlastní čtení řádků deklarace není NIKDE ve scripts/ — jen v pomocníkovi', () => {
    const { kod } = souboryScripts();
    // Kontrola univerza: čtečky i vykladač v něm musí být, jinak by „nic nenalezeno“ bylo slepé.
    for (const f of [POMOCNIK, 'scripts/coolify-story-init.sh', 'scripts/cold-start-doctor.sh', 'scripts/lib/deploy-vetev-odchylka.sh']) {
      expect(kod, `${f} není v univerzu — chůze stromem je slepá`).toContain(f);
    }
    const nalezy = kod.filter((f) => f !== POMOCNIK).flatMap((f) => vlastniCteniDeklarace(cti(f)).map((r) => `${f}: ${r}`));
    expect(nalezy, `deklaraci vykládá jen ${POMOCNIK} (--vyklad / --deklarace) — druhé pravidlo se rozejde`).toEqual([]);
  });

  it('sebetest detektoru vlastního čtení (pozitivní kotva = tvary, které tu dřív stály)', () => {
    for (const radek of [
      'repo:*)   REPO_PATH="${line#repo:}" ; REPO_PATH=$(echo "$REPO_PATH" | xargs) ;;',
      '      branch:*) GIT_BRANCH="${line#branch:}" ;;',
      'x="${line#branch:}"',
      `_deploy_branch="$(awk -F: '/^branch:/ { print $2; exit }' "$manifest")"`,
      `grep -E '^[[:space:]]*repo:' "$MANIFEST"`,
      'if (r.startsWith("branch:")) vetev = r.slice(7);',
      `_deklarovany="$(awk -F: '/^upstream_repo:/ { print $2; exit }' "$manifest")"`,
      `_pr="$(awk -F: '/^upstream_pr:/ { print $2; exit }' "$manifest")"`,
    ]) {
      expect(vlastniCteniDeklarace(radek), radek).toHaveLength(1);
    }
    for (const radek of [
      '# branch:*) v komentáři',
      `grep -E '^app:' "$manifest"`,
      '_duvod="upstream repo není deklarované (AISHA_UPSTREAM_REPO / upstream_repo: v manifestu)"',
      `err "  v manifestu přepiš 'branch:' na větev, kterou chceš nasadit."`,
      'story:*)  STORY_NAME="${line#story:}" ;;',
      '`repo: org/${PREFIX}-orchestrator`,',
    ]) {
      expect(vlastniCteniDeklarace(radek), radek).toHaveLength(0);
    }
  });
});

describe('třída: nic ve scripts/ nemíří gitem na remote jménem', () => {
  const nalezyStromu = (): Nalez[] => souboryScripts().kod.flatMap((f) => gitPodleJmena(cti(f)).map((radek) => ({ soubor: f, radek })));

  it('měří se CELÉ scripts/ — každá přípona je zařazená jako kód, nebo jako nekód', () => {
    const { kod, neznamePripony } = souboryScripts();
    expect(kod.length, 'chůze stromem je slepá').toBeGreaterThan(400);
    for (const f of ['scripts/cold-start-doctor.sh', 'scripts/lib/deploy-vetev-odchylka.sh', 'scripts/provision-surfaces.sh', 'scripts/ci/deploy-and-verify.sh']) {
      expect(kod, `${f} není v univerzu`).toContain(f);
    }
    expect(neznamePripony, 'nová přípona ve scripts/: zařaď ji do PRIPONY_KODU (měří se), nebo do PRIPONY_NEKODU').toEqual([]);
  });

  it('sebetest univerza: neznámá přípona se NEVYNECHÁ mlčky, test a node_modules se přeskočí (kontrolní vzorek)', () => {
    const soubor = (name: string): Polozka => ({ name, isDirectory: () => false });
    const adresar = (name: string): Polozka => ({ name, isDirectory: () => true });
    const strom: Record<string, Polozka[]> = {
      [join(ROOT, 'scripts')]: [soubor('a.sh'), soubor('b.md'), soubor('c.yml'), soubor('d.test.mjs'), adresar('lib'), adresar('node_modules')],
      [join(ROOT, 'scripts', 'lib')]: [soubor('e.mjs'), soubor('f.toml')],
      [join(ROOT, 'scripts', 'node_modules')]: [soubor('g.js')],
    };
    const { kod, neznamePripony } = souboryScripts((a) => strom[a] ?? []);
    expect(kod).toEqual(['scripts/a.sh', 'scripts/lib/e.mjs']);
    expect(neznamePripony, 'soubor, který není kód ani známý nekód, se musí ohlásit').toEqual(['scripts/c.yml', 'scripts/lib/f.toml']);
  });

  it('⛔ SAMOTEST na skutečném stromu: známé členy třídy detektor NAJDE — jinak je brána NEZMĚŘENO, ne zelená', () => {
    const nalezy = nalezyStromu();
    for (const [soubor, kus, tvar] of [
      ['scripts/ci/deploy-and-verify.sh', 'git ls-remote origin "$ref"', 'A'],
      ['scripts/aisha-cold-start.sh', 'git push -q origin HEAD', 'A (příkaz pokračuje přes `\\`)'],
      ['scripts/aisha-env-doctor.mjs', 'Number(b === "origin")', 'D'],
      ['scripts/db/refresh-baseline-from-main.mjs', '|| "origin/main"', 'C'],
      ['scripts/test/brany-dotcene-spust.mjs', '["origin/HEAD", "origin/main"]', 'D'],
    ]) {
      expect(
        nalezy.filter((n) => n.soubor === soubor && n.radek.includes(kus)),
        `NEZMĚŘENO: detektor ve ${soubor} nenašel známé volání (${tvar}: ${kus}) — hledá něco, co v repu není`,
      ).toHaveLength(1);
    }
  });

  it('žádný nález mimo výslovné výjimky — žádná výjimka, která už neplatí, a žádný nadsazený strop', () => {
    const { neomluvene, mrtveVyjimky, nadsazeneStropy } = vyhodnot(nalezyStromu(), VYJIMKY);
    expect(neomluvene, `remote vyber podle identity URL — ${POMOCNIK} (--remote / --cti)`).toEqual([]);
    expect(mrtveVyjimky, 'výjimka už v souboru není — smaž ji, seznam nesmí hnít').toEqual([]);
    expect(nadsazeneStropy, 'výskytů je méně než strop výjimky — sniž ho (seznam se smí jen zmenšovat)').toEqual([]);
  });

  it('každá výjimka nese důvod, strop výskytů a míří na řádek, nebo výslovně na celý soubor', () => {
    for (const v of VYJIMKY) {
      expect(v.duvod.trim().length, `${v.soubor}: výjimka bez důvodu`).toBeGreaterThan(40);
      expect(Number.isInteger(v.volani) && v.volani >= 1, `${v.soubor}: výjimka bez stropu výskytů`).toBe(true);
      if (!('celySoubor' in v)) {
        expect(v.radek.trim().length, `${v.soubor}: krátký úryvek by omluvil i jiné řádky`).toBeGreaterThan(12);
      }
    }
    const klice = VYJIMKY.map(klicVyjimky);
    expect(new Set(klice).size, 'dvakrát táž výjimka').toBe(klice.length);
    // Nasazovací cesta nesmí dostat výjimku na celý soubor — tam se omlouvá jen řádek.
    const nasazovaci = [
      'scripts/aisha-cold-start.sh',
      'scripts/cold-start-doctor.sh',
      'scripts/coolify-story-init.sh',
      'scripts/provision-surfaces.sh',
      'scripts/lib/deploy-vetev-odchylka.sh',
      'scripts/ci/deploy-and-verify.sh',
      'scripts/aisha-env-doctor.mjs',
    ];
    expect(VYJIMKY.filter((v) => 'celySoubor' in v && nasazovaci.includes(v.soubor)).map((v) => v.soubor)).toEqual([]);
  });

  it('sebetest detektoru (pozitivní kotva: každý tvar třídy A–D, i ty, které výčet podpříkazů neviděl)', () => {
    const najde = [
      // A — dřívější výčet
      'x="$(git -C "$R" ls-remote origin "refs/heads/main")"',
      'git rev-parse upstream/main',
      '_tip="$(git -C "$repo" rev-parse --verify -q "origin/${_deploy_branch}" 2>/dev/null || true)"',
      '_remote_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"',
      '&& git push -q origin HEAD ) || rc=$?',
      'git show origin/main:package.json',
      'git checkout -B vetev origin/main',
      'git reset --hard upstream/main',
      'run("git", ["fetch", "origin", base, "--quiet"]);',
      'run("git", ["checkout", "-B", branch, `origin/${base}`]);',
      "tryGit(['fetch', 'origin', 'main', '--quiet']);",
      "const remote = tryGit(['remote', 'get-url', 'origin']).trim();",
      // A — tabulka rady d8 (§2): podpříkazy mimo výčet, zápis adresy remote
      'git remote set-url origin "$URL"',
      'git rebase origin/main',
      'git merge --ff-only upstream/main',
      'git rev-list --count origin/main..HEAD',
      'git worktree add ../x origin/main',
      'git switch -c x origin/main',
      'git branch --set-upstream-to=origin/main',
      'git for-each-ref refs/remotes/origin',
      'git ls-tree -r origin/main',
      'git archive --format=tar origin/main',
      'a.push("origin"); execFileSync("git", a);',
      // B — konfigurace remote jménem (i bez slova git na řádku)
      'git config --get remote.origin.url',
      'KLIC=remote.upstream.pushurl',
      // C — jméno remote jako výchozí hodnota proměnné
      'REMOTE="${REMOTE:-origin}"; git fetch "$REMOTE"',
      'R="${NAS_REMOTE:=upstream}"',
      'const r = process.env.REMOTE ?? "origin";',
      "const zaklad = argv.base || 'upstream/main';",
      // A — příkaz pokračující na dalším řádku je JEDEN příkaz
      'git fetch \\\n  origin main',
      'git -C "$R" \\\n  ls-remote \\\n  upstream "$ref"',
      // D — argumenty složené mimo řádek volání, v souboru, který git volá
      ['for (const kandidat of ["origin/HEAD", "origin/main"]) {', '  execFileSync("git", ["rev-parse", "--verify", kandidat]);', '}'].join('\n'),
      ['const args = ["fetch"];', 'args.push("upstream");', 'spawnSync("git", args);'].join('\n'),
    ];
    for (const text of najde) expect(gitPodleJmena(text), text).toHaveLength(1);
    const nenajde = [
      '# git ls-remote origin — jen komentář',
      '// git fetch origin',
      'git ls-remote "$URL" refs/heads/main',
      'git -C "$repo" rev-parse --verify -q "refs/remotes/${_nas_remote}/${_deploy_branch}^{commit}"',
      'AISHA_SURFACE_REPO="$(git -C "$_ps_koren" remote get-url "$_ps_jmeno")"',
      '_forgejo_url="$(node "$REPO_ROOT/scripts/lib/git-origin.mjs" "$_nas_url" 2>/dev/null || true)"',
      'import { originRepo } from "./git-origin.mjs";',
      "tryGit(['rev-parse', '--abbrev-ref', 'HEAD']);",
      // sledovaná větev a přepínač nejsou jméno remote; proměnná se jménem `origin` taky ne
      'git rev-parse --abbrev-ref --symbolic-full-name @{upstream}',
      'git branch --set-upstream-to="$NAS_REMOTE/main"',
      'git fetch "$origin" main',
      // `origin` jako běžné slovo v souboru, který git nevolá (HTTP, SQL)
      ['const hlavicky = ["origin", "referer"];', 'fetch(url, { headers: hlavicky });'].join('\n'),
      `  -c "SET session_replication_role = 'origin';" 2>&1 | tail -5`,
      // NEVIDÍ (hlavička brány): jiné jméno remote než origin/upstream
      'git fetch fork main',
    ];
    for (const text of nenajde) expect(gitPodleJmena(text), text).toHaveLength(0);
  });

  it('sebetest výjimek: neomluvený nález, DRUHÝ výskyt nad strop, mrtvá výjimka i nadsazený strop bránu shodí', () => {
    const vyjimky: Vyjimka[] = [
      { soubor: 'scripts/a.sh', radek: 'git fetch origin', volani: 1, duvod: 'zkouška' },
      { soubor: 'scripts/zmizel.sh', radek: 'git pull origin', volani: 1, duvod: 'zkouška' },
      { soubor: 'scripts/nastroj.mjs', celySoubor: true, volani: 2, duvod: 'zkouška' },
      { soubor: 'scripts/opraveny-nastroj.mjs', celySoubor: true, volani: 1, duvod: 'zkouška' },
      { soubor: 'scripts/zmenseny.mjs', celySoubor: true, volani: 3, duvod: 'zkouška' },
    ];
    const nalezy: Nalez[] = [
      // Týž soubor, JINÝ řádek — a před omluveným: výjimka na řádek ho nekryje.
      { soubor: 'scripts/a.sh', radek: 'git push origin HEAD' },
      { soubor: 'scripts/a.sh', radek: 'git fetch origin main' },
      // DRUHÝ výskyt téhož úryvku v témže souboru: strop 1 → nález (rada d8 §4).
      { soubor: 'scripts/a.sh', radek: 'git fetch origin main --tags' },
      // Týž řádek v JINÉM souboru: výjimka ho nekryje.
      { soubor: 'scripts/b.sh', radek: 'git fetch origin main' },
      // Výjimka na celý soubor kryje jen tolik výskytů, kolik říká strop — třetí je nález.
      { soubor: 'scripts/nastroj.mjs', radek: "git(['fetch', 'origin'])" },
      { soubor: 'scripts/nastroj.mjs', radek: "git(['push', 'origin'])" },
      { soubor: 'scripts/nastroj.mjs', radek: "git(['pull', 'origin'])" },
      { soubor: 'scripts/zmenseny.mjs', radek: "git(['fetch', 'origin'])" },
    ];
    const v = vyhodnot(nalezy, vyjimky);
    expect(v.neomluvene).toEqual([
      'scripts/a.sh: git push origin HEAD',
      'scripts/a.sh: git fetch origin main --tags',
      'scripts/b.sh: git fetch origin main',
      "scripts/nastroj.mjs: git(['pull', 'origin'])",
    ]);
    // Mrtvá je výjimka na řádek, který zmizel, i na soubor, ve kterém už nález není.
    expect(v.mrtveVyjimky).toEqual(['scripts/zmizel.sh: git pull origin', 'scripts/opraveny-nastroj.mjs: (celý soubor)']);
    // Strop vyšší než skutečnost by budoucí výskyty omluvil předem.
    expect(v.nadsazeneStropy).toEqual(['scripts/zmenseny.mjs: (celý soubor) (strop 3, výskytů 1)']);
    expect(vyhodnot([], [])).toEqual({ neomluvene: [], mrtveVyjimky: [], nadsazeneStropy: [] });
  });
});
