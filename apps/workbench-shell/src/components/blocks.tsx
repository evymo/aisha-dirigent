import { useRef, useState, type ReactNode } from 'react';
import { SignatureCanvas, type SignatureCanvasRef } from '@aisha/capture-ui';
import { Button, Circuit } from '@aisha/design-language';
import type {
  ActionDef,
  ActionField,
  ActionFormBlock,
  AlertFeedBlock,
  ChartBlock,
  DocumentLine,
  TimingTowerBlock,
  FindingsBlock,
  GoalProgressBlock,
  HandoverConfirmBlock,
  KpiTileBlock,
  NarrativeBlock,
  RecordDetailBlock,
  RecordField,
  RelationWebBlock,
  ReviewAction,
  ReviewCapture,
  ReviewItem,
  ReviewQueueBlock,
  SurfaceBlock,
  TableBlock,
  TimelineBlock
} from '@aisha/surface-blocks';
import { formatDateTime, formatNumber, t } from '../i18n.js';
import type { BlockUi } from '../api.js';
import { Es } from '../sdk.js';

/** A decision handler: returns when the platform has persisted the review (or throws). */
export interface CapturedEvidence {
  recipient?: string;
  signature?: string;
  /** Reason for a deviation — a milestone that failed without one is unactionable. */
  note?: string;
}

/** Compile-time proof that the panel knows every capture kind the contract allows:
 *  a new kind added to ReviewCapture leaves a hole here and fails the build. */
const CAPTURE_DRAWN: Record<ReviewCapture, true> = { recipient: true, signature: true, note: true };
void CAPTURE_DRAWN;

export type ReviewHandler = (
  item: ReviewItem,
  action: ReviewAction,
  captured?: CapturedEvidence
) => Promise<void>;

/** Provenance footer — every block renders its source (platform rule: no unsourced figures). */
/**
 * Every block's source·freshness chip. The design language ships this as a
 * component precisely because "no number without a source" is a rule of the
 * language, not a decoration each surface re-invents.
 */
function Provenance({ block }: { block: SurfaceBlock }): JSX.Element {
  // Připojuje loadConsole po validaci kontraktu (App.tsx scopeIgnored): zvolený
  // pohled, který data bloku NEPOTVRDILA. Číslo bez pohledu je pořád pravdivé
  // číslo — jen o jiné množině, a to musí být vidět u něj, ne v dokumentaci.
  const ignored = (block as SurfaceBlock & { scope_ignored?: string[] }).scope_ignored ?? [];
  return (
    <footer className="prov">
      {/* ESDK `es-prov` — „žádné číslo bez zdroje" je zákon designového jazyka,
          ne ozdoba bloku. Stejná komponenta jako v mockupu i v nativní appce. */}
      <Es.Prov
        source={block.provenance.source_slug}
        freshness={formatDateTime(block.provenance.freshness_at)}
      />
      {ignored.length > 0 ? (
        <p className="prov__scope" role="note">{t('app.scope.not_applied')}</p>
      ) : null}
    </footer>
  );
}

/**
 * Section — the shared frame every block wears: an eyebrow title, optional
 * sub-line, an optional action on the right, and provenance underneath. It is
 * one component so a new block cannot invent its own heading and drift from the
 * rest of the product; the mockup's whole rhythm is this repetition.
 */
function Section({
  title,
  sub,
  right,
  block,
  className,
  children
}: {
  title: string;
  sub?: string;
  right?: JSX.Element;
  block: SurfaceBlock;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={['block', className].filter(Boolean).join(' ')}>
      <header className="block__head">
        <div className="block__heading">
          <h3 className="block__title">{title}</h3>
          {sub ? <p className="block__sub">{sub}</p> : null}
        </div>
        {right ?? null}
      </header>
      {children}
      <Provenance block={block} />
    </section>
  );
}

/**
 * Extraction/review state as the language's status chip. The mapping is
 * deliberate and fail-safe: an unrecognised state renders `unknown` (neutral),
 * never a privileged colour — red and green are reserved for loss and gain.
 */
const STATE_STATUS: Record<string, 'ok' | 'wait' | 'fault' | 'plan' | 'mute'> = {
  auto_pass: 'ok',
  human_confirmed: 'ok',
  needs_review: 'wait',
  rejected: 'fault',
  failed: 'fault'
};

function StateTag({ state }: { state?: string }): JSX.Element | null {
  if (!state) return null;
  return (
    /* ESDK `es-lamp`: stav je GLYF + SLOVO, nikdy barva sama (zákon jazyka —
       daltonik i tisk musí stav přečíst). Neznámý stav padá na `mute`, ne na
       privilegovanou barvu: zelená a červená jsou vyhrazené zisku a ztrátě. */
    <Es.Lamp state={STATE_STATUS[state] ?? 'mute'} label={t(`app.wb.state.${state}`)} />
  );
}

/** A runtime value OR an i18n key — mirrors the contract's value/value_key duality. */
function fieldText(f: Pick<RecordField, 'value' | 'value_key'>): string {
  if (f.value_key) return t(f.value_key);
  if (typeof f.value === 'number') return formatNumber(f.value);
  return f.value ?? '—';
}

/**
 * KPI tile — the headline figure, drawn by the design language rather than by
 * hand here. The old markup rebuilt a card, a caption and a number in this file,
 * so the surface silently drifted from every other product view: no tabular
 * numerals, no reserved delta colours, no live dot.
 *
 * Reserved meaning is the block's, not the tile's: `state` says whether the
 * figure is good or bad, and only that decides the delta's direction — a rising
 * number is not automatically good (rising cost is a loss).
 */
function Kpi({ block }: { block: KpiTileBlock }): JSX.Element {
  const { value, unit_key, delta_pct, state } = block.data;
  const direction: 'up' | 'down' =
    state === 'loss' || state === 'warning' ? 'down' : typeof delta_pct === 'number' && delta_pct < 0 ? 'down' : 'up';
  /* `null` = NEMĚŘENO. Pomlčka, ne nula: nula je tvrzení o měření, které nikdo
     neprovedl, a u dlaždice „kolik čeká na člověka" je to rozdíl mezi „nic
     nečeká" a „nevím". Jednotka se u neměřeného nekreslí — mate. */
  const shown = value === null
    ? '—'
    : `${formatNumber(value)}${unit_key ? ` ${t(unit_key)}` : ''}`;
  return (
    <div className="block block--kpi">
      {/* ESDK, ne RDL: `es-kpi` je dlaždice designového jazyka (overline ·
          display číslo tabular · delta · sparkline · „živě"). Tokeny čte přes
          adapter.css, takže drží brand instance. */}
      <Es.Kpi
        caption={t(block.title_key)}
        value={shown}
        delta={
          typeof delta_pct === 'number'
            ? `${delta_pct > 0 ? '+' : ''}${formatNumber(delta_pct, { maximumFractionDigits: 1 })} %`
            : undefined
        }
        dir={direction}
        note={typeof delta_pct === 'number' ? t('app.kpi.delta.note') : undefined}
      />
      <Provenance block={block} />
    </div>
  );
}

/**
 * Timing tower — Mission Control's live standings of the runs the viewer may
 * see. Same runs as goal_progress, ranked instead of stacked: position on the
 * track first, finished runs parked at the bottom.
 *
 * Sectors are drawn from each run's OWN template, so a process with three steps
 * draws three segments and one with eight draws eight. Nothing here knows how
 * many phases a process has — that is the run's data, not this renderer's.
 */
