/**
 * Jedny dveře k instančnímu overlayi — aby brána nemohla tiše měřit nulu.
 *
 * PROČ TOHLE EXISTUJE
 * Overlay (privátní instance-data repo) drží deklarace, které platforma sama
 * nezná: allowlist RPC, `title_key` bloků, profil nasazení, roster operátorů.
 * Kontrola, která je čte, je bez overlaye SLEPÁ — a dosud si každý spotřebitel
 * sám vymýšlel, co v tu chvíli dělat. Tři místa, tři různá chování:
 *
 *   · `allowlisted-rpc-has-source.gate.test.ts` — varuje a PROJDE;
 *   · `check-i18n-parity.mjs` — přidá zdroj, když je, jinak měří míň;
 *   · `derive-domains.mjs` — spadne na šablonu (a měřeno 2026-07-28: proměnná
 *     BYLA deklarovaná, jen ji konzument doplnil až po vyhodnocení importu,
 *     takže se přečetla prázdná a instanční profil se nenačetl).
 *
 * Ta poslední věta je důvod, proč se tu cesta čte LÍNĚ, uvnitř funkce. Čtení
 * v module scope je past: importy se vyhodnotí dřív než tělo konzumenta, takže
 * kdo si proměnnou hydratuje sám, nedosáhne na ni včas — a nikdo to nepozná,
 * protože výsledkem je tichý fallback, ne chyba.
 *
 * JAK SE POUŽÍVÁ
 *   `requireOverlay('brána X')` — kontrola bez overlaye NEMÁ SMYSL. Chybí-li,
 *   vyhodí výjimku, která jmenuje, KDO ho potřeboval a jak ho dodat.
 *
 *   `overlayDir()` — kontrola bez něj smysl má, jen měří míň. Vrátí cestu nebo
 *   `null`; volající se s tím musí vypořádat výslovně a NAHLAS říct, co
 *   neprohlédl. Prázdná množina není čistý strom.
 *
 * REŽIM ROZHODUJE SPOTŘEBITEL, CI HO ZPŘÍSNÍ
 * Instalace bez overlaye je legitimní — komunitní install běží na šablonách a
 * README na tom staví. Naše CI ale overlay MÁ, takže tam je jeho nepřítomnost
 * vada zapojení, ne stav světa: `AISHA_OVERLAY_REQUIRED=1` udělá i z volitelných
 * čtení povinná. Jeden přepínač v lane, žádná změna v bránách.
 *
 * DEKLAROVANÝ OVERLAY JE POVINNÝ
 * Totéž platí pro instanci, která overlay DEKLARUJE (`AISHA_INSTANCE_DATA_GIT_URL`
 * — tentýž klíč, podle kterého ho cold-start klonuje a migrace nasazuje). Pro ni
 * šablona není „méně dat", ale data CIZÍ instance.
 *
 * ⛔ NAMĚŘENO 2026-09-13 na nasazeném forku. `aisha-redeploy` před každým
 * nasazením pouští env-doktora, který odvozené klíče srovná s derivací. Bez
 * exportované cesty k overlayi se profil načetl ze šablony a doktor „opravil
 * drift" špatným směrem: `SPA_DIAGNOSE=1` místo instančního `0` a
 * `KC_ALLOWED_CLIENTS` bez klientů instance. Vrátný s nakonfigurovaným
 * operátorem pak start odmítl a edge skončil degraded — a nic nespadlo, protože
 * tichý návrat k šabloně byl v téhle funkci pravidlem.
 */

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';

export const OVERLAY_ENV = 'AISHA_INSTANCE_CONFIG_DIR';
export const REQUIRED_ENV = 'AISHA_OVERLAY_REQUIRED';
export const DECLARATION_ENV = 'AISHA_INSTANCE_DATA_GIT_URL';

/** Čte se LÍNĚ (viz hlavička) — nikdy ne v module scope. */
function rawDir() {
  return (process.env[OVERLAY_ENV] ?? '').trim();
}

/**
 * Deklaruje instance vlastní overlay? Hodnotu nikdy nevypisuj — git URL běžně
 * nese přihlašovací údaje (`https://<token>@host/…`).
 */
