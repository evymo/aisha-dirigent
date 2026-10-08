/**
 * nasazovany-repozitar.mjs — ZE KTERÉHO repozitáře a větve Coolify opravdu staví.
 *
 * ⛔ NAMĚŘENO 2026-10-03 (konvergence instance forku, krok 4): cold-start krok 2b2
 * porovnával strom s `git ls-remote origin` — se JMÉNEM remote. Ve fork checkoutu je
 * `origin` upstream, zatímco Coolify instance staví z repozitáře forku (všech
 * 33 aplikací na `<fork>-orchestrator.git`). Krok hlásil „Nasadil by se JINÝ kód“,
 * i když strom s větví, ze které se staví, souhlasil — a obráceně by stejně
 * snadno odhlásil shodu proti repozitáři, ze kterého se nestaví.
 *
 * Zdroj pravdy je deklarace: `FORGEJO_URL` (jinak `https://FORGEJO_DOMAIN`) + `repo:`
 * a `branch:` manifestu. Lokální remote se pak vybírá podle IDENTITY URL
 * (`originRepo`: host/org/repo), ne podle jména — `origin`, `upstream`, `fork` jsou
 * zvyklost, ne vlastnost.
 *
 * ⛔ JEDEN VÝKLAD DEKLARACE (nedůvěřivé čtení 2026-10-03, nález 1): `repo:` a `branch:`
 * četla TŘI různá pravidla — story-init (zapisuje do Coolify), tenhle pomocník
 * (krok 2b2) a doktor (awk). Nad manifestem bez `branch:` a s `GIT_BRANCH` v prostředí
 * stavěl story-init z větve prostředí, zatímco krok 2b2 porovnal strom s `main`.
 * Vykladač je proto JEDEN — `zManifestu` — a všichni ostatní se ptají jeho. Vykládá
 * čtyři klíče: `repo:`, `branch:`, `upstream_repo:` a `upstream_pr:` (poslední dva
 * čte měření odchylky deploy větve). Pravidla:
 *   · komentář začíná `#` na začátku hodnoty nebo PO mezeře — pryč, ořez, PÁROVÉ
 *     uvozovky kolem hodnoty pryč; `#` UVNITŘ párových uvozovek je součást hodnoty;
 *   · `#` PŘILEPENÝ k holé hodnotě (`fix#12`) → chyba: komentář to není a uříznout ho
 *     by byl odhad (dřív tiše `fix`); v uvozovkách se hodnota čte celá;
 *   · jiný tvar s uvozovkou (nepárová, text za uzavírací, typografická v jménu
 *     repozitáře nebo větve) → chyba — neznámý tvar se odmítá, neopravuje;
 *   · blokový text (`branch: |`, `>`) → chyba: deklarace je hodnota na řádku klíče;
 *   · `repo:` povinné; `branch:` chybí → `main`; `upstream_*` chybět smí;
 *   · klíč s PRÁZDNOU hodnotou → chyba (prázdná deklarace není výchozí hodnota);
 *   · DVA řádky téhož klíče → chyba (nejednoznačná deklarace);
 *   · klíč deklarace s mezerou/tabulátorem před dvojtečkou (`branch : x`) → chyba
 *     (dřív se tiše nečetl a platila výchozí hodnota);
 *   · hodnota s mezerou uvnitř → chyba (kromě `upstream_pr:`, to je text do hlášky);
 *   · TVAR: `repo:` jen `org/jméno` ze znaků A–Z a–z 0–9 . _ - (bez `..`, schématu
 *     a hostitele — skládá se z něj adresa `<Forgejo>/<repo>.git`); `branch:` jen jméno
 *     větve gitu (podmnožina `git check-ref-format --branch`; mimo jiné nezačíná `-`,
 *     doputovala by volajícím jako přepínač gitu).
 * KONTEJNER: deklarace jsou klíče NEJVYŠŠÍ úrovně manifestu — plochého seznamu řádků
 * (šablona coolify/manifests/_template.manifest; změřeno 2026-10-04: 4 manifesty v repu
 * a 5 v overlayích instancí píšou klíče od prvního sloupce, žádný řádek odsazený nemají).
 * Samotné odsazení úroveň nemění: story-init (zapisuje do
 * Coolify) ho vždy toleroval a výklad to drží (testy „odsazený `branch:`“). Řádek pod
 * řádkem, který OTEVÍRÁ vnořený kontejner (`klíč:` bez hodnoty, `klíč: |` / `>`), s větším
 * odsazením ale patří tomu kontejneru — vnořený klíč ani text bloku deklarace nejsou.
 * Chyba = nenulový kód s vysvětlením. Nehádá se.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (rada d8, mutační čtení W1): vykladač mlčky přijal `branch: fix#12`
 * (→ `fix`), `branch: --upload-pack=x`, `repo: ../../jiny/x`, `repo: https://jinde/…`,
 * `branch: ~`, typografické uvozovky, a za deklaraci vzal klíč vnořený pod jiným
 * mapováním i řádek blokového textu (`popis: |`). Teď je každý z těch tvarů chyba
 * se jmenovaným důvodem, nebo (vnořený klíč) výslovně ne-deklarace.
 *
 * CLI (volají aisha-cold-start.sh krok 2b2, coolify-story-init.sh, cold-start-doctor.sh,
 * lib/deploy-vetev-odchylka.sh, provision-surfaces.sh):
 *   --zaklad                                → "<adresa Forgeja bez údajů>\t<FORGEJO_URL|FORGEJO_DOMAIN>"
 *                                             (jen prostředí; nedeklarovaná adresa = kód 2)
 *   --manifest <f> --vyklad                 → "<větev>\t<repo>"                    (jen manifest; bez sítě i prostředí,
 *                                             pokud volající nepřidá --tvrdi-prostredi)
 *                                             + řádky "upstream_repo\t<h>" / "upstream_pr\t<h>", když je manifest nese
 *   --manifest <f> --deklarace              → "<větev>\t<url bez údajů>\t<repo>"   (bez sítě; potřebuje adresu Forgeja)
 *   --manifest <f> --repo-root <r> --remote → "<remote>\t<url remote bez údajů>"   (bez sítě)
 *   --manifest <f> --repo-root <r> --cti    → "<sha>\t<větev>\t<url>\t<remote|->"
 * K režimům s manifestem: --tvrdi "<klíč>:<kanál>=<hodnota>" (opakovatelné; klíč je
 * `branch` nebo `repo`) — hodnota, kterou tvrdí JINÝ kanál než manifest (přepínač
 * volajícího). Prázdná hodnota = kanál mlčí; shodná projde. Liší-li se od
 * deklarované, je to rozpor (kód 2): větev i repozitář se deklarují v manifestu,
 * jiný kanál je nesmí tiše přebít ani být tiše přehlédnut.
 *
 * ⛔ CO TVRDÍ PROSTŘEDÍ, POROVNÁVÁ VYKLADAČ SÁM (recenze 2026-10-04). `GIT_BRANCH`
 * v prostředí znal jen story-init (krok 3) — běh s jinou větví v prostředí prošel
 * doktorem i krokem 2b2 a spadl až PO kroku 2c (odložený wipe): instance smazaná,
 * aplikace nezaložené. Režimy `--deklarace` a `--cti` proto čtou `GIT_BRANCH`
 * z vlastního prostředí vždy (neprázdný = tvrzení kanálu „GIT_BRANCH v prostředí“);
 * režimům `--vyklad` a `--remote` to zapne `--tvrdi-prostredi` (doktor: táž kontrola
 * bez adresy Forgeja). Kdo se ptá na deklaraci nasazení, dostane tedy týž verdikt
 * v kroku 0, v kroku 2b2 i ve story-initu — pokud vidí totéž prostředí.
 * Kódy: 0 ok · 2 deklarace neúplná, nejednoznačná nebo v rozporu s jiným kanálem
 *       · 3 větev nejde přečíst (prázdno ≠ shoda)
 *       · 4 remote checkoutu pro nasazovaný repozitář nejde určit.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { originRepo } from "./git-origin.mjs";
import { isDirectRun } from "./cli-entry.mjs";

/**
 * Proč `repo:` není cesta repozitáře na Forgeji; `null` = je. Z hodnoty se skládá
 * adresa `<Forgejo>/<repo>.git` (story-init ji zapíše do Coolify, krok 2b2 z ní čte
 * větev) — schéma, hostitel nebo `..` by adresu tiše přesměrovaly jinam.
 */
