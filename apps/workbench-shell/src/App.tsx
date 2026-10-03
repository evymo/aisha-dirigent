import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ActionDef, ActionFormBlock, ReviewAction, ReviewItem, ReviewQueueBlock, SurfaceBlock } from '@aisha/surface-blocks';
import { beginLogin, completeLoginFromRedirect, getToken, logout } from './auth.js';
import { fetchBlockData, fetchScopeAxes, fetchSectionLayout, fetchSectionUi, fetchSections, fetchTranslations, submitReview, submitSurfaceAction } from './api.js';
import type { BlockUi, MilestoneCapture, ScopeAxis as ScopeAxisData, SurfaceSection } from './api.js';
import { instance } from './instance.js';
import { formatNumber, loadTranslations, t } from './i18n.js';
import { Block, type BlockHandlers } from './components/blocks.js';
import { Es } from './sdk.js';
import { Sidebar, TopBar, sectionLabel } from './components/Chrome.js';
import { Ask } from './components/Ask.js';
import { PendingPanel, Skeleton } from '@aisha/design-language';

/**
 * Dev preview fixture (workbench is live-only, so this is NOT a signed snapshot — it is an
 * explicit, banner-marked synthetic fixture for local development without a backend).
 *   console  = the workbench overview blocks
 *   details  = document_id -> its detail blocks (record_detail + review_queue)
 */
interface PreviewFixture {
  console: SurfaceBlock[];
  details?: Record<string, SurfaceBlock[]>;
}

// Stav `login` tu ZÁMĚRNĚ není. Nepřihlášený uživatel nemá v extranetu žádný
// pobyt — ani na uvítací kartě. Boot ho pošle na IdP nebo na odhlášení, takže
// stav, ve kterém by tu bez tokenu stál a něco viděl, nesmí jít ani vyjádřit.
type View =
  | { kind: 'boot' }
  | { kind: 'live'; blocks: SurfaceBlock[]; failed: string[]; preview: false }
  | { kind: 'live'; blocks: SurfaceBlock[]; failed: string[]; preview: true; fixture: PreviewFixture }
  | { kind: 'error'; messageKey: string };

/**
 * JEDNO PATRO rozkliku.
 *
 * `record` je DRUH otevřeného záznamu (row_kind). Nese se ve stavu, protože bez
 * něj by „Zkusit znovu" neumělo zopakovat totéž otevření — a spadlo by zpátky na
 * domněnku „je to dokument", tedy na vadu, kterou tenhle druh odstraňuje.
 *
 * `seq` je TOTOŽNOST PATRA, ne jeho pozice. Načítání běží asynchronně a uživatel
 * může mezitím dát zpět nebo otevřít další patro; hotová data se proto smějí
 * zapsat jen do patra, které si o ně řeklo. Dvojice (id, record) na to nestačí:
 * týž doklad může být v zásobníku dvakrát (faktura → doklad → týž doklad znovu).
 */
interface DetailFrame {
  seq: number;
  id: string;
  record: string;
  state:
    | { kind: 'loading' }
    | { kind: 'open'; blocks: SurfaceBlock[] }
    | { kind: 'error'; messageKey: string };
}

/**
 * OSY POHLEDU — čím vším smí uživatel omezit, na co se dívá.
 *
 * Dvě, protože portfolio se čte dvěma způsoby a ani jeden není nadřazený: „jak je
 * na tom tahle NAŠE FIRMA" (účetní osa, doklady) a „jak je na tom tenhle AREÁL"
 * (provozní osa, jednotky a nájemci). Táž budova patří jedné firmě, ale jedna
 * firma má víc areálů — kdo má jen firmy, na otázku „co je volné v Kraslicích"
 * neodpoví.
 *
 * Obojí se ODVOZUJE Z DAT týmž RPC, jen nad jiným substrátem: firmy z hlaviček
 * dokladů, areály z parametrů jednotek. Žádný číselník, který by se rozešel
 * se skutečností.
 */
/**
 * Osy pohledu jsou DATA sekce (ADR-003 K5) — v tomhle klientovi po nich nezůstalo
 * ani jméno.
 *
 * ⛔ NAMĚŘENO 2026-09-06: seznam os tu byl KONSTANTOU a nesl jména věcí jiného
 * produktu (`owner_company`, `unit_site`), zděděná ze společného předka forků.
 * Instance, která ta jména nezná, tím dostala přepínač, který mlčí: obě osy
 * vracely nula voleb, lišta se nevykreslila, a vlastní osu si nešlo přidat
 * jinak než editací forku. Jedna z těch dvou os navíc NIC NEFILTROVALA —
 * `owner_company` čte několik RPC, `unit_site` ani jedno; nabídka existovala,
 * konzument ne (ověřeno nezávisle ve dvou stromech).
 *
 * ⭐ Nedeklaruje-li sekce žádnou osu, přepínač prostě NENÍ. „Nic nedeklarováno"
 * je poctivá odpověď; nabídnout místo toho cizí osy by znamenalo filtrovat
 * podle něčeho, co v datech instance neexistuje.
 */

/** Jméno parametru osy je DATA (overlay instance), ne výčet v kódu. */
type ScopeAxis = string;

/**
 * Osy pro sekci: nejdřív deklarace, a jen když instance žádnou nemá, můstek.
 *
 * Prázdná odpověď NENÍ chyba — sekce bez deklarovaných os se chová jako dřív
 * (všechna data). Můstek proto nefunguje jako záchrana selhání, ale jako
 * dočasná náhrada CHYBĚJÍCÍ DEKLARACE; jakmile instance osy má, jeho jména se
 * na obrazovku nedostanou.
 */


/** Zvolený pohled → parametry bloků. `null` = bez omezení, plnohodnotná volba. */
function scopeParams(scope: { dim: ScopeAxis; value: string } | null): Record<string, string> {
  return scope ? { [scope.dim]: scope.value } : {};
}

