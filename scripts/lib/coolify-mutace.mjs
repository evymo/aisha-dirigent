#!/usr/bin/env node
/**
 * coolify-mutace.mjs — JEDEN DOMOV MUTACE APLIKACE V COOLIFY
 * (deploy · restart · start · stop · návrat na dřívější nasazení · adresa webhooku)
 *
 * PROČ VZNIKL (změřeno čtením 2026-10-04, tři nezávislé soupisy nad týmž mainem)
 * ----------------------------------------------------------------------------
 * Deklarované držení aplikací (overlay instance, `nasazeni-drzene.json`; pravidla
 * a validace: `nasazeni-drzene.mjs`) ctila jediná cesta — vlny v CI. Volání, které
 * aplikaci v Coolify nasadí, restartuje, spustí nebo zastaví, přitom žilo ve více
 * než dvaceti souborech, každé vlastním `curl`/`fetch` a žádné se na držení
 * neptalo: studený start by drženou aplikaci přenasadil (odpojení dat na prázdný
 * svazek, spuštění služby, kterou provozovatel zastavil), ruční dispatch taky.
 * Stráž v každém skriptu zvlášť by zopakovala tu chybu — pátá cesta přibude a
 * nikdo ji nedopíše. Nejmenší společný jmenovatel není skript, ale VOLÁNÍ API.
 *
 * PRAVIDLO
 * --------
 * Mutaci aplikace v Coolify smí odeslat JEN tenhle modul. Před každým voláním se
 * zeptá domova držení; držená aplikace = žádné volání, hláška
 * „DRŽENO: <aplikace> — <důvod>“ a výsledek, který nejde zaměnit s úspěšným
 * nasazením ani s chybou sítě (`drzeno: true`, v CLI kód KOD_DRZENO = 100).
 *   · Platí pro KAŽDOU akci — i restart, start a stop (zastavení držené služby je
 *     taky zásah mimo vědomé rozhodnutí).
 *   · Žádný přepínač držení nepřebije (`--force` je jen parametr Coolify
 *     „stavět bez keše“). Držení se ruší tam, kde vzniklo: v overlayi instance.
 *   · Jméno se porovnává PŘESNĚ (role = jméno bez prefixu instance), nikdy
 *     podřetězcem: držené `web` nedrží `web-render` a naopak.
 *   · Nečitelná deklarace nebo deklarovaný a nedostupný overlay = žádná mutace
 *     a chyba (CLI kód 2). Instance bez overlaye / bez souboru = nic drženo.
 *   · Volání bez jména aplikace se ODMÍTNE: bez jména není čeho se zeptat.
 *   · Adresa webhooku nasazení je mutace odložená na cizí ruku (kdo ji zavolá,
 *     nasadí) — pro drženou aplikaci se nevydá.
 *
 * EXTERNÍ ≠ DRŽENÁ (druhý důvod „nesahat“, vlastní kód a hláška)
 * ---------------------------------------------------------------
 * Služba, kterou profil prostředí vede jako externí (`external_domain`), v tomhle
 * prostředí naše NENÍ — běží jinde a v našem projektu Coolify ani nemusí existovat.
 * Odpověď dává domov vlastnictví (`vlastnictvi-aplikaci.mjs`); tady se na ni ptá
 * každá mutace PŘED držením: „EXTERNÍ: <role> — <adresa> — … nevlastním“, výsledek
 * `externi: true`, v CLI kód KOD_EXTERNI = 101. Profil prostředí se bere ze zadání
 * (`k.profil`, CLI `--profil`) nebo z AISHA_PROFILE; volající, který ho nezná (ruční
 * dispatch v CI nese jen ověřené držení), dostane na stderr varování, že externí
 * služby nerozliší — mutuje jen aplikace, které v projektu instance existují.
 *
 * Kdo sem ještě nepatří (operátorské nástroje mimo konvergenci studeného startu,
 * běhové služby, CI přímé úlohy), je vyjmenován S DŮVODEM v bráně
 * `nasazeni-drzene-aplikace`; ta hledá volání mutace mimo tenhle soubor a seznam
 * výjimek se smí jen zmenšovat.
 *
 * Shell: `scripts/lib/coolify-mutace.sh` je obal TOHOTO CLI — žádná druhá logika.
 *
 * CLI
 * ---
 *   node scripts/lib/coolify-mutace.mjs --akce deploy|restart|start|stop|navrat|webhook
 *        --jmeno <jméno aplikace v Coolify> [--prefix <prefix instance>] --uuid <uuid aplikace>
 *        --kdo <volající nástroj> [--force true|false] [--nasazeni <uuid nasazení>]
 *        [--env-soubor <soubor prostředí instance>] [--drzene '<ověřený JSON>'] [--profil <id>]
 *   Prostředí: COOLIFY_URL (bez /api/v1) nebo COOLIFY_API (s /api/v1), COOLIFY_API_TOKEN
 *              — token NIKDY přepínačem (argumenty jsou vidět ve výpisu procesů).
 *   --drzene   už ověřená deklarace (output úlohy, která ji četla — CI/dispatch);
 *              bez něj si deklaraci instance obstará sám (overlay z prostředí / klonem).
 *   --profil   profil prostředí pro rozlišení externích služeb (jinak AISHA_PROFILE)
 *   stdout:    odpověď Coolify jako jeden řádek JSON (u `webhook` adresa);
 *              u držené aplikace hláška „DRŽENO: …“, u externí „EXTERNÍ: …“
 *   Kódy:      0 = mutace přijata · 100 = DRŽENO · 101 = EXTERNÍ (nic se neodeslalo) ·
 *              1 = Coolify nebo síť selhaly · 2 = chybné zadání nebo nečitelná
 *              deklarace / profil (nic se neodeslalo)
 */