export function overlayDeclared() {
  return (process.env[DECLARATION_ENV] ?? '').trim() !== '';
}

/**
 * Deklarovaný overlay jako repo, které jde předat buildu: URL BEZ přihlašovacích
 * údajů a bez fragmentu, ref z fragmentu (`…git#main`). Token do buildu patří
 * BuildKit secretem, ne do URL v build ARGu — ta se zapisuje do metadat obrazu.
 *
 * `null`, když instance overlay nedeklaruje nebo hodnotu nejde přečíst.
 * scp tvar (`git@host:org/repo.git`) přihlašovací údaje nenese a projde beze změny.
 */
export function deklarovanyOverlayRepo() {
  const raw = (process.env[DECLARATION_ENV] ?? '').trim().replace(/\\\//g, '/');
  if (!raw) return null;
  const [bezRefu, ref = ''] = raw.split('#');
  if (/^[\w.-]+@[\w.-]+:/.test(bezRefu)) return { url: bezRefu, ref, kde: bezRefu.replace(/^[^@]*@/, '') };
  try {
    const u = new URL(bezRefu);
    u.username = '';
    u.password = '';
    return { url: u.toString(), ref, kde: `${u.host}${u.pathname}` };
  } catch {
    return null;
  }
}

/** Kde overlay leží, bez přihlašovacích údajů — aby hláška řekla, CO naklonovat. */
function deklaraceBezPrihlaseni() {
  return deklarovanyOverlayRepo()?.kde ?? null;
}

/**
 * Musí overlay být k dispozici? Ano, když to vynucuje prostředí (CI), NEBO když
 * ho instance deklaruje — viz „DEKLAROVANÝ OVERLAY JE POVINNÝ" v hlavičce.
 */
export function overlayRequired() {
  const v = (process.env[REQUIRED_ENV] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || overlayDeclared();
}

/**
 * Cesta k overlayi, nebo `null`. Volající MUSÍ ošetřit `null` sám a nahlas
 * říct, co kvůli tomu neprohlédl.
 */
export function overlayDir() {
  const dir = rawDir();
  if (!dir || !existsSync(dir)) return null;
  return dir;
}

/**
 * Cesta k overlayi, nebo výjimka. Pro kontroly, které bez něj nemají co měřit.
 *
 * @param {string} kdo Jméno volajícího — objeví se v hlášce, aby bylo poznat,
 *   která kontrola zůstala slepá, ne jen že „něco chybí".
 */
export function requireOverlay(kdo) {
  const dir = overlayDir();
  if (dir) return dir;
  const duvod = rawDir()
    ? `${OVERLAY_ENV}='${rawDir()}' ukazuje na adresář, který neexistuje`
    : `${OVERLAY_ENV} není nastavená`;
  if (overlayDeclared()) {
    const kde = deklaraceBezPrihlaseni();
    throw new Error(
      `${kdo}: instance deklaruje vlastní overlay (${DECLARATION_ENV}${kde ? ` → ${kde}` : ''}), ` +
        `ale ${duvod}. Bez něj by se profil, klienti i režimy odvodily ze ŠABLON ` +
        `config/profiles/ — tedy pro CIZÍ instanci, a nic by přitom nespadlo. ` +
        `Nastav ${OVERLAY_ENV} na checkout toho repa.`,
    );
  }
  throw new Error(
    `${kdo}: instanční overlay není dostupný — ${duvod}. ` +
      `Bez něj tahle kontrola nemá co měřit a zelená by znamenala „nic jsem nenašel", ` +
      `ne „nic tam není". Nastav ${OVERLAY_ENV} na checkout instance-data repa.`,
  );
}

/**
 * Přihlašovací údaje ven NESMÍ — ani v hlášce o chybě. Maskují se DVA tvary,
 * protože každý nosí tajemství jinde:
 *   · `https://uživatel:heslo@host/…` — údaj PŘED zavináčem;
 *   · `https://host/repo.git?token=…` — údaj v DOTAZU (tvar instalačních
 *     tokenů GitHub App a podobných CI integrací).
 * Tvar `git@host:org/repo.git` se nemaskuje: SSH se ověřuje klíčem, v URL
 * žádné tajemství nenese, a maskovat tam není co.
 *
 * ⛔ NALEZENO PŘI REVIZI 2026-09-20: první verze uměla jen ten zavináčový tvar,
 * takže token v dotazu prošel do hlášky nezakrytý.
 *
 * ⛔ NAMĚŘENO 2026-10-04 (rada d8): `[^@\s]*@` končil PRVNÍM zavináčem — z hesla
 * s neescapovaným `@` (`https://u:p@ss@host/…`) zůstal v hlášce zbytek (`ss@host`).
 * Zakrývá se proto až po POSLEDNÍ `@` adresy (v textu hlášky ji ohraničuje mezera;
 * zakrýt víc je tu bezpečné, s hodnotou se nic dalšího nedělá). Totéž pravidlo
 * posledního `@` drží `bezUdaju` v nasazovany-repozitar.mjs — ten ale vrací
 * použitelnou adresu, proto ho ohraničuje konec autority, ne mezera.
 */
function bezUdaju(text) {
  return String(text)
    .replace(/(https?:\/\/)\S*@/g, '$1<skryto>@')
    .replace(
      /([?&](?:token|access_token|private_token|api[-_]?key|key|password|passwd|pwd|secret)=)[^&\s]+/gi,
      '$1<skryto>',
    );
}

/**
 * Commit, na který deklarace ukazuje. Tohle je ten krok, který dělá mezipaměť
 * NEMĚNNOU: adresář pojmenovaný commitem už nikdo nikdy nepřepisuje, takže
 * čtenář, který dostal cestu a čte z ní později, nemůže potkat rozdělaný stav.
 *
 * ⛔ NALEZENO PŘI REVIZI 2026-09-20. Dřív se mezipaměť držela na jednom
 * adresáři podle `url#ref` a aktualizovala se `fetch` + `reset --hard`. Volající
 * ale dostane CESTU a soubory čte POZDĚJI — ne atomicky s návratem funkce. Když
 * mezitím jiný proces přepisoval týž adresář, přečetl by čtenář půl starého
 * a půl nového stavu, TIŠE a bez chyby. Přesně ten druh vady, co vypadá funkčně.
 *
 * Staré adresáře se vědomě NEUKLÍZEJÍ: mazat adresář, ze kterého možná právě
 * čte jiný proces, by tu vadu vrátilo zadními vrátky. Leží v `tmpdir()`, o ten
 * se stará systém.
 */
function commitDeklarace(git, url, ref) {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase();
  const radky = git('ls-remote', url, ...(ref ? [ref] : ['HEAD']))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  // U anotovaného tagu ukazuje na commit až řádek `…^{}`; bez něj by se vzal
  // objekt tagu, který checkout sice zvládne, ale jméno adresáře by se pak
  // lišilo podle toho, kdo se ptal.
  const radek = radky.find((r) => r.endsWith('^{}')) ?? radky[0];
  const commit = radek?.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) {
    throw new Error(`vzdálený repozitář nezná ${ref || 'HEAD'}`);
  }
  return commit.toLowerCase();
}

/**
 * ⛔ DEKLARACI SI OBSTARÁ NÁSTROJ SÁM (naměřeno 2026-09-20 při výpadku produkce).
 *
 * Overlay uměl obstarat JEDINÝ nástroj — `aisha-cold-start.sh`
 * (`_fetch_instance_overlay`). Všichni ostatní čtenáři topologie čekali, že jim
 * cestu předá operátor v `AISHA_INSTANCE_CONFIG_DIR`. Když v 04:49 UTC spadlo
 * nasazení jádra a API instance vracelo 502, obnova naším vlastním skriptem
 * NEPROBĚHLA: `aisha-redeploy` zastavil env-doktor s „instance deklaruje vlastní
 * overlay, ale AISHA_INSTANCE_CONFIG_DIR není nastavená". Výpadek se tím prodloužil
 * o dobu, než člověk zjistil, že si má proměnnou doplnit ručně.
 *
 * Deklarace bez plniče je ornament: `AISHA_INSTANCE_DATA_GIT_URL` říká, KDE
 * overlay je, takže nástroj si ho má vzít. Proměnná zůstává jako RUČNÍ PŘEBITÍ
 * (měřím nad konkrétním checkoutem), ne jako podmínka běhu.
 *
 * Fail-closed se NEMĚNÍ: když je overlay deklarovaný a získat ho nejde, vyhodí
 * se výjimka. Šablona `config/profiles/` se místo něj nepoužije NIKDY — pro
 * instanci s vlastním overlayem to nejsou „méně dat", ale data CIZÍ instance.
 *
 * @param {string} kdo Jméno volajícího do hlášky.
 * @returns {string|null} cesta k overlayi, nebo `null`, když ho instance nedeklaruje
 */
export function ziskejDeklarovanyOverlay(kdo) {
  const rucni = overlayDir();
  if (rucni) return rucni;
  const repo = deklarovanyOverlayRepo();
  if (!repo) return null;

  const raw = (process.env[DECLARATION_ENV] ?? '').trim().replace(/\\\//g, '/');
  const [bezRefu, ref = ''] = raw.split('#');
  // Hnízdo se jmenuje OTISKEM, ne URL: ta nese přihlašovací údaje a ty do cesty
  // na disku nepatří.
  const otisk = createHash('sha256').update(`${repo.url}#${ref}`).digest('hex').slice(0, 16);
  const hnizdo = join(tmpdir(), 'aisha-overlay', otisk);
  const git = (...a) => execFileSync('git', a, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });

  try {
    // Nejdřív se zjistí COMMIT, protože podle něj se mezipaměť jmenuje. Dva
    // běhy nad týmž commitem tak sdílejí týž adresář a NIKDO ho nepřepisuje.
    const commit = commitDeklarace(git, bezRefu, ref);
    const cil = join(hnizdo, commit);
    if (existsSync(join(cil, '.git'))) return cil;

    mkdirSync(hnizdo, { recursive: true });
    const rozdelano = join(hnizdo, `.rozdelano-${process.pid}-${randomBytes(4).toString('hex')}`);
    try {
      git('clone', '--quiet', bezRefu, rozdelano);
      git('-C', rozdelano, 'checkout', '--quiet', '--detach', commit);
      try {
        renameSync(rozdelano, cil);
      } catch (e) {
        // Někdo byl rychlejší. Adresář se jmenuje commitem, takže jeho obsah je
        // TÝŽ — použije se jeho a náš rozdělaný se zahodí.
        if (!existsSync(join(cil, '.git'))) throw e;
        rmSync(rozdelano, { recursive: true, force: true });
      }
    } catch (e) {
      rmSync(rozdelano, { recursive: true, force: true });
      throw e;
    }
    return cil;
  } catch (e) {
    throw new Error(
      `${kdo}: instance deklaruje vlastní overlay (${DECLARATION_ENV} → ${repo.kde}), ` +
        `ale nejde ho získat: ${bezUdaju(String(e?.message ?? e)).split('\n')[0]}. NEPOKRAČUJU: ` +
        `šablony v config/profiles/ popisují CIZÍ instanci. Oprav přístup, nebo nastav ` +
        `${OVERLAY_ENV} na vlastní checkout.`,
    );
  }
}

/**
 * Pro volitelná čtení: vrátí cestu, `null`, a v režimu vynucení místo `null`
 * vyhodí. Spotřebitel tak píše JEDNU větev a chování se řídí prostředím.
 *
 * @param {string} kdo Jméno volajícího do hlášky.
 */
export function overlayDirOrRequired(kdo) {
  const dir = overlayDir();
  if (dir) return dir;
  // Deklarovaný overlay si obstaráme sami (viz ziskejDeklarovanyOverlay) —
  // proměnná je přebití, ne podmínka.
  const ziskany = ziskejDeklarovanyOverlay(kdo);
  if (ziskany) return ziskany;
  if (overlayRequired()) return requireOverlay(kdo);
  return null;
}