/**
 * Mapping of one run onto the SDK's StoryLoop task contract (PRAVIDLA P2).
 *
 * Exported for the render test: with a custom element, renderToStaticMarkup
 * shows only an inert tag, so the property worth pinning — flags survive
 * verbatim, pos is clamped, provenance travels as `src` — is asserted on THIS
 * function, not on painted DOM.
 *
 * `ent`/`done`/`gate` NOW TRAVEL (2026-08-05): the producer sends them, so the
 * board stopped being static — time-in-phase, the durations of finished phases,
 * and the human gate all come from measured data.
 *
 * They are passed THROUGH, never invented. A run whose current step has no
 * `started_at` omits `ent` entirely, which is what makes the SDK draw '—'
 * (`entKnown`) instead of a measured-looking "00:00"; a fabricated zero would
 * claim a measurement nobody took. Same for `gate`: absent means "nobody is
 * being waited on", which is a different statement from an empty gate card.
 *
 * `radio` still stays absent — there is no producer of run commentary, and an
 * invented feed would be the loudest possible number without a source.
 */
export function runToTask(
  r: TimingTowerBlock['data']['runs'][number],
  prov: SurfaceBlock['provenance'],
  freshness: string
): Record<string, unknown> {
  return {
    id: r.batch_id,
    title: r.title,
    prio: r.priority,
    flag: r.flag, // both vocabularies are green|yellow|red|box|finish — verbatim
    pos: Math.max(0, Math.min(1, r.pos)),
    // Omitted, not nulled: `setTasks` derives `entKnown` from `ent != null`, and
    // an explicit null would read as "measured nothing" rather than "not measured".
    ...(r.ent != null ? { ent: r.ent } : {}),
    ...(r.done?.length ? { done: r.done } : {}),
    ...(r.gate ? { gate: r.gate } : {}),
    src: [{ source: prov.source_slug, freshness }]
  };
}

/** Sectors of the run's own template → the MC's phase anchors, spread evenly.
 *  Phases are ANCHORS on the track (the user reads a phase as a fixed place);
 *  what varies per run is the speed between them, i.e. `pos`. */
export function sectorsToPhases(
  sectors: TimingTowerBlock['data']['runs'][number]['sectors']
): Array<{ key: string; label: string; from: number; to: number }> {
  const sorted = sectors.slice().sort((a, b) => a.order - b.order);
  const n = sorted.length || 1;
  return sorted.map((s, i) => ({ key: s.code, label: s.name, from: i / n, to: (i + 1) / n }));
}

/**
 * Mission Control — the SDK's StoryLoopMC (tower + circuit board + ticker)
 * over the same runs the old hand-rolled tower listed. The rich projection
 * (sector boundaries with labels, pit lane for the human gate, checkered
 * finish, centre hub) comes from the component; this renderer only maps the
 * block contract onto the task contract and passes the instance's words.
 *
 * The engineer panel region is now CONDITIONAL rather than off: it appears only
 * when some run actually carries a gate. That keeps both failure modes away —
 * an always-on panel would stand empty (looks broken) and an always-off one
 * would hide the very thing the driver's surface exists for, namely "who is
 * being waited on". The region list is therefore data-driven, like everything
 * else here.
 */
/**
 * Každé slovo, které Mission Control umí nakreslit.
 *
 * ⛔ NAMĚŘENO 2026-09-05: `mc.js` nese `DEF_LABELS` — 35 řetězců NATVRDO ČESKY.
 * Host je smí přebít polem `labels`, jenže shell dodával jen tři (`tower`,
 * `active`, `finLabel`). Zbylých 32 se proto kreslilo česky VE VŠECH jazycích:
 * anglický, německý ani thajský uživatel s tím nemohl nic dělat, protože to
 * nebyl klíč, ale konstanta v balíku.
 *
 * ⭐ SLOVA PATŘÍ DO SLOVNÍKU, KOMPONENTA JE JEN RENDERER. Seznam je proto
 * jediné místo, kde se říká, co všechno se dodává — hlídá ho brána
 * `mission-control-slova-dodava-host`, která ho poměřuje proti `DEF_LABELS`
 * v nainstalovaném balíku. Přibude-li v SDK nové slovo, brána zčervená dřív,
 * než se stihne objevit v UI česky.
 */
const MC_LABEL_KEYS = [
  'colTask', 'colSecs', 'colTime', 'hubTitle', 'onTrack', 'inBox', 'flags',
  'doneToday', 'boxLane', 'secTimes', 'running', 'radio', 'tele', 'model',
  'tokens', 'cost', 'lat', 'src', 'pitWall', 'redFlag', 'approve', 'approveRed',
  'reject', 'owner', 'auditNote', 'sector', 'legend', 'you', 'approveMsg',
  'approveRedMsg', 'finishMsg',
] as const;

/**
 * Jména vlajek. Vlastní mapa, protože NEJDOU z `app.mc.*` — vlajka je pojem
 * timing tower (`app.tower.flag.*`) a týž klíč čte i mobilní renderer.
 *
 * ⛔ Do 0.3.1 tahle jména žila jen v `FLAGS[].label` uvnitř balíku a host je
 * přebít NEMOHL: `mc.js` na ně sahalo přímo. Od 0.3.2 chodí přes `L`, takže
 * je dodává slovník jako každé jiné slovo.
 */
const MC_FLAG_LABELS: Record<string, string> = {
  flagGreen: 'app.tower.flag.green',
  flagYellow: 'app.tower.flag.yellow',
  flagRed: 'app.tower.flag.red',
  flagBox: 'app.tower.flag.box',
  flagFinish: 'app.tower.flag.finish',
};

/**
 * Slovník → pole `labels` komponenty.
 *
 * `tower` nese titulek bloku (ten je instanční, chodí přes `title_key`), zbytek
 * jde z `app.mc.*`. `sectorMsg` je FUNKCE — komponenta ji volá se čtyřmi
 * hodnotami, takže se do věty doplní interpolací; proto je to jediný klíč
 * extranetu s `{{…}}`.
 */
export function missionControlLabels(titleKey: string): Record<string, unknown> {
  const labels: Record<string, unknown> = {
    tower: t(titleKey),
    active: t('app.tower.active'),
    finLabel: t('app.tower.finished'),
    sectorMsg: (id: string, from: string, time: string, to: string): string =>
      t('app.mc.sectorMsg')
        .replace('{{id}}', id)
        .replace('{{from}}', from)
        .replace('{{time}}', time)
        .replace('{{to}}', to),
  };
  for (const key of MC_LABEL_KEYS) labels[key] = t(`app.mc.${key}`);
  for (const [label, klic] of Object.entries(MC_FLAG_LABELS)) labels[label] = t(klic);
  return labels;
}

function TimingTower({ block }: { block: TimingTowerBlock }): JSX.Element {
  const runs = block.data.runs ?? [];
  const active = runs.filter((r) => r.flag !== 'finish');
  const freshness = formatDateTime(block.provenance.freshness_at);
  const tasks = runs.map((r) => runToTask(r, block.provenance, freshness));
  const phases = sectorsToPhases(runs[0]?.sectors ?? []);
  // The SDK draws the panel for runs flagged box (or red WITH a gate); asking
  // the same question here keeps the region and its content from disagreeing.
  const hasGate = runs.some((r) => r.gate && r.flag !== 'finish');

  return (
    <section className="rdl-card block tower">
      <div className="tower-head">
        <h3>{t(block.title_key)}</h3>
        <span className="tower-count">{t('app.tower.active')}: {active.length}</span>
      </div>

      {runs.length === 0 ? (
        <Es.Empty title={t('app.blocks.empty')} />
      ) : (
        <Es.MissionControl
          regions={hasGate ? 'tower,board,panel,ticker' : 'tower,board,ticker'}
          tasks={tasks}
          phases={phases.length ? phases : undefined}
          labels={missionControlLabels(block.title_key)}
        />
      )}
      <Provenance block={block} />
    </section>
  );
}