import { isDirectRun } from "./cli-entry.mjs";
import { createCoolifyClient } from "./coolify-http.mjs";
import { drzeniInstance, hlaskaDrzeno, KOD_DRZENO, polozkyZDrzenych } from "./nasazeni-drzene.mjs";
import { externiProstredi, hlaskaExterni, KOD_EXTERNI } from "./vlastnictvi-aplikaci.mjs";

const UUID = /^[A-Za-z0-9_-]+$/;
const uuidNeboChyba = (v, co) => {
  if (typeof v !== "string" || !UUID.test(v)) throw new Error(`coolify-mutace: ${co} „${v ?? ""}“ nemá tvar identifikátoru Coolify`);
  return v;
};

const idAplikace = (z) => uuidNeboChyba(z.uuid, "uuid aplikace");
const idNasazeni = (z) => uuidNeboChyba(z.nasazeni, "uuid nasazení");

/**
 * Akce → cesta API (bez /api/v1). JEDINÉ místo v repu, kde se cesta mutace skládá.
 * `webhook` nic neodesílá — vydává adresu, kterou zavolá někdo jiný.
 * (Tvar cest je záměrně doslovný: brána `nasazeni-drzene-aplikace` podle něj ověřuje,
 * že její vzor volání mutace v tomhle souboru NAJDE — jinak by měřila prázdno.)
 */
export const AKCE = {
  deploy: (z) => {
    const uuid = idAplikace(z);
    return `/deploy?uuid=${uuid}&force=${z.force ? "true" : "false"}`;
  },
  restart: (z) => {
    const uuid = idAplikace(z);
    const dotaz = z.nasazeni ? `?deployment_uuid=${idNasazeni(z)}&force=true` : "";
    return `/applications/${uuid}/restart${dotaz}`;
  },
  start: (z) => {
    const uuid = idAplikace(z);
    return `/applications/${uuid}/start`;
  },
  stop: (z) => {
    const uuid = idAplikace(z);
    return `/applications/${uuid}/stop`;
  },
  navrat: (z) => {
    const nasazeni = idNasazeni(z);
    return `/deployments/${nasazeni}/restart?force=true`;
  },
  webhook: (z) => {
    const uuid = idAplikace(z);
    return `/deploy?uuid=${uuid}&force=false`;
  },
};