function vadaRepozitare(repo) {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    return "čekám `org/jméno` ze znaků A–Z a–z 0–9 . _ - (bez schématu, hostitele a dalších lomítek)";
  }
  if (repo.includes("..") || /(^|\/)\.(\/|$)/.test(repo)) return "cesta nese `..` nebo část `.`";
  return null;
}

/**
 * Pravidla jména větve — podmnožina `git check-ref-format --branch`. Hodnota doputuje
 * volajícím jako argument gitu (`ls-remote … refs/heads/<větev>`) a do Coolify.
 * Řídicí znaky se měří kódem znaku (ne regulárním výrazem s řídicími znaky).
 */
const PRAVIDLA_VETVE = [
  [(v) => v.startsWith("-"), "začíná `-` — volajícím by doputovala jako přepínač gitu"],
  [(v) => /[\s~^:?*[\\]/.test(v) || [...v].some((z) => z.charCodeAt(0) < 0x20 || z.charCodeAt(0) === 0x7f), "nese mezeru, řídicí znak nebo jeden ze znaků ~ ^ : ? * [ \\"],
  [(v) => v.includes(".."), "nese `..`"],
  [(v) => v === "@" || v.includes("@{"), "je `@` nebo nese `@{`"],
  [(v) => v.startsWith("/") || v.endsWith("/") || v.includes("//"), "začíná nebo končí `/`, nebo nese `//`"],
  [(v) => /(^|\/)\./.test(v), "některá část jména začíná tečkou"],
  [(v) => v.endsWith(".") || /\.lock(\/|$)/.test(v), "končí tečkou nebo `.lock`"],
];

/** Proč `branch:` není jméno větve gitu; `null` = je. */
function vadaVetve(vetev) {
  return PRAVIDLA_VETVE.find(([vadna]) => vadna(vetev))?.[1] ?? null;
}

/**
 * Klíče deklarace: pole, pod kterým je výklad vrací, smí-li hodnota nést mezeru
 * (jméno repozitáře ani větve ji nenese; `upstream_pr:` je volný text do hlášky)
 * a pravidlo TVARU hodnoty (`vadaTvaru` vrací důvod odmítnutí, `null` = projde).
 */
const KLICE_DEKLARACE = [
  { klic: "repo:", pole: "repo", mezera: false, vadaTvaru: vadaRepozitare },
  { klic: "branch:", pole: "vetev", mezera: false, vadaTvaru: vadaVetve },
  { klic: "upstream_repo:", pole: "upstreamRepo", mezera: false },
  { klic: "upstream_pr:", pole: "upstreamPr", mezera: true },
];

/** Typografické uvozovky: jméno repozitáře ani větve je nenese a pár tvoří jen rovné. */
const TYPOGRAFICKE_UVOZOVKY = /[“”„‟‘’‚‛«»‹›]/;

/**
 * Hodnota jednoho řádku deklarace (text ZA klíčem). Tvary jsou dva a žádný třetí:
 *   holá hodnota           → komentář (`#` na začátku nebo po mezeře) pryč, ořez;
 *                            uvozovka ani `#` přilepený k hodnotě v ní být nesmí
 *   "hodnota" / 'hodnota'  → obsah párových uvozovek, celý; za nimi smí být jen komentář
 */
function hodnotaDeklarace({ klic, mezera, vadaTvaru }, zaKlicem) {
  const text = zaKlicem.trimStart();
  const uvozovka = text[0] === '"' || text[0] === "'" ? text[0] : "";
  let hodnota;
  if (uvozovka) {
    const konec = text.indexOf(uvozovka, 1);
    if (konec === -1) {
      throw new Error(`manifest má \`${klic}\` s NEPÁROVOU uvozovkou (${text.trimEnd()}) — hodnotu zapiš bez uvozovek, nebo v páru kolem celé hodnoty`);
    }
    // Za uzavírací uvozovkou smí být jen komentář — a ten začíná `#` PO mezeře.
    const za = text.slice(konec + 1).trimEnd();
    if (za !== "" && !/^\s+#/.test(za)) {
      throw new Error(`manifest má \`${klic}\` s textem za uzavírací uvozovkou ('${za.trim()}') — takový tvar nevykládám`);
    }
    hodnota = text.slice(1, konec);
  } else {
    // `#` přilepený k hodnotě komentář není (YAML ani story-init ho tak nečetly) a uříznout
    // ho by byl odhad: dřív `branch: fix#12` tiše znamenalo větev `fix`.
    const krizek = text.indexOf("#");
    if (krizek > 0 && !/\s/.test(text[krizek - 1])) {
      throw new Error(
        `manifest má \`${klic}\` s \`#\` přilepeným k hodnotě (${text.trimEnd()}) — komentář začíná \`#\` po mezeře; ` +
          "patří-li `#` do hodnoty, zapiš ji v párových uvozovkách",
      );
    }
    hodnota = (krizek === -1 ? text : text.slice(0, krizek)).trim();
  }
  if (mezera) hodnota = hodnota.trim();
  // Holá hodnota uvozovku nést nesmí (není v páru kolem celé hodnoty); jméno
  // repozitáře ani větve ji nenese ani uvnitř páru. Volný text v páru ano.
  if (!uvozovka && /["']/.test(hodnota)) {
    throw new Error(`manifest má \`${klic}\` s NEPÁROVOU uvozovkou (${hodnota}) — hodnotu zapiš bez uvozovek, nebo v páru kolem celé hodnoty`);
  }
  if (uvozovka && !mezera && /["']/.test(hodnota)) {
    throw new Error(`manifest má \`${klic}\` s uvozovkou uvnitř hodnoty (${hodnota}) — jméno repozitáře ani větve uvozovku nenese`);
  }
  if (!mezera && TYPOGRAFICKE_UVOZOVKY.test(hodnota)) {
    throw new Error(`manifest má \`${klic}\` s typografickou uvozovkou (${hodnota}) — jméno repozitáře ani větve uvozovku nenese; pár tvoří jen rovné " nebo '`);
  }
  if (hodnota === "") {
    throw new Error(
      `manifest má \`${klic}\` s PRÁZDNOU hodnotou — prázdná deklarace není výchozí hodnota; doplň ji, nebo řádek smaž`,
    );
  }
  if (!uvozovka && /^[|>][-+0-9]*$/.test(hodnota)) {
    throw new Error(`manifest má \`${klic}\` s blokovým textem (${hodnota}) — deklarace je hodnota na řádku klíče; blok nevykládám`);
  }
  if (!mezera && /\s/.test(hodnota)) {
    throw new Error(`manifest má \`${klic}\` s mezerou uvnitř hodnoty ('${hodnota}') — jméno repozitáře ani větve mezeru nenese`);
  }
  const vada = vadaTvaru?.(hodnota);
  if (vada) throw new Error(`manifest má \`${klic}\` s hodnotou '${hodnota}', kterou nevykládám: ${vada}`);
  return hodnota;
}

/**
 * Řádek, který OTEVÍRÁ vnořený kontejner: klíč bez hodnoty (vnořené mapování, seznam)
 * nebo s blokovým textem (`|`, `>` a jejich modifikátory); za ním smí být jen komentář.
 * Řádky s VĚTŠÍM odsazením pod ním patří kontejneru, ne deklaraci nasazení.
 */
const OTEVIRA_KONTEJNER = /^(?:-\s+)?[A-Za-z0-9_.-]+:\s*(?:[|>][-+0-9]*)?(?:\s+#.*)?$/;

/**
 * Klíč deklarace s mezerou nebo tabulátorem PŘED dvojtečkou (`branch : x`). Dřív se
 * takový řádek tiše nepřečetl a platila výchozí hodnota (`main`) — návrat k výchozí
 * hodnotě nad deklarací, která v manifestu stojí. Teď je to chyba se jmenovaným důvodem.
 */
const MEZERA_PRED_DVOJTECKOU = new RegExp(`^(${KLICE_DEKLARACE.map((k) => k.klic.slice(0, -1)).join("|")})[ \\t]+:`);

/**
 * Deklarace nasazení z manifestu — JEDINÝ výklad (pravidla v hlavičce).
 * Neplatná nebo nejednoznačná deklarace vyhodí; nikdy se nedosazuje odhad.
 *
 * @param {string} text obsah manifestu
 * @returns {{ repo: string, vetev: string, upstreamRepo?: string, upstreamPr?: string }}
 *   `upstreamRepo` / `upstreamPr` jsou `undefined`, když je manifest nedeklaruje
 */
export function zManifestu(text) {
  const radky = Object.fromEntries(KLICE_DEKLARACE.map((k) => [k.pole, []]));
  // Odsazení řádku, který otevřel vnořený kontejner; `null` = čte se nejvyšší úroveň.
  let kontejner = null;
  for (const radek of String(text).split("\n")) {
    const r = radek.trim();
    if (r === "" || r.startsWith("#")) continue;
    const odsazeni = radek.length - radek.trimStart().length;
    // Klíč pod jiným mapováním nebo řádek blokového textu: patří tomu kontejneru.
    if (kontejner !== null && odsazeni > kontejner) continue;
    kontejner = null;
    const mezeraPred = MEZERA_PRED_DVOJTECKOU.exec(r);
    if (mezeraPred) {
      throw new Error(
        `manifest má klíč deklarace \`${mezeraPred[1]}\` s mezerou před dvojtečkou (${r}) — takový řádek nevykládám ` +
          `(dřív se tiše nečetl a platila výchozí hodnota); zapiš \`${mezeraPred[1]}:\` bez mezery`,
      );
    }
    const popis = KLICE_DEKLARACE.find((k) => r.startsWith(k.klic));
    if (popis) radky[popis.pole].push(r.slice(popis.klic.length));
    else if (OTEVIRA_KONTEJNER.test(r)) kontejner = odsazeni;
  }
  const out = {};
  for (const popis of KLICE_DEKLARACE) {
    const nalezene = radky[popis.pole];
    if (nalezene.length > 1) {
      throw new Error(
        `manifest má ${nalezene.length} řádky \`${popis.klic}\` — deklarace je nejednoznačná (nevybírám první ani poslední); nech jeden`,
      );
    }
    out[popis.pole] = nalezene.length === 1 ? hodnotaDeklarace(popis, nalezene[0]) : undefined;
  }
  if (out.repo === undefined) throw new Error("manifest nemá `repo:` — nevím, ze kterého repozitáře Coolify staví");
  out.vetev ??= "main";
  return out;
}

/** Co smí o deklaraci tvrdit jiný kanál — a jak se rozpor řekne. */
const TVRZENE_KLICE = {
  branch: { pole: "vetev", co: "větev", veta: "větev se deklaruje v manifestu (řádek `branch:`; bez něj `main`). Přepiš ji tam" },
  repo: { pole: "repo", co: "repozitář", veta: "repozitář se deklaruje v manifestu (řádek `repo:`). Přepiš ho tam" },
};

/**
 * Rozpory mezi deklarací a tím, co o větvi nebo repozitáři tvrdí jiné kanály.
 *
 * ⛔ NÁLEZ 1a: story-init začínal větví z prostředí a manifest ji jen PŘEPSAL, když
 * řádek větve měl. Bez něj vyhrálo prostředí — a krok 2b2 o tom nevěděl. Kanál,
 * který tvrdí něco jiného než deklarace, proto nesmí vyhrát ani zmizet: je to chyba.
 * Totéž pro repozitář (`--repo` volajícího proti `repo:` manifestu).
 *
 * @param {{ repo: string, vetev: string }} vyklad výklad manifestu
 * @param {string[]} tvrzeni položky `<klíč>:<kanál>=<hodnota>`, klíč `branch` | `repo`;
 *   prázdná hodnota = kanál mlčí. Jiný tvar položky vyhodí (neznámé se odmítá).
 * @returns {string[]} věty o rozporech (prázdné = soulad)
 */
export function rozporyDeklarace(vyklad, tvrzeni) {
  const out = [];
  for (const polozka of tvrzeni) {
    const m = /^([a-z_]+):([^=]*)=(.*)$/s.exec(String(polozka));
    const popis = m && Object.hasOwn(TVRZENE_KLICE, m[1]) ? TVRZENE_KLICE[m[1]] : undefined;
    if (!m || !popis) {
      throw new Error(`--tvrdi '${polozka}': čekám <klíč>:<kanál>=<hodnota> s klíčem ${Object.keys(TVRZENE_KLICE).join(" | ")}`);
    }
    const kanal = m[2];
    const hodnota = m[3].trim();
    const deklarovana = vyklad[popis.pole];
    if (hodnota && hodnota !== deklarovana) {
      out.push(
        `${kanal} tvrdí ${popis.co} '${hodnota}', manifest deklaruje '${deklarovana}' — ${popis.veta}, ` +
          `nebo hodnotu z kanálu „${kanal}“ odstraň.`,
      );
    }
  }
  return out;
}

/**
 * Co o deklaraci tvrdí PROSTŘEDÍ — jediné místo, které ví, která proměnná je tvrzení.
 * Dnes jedna: `GIT_BRANCH` (story-init jí historicky řídil větev). Prázdná nebo
 * nenastavená = prostředí mlčí.
 *
 * @returns {string[]} položky ve tvaru pro `rozporyDeklarace`
 */
export function tvrzeniProstredi(env) {
  const vetev = String(env.GIT_BRANCH ?? "").trim();
  return vetev ? [`branch:GIT_BRANCH v prostředí=${vetev}`] : [];
}

/**
 * Deklarovaná adresa Forgeja a ODKUD je: FORGEJO_URL, jinak https://FORGEJO_DOMAIN —
 * týmž pořadím jako story-init. `null`, když není deklarovaná ani jedna.
 *
 * @returns {{ url: string, zdroj: "FORGEJO_URL" | "FORGEJO_DOMAIN" } | null}
 */
export function forgejoDeklarace(env) {
  const url = String(env.FORGEJO_URL ?? "").trim();
  if (url) return { url: url.replace(/\/+$/, ""), zdroj: "FORGEJO_URL" };
  const domena = String(env.FORGEJO_DOMAIN ?? "").trim();
  return domena ? { url: `https://${domena}`, zdroj: "FORGEJO_DOMAIN" } : null;
}

/** Základ Forgeja (jen adresa); "" když není deklarovaný. Jedno pravidlo: forgejoDeklarace. */
export function forgejoZaklad(env) {
  return forgejoDeklarace(env)?.url ?? "";
}

/**
 * URL bez přihlašovacích údajů — hodnota jde do logu a volající s ní dál pracují jako
 * s adresou (ls-remote, výpis `--deklarace` / `--remote`). Údaje jsou všechno mezi `://`
 * a POSLEDNÍM `@` před hostitelem: neescapovaný `@` v hesle (`https://u:p@ss@host/…`)
 * patří ještě k údajům — tak adresu čte git (curl) i WHATWG URL. Hranicí je konec
 * autority (`/`, `?`, `#`), ne konec řetězce: `@` v cestě údaj není a adresa musí
 * zůstat použitelná. Druhý maskovač (instance-overlay.mjs, `bezUdaju` nad volným textem
 * hlášky) má jiný kontrakt — nahrazuje zástupkou — ale totéž pravidlo posledního `@`.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (rada d8): `[^/@]*@` končil PRVNÍM `@` — zbytek hesla šel do logu.
 */
export function bezUdaju(url) {
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1");
}

/** Repozitář a větev, ze kterých Coolify staví. Neúplná deklarace vyhodí (nehádá se). */
export function nasazovanyRepozitar(manifestText, env) {
  const { repo, vetev } = zManifestu(manifestText);
  const zaklad = forgejoZaklad(env);
  if (!zaklad) throw new Error("FORGEJO_URL ani FORGEJO_DOMAIN nejsou nastavené — nevím, ze kterého Forgeja Coolify staví");
  return { url: bezUdaju(`${zaklad}/${repo}.git`), vetev, repo };
}

/** Jméno remote, jehož URL je TENTÝŽ repozitář; null, když žádný. */
export function remoteProRepozitar(remotes, url) {
  const cil = originRepo(url);
  if (!cil) return null;
  return remotes.find((r) => originRepo(r.url) === cil)?.name ?? null;
}

/**
 * Remote checkoutu, který JE nasazovaný repozitář — bez sítě, podle identity URL.
 *
 * S deklarovanou adresou Forgeja (`zaklad`) se porovnává CELÁ identita host/org/repo.
 * Bez ní je z deklarace známá jen cesta `org/repo` (manifest): shoda je pak na cestu
 * a všechny odpovídající remoty musí být TÝŽ repozitář. Táž cesta na dvou různých
 * hostitelích je nejednoznačnost — nevybírá se první.
 *
 * @param {{name: string, url: string}[]} remotes
 * @param {string} repo `org/repo` z manifestu
 * @param {string} zaklad adresa Forgeja, nebo "" když není deklarovaná
 * @returns {{ remote: string, url: string } | { duvod: string }}
 */
export function remoteNasazeni(remotes, repo, zaklad) {
  const jmena = remotes.map((r) => r.name).join(", ") || "žádné";
  if (zaklad) {
    const url = bezUdaju(`${zaklad}/${repo}.git`);
    const jmeno = remoteProRepozitar(remotes, url);
    if (!jmeno) return { duvod: `žádný remote checkoutu neukazuje na nasazovaný repozitář ${url} (remoty: ${jmena})` };
    return { remote: jmeno, url: bezUdaju(remotes.find((r) => r.name === jmeno).url) };
  }
  // Cesta se normalizuje TÝMŽ normalizátorem jako URL remotů (zástupný hostitel se
  // hned odřízne) — vlastní úprava velikosti písmen a `.git` by byl druhý výklad.
  const cesta = originRepo(`https://x/${repo}.git`).slice(1);
  const shody = cesta.length > 1 ? remotes.filter((r) => originRepo(r.url).endsWith(cesta)) : [];
  if (shody.length === 0) {
    return {
      duvod:
        `žádný remote checkoutu neukazuje na nasazovaný repozitář '${repo}' ` +
        `(adresa Forgeja není deklarovaná, porovnává se jen cesta; remoty: ${jmena})`,
    };
  }
  const identity = [...new Set(shody.map((r) => originRepo(r.url)))];
  if (identity.length > 1) {
    return {
      duvod:
        `repozitář '${repo}' je mezi remoty checkoutu na RŮZNÝCH hostitelích ` +
        `(${shody.map((r) => `${r.name}: ${originRepo(r.url)}`).join(", ")}) a adresa Forgeja není deklarovaná ` +
        "(FORGEJO_URL / FORGEJO_DOMAIN) — nevybírám naslepo",
    };
  }
  return { remote: shody[0].name, url: bezUdaju(shody[0].url) };
}

/**
 * `git config --get-regexp ^remote\..*\.url$` → [{name, url}].
 * Ne `git remote -v`: ten vypisuje URL už PŘEPSANÉ přes `url.*.insteadOf`,
 * takže identita repozitáře by se porovnávala s cílem přepisu (změřeno testem).
 */
export function rozeberRemotes(vystup) {
  const out = [];
  for (const radek of String(vystup).split("\n")) {
    const m = /^remote\.(.+)\.url\s+(\S+)$/.exec(radek.trim());
    if (m) out.push({ name: m[1], url: m[2] });
  }
  return out;
}

/** Remoty checkoutu; `chyba` nese důvod, když je nejde přečíst (nebo žádné nejsou). */
function nactiRemotes(koren, env) {
  try {
    return {
      remotes: rozeberRemotes(
        execFileSync("git", ["-C", koren, "config", "--get-regexp", "^remote\\..*\\.url$"], {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      ),
      chyba: "",
    };
  } catch (e) {
    const duvod = String(e.stderr ?? "").trim().split("\n").pop() || String(e.message).split("\n")[0];
    return { remotes: [], chyba: duvod };
  }
}

function main(argv) {
  const hodnota = (jmeno) => {
    const i = argv.indexOf(jmeno);
    return i === -1 ? "" : String(argv[i + 1] ?? "");
  };
  if (argv.includes("--zaklad")) {
    const dekl = forgejoDeklarace(process.env);
    if (!dekl) {
      process.stderr.write("nasazovany-repozitar: FORGEJO_URL ani FORGEJO_DOMAIN nejsou nastavené — adresa Forgeja není deklarovaná\n");
      return 2;
    }
    process.stdout.write(`${bezUdaju(dekl.url)}\t${dekl.zdroj}\n`);
    return 0;
  }
  const manifest = hodnota("--manifest");
  if (!manifest) {
    process.stderr.write("nasazovany-repozitar: chybí --manifest\n");
    return 2;
  }
  let text;
  let vyklad;
  try {
    text = readFileSync(manifest, "utf8");
    vyklad = zManifestu(text);
  } catch (e) {
    process.stderr.write(`nasazovany-repozitar: ${manifest}: ${e.message}\n`);
    return 2;
  }
  // Prostředí se porovnává PŘED vším ostatním (i před adresou Forgeja): rozpor je
  // vlastnost deklarace, ne toho, jestli se zrovna dá sestavit adresa.
  const sProstredim = argv.includes("--deklarace") || argv.includes("--cti") || argv.includes("--tvrdi-prostredi");
  const tvrzeni = [
    ...(sProstredim ? tvrzeniProstredi(process.env) : []),
    ...argv.flatMap((a, i) => (a === "--tvrdi" ? [String(argv[i + 1] ?? "")] : [])),
  ];
  let rozpory;
  try {
    rozpory = rozporyDeklarace(vyklad, tvrzeni);
  } catch (e) {
    process.stderr.write(`nasazovany-repozitar: ${e.message}\n`);
    return 2;
  }
  if (rozpory.length > 0) {
    for (const r of rozpory) process.stderr.write(`nasazovany-repozitar: ${manifest}: ${r}\n`);
    return 2;
  }
  if (argv.includes("--vyklad")) {
    // První řádek čtou všichni; nepovinné klíče jdou na dalších řádcích jen tehdy,
    // když je manifest deklaruje (prázdné pole by tabulátorem oddělený řádek rozbilo).
    process.stdout.write(`${vyklad.vetev}\t${vyklad.repo}\n`);
    if (vyklad.upstreamRepo !== undefined) process.stdout.write(`upstream_repo\t${vyklad.upstreamRepo}\n`);
    if (vyklad.upstreamPr !== undefined) process.stdout.write(`upstream_pr\t${vyklad.upstreamPr}\n`);
    return 0;
  }
  const koren = hodnota("--repo-root") || process.cwd();
  // Bez dotazu na heslo: neinteraktivní běh by jinak visel místo verdiktu.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (argv.includes("--remote")) {
    const { remotes, chyba } = nactiRemotes(koren, env);
    const nalez = remoteNasazeni(remotes, vyklad.repo, forgejoZaklad(process.env));
    if (!nalez.remote) {
      process.stderr.write(
        `nasazovany-repozitar: ${nalez.duvod}` +
          (chyba ? ` [checkout ${koren} nemá žádný remote, nebo jeho konfiguraci nejde přečíst: ${chyba}]` : "") +
          "\n",
      );
      return 4;
    }
    process.stdout.write(`${nalez.remote}\t${nalez.url}\n`);
    return 0;
  }
  let dekl;
  try {
    dekl = nasazovanyRepozitar(text, process.env);
  } catch (e) {
    process.stderr.write(`nasazovany-repozitar: ${e.message}\n`);
    return 2;
  }
  if (argv.includes("--deklarace")) {
    process.stdout.write(`${dekl.vetev}\t${dekl.url}\t${dekl.repo}\n`);
    return 0;
  }
  if (!argv.includes("--cti")) {
    process.stderr.write("nasazovany-repozitar: --zaklad | --vyklad | --deklarace | --remote | --cti\n");
    return 2;
  }
  const { remotes, chyba } = nactiRemotes(koren, env);
  if (chyba) {
    // Checkout bez remotů (nebo nečitelná konfigurace) není konec: větev se přečte
    // přímo z deklarované adresy. Mlčet se o tom ale nesmí — jinak by „žádný remote
    // na tenhle repozitář neukazuje“ níž vypadalo jako vlastnost checkoutu.
    console.warn(`nasazovany-repozitar: remoty checkoutu ${koren} nejdou přečíst (${chyba}) — čtu přímo ${dekl.url}`);
  }
  const pres = remoteProRepozitar(remotes, dekl.url);
  let vystup = "";
  try {
    vystup = execFileSync("git", ["-C", koren, "ls-remote", pres ?? dekl.url, `refs/heads/${dekl.vetev}`], {
      encoding: "utf8",
      env,
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    process.stderr.write(`nasazovany-repozitar: git ls-remote ${pres ?? dekl.url} selhal: ${String(e.stderr ?? e.message).trim().split("\n").pop()}\n`);
  }
  const sha = vystup.split("\n")[0]?.split("\t")[0]?.trim() ?? "";
  if (!/^[0-9a-f]{40,64}$/.test(sha)) {
    process.stderr.write(
      `nasazovany-repozitar: větev '${dekl.vetev}' v ${dekl.url} nejde přečíst` +
        (pres ? ` (přes remote '${pres}')` : " (žádný remote checkoutu na tenhle repozitář neukazuje)") +
        " — prázdno není shoda.\n",
    );
    return 3;
  }
  process.stdout.write(`${sha}\t${dekl.vetev}\t${dekl.url}\t${pres ?? "-"}\n`);
  return 0;
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