/**
 * Chart renderer — one component for the whole visual family, picking the
 * visualisation by `kind` (the contract keeps `kind` closed for exactly this
 * reason). Drawn as inline SVG: the shells ship no charting library, and a
 * dependency for three shapes would cost more than it saves.
 *
 * Empty `points` renders an explicit empty state rather than an axis with
 * nothing on it — a chart that looks drawn but has no data reads as "zero",
 * which is a different claim from "no data".
 */
/** Stav bodu grafu → stav jazyka ESDK (glyf + slovo). */
const CHART_STATE: Record<string, 'ok' | 'wait' | 'fault'> = { ok: 'ok', warning: 'wait', loss: 'fault' };

/**
 * Graf = ESDK, ne vlastní SVG. Do 2026-09-23 kreslil shell polyline a pruhy
 * sám — mimo jazyk (bez stavu glyfem, bez legendy, bez druhé řady). Teď:
 *   trend → `es-trend` (+ `compare` jako druhá řada TÉŽE otázky, legenda slovy)
 *   bar   → `es-hbar` (stav bodu přebije práh a nese glyf ● ▲ ■ — JAZYK-01)
 *   donut → `es-donut`
 * Rám, titul a zdroj drží `Section` (Provenance) — `es-chart-card` se nepoužívá,
 * protože svůj obsah přepisuje v render() a React by nad ním ztratil děti.
 */
function Chart({ block }: { block: ChartBlock }): JSX.Element {
  const { kind, points, target, unit_key, compare, legend_keys } = block.data;
  const unit = unit_key ? t(unit_key) : '';
  const fmt = (v: number): string => `${formatNumber(v)}${unit ? ` ${unit}` : ''}`;
  const lbl = (p: { label: string; label_key?: string }): string => (p.label_key ? t(p.label_key) : p.label);
  // Vlastní rám se zdrojem PŘÍMO tady (brána puvod-je-u-kazdeho-bloku čte tělo
  // rendereru): číslo grafu se nekreslí bez původu (zákon jazyka 02).
  const frame = (mod: string, children: ReactNode, sub?: string): JSX.Element => (
    <section className={`block chart chart--${mod}`}>
      <header className="block__head">
        <div className="block__heading">
          <h3 className="block__title">{t(block.title_key)}</h3>
          {sub ? <p className="block__sub">{sub}</p> : null}
        </div>
      </header>
      {children}
      <Provenance block={block} />
    </section>
  );

  if (points.length === 0) {
    return (
      frame('empty', <Es.Empty title={t('app.blocks.empty')} />)
    );
  }

  if (kind === 'trend') {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const total = points.reduce((a, p) => a + p.value, 0);
    const totalCmp = compare && compare.length ? compare.reduce((a, p) => a + p.value, 0) : null;
    const legend = (legend_keys ?? []).map((k) => t(k)).join('|');
    return (
      frame('trend', <>
        <Es.Trend
          data={points.map((p) => p.value).join(',')}
          compare={compare && compare.length ? compare.map((p) => p.value).join(',') : undefined}
          legend={legend || undefined}
          target={typeof target === 'number' ? String(target) : undefined}
          min="0"
          height="140"
        />
        <dl className="chart-sum">
          <div>
            <dt>{legend_keys?.[0] ? t(legend_keys[0]) : t('app.cols.total')}</dt>
            <dd>{fmt(total)}</dd>
          </div>
          {totalCmp !== null && legend_keys?.[1] ? (
            <div>
              <dt>{t(legend_keys[1])}</dt>
              <dd>{fmt(totalCmp)}</dd>
            </div>
          ) : null}
        </dl>
      </>, `${lbl(first)} – ${lbl(last)}`)
    );
  }

  if (kind === 'donut') {
    const p = points[0]!;
    const max = Math.max(...points.map((x) => x.value), target ?? 0) || 1;
    const pct = Math.max(0, Math.min(100, p.pct ?? (p.value / max) * 100));
    return (
      frame('donut', <Es.Donut value={String(Math.round(pct))} display={`${formatNumber(Math.round(pct))} %`} label={lbl(p)} />)
    );
  }

  // bar
  const max = Math.max(...points.map((p) => p.value), target ?? 0) || 1;
  return (
    frame('bar', <Es.HBar
        max="100"
        data={{
          rows: points.map((p) => ({
            label: lbl(p),
            value: p.pct ?? (p.value / max) * 100,
            display: fmt(p.value) + (typeof p.pct === 'number' ? ` · ${formatNumber(p.pct)} %` : ''),
            state: p.state ? CHART_STATE[p.state] : undefined,
            stateLabel: p.state ? t(`app.state.${p.state}`) : undefined
          }))
        }}
      />, unit || undefined)
  );
}

/**
 * Síť vazeb (ESDK `es-web`). Slova nese shell (i18n), data jen tvar:
 * `label_key` skupiny, `unit_key`/`state_key` uzlu a SLOVA JISTOTY
 * (potvrzeno · navrženo · odvozeno) — ta jsou jazyk plochy, ne balíku.
 *
 * Odkazem je jen uzel, jehož DRUH instance umí otevřít (`canOpen`) — stejné
 * pravidlo jako u řádků tabulky: ovladač, který nikam nevede, se nekreslí.
 */
export function relationWebData(
  block: RelationWebBlock,
  canOpen?: (kind: string) => boolean
): Record<string, unknown> {
  const { center, groups } = block.data;
  return {
    center,
    words: {
      confirmed: t('app.web.certainty.confirmed'),
      proposed: t('app.web.certainty.proposed'),
      derived: t('app.web.certainty.derived')
    },
    groups: groups.map((g) => ({
      key: g.key,
      label: t(g.label_key),
      nodes: g.nodes.map((n) => ({
        id: n.id && n.kind && (canOpen?.(n.kind) ?? true) ? n.id : undefined,
        kind: n.kind,
        label: n.label,
        sub: n.sub,
        value: n.value,
        display:
          typeof n.value === 'number' ? `${formatNumber(n.value)}${n.unit_key ? ` ${t(n.unit_key)}` : ''}` : n.sub,
        state: n.state,
        stateLabel: n.state_key ? t(n.state_key) : undefined,
        certainty: n.certainty
      }))
    }))
  };
}

function RelationWeb({
  block,
  onSelectRecord,
  canOpen
}: {
  block: RelationWebBlock;
  onSelectRecord?: (id: string, kind: string) => void;
  canOpen?: (kind: string) => boolean;
}): JSX.Element {
  const data = relationWebData(block, onSelectRecord ? canOpen : () => false);
  const empty = block.data.groups.length === 0;
  return (
    <Section title={t(block.title_key)} block={block} className="relation-web">
      {empty ? (
        <Es.Empty title={t('app.web.empty')} />
      ) : (
        <Es.Web
          data={data}
          onEsNode={(e: CustomEvent<{ id: string; node: { kind?: string } }>) => {
            const kind = e.detail.node?.kind;
            if (kind && e.detail.id) onSelectRecord?.(e.detail.id, kind);
          }}
        />
      )}
    </Section>
  );
}