/** Role aplikace = jméno bez prefixu instance. Deklarace držení jmenuje role. */
export function roleAplikace(jmeno, prefix) {
  const j = String(jmeno ?? "").trim();
  const p = String(prefix ?? "").trim();
  return p && j.startsWith(`${p}-`) ? j.slice(p.length + 1) : j;
}

/** Deklarace držení TOHOTO procesu — čte se jednou; neúspěch se nepamatuje (a vždy hází). */
let _drzeniProcesu = null;
export function drzeniProcesu(kdo, { envSoubory = [] } = {}) {
  if (!_drzeniProcesu) _drzeniProcesu = drzeniInstance(kdo, { envSoubory });
  return _drzeniProcesu;
}

/**
 * Drží instance tuhle aplikaci? Vrací položku deklarace, nebo null. Porovnává se
 * PŘESNĚ role (a pro jistotu i celé jméno, kdyby deklarace nesla jméno s prefixem —
 * validace takovou položku odmítne, takže to je jen pojistka směrem k „drženo“).
 * @param {{ jmeno: string, prefix?: string }} z
 * @param {{ kdo: string, drzene?: Array<{aplikace: string}>, envSoubory?: string[] }} k
 */
export function drzenaPolozka(z, k) {
  const jmeno = String(z?.jmeno ?? "").trim();
  if (!jmeno) throw new Error("coolify-mutace: chybí jméno aplikace — bez jména se nejde zeptat na držení, mutaci NEODEŠLU");
  // ⛔ Revize rady (cb, 2026-10-04, N1): s prázdným prefixem je role CELÉ jméno, takže
  // „inst-web-render“ se proti deklaraci „web-render“ přečetla jako NEdržená. Bez prefixu,
  // nebo se jménem, které instanci nepatří, se role určit nedá — a „nevím“ není „nedržená“.
  const prefix = String(z?.prefix ?? "").trim();
  if (!prefix) throw new Error("coolify-mutace: chybí prefix instance (--prefix) — bez něj nejde ze jména určit roli, mutaci NEODEŠLU");
  if (!jmeno.startsWith(`${prefix}-`)) throw new Error(`coolify-mutace: aplikace „${jmeno}“ nepatří instanci „${prefix}“ — mutaci NEODEŠLU`);
  const polozky = k?.drzene !== undefined ? k.drzene : drzeniProcesu(k?.kdo ?? "coolify-mutace", { envSoubory: k?.envSoubory ?? [] }).polozky;
  if (!Array.isArray(polozky)) throw new Error("coolify-mutace: deklarace držení není pole položek — mutaci NEODEŠLU");
  const role = roleAplikace(jmeno, z.prefix);
  return polozky.find((p) => p.aplikace === role || p.aplikace === jmeno) ?? null;
}

/**
 * Externí služby profilu prostředí TOHOTO procesu — čte se jednou na (profil, soubory prostředí).
 * Soubory prostředí MUSÍ dojít až do domova: `${VAR}` v external_domain, deklarovaná jen
 * v souboru (samostatně spuštěný sync-envs / redeploy / povrchy předávají `--env-soubor`),
 * by bez nich byla „nevím“ (revize integrátora 2026-10-05, A-N1). Klíč cache nese i soubory —
 * týž profil s jiným souborem je jiná odpověď.
 */
const _externiProcesu = new Map();
function externiProcesu(profil, envSoubory = []) {
  const klic = JSON.stringify([profil, envSoubory]);
  if (!_externiProcesu.has(klic)) _externiProcesu.set(klic, externiProstredi(profil, { envSoubory }));
  return _externiProcesu.get(klic);
}