/**
 * Osy pohledu, podle kterých blok NEFILTROVAL.
 *
 * Pohled jde do každého bloku, ale filtruje jen ten, jehož data RPC ho umí
 * přečíst — a to ohlásí v `provenance.scope_effective` (DB `scope_applied`).
 * Kdo mlčí, ukazuje data bez ohledu na pohled; bez tohohle přiznání by vedle
 * sebe stála čísla o dvou různých množinách a na obrazovce by to nikdo nepoznal.
 * Porovnává se i HODNOTA: blok, který ohlásí jinou firmu, než jakou uživatel
 * zvolil, ji nepotvrdil.
 */
export function scopeIgnored(
  scope: Record<string, string>,
  effective: ReadonlyArray<{ dim: string; value: string }> | undefined
): string[] {
  return Object.entries(scope)
    .filter(([dim, value]) => !(effective ?? []).some((c) => c.dim === dim && c.value === value))
    .map(([dim]) => dim);
}

/**
 * Načte bloky sekce pod DANÝM POHLEDEM.
 *
 * `scope` jde do KAŽDÉHO bloku sekce, ne jen do některých: kdyby si jeden blok
 * pohled vyložil a druhý ne, dvě čísla vedle sebe by mluvila o jiné množině dat
 * a na obrazovce by to nikdo nepoznal. Blok, který parametr nezná, ho ignoruje —
 * `get_block_data` slévá `source_params || p_params`, takže neznámý klíč nic
 * nerozbije.
 */
// Exportováno kvůli bráně `console-odolnost.test.tsx`: odolnost popsaná níž je
// SLIB, který dosud nic neověřovalo, a mobilní povrch má tutéž cestu bez
// per-blokové pojistky (jeden blok nad capem shodí celou obrazovku). Slib, který
// nikdo neměří, přestane platit tichou úpravou.
/**
 * Co se ze sekce povedlo načíst — a co ne.
 *
 * ⭐ `failed` NENÍ diagnostika pro vývojáře, je to ODPOVĚĎ UŽIVATELI. Blok, který
 * neprojde kontraktem, se dřív jen zapsal do konzole prohlížeče a z obrazovky
 * zmizel. Naměřeno 2026-08-08: šest bloků takhle na produkci chybělo — a protože
 * nepřítomnost nikdo nereklamuje, nikdo o tom nevěděl. Odolnost („jedna vada
 * neshodí celou konzoli") má zůstat; mizet beze slova ne.
 */
export interface ConsoleLoad {
  blocks: SurfaceBlock[];
  /** Slugy bloků, které se nepodařilo načíst nebo neprošly kontraktem. */
  failed: string[];
}

/**
 * Blok, který v SEZNAMU sekce nemá co říct: čte JEDEN záznam a bez identity
 * vydá poctivé „o žádném záznamu". Umístěný v sekci být MUSÍ (dispečer od W4
 * pouští jen umístěný blok, jehož publikum volajícího připustí), ale kreslí se
 * až v detailním panelu, kam ho `openRecord` zavolá s parametrem záznamu
 * (`detail_by_kind`). Naměřeno 2026-09-05 na registru dvojčat: čtyři takové
 * bloky se v seznamu vykreslily jako čtyři prázdné rámy pod tabulkou — a čtyři
 * zbytečné požadavky na dispečer při každém otevření sekce.
 *
 * Je to NÁPOVĚDA rozvržení (`presentation`), ne maska: sekce jsou data, tak i
 * uspořádání. Neznámá hodnota nadále degraduje na výchozí kreslení; jen tahle
 * jedna říká „v seznamu ne".
 */
export const PRESENTATION_DETAIL_ONLY = 'detail';

/**
 * Bloky, kterými se otevírá záznam daného druhu — DATA instance
 * (`workbench.detail_by_kind`). 'document' zůstává výchozím druhem: registr
 * dokladů se choval takhle vždycky a jeho konfigurace (`detail_blocks`) se nemění.
 * Jediné místo pravidla: čte ho proklik (`openRecord`) i tabulka, když rozhoduje,
 * jestli je řádek odkaz.
 */
export function detailSlugs(kind: string): string[] {
  const wb = instance.config.workbench;
  return wb?.detail_by_kind?.[kind]?.blocks ?? (kind === 'document' ? wb?.detail_blocks ?? [] : []);
}

/**
 * Detail záznamu skládá bloky jako sekce (vzor prototypu „Modernizace“):
 *   fakta (record_detail) → čísla v jednom řádku (KPI mřížka) → DVA SLOUPCE:
 *   hlavní = tabulky, síť vazeb, fronty; postranní = grafy (jako „Cashflow
 *   měsíce“ vedle tabulek Smluv). Bez grafu zůstává jeden sloupec — prázdný
 *   postranní pruh by byl okraj, ne obsah.
 * Pořadí uvnitř skupin drží deklarace (`detail_by_kind`), ne kód.
 */
export function composeDetail(blocks: SurfaceBlock[], handlers: BlockHandlers, ask?: JSX.Element | null): JSX.Element {
  const facts = blocks.length > 0 && blocks[0]!.block_type === 'record_detail' ? blocks[0]! : null;
  const rest = blocks.filter((b) => b !== facts);
  const kpis = rest.filter((b) => b.block_type === 'kpi_tile');
  const side = rest.filter((b) => b.block_type === 'chart');
  const main = rest.filter((b) => b.block_type !== 'kpi_tile' && b.block_type !== 'chart');
  const block = (b: SurfaceBlock): JSX.Element => <Block key={b.block_slug} block={b} handlers={handlers} />;
  return (
    <>
      {facts ? block(facts) : null}
      {ask ?? null}
      {kpis.length > 0 ? <div className="wb-kpigrid">{kpis.map(block)}</div> : null}
      {side.length > 0 && main.length > 0 ? (
        <div className="wb-cols">
          <div className="wb-cols__main">{main.map(block)}</div>
          <div className="wb-cols__side">{side.map(block)}</div>
        </div>
      ) : (
        [...main, ...side].map(block)
      )}
    </>
  );
}