/**
 * Table renderer. A row carrying an `id` column points AT SOMETHING; clicking it opens
 * that something (onSelectRecord). Without a handler or an `id`, it renders as a plain
 * read-only table (parity with the mobile shell).
 *
 * `row_kind` říká, CO ten řádek je. Dřív tu žádný druh nebyl a shell měl pro `id`
 * jediný význam — „dokument". Řádek dlužníka přitom nese IČO, takže klik poslal
 * čtečce dokladů číslo, které nezná, a ta místo chyby vydala PRÁZDNOU kartu.
 * Druh se sem NEODVOZUJE z názvu bloku ani RPC: vydává ho ta RPC, která `id` naplnila.
 */
/**
 * Je řádek OTEVÍRATELNÝ? Vrací id, kterým se otevře — jinak `null`.
 *
 * Pravidlo má dvě podmínky a obě jsou nutné: řádek musí NÉST identitu (`id`) a
 * někdo ji musí umět PŘIJMOUT (`onSelectRecord`). Bez identity by klik otevřel
 * neurčito, bez příjemce by to byl mrtvý ovladač, který slibuje akci a nemá ji.
 *
 * Stojí to jako pojmenovaná funkce, protože po přechodu na `es-table` se řádky
 * kreslí uvnitř custom elementu a ve statickém renderu nejsou vidět — pravidlo
 * by jinak nešlo testovat vůbec. Týž postup jako u `story-loop-mc`: mapování se
 * měří na funkci, render jen doloží, že prvek vznikl.
 */