/**
 * Je tahle aplikace v tomhle prostředí EXTERNÍ? Vrací { role, domena, hlaska }, nebo null.
 * `k.externi` = už zjištěná mapa role → adresa (volající, který vlastnictví načetl sám);
 * jinak profil `k.profil` / AISHA_PROFILE dveřmi domova vlastnictví. Bez profilu se
 * externí služby rozlišit nedají — vrací null a `k.priNezmereno` (je-li) se zavolá.
 * Prefix a jméno ověřuje drzenaPolozka — tady se ptá až po ní (stejné podmínky zadání).
 * @param {{ jmeno: string, prefix?: string }} z
 * @param {{ externi?: Map<string,string>, profil?: string, envSoubory?: string[], priNezmereno?: (duvod: string) => void }} k
 */
export function externiPolozka(z, k) {
  const role = roleAplikace(z.jmeno, z.prefix);
  let mapa = k?.externi;
  if (!(mapa instanceof Map)) {
    const profil = String(k?.profil ?? process.env.AISHA_PROFILE ?? "").trim();
    if (!profil) {
      k?.priNezmereno?.("profil prostředí nedeklarován (AISHA_PROFILE / --profil) — externí služby nerozliším");
      return null;
    }
    mapa = externiProcesu(profil, k?.envSoubory ?? []);
  }
  if (!mapa.has(role)) return null;
  const domena = mapa.get(role);
  return { role, domena, hlaska: hlaskaExterni({ role, domena }, String(k?.profil ?? process.env.AISHA_PROFILE ?? "").trim()) };
}

/**
 * Odešle mutaci aplikace do Coolify — nebo ji NEODEŠLE, protože je aplikace v tomhle
 * prostředí externí, nebo držená.
 * @param {{ akce: keyof typeof AKCE, jmeno: string, prefix?: string, uuid?: string, force?: boolean, nasazeni?: string }} z
 * @param {{ kdo: string, volej: (cesta: string, volby: { method: string, timeoutMs?: number }) => Promise<unknown>,
 *           drzene?: Array<{aplikace: string}>, envSoubory?: string[], timeoutMs?: number,
 *           externi?: Map<string,string>, profil?: string, priNezmereno?: (duvod: string) => void }} k
 *        `volej` = klient Coolify volajícího (cesta bez /api/v1); výjimky klienta se propouštějí beze změny
 * @returns {Promise<{ drzeno: true, hlaska: string, polozka: object }
 *   | { externi: true, drzeno: false, hlaska: string, polozka: object }
 *   | { drzeno: false, externi: false, cesta: string, odpoved: unknown }>}
 */
export async function mutujAplikaci(z, k) {
  const sestav = AKCE[z?.akce];
  if (!sestav || z.akce === "webhook") throw new Error(`coolify-mutace: neznámá akce „${z?.akce ?? ""}“ (deploy, restart, start, stop, navrat)`);
  if (typeof k?.volej !== "function") throw new Error("coolify-mutace: chybí klient Coolify (volej)");
  // Držení a vlastnictví se čtou PŘED sestavením cesty i před voláním — pro každou akci stejně.
  // drzenaPolozka ověří jméno a prefix (bez nich nejde určit roli) — proto první.
  const polozka = drzenaPolozka(z, k);
  if (polozka) return { drzeno: true, hlaska: hlaskaDrzeno(polozka), polozka };
  const cizi = externiPolozka(z, k);
  if (cizi) return { externi: true, drzeno: false, hlaska: cizi.hlaska, polozka: cizi };
  const cesta = sestav(z);
  await overParovani(z, k);
  const odpoved = await k.volej(cesta, { method: "POST", ...(k.timeoutMs ? { timeoutMs: k.timeoutMs } : {}) });
  return { drzeno: false, externi: false, cesta, odpoved };
}

/**
 * Patří uuid (a u návratu i nasazení) aplikaci, na jejíž držení se stráž ptala?
 * ⛔ Revize rady (cb, 2026-10-04, N2): stráž se ptá podle JMÉNA, mutace míří na UUID.
 * Volající, který spáruje špatně (zastaralé uuid po přezaložení, uuid z jiného řádku),
 * by nasadil drženou aplikaci, zatímco se ptal na nedrženou. Proto se před odesláním
 * přečte, čí uuid je; nepárují-li se, nebo to nejde zjistit, mutace se NEODEŠLE.
 * Nasazení (Coolify v4) nese jméno aplikace v `application_name`, starší verze
 * v `resource_name` (tvar naměřený: src/tests/gates/fixtures/coolify-nasazeni-aplikace.json,
 * scripts/coolify-deploy-watch.mjs).
 */