/** Jméno záznamu z karty faktů (pole `nazev`) — pro předvyplněnou otázku. */
export function recordName(blocks: SurfaceBlock[]): string | null {
  const facts = blocks.find((b) => b.block_type === 'record_detail');
  if (!facts || facts.block_type !== 'record_detail') return null;
  const f = facts.data.fields.find((x) => x.key === 'nazev');
  return typeof f?.value === 'string' && f.value.trim() ? f.value.trim() : null;
}

/**
 * Jeden blok sekce: data + to, co k nim přikládá layout a pohled. Táž cesta pro
 * načtení celé sekce i pro přenačtení jednoho bloku po změně jeho ovladače —
 * jinak by přenačtený blok přišel o `presentation`, přiznání pohledu nebo ovladače.
 *
 * `params` = hodnoty ovladačů TOHOTO bloku (client_params). Pohled sekce (`scope`)
 * má přednost: ovladač bloku nesmí tiše přepsat firmu zvolenou nad celou sekcí.
 */
export async function loadBlock(
  b: { block_slug: string; presentation?: string },
  scope: Record<string, string>,
  params: Record<string, unknown> = {},
  ui?: BlockUi
): Promise<SurfaceBlock> {
  const data = await fetchBlockData(b.block_slug, { ...params, ...scope });
  // Arrangement is layout DATA: the hint rides next to the validated block
  // (attached after contract validation — it is not part of the data shape).
  // Attached only when the layout carries it: an explicit `undefined`
  // property is not the same as an absent optional one
  // (exactOptionalPropertyTypes), and the predicate below says `?:`.
  // Co jede VEDLE dat bloku (není součástí jeho tvaru): nápověda layoutu, přiznání
  // pohledu a ovladače. Připojuje se po validaci kontraktu, jen když je co připojit
  // (exactOptionalPropertyTypes: chybějící klíč ≠ klíč s undefined).
  const vedle: { presentation?: string; scope_ignored?: string[]; ui?: BlockUi; params?: Record<string, unknown> } = {};
  if (b.presentation !== undefined) vedle.presentation = b.presentation;
  // Pohled, který blok NEPOTVRDIL (`provenance.scope_effective`), se u bloku
  // přizná. Naměřeno 2026-09-28: v sekci Smlouvy pět bloků z deseti firmu tiše
  // ignorovalo a pod zvolenou firmou ukazovalo celý podnik.
  const ignored = scopeIgnored(scope, data.provenance.scope_effective);
  if (ignored.length > 0) vedle.scope_ignored = ignored;
  // Ovladače a řazení (get_surface_layout_ui) i jejich aktuální hodnoty.
  if (ui && Object.keys(ui).length > 0) { vedle.ui = ui; vedle.params = params; }
  return Object.keys(vedle).length === 0 ? data : Object.assign({}, data, vedle);
}

export async function loadConsole(
  section: string,
  scope: Record<string, string> = {},
  blockParams: Record<string, Record<string, unknown>> = {}
): Promise<ConsoleLoad> {
  const [layout, ui] = await Promise.all([fetchSectionLayout(section), fetchSectionUi(section)]);
  const ordered = [...layout.blocks]
    .filter((b) => b.presentation !== PRESENTATION_DETAIL_ONLY)
    .sort((a, b) => a.position - b.position);
  // Resilience: one block whose data source is broken (bad RPC shape, contract
  // violation, RLS denial) must NOT blank the whole console. Render every block
  // that loads; skip the ones that fail (logged for diagnosis). A fully-empty
  // result still yields the live view (empty state), never the boot error.
  const failed: string[] = [];
  const settled = await Promise.all(
    ordered.map((b) =>
      loadBlock(b, scope, blockParams[b.block_slug] ?? {}, ui[b.block_slug])
        .catch((err: unknown) => {
          console.warn(`[workbench] block '${b.block_slug}' skipped — failed to load:`, err);
          failed.push(b.block_slug);
          return null;
        })
    )
  );
  return {
    blocks: settled.filter((b): b is SurfaceBlock & { presentation?: string } => b !== null),
    failed
  };
}

async function loadPreviewFixture(): Promise<PreviewFixture | null> {
  // Prefer the workbench-specific fixture (different shape) over the shared preview path.
  const url = instance.config.workbench?.fixture_url ?? instance.config.preview.fixture_url;
  if (!url) return null;
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as PreviewFixture | null;
}

/**
 * The steps a pending section is waiting for, as i18n KEYS derived from its own
 * reason key: `<reason>.step.1`, `.2`, `.3`. An instance that has written them
 * gets its concrete plan ("connect the telematics lane", "re-run ingest"); one
 * that has not gets nothing rather than an invented roadmap — this shell must
 * never author product promises.
 */
function pendingSteps(reasonKey?: string): string[] {
  if (!reasonKey) return [];
  const out: string[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const key = `${reasonKey}.step.${i}`;
    const text = t(key);
    if (text === key) break;
    out.push(text);
  }
  return out;
}


/**
 * The mockup's page rhythm, derived from block TYPES — not from per-section
 * bespoke code: KPI tiles form the opening row, "wide" work blocks fill the
 * main column, commentary (charts, narrative, feeds, timelines) sits in the
 * side rail. Every section gets the same PageHead with the "ask AISHA" action,
 * so the affordance the mockup shows on each view exists everywhere the
 * instance has an answering surface. Purely presentational: order inside each
 * bucket keeps the backend's layout order.
 */
/**
 * Přepínač pohledu — kterou z našich firem právě sledujeme.
 *
 * Sedí NAD čísly, protože volba pohledu je rozhodnutí, které se dělá před čtením:
 * jinak si člověk přečte součet a netuší, čí je. Vykreslí se jen když databáze
 * nějaké volby vrátila — u instance s jedinou firmou by prázdný filtr byl šum a
 * při selhání RPC se sekce chová jako dřív.
 *
 * Volby nesou POČET: pro rozhodnutí „kam se podívat" je rozdíl mezi firmou se
 * třemi doklady a firmou se třemi tisíci.
 */