export function selectableRowId(
  rows: Array<Record<string, unknown>>,
  index: number,
  hasHandler: boolean
): string | null {
  const id = rows[index]?.id;
  return hasHandler && typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Jsou řádky tabulky ODKAZY? Ano jen tehdy, když je komu klik poslat A instance
 * umí druh řádku otevřít. Absence `canOpen` = dřívější chování (preview, testy).
 * Pojmenovaná funkce ze stejného důvodu jako `selectableRowId`: řádky kreslí
 * `es-table` a ve statickém renderu nejsou vidět.
 */
export function tableOpens(
  kind: string,
  hasHandler: boolean,
  canOpen?: (kind: string) => boolean
): boolean {
  return hasHandler && (canOpen?.(kind) ?? true);
}

function Table({
  block,
  onSelectRecord,
  canOpen
}: {
  block: TableBlock;
  onSelectRecord?: (id: string, kind: string) => void;
  canOpen?: (kind: string) => boolean;
}): JSX.Element {
  const { columns, rows } = block.data;
  // Výchozí řazení a hledání jsou UI metadata bloku (get_surface_layout_ui), ne data.
  // Výchozí řazení a hledání řídí ESDK `es-table` (0.5) z UI metadat bloku.
  const ui = (block as TableBlock & { ui?: BlockUi }).ui;
  // Řádek, jehož DRUH instance neumí otevřít, není odkaz. Dřív byl klikací
  // každý řádek s `id` a klik na druh bez `detail_by_kind` skončil chybovou
  // kartou (naměřeno 2026-09-23: story_entry v poradě, answer_run a
  // ingest_source ve správě) — ovladač, který slibuje akci a nemá ji.
  const kind = block.data.row_kind ?? 'document';
  const opens = tableOpens(kind, Boolean(onSelectRecord), canOpen);
  const rowId = (i: number): string | null => selectableRowId(rows, i, opens);
  const anySelectable = rows.some((_, i) => rowId(i) !== null);
  return (
    <Section title={t(block.title_key)} block={block}>
      {/* ESDK `es-table`: čísla mono a vpravo, hover místo zebry, výběr řádku
          událostí `es-row`. Data jdou PROPEM (`.data`), ne atributy — most
          `wrap()` v sdk.ts to bridguje. */}
      <Es.Table
        data={{
          columns: columns.map((c) => ({
            key: c.key,
            label: c.label_key ? t(c.label_key) : c.key,
            num: c.align === 'right'
          })),
          ...(ui?.default_sort ? { sort: ui.default_sort } : {}),
          ...(ui?.search ? { search: true, searchLabel: t('app.search.placeholder') } : {}),
          rows: rows.map((r) =>
            Object.fromEntries(
              columns.map((c) => {
                const v = r[c.key];
                if (c.value_keys && typeof v === 'string' && v) return [c.key, t(v)];
                return [c.key, typeof v === 'number' ? formatNumber(v) : (v ?? '—')];
              })
            )
          )
        }}
        onEsRow={
          anySelectable
            ? (e: CustomEvent<{ index: number }>) => {
                // es-table (0.5) hlásí PŮVODNÍ index řádku i po řazení a hledání.
                const id = rowId(e.detail.index);
                // Absence druhu = 'document' (registr dokladů, jak to bylo vždy).
                if (id) onSelectRecord?.(id, kind);
              }
            : undefined
        }
      />
    </Section>
  );
}

function Timeline({ block }: { block: TimelineBlock }): JSX.Element {
  return (
    <section className="rdl-card block timeline">
      <h3>{t(block.title_key)}</h3>
      <ol>
        {block.data.items.map((item, i) => (
          <li key={i} className={`state-${item.state ?? 'none'}`}>
            <time>{formatDateTime(item.at)}</time>
            <span>{item.label_key ? t(item.label_key) : item.label ?? ''}</span>
          </li>
        ))}
      </ol>
      <Provenance block={block} />
    </section>
  );
}

function AlertFeed({ block }: { block: AlertFeedBlock }): JSX.Element {
  return (
    <section className="rdl-card block alerts">
      <h3>{t(block.title_key)}</h3>
      {block.data.items.length === 0 ? (
        <Es.Empty title={t('app.blocks.empty')} />
      ) : (
        <ul>
          {block.data.items.map((a) => (
            <li key={a.id} className={`sev-${a.severity}`}>
              <span className="sev-dot" aria-hidden="true" />
              <span className="alert-kind">{t(a.kind_key)}</span>
              <time>{formatDateTime(a.at)}</time>
            </li>
          ))}
        </ul>
      )}
      <Provenance block={block} />
    </section>
  );
}

function Narrative({ block }: { block: NarrativeBlock }): JSX.Element {
  return (
    <section className="rdl-card block narrative">
      <h3>{t(block.title_key)}</h3>
      {block.data.markdown.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      <Provenance block={block} />
    </section>
  );
}

function FieldRow({ f }: { f: RecordField }): JSX.Element {
  return (
    <div className={`field state-${f.state ?? 'none'}`}>
      <dt>{t(f.label_key)}</dt>
      <dd>
        <span className="field-value">{fieldText(f)}</span>
        {typeof f.confidence === 'number' ? (
          <span className="field-confidence" title={t('app.wb.confidence')}>
            {formatNumber(f.confidence * 100, { maximumFractionDigits: 0 })} %
          </span>
        ) : null}
        <StateTag state={f.state} />
      </dd>
    </div>
  );
}

/** Read-only rich detail of one document/contract (extracted fields + status + provenance). */
/**
 * Hodnota vytěženého pole položky. Ingest ji zapisuje jako objekt
 * ({value, raw, gate, span}), ale tvar je OTEVŘENÝ — proto se čte opatrně
 * a nikdy se nevykreslí surový objekt.
 */
function hodnotaPole(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const h = o.value ?? o.raw;
    return h === null || h === undefined ? '—' : String(h);
  }
  return String(v);
}

/**
 * Řádkové položky dokladu — odpověď na „ZA CO".
 *
 * Sloupce se odvozují Z DAT (sjednocení klíčů přes všechny položky), ne
 * z číselníku: jména polí zapisuje ingest a nová položka („unit") se objevila
 * jen u 6 z 28 naměřených řádků. Napsat je natvrdo by znamenalo, že se doklad
 * s jiným polem vykreslí neúplně a nikdo se to nedozví.
 */
function LineItems({ items, pending }: { items: DocumentLine[]; pending?: number }): JSX.Element | null {
  if (items.length === 0) return null;
  const klice: string[] = [];
  for (const it of items) {
    for (const k of Object.keys(it.fields ?? {})) if (!klice.includes(k)) klice.push(k);
  }
  return (
    <div className="record-detail__lines">
      <h4>
        {t('app.doc.lines.title')}
        {/* `t()` neinterpoluje (druhý parametr je locale, ne hodnoty), takže se
            číslo skládá vedle klíče — ne uvnitř něj. */}
        {typeof pending === 'number' && pending > 0 ? (
          <span className="badge badge--warn"> {t('app.doc.lines.pending')} {formatNumber(pending)}</span>
        ) : null}
      </h4>
      {/* Položky dokladu — táž ESDK tabulka jako registr, aby řádek faktury
          vypadal a choval se stejně jako řádek kdekoli jinde v extranetu. */}
      <Es.Table
        data={{
          columns: klice.map((k) => ({ key: k, label: t(`app.cols.${k}`), num: k !== 'item_name' })),
          rows: items.map((it) =>
            Object.fromEntries(klice.map((k) => [k, hodnotaPole((it.fields ?? {})[k])]))
          )
        }}
      />
    </div>
  );
}

function RecordDetail({ block }: { block: RecordDetailBlock }): JSX.Element {
  const { badges, fields, quote, line_items, lines_pending, missing } = block.data;
  return (
    <section className="rdl-card block record-detail">
      <h3>{t(block.title_key)}</h3>
      {badges && badges.length > 0 ? (
        <div className="badges">
          {badges.map((b) => (
            <span key={b} className="badge">{t(b)}</span>
          ))}
        </div>
      ) : null}
      {/* Co dokladu chybí do úplnosti. Nahoře a barevně: neúplnost je vlastnost
          dokladu, kterou má člověk vidět dřív, než začne z čísel vyvozovat. */}
      {missing && missing.length > 0 ? (
        <Es.Banner tone="warn">
          {t('app.doc.missing')} {missing.map((m) => t(`app.cols.${m}`)).join(', ')}
        </Es.Banner>
      ) : null}
      <dl className="fields">
        {fields.map((f) => (
          <FieldRow key={f.key} f={f} />
        ))}
      </dl>
      <LineItems items={line_items ?? []} pending={lines_pending} />
      {quote ? <blockquote className="grounded-quote">{quote}</blockquote> : null}
      <Provenance block={block} />
    </section>
  );
}

type RowState = 'idle' | 'submitting' | 'done' | 'error';

function ReviewRow({
  item,
  actions,
  onReview
}: {
  item: ReviewItem;
  actions: ReviewAction[];
  onReview?: ReviewHandler;
}): JSX.Element {
  const [status, setStatus] = useState<RowState>('idle');
  const [chosen, setChosen] = useState<string | null>(null);

  // Which action opened the capture panel. Null = no panel, i.e. the ordinary
  // one-tap path — an action WITHOUT `capture` must never grow a second step.
  const [capturing, setCapturing] = useState<ReviewAction | null>(null);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const signatureRef = useRef<SignatureCanvasRef>(null);

  const send = async (action: ReviewAction, captured?: CapturedEvidence): Promise<void> => {
    if (!onReview || status === 'submitting' || status === 'done') return;
    setStatus('submitting');
    setChosen(action.decision);
    try {
      await onReview(item, action, captured);
      setStatus('done');
      setCapturing(null);
    } catch {
      setStatus('error');
      setChosen(null);
    }
  };

  const act = async (action: ReviewAction): Promise<void> => {
    if (action.capture && action.capture.length > 0) {
      setCapturing(action);
      return;
    }
    await send(action);
  };

  const needs = (what: ReviewCapture): boolean =>
    Boolean(capturing?.capture?.includes(what));

  // Everything the action asked for must actually be there. The server refuses a
  // blank signature too; this only spares the person a round trip.
  const captureComplete =
    (!needs('recipient') || recipient.trim().length > 0) &&
    (!needs('signature') || hasSignature) &&
    (!needs('note') || note.trim().length > 0);

  const confirmCapture = async (): Promise<void> => {
    if (!capturing || !captureComplete) return;
    await send(capturing, {
      ...(needs('recipient') ? { recipient: recipient.trim() } : {}),
      ...(needs('signature') ? { signature: signatureRef.current?.getSignatureData() ?? undefined } : {}),
      ...(needs('note') ? { note: note.trim() } : {})
    });
  };

  return (
    <li className={`review-item state-${item.state ?? 'none'} rowstate-${status}`}>
      <div className="review-head">
        <span className="review-title">{item.title_key ? t(item.title_key) : item.title ?? item.id}</span>
        {item.subtitle_key ? <span className="review-sub">{t(item.subtitle_key)}</span> : null}
        <StateTag state={item.state} />
      </div>
      {item.quote ? <blockquote className="grounded-quote">{item.quote}</blockquote> : null}
      {item.fields && item.fields.length > 0 ? (
        <dl className="fields compact">
          {item.fields.map((f) => (
            <FieldRow key={f.key} f={f} />
          ))}
        </dl>
      ) : null}
      {capturing ? (
        <div className="capture-panel">
          {needs('recipient') ? (
            <label className="capture-field">
              <span>{t('app.wf.capture.recipient')}</span>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                autoComplete="off"
              />
            </label>
          ) : null}
          {needs('note') ? (
            <label className="capture-field">
              <span>{t('app.wf.capture.note')}</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </label>
          ) : null}
          {needs('signature') ? (
            <div className="capture-field">
              <span>{t('app.wf.capture.signature')}</span>
              <SignatureCanvas
                ref={signatureRef}
                onSignatureChange={setHasSignature}
                placeholder={t('app.wf.capture.signature_hint')}
                clearLabel={t('app.wf.capture.clear')}
                canvasClassName="capture-pad"
                clearButtonClassName="ghost"
              />
            </div>
          ) : null}
          <div className="review-actions">
            <Button
              variant="primary"
              disabled={!captureComplete || status === 'submitting'}
              onClick={() => void confirmCapture()}
            >
              {t(capturing.action_key)}
            </Button>
            <Button variant="secondary" onClick={() => setCapturing(null)} disabled={status === 'submitting'}>
              {t('app.wf.capture.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="review-actions">
        {status === 'done' ? (
          <span className="review-result">{t('app.wb.review.recorded')}</span>
        ) : (
          actions.map((a) => (
            <Button
              key={a.decision}
              /* One Ignition action per row: approve is primary, everything else
                 is secondary. `danger` stays reserved for destruction — a
                 rejection is a recorded outcome, not a destructive act. */
              variant={a.intent === 'approve' ? 'primary' : 'secondary'}
              className={chosen === a.decision ? 'chosen' : undefined}
              disabled={!onReview || status === 'submitting'}
              onClick={() => void act(a)}
            >
              {t(a.action_key)}
            </Button>
          ))
        )}
        {status === 'error' ? <span className="review-error">{t('app.wb.review.failed')}</span> : null}
      </div>
    </li>
  );
}

/** The "příprava" block: human-in-the-loop review of extractions/obligations. */
/**
 * The day's tape — the same review_queue CONTRACT arranged as a single stream:
 * done (collapsed) → NOW (the first waiting item, hero-sized) → ahead. The
 * interaction stays ReviewRow's (one capture implementation); the tape only
 * arranges. Items arrive partitioned by state: 'human_confirmed' = done today
 * (the RPC's include_done_today), 'needs_review' = waiting. Nothing here knows
 * what a delivery note is — fields, labels and rewards are block config (data).
 */
function TapeQueue({ block, onReview }: { block: ReviewQueueBlock; onReview?: ReviewHandler }): JSX.Element {
  const { items, actions } = block.data;
  const [showDone, setShowDone] = useState(false);
  const done = items.filter((i) => i.state === 'human_confirmed');
  const waiting = items.filter((i) => i.state !== 'human_confirmed');
  const [now, ...ahead] = waiting;
  return (
    <section className="rdl-card block review-queue tape">
      <h3>{t(block.title_key)}</h3>
      {done.length > 0 ? (
        <div className="tape-done">
          <button
            type="button"
            className="tape-done-toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            <span className="tape-dot done" aria-hidden="true" />
            {t('app.wb.tape.done')} · {done.length}
          </button>
          {showDone ? (
            <ul className="tape-done-list">
              {done.map((item) => (
                <li key={item.id} className="tape-done-item">
                  <span className="tape-done-title">{item.title ?? (item.title_key ? t(item.title_key) : item.id)}</span>
                  {item.quote ? <span className="tape-done-quote">{item.quote}</span> : null}
                  {/*
                    ⭐ `es-facts` JE v jazyce od začátku a nikdo ho nevolal —
                    tenhle blok si mřížku štítek/hodnota psal ručně jako <dl>.
                    Prvek nese i pravidlo, které ruční verze neměla: hodnota je
                    větší než popisek, protože se čte HODNOTA.
                  */}
                  {item.fields && item.fields.length > 0 ? (
                    <Es.Facts
                      data={{ facts: item.fields.map((f) => ({ l: t(f.label_key), v: fieldText(f) })) }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="tape-sect">{t('app.wb.tape.now')}</div>
      {now ? (
        <ul className="tape-now">
          <ReviewRow key={now.id} item={now} actions={actions} onReview={onReview} />
        </ul>
      ) : (
        /*
          Zákon jazyka: prázdný stav říká, CO BUDE DÁL. Holé <p> jen konstatovalo
          prázdno — řidič u rampy z toho nepozná, jestli je hotovo, nebo se to
          nenačetlo.
        */
        <Es.Empty title={t('app.wb.tape.empty')} hint={t('app.wb.tape.emptyHint')} />
      )}
      {ahead.length > 0 ? (
        <>
          <div className="tape-sect">
            {t('app.wb.tape.ahead')} · {ahead.length}
          </div>
          <ul>
            {ahead.map((item) => (
              <ReviewRow key={item.id} item={item} actions={actions} onReview={onReview} />
            ))}
          </ul>
        </>
      ) : null}
      <Provenance block={block} />
    </section>
  );
}

function ReviewQueue({ block, onReview }: { block: ReviewQueueBlock; onReview?: ReviewHandler }): JSX.Element {
  const { items, actions } = block.data;
  return (
    <section className="rdl-card block review-queue">
      <h3>{t(block.title_key)}</h3>
      {items.length === 0 ? (
        <Es.Empty title={t('app.wb.review.clear')} />
      ) : (
        <ul>
          {items.map((item) => (
            <ReviewRow key={item.id} item={item} actions={actions} onReview={onReview} />
          ))}
        </ul>
      )}
      <Provenance block={block} />
    </section>
  );
}

/** Cross-document findings: severity-ranked, each with its grounded fields + source evidence. */
function Findings({ block }: { block: FindingsBlock }): JSX.Element {
  return (
    <section className="rdl-card block findings">
      <h3>{t(block.title_key)}</h3>
      {block.data.items.length === 0 ? (
        <Es.Empty title={t('app.blocks.empty')} />
      ) : (
        <ul className="finding-list">
          {block.data.items.map((f) => (
            <li key={f.id} className={`finding sev-${f.severity}`}>
              <span className="sev-dot" aria-hidden="true" />
              {f.title_key ? <span className="finding-title">{t(f.title_key)}</span> : null}
              {f.fields && f.fields.length > 0 ? (
                <dl className="finding-fields">
                  {f.fields.map((fld) => (
                    <div key={fld.key}>
                      <dt>{t(fld.label_key)}</dt>
                      <dd>{fieldText(fld)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {f.evidence && f.evidence.length > 0 ? (
                <ul className="finding-evidence">
                  {f.evidence.map((e) => (
                    <li key={e.source_slug} title={e.source_sha256 ?? e.source_slug}>
                      {e.filename ?? e.source_slug}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Provenance block={block} />
    </section>
  );
}

/**
 * Process runs on their milestone track (the "oval" contract — a richer skin
 * like RaceTrack reads the same data). Everything shown is instance data:
 * titles and milestone names come from the workflow template, `pos` is the
 * continuous track position, `goal` mirrors the story-loop evaluation.
 */
/**
 * The oval — runs drawn on a closed track instead of a flat bar.
 *
 * The contract was designed for this: `pos` is a CONTINUOUS position 0..1 and
 * `milestones` are the track's own sectors, so a process with three milestones
 * draws three sectors and one with eight draws eight. Nothing here knows how
 * long a process is; that is the run's data.
 *
 * Geometry is computed, never measured: points come from an ellipse formula
 * rather than SVGPathElement.getPointAtLength(), so the block renders
 * identically on the server (the render tests use renderToStaticMarkup, where
 * there is no layout) and needs no refs or effects.
 *
 * Start/finish is at the top and runs move clockwise — the direction people
 * read a clock, so "further along" needs no legend.
 */
/**
 * Potvrzení úkonu v terénu — webové zrcadlo mobilní masky `handover_confirm`.
 *
 * ⭐ NENÍ TO „blok dodacích listů". Dodací list je ŠABLONA uzlů workflow, ne typ
 * v klientovi; táž maska odbaví předání i odečet, protože se ptá DAT
 * (`measure`, `evidence`), ne jména kroku.
 *
 * ⛔ Klient tu NEROZHODUJE. `suggested` je odhad stroje a `es-measure` ho kreslí
 * jako ZDROJ vedle hodnoty; hodnotou se stane až tím, co potvrdí člověk
 * (JAZYK-04/05/06). Váha z dat řadí a zvýrazňuje — pravdu nedělá.
 */
function HandoverConfirm({ block }: { block: HandoverConfirmBlock }): JSX.Element {
  const d = block.data;
  const steps = (d.steps ?? []).map((s) => `${s.label}=${s.state}`).join('|');

  return (
    <section className="rdl-card block handover-confirm">
      <h3>{t(block.title_key)}</h3>
      {steps ? <Es.Stepper steps={steps} /> : null}
      {d.title ? <p className="handover-title">{d.title}</p> : null}
      {(d.facts ?? []).map((f) => (
        <Es.Fact key={f.label} label={f.label} value={f.value ?? ''} />
      ))}
      {d.measure ? (
        <Es.Measure
          label={d.measure.label ?? ''}
          unit={d.measure.unit ?? ''}
          suggested={d.measure.suggested ?? ''}
        />
      ) : null}
      {d.evidence?.length ? <Es.Evidence data={d.evidence} /> : null}
      {/*
        ⛔ CHYBĚLO TU. Dvanáct ze třinácti blokových rendererů kreslí původ;
        `handover_confirm` byl jediný, kdo ne — a přitom vydává NAMĚŘENOU
        hodnotu (`Es.Measure`) a doklady. „Žádné číslo bez zdroje" je zákon
        jazyka 02, takže právě tady chyběl nejcitelněji: potvrzení předání se
        podepisuje, a podepsat se dá jen to, u čeho je vidět, odkud to je.
        Hlídá brána `puvod-je-u-kazdeho-bloku`.
      */}
      <Provenance block={block} />
    </section>
  );
}

function GoalProgress({ block }: { block: GoalProgressBlock }): JSX.Element {
  const runs = block.data.runs ?? [];

  return (
    <section className="rdl-card block goal-progress">
      <h3>{t(block.title_key)}</h3>
      {runs.length === 0 ? (
        <Es.Empty title={t('app.blocks.empty')} />
      ) : (
        <>
          <Circuit
            ariaLabel={t('app.oval.label')}
            sectors={runs[0]?.milestones?.length ?? 0}
            markers={runs.map((run) => ({
              pos: Math.max(0, Math.min(1, run.pos)),
              // Splněný cíl nese REZERVOVANOU barvu zisku — ne akcent, kterým se
              // barví cokoli zvýrazněného. Běh, který jen jede, není výstraha.
              tone: run.goal?.met === true ? 'gain' : (run.failed ?? 0) > 0 ? 'loss' : 'info',
              title: `${run.title} — ${Math.round(run.pos * 100)} %`
            }))}
          />

          {/* The legend is the data, not decoration: which run is where, how far
              along, and how many milestones are done. */}
          <ul className="runs">
            {runs.map((run) => {
              const pos = Math.max(0, Math.min(1, run.pos));
              const done = run.milestones.filter((m) => m.status === 'completed').length;
              return (
                <li key={run.batch_id}>
                  <div className="run-head">
                    <span className="run-title">{run.title}</span>
                    <span className="run-figs rdl-mono">
                      {done}/{run.milestones.length} · {Math.round(pos * 100)} %
                    </span>
                    {run.goal?.met ? <span className="run-goal-met">✓</span> : null}
                  </div>
                  <ol className="milestones">
                    {run.milestones
                      .slice()
                      .sort((a, b) => a.order - b.order)
                      .map((m) => (
                        <li key={m.code} className={`ms-${m.status}`}>
                          {m.name}
                        </li>
                      ))}
                  </ol>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Provenance block={block} />
    </section>
  );
}

/** Deklarace jednoho klientského parametru — řetězec (typ) nebo objekt s popisem pro UI. */
type ParamSpec =
  | string
  | {
      type?: string;
      enum?: string[];
      multi?: boolean;
      ui?: string;
      on?: number | string;
      label_key?: string;
      value_label_prefix?: string;
      local?: boolean;
    };

/** Druh ovladače z deklarace; `null` = parametr se uživateli nenabízí (uuid, čas, místní). */
export function ovladac(spec: ParamSpec): 'multi' | 'enum' | 'toggle' | 'bool' | 'month' | 'date' | 'text' | null {
  if (typeof spec === 'string') {
    if (spec === 'bool') return 'bool';
    if (spec === 'date') return 'date';
    if (spec === 'text') return 'text';
    return null;
  }
  if (spec.local) return null;
  if (Array.isArray(spec.enum)) return spec.multi ? 'multi' : 'enum';
  if (spec.type === 'int' && spec.ui === 'toggle' && spec.on !== undefined) return 'toggle';
  if (spec.type === 'bool') return 'bool';
  if (spec.type === 'date') return spec.ui === 'month' ? 'month' : 'date';
  if (spec.type === 'text') return 'text';
  return null;
}

/** Pole pro `es-filters` z deklarace bloku: druh, popisek (překlad), volby, aktuální hodnota. */
export function poleFiltru(
  specs: Record<string, unknown>,
  values: Record<string, unknown>
): Array<{ key: string; kind: string; label: string; options?: { value: string; label: string }[]; value?: unknown; on?: unknown }> {
  return Object.entries(specs).flatMap(([key, raw]) => {
    const spec = raw as ParamSpec;
    const druh = ovladac(spec);
    if (!druh) return [];
    const obj: Exclude<ParamSpec, string> = typeof spec === 'object' ? spec : {};
    const label = obj.label_key ? t(obj.label_key) : key;
    const options = (obj.enum ?? []).map((v) => ({
      value: v,
      label: obj.value_label_prefix ? t(`${obj.value_label_prefix}${v}`) : v
    }));
    return [{
      key,
      kind: druh,
      label,
      ...(options.length > 0 ? { options } : {}),
      ...(values[key] !== undefined ? { value: values[key] } : {}),
      ...(obj.on !== undefined ? { on: obj.on } : {})
    }];
  });
}

export interface BlockHandlers {
  /** `kind` = `row_kind` vydaný RPC; shell podle něj vybere čtečku, nehádá. */
  onSelectRecord?: (id: string, kind: string) => void;
  /** Umí instance tenhle druh OTEVŘÍT? Bez odpovědi se řádek chová jako dřív. */
  canOpen?: (kind: string) => boolean;
  onReview?: (block: ReviewQueueBlock, item: ReviewItem, action: ReviewAction, captured?: CapturedEvidence) => Promise<void>;
  /** Akce správy (K4): shell posílá slug + cíl (z bloku) + payload (z formuláře) do jednoho auditovaného RPC. */
  onAction?: (block: ActionFormBlock, action: ActionDef, payload: Record<string, string>) => Promise<void>;
  /** Ovladač bloku změnil hodnoty jeho client_params → shell přenačte JEN ten blok. */
  onBlockParams?: (blockSlug: string, params: Record<string, unknown>) => void;
}

type ActionState = 'idle' | 'submitting' | 'done' | 'error';

/**
 * Jedno pole formuláře akce — vstup podle DEKLARACE (`type`), ne podle domény.
 * Server hodnotu ověří znovu; tady se jen nekreslí nesmysl (číslo jako text).
 */
function ActionFieldInput({
  f,
  value,
  onChange
}: {
  f: ActionField;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const id = `act-${f.key}`;
  if (f.type === 'enum') {
    return (
      <select id={id} className="action-form__input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(f.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{t(o.label_key)}</option>
        ))}
      </select>
    );
  }
  if (f.type === 'boolean') {
    return (
      <select id={id} className="action-form__input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        <option value="true">{t('app.action.yes')}</option>
        <option value="false">{t('app.action.no')}</option>
      </select>
    );
  }
  if (f.type === 'textarea') {
    return <textarea id={id} className="action-form__input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (f.type === 'secret') {
    // Skryté pole: prohlížeč ho nesmí nabídnout k uložení ani doplnit uložené heslo.
    return <input id={id} className="action-form__input" type="password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  const inputType =
    f.type === 'date' ? 'date'
    : f.type === 'timestamptz' ? 'datetime-local'
    : f.type === 'integer' ? 'number'
    : 'text';
  return <input id={id} className="action-form__input" type={inputType} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * AKCE SPRÁVY Z PLOCHY (ADR-003, K4). Tlačítka z allowlistu, formulář z deklarace
 * polí, odeslání přes JEDNO auditované RPC — jméno cílové funkce klient nezná.
 * Bez identity cíle (`target_id: null`) se akce jen vypíší a nedají spustit:
 * blok stojí mimo detail a nemá nad čím běžet.
 */
function ActionForm({ block, onAction }: { block: ActionFormBlock; onAction?: BlockHandlers['onAction'] }): JSX.Element {
  const { actions, target_id } = block.data;
  const [open, setOpen] = useState<ActionDef | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ActionState>('idle');
  // Akce BEZ cíle (`target_kind: 'none'`, např. schválení pluginu ve správě) nad
  // žádným záznamem neběží — čekat na výběr záznamu by ji zamklo navždy.
  const canRun = Boolean(onAction) && (block.data.target_kind === 'none' || target_id !== null);
  const pick = (a: ActionDef): void => {
    const init: Record<string, string> = {};
    for (const f of a.fields) if (f.default !== undefined) init[f.key] = f.default;
    setValues(init);
    setStatus('idle');
    setOpen(a);
  };
  const complete = (a: ActionDef): boolean => a.fields.every((f) => !f.required || (values[f.key] ?? '').trim() !== '');
  const send = async (): Promise<void> => {
    if (!open || !onAction || status === 'submitting' || !complete(open)) return;
    setStatus('submitting');
    try {
      // Posílají se jen deklarovaná pole; prázdné se vynechají (server doplní default / NULL).
      const payload: Record<string, string> = {};
      for (const f of open.fields) {
        const v = (values[f.key] ?? '').trim();
        if (v !== '') payload[f.key] = v;
      }
      await onAction(block, open, payload);
      // Tajné hodnoty se v paměti formuláře nedrží ani po úspěchu.
      setValues((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !open.fields.some((f) => f.key === k && f.type === 'secret'))));
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };
  return (
    <section className="rdl-card block action-form" data-block={block.block_slug}>
      <h3>{t(block.title_key)}</h3>
      {actions.length === 0 ? (
        <p className="wb-muted">{t('app.action.none')}</p>
      ) : (
        <div className="action-form__list">
          {actions.map((a) => (
            <Button
              key={a.slug}
              variant={open?.slug === a.slug ? 'primary' : 'secondary'}
              disabled={!canRun}
              title={!canRun ? t('app.action.pick') : undefined}
              onClick={() => pick(a)}
              data-action={a.slug}
            >
              {t(a.title_key)}
            </Button>
          ))}
        </div>
      )}
      {open && canRun && (
        <form
          className="action-form__form"
          data-action-form={open.slug}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {open.description_key ? <p className="wb-muted">{t(open.description_key)}</p> : null}
          {open.fields.map((f) => (
            <label key={f.key} className="action-form__field" htmlFor={`act-${f.key}`}>
              <span className="action-form__label">
                {t(f.label_key)}
                {f.required ? <em className="action-form__req"> · {t('app.action.required')}</em> : null}
              </span>
              <ActionFieldInput f={f} value={values[f.key] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
            </label>
          ))}
          <div className="action-form__buttons">
            <Button type="submit" variant="primary" disabled={status === 'submitting' || status === 'done' || !complete(open)}>
              {t('app.action.submit')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(null)}>
              {t('app.action.cancel')}
            </Button>
            {status === 'done' ? <span className="action-form__status action-form__status--done">{t('app.action.done')}</span> : null}
            {status === 'error' ? <span className="action-form__status action-form__status--error">{t('app.action.failed')}</span> : null}
          </div>
        </form>
      )}
      <Provenance block={block} />
    </section>
  );
}

/**
 * Blok + jeho ovladače. Ovladače jsou DATA bloku (`source_params.client_params`,
 * vydává get_surface_layout_ui): shell z deklarace pozná typ a nabídne odpovídající
 * vstup; natvrdo tu není žádný blok ani parametr. Bez deklarace nebo bez handleru
 * (náhled, detail) se blok vykreslí jako dřív.
 */
export function Block({ block, handlers }: { block: SurfaceBlock; handlers?: BlockHandlers }): JSX.Element {
  const extra = block as SurfaceBlock & { ui?: BlockUi; params?: Record<string, unknown> };
  const specs = extra.ui?.client_params;
  const onParams = handlers?.onBlockParams;
  if (!specs || !onParams) return <BlockBody block={block} handlers={handlers} />;
  const values = extra.params ?? {};
  const fields = poleFiltru(specs, values);
  if (fields.length === 0) return <BlockBody block={block} handlers={handlers} />;
  return (
    <div className="wb-blockwrap">
      {/* ESDK `es-filters`: ovladač podle druhu, hodnotu už otypovanou (měsíc → první
          den, přepínač → deklarovaná hodnota). Prázdná volba = parametr se nepošle. */}
      <Es.Filters
        data={{ fields, allLabel: t('app.scope.all') }}
        onEsChange={(e: CustomEvent<{ key: string; value: unknown }>) => {
          const next = { ...values };
          if (e.detail.value === undefined) delete next[e.detail.key];
          else next[e.detail.key] = e.detail.value;
          onParams(block.block_slug, next);
        }}
      />
      <BlockBody block={block} handlers={handlers} />
    </div>
  );
}

function BlockBody({ block, handlers }: { block: SurfaceBlock; handlers?: BlockHandlers }): JSX.Element {
  switch (block.block_type) {
    case 'kpi_tile':
      return <Kpi block={block} />;
    case 'chart':
      return <Chart block={block} />;
    case 'timing_tower':
      return <TimingTower block={block} />;
    case 'table':
      return <Table block={block} onSelectRecord={handlers?.onSelectRecord} canOpen={handlers?.canOpen} />;
    case 'timeline':
      return <Timeline block={block} />;
    case 'alert_feed':
      return <AlertFeed block={block} />;
    case 'narrative':
      return <Narrative block={block} />;
    case 'record_detail':
      return <RecordDetail block={block} />;
    case 'review_queue': {
      const onReview = handlers?.onReview
        ? (item: ReviewItem, action: ReviewAction, captured?: CapturedEvidence) =>
            handlers.onReview!(block, item, action, captured)
        : undefined;
      // Arrangement hint from the LAYOUT (block config = data). Unknown value
      // degrades to the default queue — a hint must never be able to blank a block.
      return (block as SurfaceBlock & { presentation?: string }).presentation === 'tape'
        ? <TapeQueue block={block} onReview={onReview} />
        : <ReviewQueue block={block} onReview={onReview} />;
    }
    case 'findings':
      return <Findings block={block} />;
    case 'goal_progress':
      return <GoalProgress block={block} />;
    case 'handover_confirm':
      return <HandoverConfirm block={block} />;
    case 'relation_web':
      return <RelationWeb block={block} onSelectRecord={handlers?.onSelectRecord} canOpen={handlers?.canOpen} />;
    case 'action_form':
      return <ActionForm block={block} onAction={handlers?.onAction} />;
  }
}