async function overParovani(z, k) {
  const cti = (cesta) => k.volej(cesta, { method: "GET", ...(k.timeoutMs ? { timeoutMs: k.timeoutMs } : {}) });
  const jmeno = String(z.jmeno).trim();
  const uuid = idAplikace(z);
  const aplikace = await cti(`/applications/${uuid}`);
  if (aplikace?.name !== jmeno) {
    throw new Error(`coolify-mutace: uuid ${uuid} patří aplikaci „${aplikace?.name ?? "?"}“, ne „${jmeno}“ — držení se ptalo na jinou aplikaci, mutaci NEODEŠLU`);
  }
  if (z.nasazeni) {
    const nasazeni = idNasazeni(z);
    const n = await cti(`/deployments/${nasazeni}`);
    const cizi = n?.application_name ?? n?.resource_name;
    if (cizi !== jmeno) {
      throw new Error(`coolify-mutace: nasazení ${nasazeni} patří aplikaci „${cizi ?? "? (nejde zjistit)"}“, ne „${jmeno}“ — mutaci NEODEŠLU`);
    }
  }
}

/**
 * Adresa webhooku nasazení (kdo ji zavolá, nasadí). Pro drženou aplikaci se NEVYDÁ.
 * @returns {{ drzeno: true, hlaska: string } | { drzeno: false, adresa: string }}
 */
export function adresaWebhooku(z, k) {
  const polozka = drzenaPolozka(z, k);
  if (polozka) return { drzeno: true, hlaska: hlaskaDrzeno(polozka) };
  const cizi = externiPolozka(z, k);
  if (cizi) return { externi: true, drzeno: false, hlaska: cizi.hlaska };
  const zaklad = String(k?.zaklad ?? "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(zaklad)) throw new Error("coolify-mutace: chybí adresa Coolify (COOLIFY_URL) pro webhook");
  return { drzeno: false, adresa: `${zaklad}/api/v1${AKCE.webhook(z)}` };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const ZNAME_PREPINACE = new Set(["akce", "jmeno", "prefix", "uuid", "kdo", "force", "nasazeni", "env-soubor", "drzene", "profil"]);

function argumenty(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) return { chyba: `nečekaný argument „${argv[i]}“` };
    const klic = argv[i].slice(2);
    if (!ZNAME_PREPINACE.has(klic)) return { chyba: `neznámý přepínač --${klic}` };
    // Každý přepínač nese hodnotu; prázdná hodnota (`--drzene ""`) je hodnota, ne další přepínač.
    if (i + 1 >= argv.length) return { chyba: `--${klic} bez hodnoty` };
    a[klic] = argv[++i];
  }
  return { a };
}