// Exportováno kvůli bráně `osy-pohledu-jsou-data.test.tsx`: že se prázdná osa
// nevykreslí, je tvrzení o LIŠTĚ, ne o načítání — musí se měřit na ní.
/**
 * Načte bloky DETAILU záznamu. Vadný blok NEZABÍJÍ ostatní — vrátí se ty, které
 * dorazily, a jména těch, které selhaly.
 *
 * ⛔ NAMĚŘENO 2026-09-07 na produkci: detail volal `Promise.all`, takže JEDEN
 * vadný blok shodil VŠECH PĚT. Uživatel viděl „Data se nepodařilo načíst",
 * přestože všech pět volání vrátilo 200 s kompletními daty — padala až
 * kontrakt-kontrola jednoho z nich (boolean v buňce tabulky). Totální výpadek
 * tam, kde chyběl jeden řádek; diagnóza pak začíná o vrstvu vedle.
 *
 * ⭐ TÁŽ ZÁSADA JAKO NA HRANICI MASKY — „neznámé nezabíjí známé"
 * (neznam-nezabiji-znam.test.ts, 2026-08-08). `loadConsole` ji drží už dřív:
 * vadný blok sesbírá do `failed` a zbytek ukáže. Detail ji NEMĚL a platilo
 * v něm všechno-nebo-nic. Sjednoceno na chování sekce.
 */
export async function loadDetailBlocks(
  slugs: readonly string[],
  paramKey: string,
  id: string
): Promise<{ blocks: SurfaceBlock[]; failed: string[] }> {
  const failed: string[] = [];
  const settled = await Promise.all(
    slugs.map((slug) =>
      fetchBlockData(slug, { [paramKey]: id }).catch((err: unknown) => {
        console.warn(`[workbench] detail block '${slug}' skipped — failed to load:`, err);
        failed.push(slug);
        return null;
      })
    )
  );
  return { blocks: settled.filter((b): b is SurfaceBlock => b !== null), failed };
}

export function ScopeLens({ axes, active, onPick }: {
  axes: ScopeAxisData[];
  active: { dim: ScopeAxis; value: string } | null;
  onPick: (v: { dim: ScopeAxis; value: string } | null) => void;
}): JSX.Element | null {
  const osy = axes.filter((a) => a.options.length > 0);
  if (osy.length === 0) return null;
  return (
    <div className="wb-lens" role="group" aria-label={t('app.scope.aria')}>
      <button
        className={`wb-lens__chip${active === null ? ' is-active' : ''}`}
        aria-pressed={active === null}
        onClick={() => onPick(null)}
      >{t('app.scope.all')}</button>
      {osy.map((osa) => (
        <span key={osa.axis_key} className="wb-lens__axis" data-axis={osa.axis_key}>
          <span className="wb-lens__axislabel">{t(osa.title_key)}</span>
          {osa.options.map((o) => {
            const je = active?.dim === osa.dim && active.value === o.value;
            return (
              <button
                key={o.value}
                className={`wb-lens__chip${je ? ' is-active' : ''}`}
                aria-pressed={je}
                onClick={() => onPick({ dim: osa.dim, value: o.value })}
                title={o.value}
              >
                {o.value}
                <span className="wb-lens__count rdl-mono">{formatNumber(o.count)}</span>
              </button>
            );
          })}
        </span>
      ))}
    </div>
  );
}

function composeSection(
  blocks: SurfaceBlock[],
  handlers: BlockHandlers,
  section: string | null,
  sections: SurfaceSection[],
  lens: {
    axes: ScopeAxisData[];
    active: { dim: ScopeAxis; value: string } | null;
    onPick: (v: { dim: ScopeAxis; value: string } | null) => void;
  },
  onAsk?: () => void
): JSX.Element {
  const isKpi = (b: SurfaceBlock): boolean => b.block_type === 'kpi_tile';
  /** Komentář: vždycky patří k okraji, ať je sekce jakákoli. */
  const isCommentary = (b: SurfaceBlock): boolean =>
    ['chart', 'narrative', 'alert_feed', 'timeline'].includes(b.block_type);
  /**
   * ROZHODOVACÍ blok (fronta, nálezy, postup k cíli) — „co mám odbavit".
   *
   * Do bočního pruhu patří JEN tehdy, když je vedle čeho stát: sekce s jedinou
   * frontou je ta fronta, ne rám kolem prázdna. `presentation` se nechává na
   * hlavním sloupci vždy — páska dne je hlavní proud, ne poznámka na okraji.
   */
  const isDecision = (b: SurfaceBlock): boolean =>
    ['review_queue', 'findings', 'goal_progress'].includes(b.block_type) &&
    (b as { presentation?: string }).presentation !== 'tape';
  const kpis: SurfaceBlock[] = blocks.filter(isKpi);
  const rest: SurfaceBlock[] = blocks.filter((b) => !isKpi(b));
  const wide: SurfaceBlock[] = rest.filter((b) => !isCommentary(b) && !isDecision(b));
  /*
   * Naměřeno 2026-08-08 na sekci smluv: 1 KPI + 5 tabulek + 1 fronta a
   * `.wb-cols` se NEVYTVOŘILA ANI JEDNOU — dvousloupec existoval jen v kódu,
   * protože žádný z těch typů nebyl „komentář". Sekce tak byla jedna nudle
   * na plnou šířku. Pruh proto bere i rozhodovací bloky, ale jen když hlavnímu
   * sloupci zůstanou aspoň dva — jinak by se z obsahu stal okraj.
   */
  const decisions: SurfaceBlock[] = rest.filter(isDecision);
  const side: SurfaceBlock[] = [
    ...rest.filter(isCommentary),
    ...(wide.length >= 2 ? decisions : []),
  ];
  const main: SurfaceBlock[] = wide.length >= 2 ? wide : [...wide, ...decisions];
  const title = section ? sectionLabel(section, sections.find((x) => x.section === section)?.title_key) : '';
  return (
    <>
      <header className="wb-pagehead">
        <h2 className="wb-pagehead__title">{title}</h2>
        {onAsk && section !== 'ask' ? (
          <button className="wb-textbtn" onClick={onAsk}>{t('app.ask.cta')}</button>
        ) : null}
      </header>
      <ScopeLens axes={lens.axes} active={lens.active} onPick={lens.onPick} />
      {kpis.length > 0 ? (
        <div className="wb-kpigrid">
          {kpis.map((b) => <Block key={b.block_slug} block={b} handlers={handlers} />)}
        </div>
      ) : null}
      {side.length > 0 ? (
        <div className="wb-cols">
          <div className="wb-cols__main">
            {main.map((b) => <Block key={b.block_slug} block={b} handlers={handlers} />)}
          </div>
          <div className="wb-cols__side">
            {side.map((b) => <Block key={b.block_slug} block={b} handlers={handlers} />)}
          </div>
        </div>
      ) : (
        main.map((b) => <Block key={b.block_slug} block={b} handlers={handlers} />)
      )}
    </>
  );
}