/** Adresa Coolify bez /api/v1 z prostředí (COOLIFY_URL, jinak COOLIFY_API bez přípony). */
function zakladZProstredi() {
  const url = (process.env.COOLIFY_URL ?? "").trim().replace(/\/+$/, "");
  if (url) return url.replace(/\/api\/v1$/, "");
  return (process.env.COOLIFY_API ?? "").trim().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

async function hlavni(argv) {
  const { a, chyba } = argumenty(argv);
  const zadani = (zprava) => {
    console.error(`coolify-mutace: ${zprava} — nic jsem neodeslal.`);
    return 2;
  };
  if (chyba) return zadani(chyba);
  if (!Object.hasOwn(AKCE, a.akce ?? "")) return zadani(`--akce chce jedno z: ${Object.keys(AKCE).join(", ")}`);
  if (!a.jmeno?.trim()) return zadani("chybí --jmeno <jméno aplikace v Coolify> (bez jména se nejde zeptat na držení)");
  if (!a.kdo?.trim()) return zadani("chybí --kdo <volající nástroj>");
  if (a.force !== undefined && a.force !== "true" && a.force !== "false") return zadani(`--force chce true|false, dostal „${a.force}“`);

  const z = { akce: a.akce, jmeno: a.jmeno, prefix: a.prefix ?? "", uuid: a.uuid, force: a.force === "true", nasazeni: a.nasazeni };
  const k = {
    kdo: a.kdo,
    envSoubory: a["env-soubor"] ? [a["env-soubor"]] : [],
    ...(a.profil !== undefined ? { profil: a.profil } : {}),
    priNezmereno: (duvod) => console.error(`::warning title=vlastnictví aplikací::coolify-mutace: ${duvod} — mutuji jen aplikaci, která v projektu instance existuje`),
  };
  // Držení: ověřený JSON od úlohy, která deklaraci četla, nebo vlastní čtení instance.
  let polozka;
  let cizi;
  try {
    if (a.drzene !== undefined) k.drzene = polozkyZDrzenych(a.drzene);
    polozka = drzenaPolozka(z, k);
  } catch (e) {
    for (const c of Array.isArray(e?.chyby) ? e.chyby.map((x) => `${e.titulek}::${x}`) : [`deklarace držení::${e.message}`]) {
      console.error(`::error title=${c}`);
    }
    console.error("coolify-mutace: nevím, co je drženo, takže nevím, co smím nasadit — nic jsem neodeslal.");
    return 2;
  }
  if (polozka) {
    process.stdout.write(`${hlaskaDrzeno(polozka)}\n`);
    return KOD_DRZENO;
  }
  try {
    cizi = externiPolozka(z, k);
  } catch (e) {
    console.error(`::error title=vlastnictví aplikací::${e.message}`);
    console.error("coolify-mutace: nevím, co je v prostředí naše, takže nevím, co smím nasadit — nic jsem neodeslal.");
    return 2;
  }
  if (cizi) {
    process.stdout.write(`${cizi.hlaska}\n`);
    return KOD_EXTERNI;
  }
  // Vlastnictví je zjištěné — mutujAplikaci se už neptá znovu (ani nevaruje podruhé).
  k.externi = new Map();

  const zaklad = zakladZProstredi();
  try {
    if (z.akce === "webhook") {
      const w = adresaWebhooku(z, { ...k, zaklad });
      process.stdout.write(`${w.adresa}\n`);
      return 0;
    }
    AKCE[z.akce](z); // tvar identifikátorů se ověří dřív, než se sáhne po pověření
  } catch (e) {
    return zadani(e.message);
  }
  const token = (process.env.COOLIFY_API_TOKEN ?? "").trim();
  if (!zaklad || !token) return zadani("chybí COOLIFY_URL (nebo COOLIFY_API) či COOLIFY_API_TOKEN v prostředí");
  try {
    const volej = createCoolifyClient({ baseUrl: zaklad, token });
    // mutujAplikaci se na držení ptá SAMA (deklarace procesu je načtená, podruhé se nečte).
    const v = await mutujAplikaci(z, { ...k, volej });
    if (v.externi) {
      process.stdout.write(`${v.hlaska}\n`);
      return KOD_EXTERNI;
    }
    if (v.drzeno) {
      process.stdout.write(`${v.hlaska}\n`);
      return KOD_DRZENO;
    }
    process.stdout.write(`${JSON.stringify(v.odpoved ?? null)}\n`);
    return 0;
  } catch (e) {
    console.error(`coolify-mutace: ${z.akce} ${z.jmeno} selhalo: ${e.message}`);
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  // Konec až po dopsání stdout: zápis do roury je asynchronní a `process.exit` hned
  // po něm by odpověď (uuid nasazení, hlášku DRŽENO) uřízl.
  const konec = (kod) => process.stdout.write("", () => process.exit(kod));
  hlavni(process.argv.slice(2)).then(konec, (e) => {
    console.error(`coolify-mutace: ${e?.message ?? e} — nic dalšího neodesílám.`);
    konec(2);
  });
}