export default function App(): JSX.Element {
  const [view, setView] = useState<View>({ kind: 'boot' });
  /**
   * STOPA ZANOŘENÍ — kudy uživatel šel dovnitř.
   *
   * Není to „detail" (jedno zvláštní patro nad sekcí), je to CESTA SÍTÍ VAZEB:
   * dlužník → jeho faktury → ten doklad → …, libovolně hluboko. Je to totéž
   * zanořování jako sestup do příběhu, takže se tu nemodeluje zvlášť: sekce je
   * kořen, každé otevření přidá uzel, „zpět" jeden odebere.
   *
   * Prázdná stopa = jsme na sekci. Shell přitom NEVÍ, jaké druhy uzlů existují —
   * čím se který druh otevírá, je vlastnost instance (`detail_by_kind`), takže
   * nové patro nepotřebuje nový kód.
   */
  const [trail, setTrail] = useState<DetailFrame[]>([]);
  // Totožnost patra. `useRef`, protože přežívá překreslení a NESMÍ se odvozovat
  // z délky stopy — po „zpět a znovu dovnitř" by se čísla opakovala a dokončené
  // načítání by zapsalo data do cizího patra.
  const poradi = useRef(0);
  const [sections, setSections] = useState<SurfaceSection[]>([]);
  const [theme, setTheme] = useState<'carbon' | 'daylight'>(
    () => (document.documentElement.getAttribute('data-theme') as 'carbon' | 'daylight') ?? 'carbon'
  );
  const [section, setSection] = useState<string | null>(null);
  // Sekce, na kterou se právě čeká — pro odpovědi, které dorazí POZDĚ. Osy se už
  // nečekají spolu s bloky (viz `openSection`), takže osy předchozí sekce smí
  // přistát až po přepnutí; bez téhle kontroly by nové sekci podstrčily cizí lištu.
  const sectionRef = useRef<string | null>(null);
  // Pohled = kterou z našich firem právě sledujeme. `null` znamená VŠECHNY — je to
  // plnohodnotná volba, ne „nevybráno": u portfolia je součet přes firmy nejčastější
  // otázka a nesmí vyžadovat klikání.
  const [scopeAxes, setScopeAxes] = useState<ScopeAxisData[]>([]);
  const [scope, setScope] = useState<{ dim: ScopeAxis; value: string } | null>(null);
  // Hodnoty ovladačů bloků (client_params) — per blok, v rámci sekce. Nová sekce je
  // zahodí (jiné bloky); změna pohledu je drží (měsíc knihy faktur zůstane i pod jinou firmou).
  const blockParamsRef = useRef<Record<string, Record<string, unknown>>>({});
  const [, bump] = useReducer((n: number) => n + 1, 0); // locale change re-render
  /** Osy dorazí po blocích; zapíší se jen tehdy, patří-li pořád aktuální sekci. */
  const doplnitOsy = useCallback(async (pro: string, osy: Promise<ScopeAxisData[]>): Promise<void> => {
    const axes = await osy;
    if (sectionRef.current === pro) setScopeAxes(axes);
  }, []);

  /**
   * Archetyp vzhledu na <html>, hned na začátku bootu.
   *
   * Tokeny SDK existují jen pod dvojicí [data-theme] + [data-archetype], takže
   * bez tohohle řádku se komponenty ESDK kreslí do prázdna. Hodnota je vlastnost
   * INSTANCE (config), ne shellu — natvrdo v index.html by z generického kanálu
   * udělala instanční a druhá instance by dostala cizí vzhled.
   *
   * Chybí-li, shell to ŘEKNE a jede dál: zbytek povrchu je v pořádku a shodit
   * kvůli vzhledu celý extranet by bylo horší. Tiché nic je ale to jediné, co si
   * dovolit nesmí — přesně tak byl SDK měsíce nepoužitelný, aniž kdo věděl proč.
   */
  useEffect(() => {
    const a = instance.config.archetype;
    if (a) document.documentElement.setAttribute('data-archetype', a);
    else console.error(
      '[workbench] instance nedeklaruje `archetype` — komponenty extranet-sdk-ui ' +
        'nemají token layer a vykreslí se bez stylu. Doplň jej do app.config.json.',
    );
  }, []);

  const boot = useCallback(async (): Promise<void> => {
    // 1) dev preview (explicit, banner-marked, unsigned local fixture)
    if (instance.config.preview.enabled) {
      const fixture = await loadPreviewFixture();
      if (fixture) {
        setView({ kind: 'live', blocks: fixture.console, failed: [], preview: true, fixture });
        return;
      }
    }
    // 2) auth
    // Bez platného tokenu se do extranetu nedostane NIKDO — ani na okamžik,
    // ani přes mezistránku (majitel 2026-08-03: „v žádném případě se uživatel
    // na extranet nesmí dostat"). Jsou právě dvě východiska: na přihlášení,
    // nebo na odhlášení. Třetí, které by ukázalo kus povrchu, tu není.
    const landing = await completeLoginFromRedirect();
    if (landing === 'failed') {
      // Vrátili jsme se od Keycloaku s kódem a stejně z toho token není.
      // Znovu žádat o kód nemá smysl a je to nebezpečné: relace u KC žije,
      // takže by kód mlčky vydal znovu a vzniklo by kolo bez jediného kliknutí.
      // Odhlášení je jediný krok, který ten stav opravdu ukončí — zruší relaci
      // u IdP, takže další pokus začne od formuláře.
      //
      // Ano, tohle odhlásí i toho, komu selhala jen dočasná služba. Je to
      // vědomá volba majitele: raději odhlásit, než pustit dovnitř kohokoli,
      // za koho neručí platný token.
      logout();
      return;
    }
    const token = await getToken();
    if (!token) {
      // Rovnou na IdP. Zůstáváme přitom ve `boot`, ne v `login`: než prohlížeč
      // přesměrování provede, uplyne měřitelný okamžik a v něm se nesmí mihnout
      // ani přihlašovací karta. `boot` bez sekcí nekreslí ani rám (`showFrame`).
      await beginLogin();
      return;
    }
    // 2b) display strings from the DB, now that we have an identity. Same
    // `translations` table the admin UI edits, so a wording change ships as data
    // rather than as a rebuild. Awaited before the first authenticated render so
    // the surface does not flash the build-time text and then swap it.
    //
    // Seznam sekcí na překladech nezávisí, proto se ptá SOUBĚŽNĚ (naměřeno
    // 2026-09-29 v prohlížeči: překlady 4 stránky ~390 ms, sekce ~110 ms — dřív
    // za sebou). Čeká se dál na obojí, takže první vykreslení je stejné.
    // Odmítnutí se tu jen „ošetří", aby nevisel neobsloužený slib; skutečně ho
    // přečte `await` níž, uvnitř `try`.
    const sectionsP = fetchSections();
    sectionsP.catch(() => undefined);
    await loadTranslations(fetchTranslations);
    document.title = t('app.title');
    // 3) live RPC path — discover which sections exist, then load the first.
    // Backend decides what exists AND the order; the client only picks a default.
    try {
      const available = await sectionsP;
      setSections(available);
      const first = available[0]?.section;
      if (!first) {
        // Authenticated but granted nothing: an empty extranet is a legitimate
        // state (RLS default-deny), not an error to shout about.
        setView({ kind: 'live', blocks: [], failed: [], preview: false });
        return;
      }
      setSection(first);
      sectionRef.current = first;
      // Osy patří SEKCI: registr se přepíná podle druhu a skupiny, porada podle
      // šablony práce. Jeden seznam pro celou plochu by na půlce sekcí nabízel,
      // podle čeho se tam přepnout nedá.
      const axesP = fetchScopeAxes(first);
      const { blocks, failed } = await loadConsole(first);
      setView({ kind: 'live', blocks, failed, preview: false });
      void doplnitOsy(first, axesP);
    } catch {
      setView({ kind: 'error', messageKey: 'app.error.load' });
    }
  }, [doplnitOsy]);

  /** Switch sections without a full boot — auth and the section list still hold. */
  const openSection = useCallback(async (next: string): Promise<void> => {
    setSection(next);
    // Nová sekce = nový kořen: stopa se zahodí celá, ne o patro.
    setTrail([]);
    // A nový přepínač: osy jsou vlastností sekce (K5). Zvolený pohled se proto
    // zahazuje — „jen zájemci" z registru nedává ve věži smysl a tiše přenesený
    // parametr by filtroval podle něčeho, co na obrazovce není vidět.
    setScope(null);
    blockParamsRef.current = {};
    sectionRef.current = next;
    // Lišta předchozí sekce pryč HNED — jinak by nad novými bloky chvíli visela
    // cizí volba, než dorazí osy téhle sekce.
    setScopeAxes([]);
    setView({ kind: 'boot' });
    try {
      // ⛔ OSY NEBRZDÍ DATA (naměřeno 2026-09-29): přepnutí na Smlouvy trvalo
      // 3,46 s a posledním, na co se čekalo, byly osy (3,4 s) — bloky byly
      // hotové za 2,9 s. Přepínač je doplněk obrazovky, ne podmínka jejího
      // zobrazení: bloky se vykreslí hned a lišta se doplní, až dorazí.
      const axesP = fetchScopeAxes(next);
      const konzole = await loadConsole(next);
      // Uživatel mezitím přepnul jinam — tahle odpověď už nepatří na obrazovku.
      if (sectionRef.current !== next) return;
      setView({ kind: 'live', ...konzole, preview: false });
      void doplnitOsy(next, axesP);
    } catch {
      if (sectionRef.current !== next) return;
      setView({ kind: 'error', messageKey: 'app.error.load' });
    }
  }, [doplnitOsy]);

  /**
   * Přepnutí pohledu. Překresluje se CELÁ sekce, ne jednotlivé bloky: pohled je
   * vlastnost obrazovky, a kdyby se část bloků přenačetla a část ne, čísla vedle
   * sebe by chvíli mluvila o jiné množině dat.
   */
  const applyScope = useCallback(async (next: { dim: ScopeAxis; value: string } | null): Promise<void> => {
    setScope(next);
    setTrail([]);
    if (!section) return;
    try {
      setView({ kind: 'live', ...(await loadConsole(section, scopeParams(next), blockParamsRef.current)), preview: false });
    } catch {
      setView({ kind: 'error', messageKey: 'app.error.load' });
    }
  }, [section]);

  useEffect(() => {
    void boot();
  }, [boot]);

  /**
   * Otevře detail toho, na co řádek ukazuje.
   *
   * `kind` je DRUH záznamu, který vydala RPC (`row_kind`), ne domněnka shellu.
   * Dokud tenhle parametr neexistoval, dostával `openDocument` každé `id` a měl
   * pro něj jediný význam — „dokument". Řádek dlužníka nese IČO, takže klik
   * poslal čtečce dokladů číslo, které nezná, a ta místo chyby vydala PRÁZDNOU
   * kartu (naměřeno na produkci 2026-08-07).
   *
   * Čím se který druh otevírá, je DATA instance (`workbench.detail_by_kind`):
   * jinak by tu stálo větvení na konkrétní druh, tedy jméno jednoho podnikového
   * pojmu zadrátované v generickém shellu.
   *
   * (Vzorek takového větvení se sem schválně NEPÍŠE ani do komentáře — brána
   * table-row-kind čte soubor textově a vzorek ve vysvětlivce by vzala jako kód.)
   */
  /** Zapíše výsledek do patra, které si o něj řeklo — a jen do něj. */
  const zapsatDoPatra = useCallback((seq: number, state: DetailFrame['state']): void => {
    setTrail((st) => st.map((f) => (f.seq === seq ? { ...f, state } : f)));
  }, []);

  /**
   * Otevře uzel, na který stopa ukazuje.
   *
   * `nahradit` = totožnost patra, které se má PŘEPSAT místo přidání nového. Tím
   * se liší „zkusit znovu" (opravuje patro, kde stojím) od prokliku (jde hloub).
   * Bez toho rozdílu by opakovaný pokus stopu prodlužoval a „zpět" by se pak
   * vracelo do vlastních neúspěšných pokusů.
   */
  const openRecord = useCallback(
    async (id: string, kind: string, nahradit?: number): Promise<void> => {
      const byKind = instance.config.workbench?.detail_by_kind?.[kind];
      const slugs = detailSlugs(kind);
      const seq = nahradit ?? (poradi.current += 1);
      const patro = (state: DetailFrame['state']): DetailFrame => ({ seq, id, record: kind, state });
      const polozit = (state: DetailFrame['state']): void => {
        if (nahradit !== undefined) zapsatDoPatra(seq, state);
        else setTrail((st) => [...st, patro(state)]);
      };
      // Neznámý druh NEOTEVÍRÁ nic a řekne to. Tiché nic by bylo přesně ta vada,
      // kterou tenhle parametr odstraňuje.
      if (slugs.length === 0) {
        if (kind !== 'document') polozit({ kind: 'error', messageKey: 'app.error.noDetailForKind' });
        return;
      }
      const paramKey = byKind?.param ?? 'document_id';
      polozit({ kind: 'loading' });
      // Preview: read details straight from the fixture (no backend).
      if (view.kind === 'live' && view.preview) {
        zapsatDoPatra(seq, { kind: 'open', blocks: view.fixture.details?.[id] ?? [] });
        return;
      }
      try {
        // Key MUST be `document_id` (or `doc_slug`) — that is what the detail RPCs
        // read (get_document_detail/get_obligation_queue: p_params->>'document_id').
        // The old `p_document_id` over-applied the SQL arg-name `p_` prefix to a
        // jsonb key, so the RPC saw NULL and every detail came back empty.
        const { blocks, failed: failedDetail } = await loadDetailBlocks(slugs, paramKey, id);
        // Když nepřijde ANI JEDEN blok, není co ukázat — teprve to je chyba.
        if (blocks.length === 0 && failedDetail.length > 0) {
          zapsatDoPatra(seq, { kind: 'error', messageKey: 'app.error.load' });
          return;
        }
        // Dopsat smí jen do SVÉHO patra: uživatel mohl mezitím dát zpět nebo jít
        // dál, a přepsat cizí patro by mu pod rukama vyměnilo obsah.
        zapsatDoPatra(seq, { kind: 'open', blocks });
      } catch {
        zapsatDoPatra(seq, { kind: 'error', messageKey: 'app.error.load' });
      }
    },
    [view, zapsatDoPatra]
  );

  const onReview = useCallback(
    async (
      block: ReviewQueueBlock,
      item: ReviewItem,
      action: ReviewAction,
      capture?: MilestoneCapture
    ): Promise<void> => {
      // Preview mode has no backend — resolve so the UI marks the row done (demo only).
      if (view.kind === 'live' && view.preview) return;
      await submitReview(block.data.entity_kind, item.id, action.decision, capture);
    },
    [view]
  );

  /**
   * AKCE SPRÁVY Z PLOCHY (ADR-003, K4). Klient posílá jen slug + cíl + payload;
   * cíl se skládá z druhu a identity, které vydal blok (`target_kind`,
   * `target_id`), takže shell nehádá, co je „twin_id" — říká to server.
   * Po zápisu se detail, ve kterém akce běžela, načte znovu: fakt vznikl na
   * serveru a jeho obraz tady musí přijít odtamtud, ne z optimistické úpravy.
   */
  const onAction = useCallback(
    async (block: ActionFormBlock, action: ActionDef, payload: Record<string, string>): Promise<void> => {
      if (view.kind === 'live' && view.preview) return;
      const key =
        block.data.target_kind === 'twin' ? 'twin_id'
        : block.data.target_kind === 'actor' ? 'user_id'
        : block.data.target_kind === 'story' ? 'story_id'
        : null;
      const target = key && block.data.target_id ? { [key]: block.data.target_id } : {};
      await submitSurfaceAction(action.slug, target, payload);
      const top = trail[trail.length - 1];
      if (top) await openRecord(top.id, top.record, top.seq);
    },
    [view, trail, openRecord]
  );

  // Ovladač bloku změnil hodnotu → přenačte se JEN ten blok (ostatní čísla se nemění,
  // pohled sekce platí dál). Selhání nechá na obrazovce předchozí stav bloku.
  const viewRef = useRef(view);
  viewRef.current = view;
  const onBlockParams = useCallback(async (slug: string, params: Record<string, unknown>): Promise<void> => {
    blockParamsRef.current = { ...blockParamsRef.current, [slug]: params };
    const v = viewRef.current;
    const cur = v.kind === 'live'
      ? (v.blocks.find((b) => b.block_slug === slug) as (SurfaceBlock & { presentation?: string; ui?: BlockUi }) | undefined)
      : undefined;
    if (!cur) return;
    try {
      const fresh = await loadBlock(cur, scopeParams(scope), params, cur.ui);
      setView((w) => (w.kind === 'live'
        ? { ...w, blocks: w.blocks.map((b) => (b.block_slug === slug ? fresh : b)) }
        : w));
    } catch (err) {
      console.warn(`[workbench] block '${slug}' — přenačtení s parametry selhalo:`, err);
    }
  }, [scope]);

  const handlers: BlockHandlers = {
    onSelectRecord: (id, kind) => void openRecord(id, kind),
    canOpen: (kind) => detailSlugs(kind).length > 0,
    onReview,
    onAction,
    onBlockParams: (slug, params) => void onBlockParams(slug, params)
  };

  const preview = view.kind === 'live' && view.preview;
  // Kde uživatel právě stojí: vrchol stopy. Prázdná stopa = sekce.
  const uzel = trail[trail.length - 1];
  const inDetail = uzel !== undefined;
  const askBlock = instance.config.ask?.answer_block;

  /* The section the viewer opened, when it is declared-but-not-connected. Its
     own row says so (state='inactive'), so nothing here needs a list of names. */
  const pending = sections.find((x) => x.section === section && x.state === 'inactive');

  // The frame stays up while a section loads. openSection() sets view='boot',
  // and the old rule hid the sidebar with it — so switching sections tore the
  // navigation away and left a bare top bar with a lone ellipsis, which reads as
  // a broken page rather than a loading one.
  // Během bootu bez sekcí se rám nekreslí — a to je zároveň to, co vidí
  // nepřihlášený, než ho prohlížeč odnese na IdP: nic.
  const showFrame = view.kind !== 'boot' || sections.length > 0;

  return (
    <div className={showFrame ? 'app workbench has-frame' : 'app workbench'}>
      {/* Sidebar only once there is something to navigate: during boot and on
          the login screen a nav of zero sections is noise, not orientation. */}
      {showFrame && sections.length > 0 ? (
        <Sidebar sections={sections} current={section ?? ''} onOpen={(s) => void openSection(s)} />
      ) : null}
      <div className="wb-main">
      <TopBar
        title={inDetail || !section ? undefined : sectionLabel(section, sections.find((x) => x.section === section)?.title_key)}
        theme={theme}
        onThemeChange={(next) => {
          setTheme(next);
          document.documentElement.setAttribute('data-theme', next);
        }}
        onLocaleChange={bump}
        onLogout={view.kind === 'live' && !preview ? logout : undefined}
        // ZPĚT ODEBERE JEDNO PATRO, ne celou stopu. Dřív tu stálo zavření
        // rovnou na sekci, takže „zpět" z detailu faktury skočilo na začátek
        // sekce místo na seznam faktur, ze kterého se přišlo.
        onBack={inDetail ? () => setTrail((st) => st.slice(0, -1)) : undefined}
        preview={preview}
      />
      <main>
        {view.kind === 'boot' ? (
          <Skeleton kpis={4} count={2} label={t('app.loading')} />
        ) : null}

        {view.kind === 'live' && !inDetail && pending ? (
          /* Declared, not yet connected: say what it will show and what it waits
             for. Loading its (empty) layout would render a blank console that
             looks broken instead of planned. */
          <PendingPanel
            title={sectionLabel(pending.section, pending.title_key)}
            statusLabel={t('app.section.pending.status')}
            reason={pending.reason_key ? t(pending.reason_key) : t('app.section.pending.reason')}
            stepsLabel={t('app.section.pending.next')}
            steps={pendingSteps(pending.reason_key)}
          />
        ) : null}

        {/* Blok, který neprošel kontraktem, se dřív jen zapsal do konzole a
            z obrazovky ZMIZEL. Odolnost zůstává (jedna vada neshodí sekci), ale
            mizení beze slova ne: nepřítomnost nikdo nereklamuje, takže šest
            takových bloků na produkci chybělo týdny. */}
        {view.kind === 'live' && !inDetail && view.failed.length > 0 ? (
          <Es.Banner tone="fault">{t('app.blocks.failed')} {view.failed.join(', ')}</Es.Banner>
        ) : null}

        {view.kind === 'live' && !inDetail && !pending ? (
          <>
            {/* Asking comes first, on every section: the product's loop is a
                question, not a dashboard. Absent config = no panel (an input
                that answers nothing is worse than none). Preview has no backend. */}
            {askBlock && !preview ? <Ask blockSlug={askBlock} /> : null}
            {view.blocks.length === 0 ? (
              <p className="center muted">{t('app.blocks.empty')}</p>
            ) : (
              composeSection(view.blocks, handlers, section, sections,
                { axes: scopeAxes, active: scope, onPick: (v) => void applyScope(v) },
                askBlock ? () => void openSection('ask') : undefined)
            )}
          </>
        ) : null}

        {uzel ? (
          <section className="detail">
            {uzel.state.kind === 'loading' ? <Skeleton count={2} label={t('app.loading')} /> : null}
            {uzel.state.kind === 'open' ? (
              uzel.state.blocks.length === 0 ? (
                <Es.Empty title={t('app.blocks.empty')} />
              ) : (
                composeDetail(
                  uzel.state.blocks,
                  handlers,
                  // „Zeptat se AISHY" o TOMHLE záznamu — jen u druhů, které nesou
                  // jméno (karta firmy); otázka je předvyplněná, odešle ji člověk.
                  askBlock && !preview && recordName(uzel.state.blocks) ? (
                    <Ask
                      key={`ask-${uzel.seq}`}
                      blockSlug={askBlock}
                      initialDraft={t('app.cp.ask.prefill').replace('{name}', recordName(uzel.state.blocks)!)}
                    />
                  ) : null
                )
              )
            ) : null}
            {uzel.state.kind === 'error' ? (
              <section className="login">
                {/* Chyba je STAV s barvou, ne odstavec — fault pruh říká „tohle
                    není prázdno" dřív, než kdo čte (Z7: chyba = prázdno). */}
                <Es.Banner tone="fault">{t(uzel.state.messageKey)}</Es.Banner>
                {/* Opakuje se TOHLE patro (`uzel.seq`), stopa se neprodlužuje. */}
                <button className="es-btn" onClick={() => void openRecord(uzel.id, uzel.record, uzel.seq)}>
                  {t('app.retry.cta')}
                </button>
              </section>
            ) : null}
          </section>
        ) : null}

        {view.kind === 'error' ? (
          <section className="login">
            <Es.Banner tone="fault">{t(view.messageKey)}</Es.Banner>
            <button className="es-btn" onClick={() => void boot()}>
              {t('app.retry.cta')}
            </button>
          </section>
        ) : null}
      </main>
      </div>
    </div>
  );
}
