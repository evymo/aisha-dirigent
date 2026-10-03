/**
 * Surface-agnostic block contract (view-models).
 * Rules encoded here (see multi-surface spec §2):
 *  - schema-versioned payloads
 *  - mandatory provenance on every block
 *  - key-first i18n: chrome/labels are i18n KEYS; free text is runtime data from grounded sources
 *  - sensitivity is fail-closed (unknown value = not renderable)
 */

export type Sensitivity = 'public' | 'internal' | 'restricted' | 'confidential';

/** Ordering for gating; unknown values are handled fail-closed in assertRenderable(). */
export const SENSITIVITY_ORDER: Record<Sensitivity, number> = {
  public: 0,
  internal: 1,
  restricted: 2,
  confidential: 3
};

/** Hard cap for anything cached on a client device (offline snapshots). */
export const OFFLINE_MAX_SENSITIVITY: Sensitivity = 'restricted';

/**
 * One coordinate of a scope vector: WHICH node the reader chose to stand on,
 * and — the part that carries accountability — WHO supplied that coordinate.
 *
 * A scope is a vector, not a boolean filter: several dimensions at once, each
 * with its own origin and certainty. `origin` is a closed vocabulary because
 * responsibility cannot be an open string: a coordinate the user picked, one a
 * detector derived, and one guessed from the wording of a question are three
 * different liabilities. `detail` carries the free-text specifics (which
 * detector, which heuristic) without diluting that.
 *
 * A scope NARROWS what an identity may already see. It never widens it — the
 * caller controls `p_params`, so it can never be an authorization input.
 */
export interface ScopeCoordinate {
  /** Dimension slug — open text (company, object, area, story, …): a new axis is data. */
  dim: string;
  value: string;
  origin: 'user_pick' | 'derived' | 'guessed_from_text' | 'system';
  /** 0..1. A guess is never 1 — the resolver rejects that. */
  confidence: number;
  /** Which detector/heuristic produced it (free text, diagnostic only). */
  detail?: string;
  /** Which substrate vouched for the value: 'twin', 'story', or 'none' (unverified pass-through). */
  resolver?: 'twin' | 'story' | 'none';
}

/** Why a requested coordinate did not survive. One reason for both "absent" and
 *  "not yours" on purpose — a distinguishable answer would be an existence oracle. */
export interface ScopeDrop {
  dim: string;
  value: string;
  reason: 'not_visible' | 'unsupported_value';
}

/**
 * Jeden skok původu: KDO údaj doručil a KDY. Řetěz `chain` jde od zdroje pravdy
 * k místu, odkud blok čte (ERP → konektor → ingest → registr). `source_slug` bloku
 * je jméno POSLEDNÍHO místa (často tabulka) — samo o sobě „zdroj" není: naměřeno
 * 2026-09-25 na kartě protistrany, kde každý blok hlásil „ZDROJ: li-source-registry"
 * a nikdo z toho nepoznal, že čísla jsou z ERP a jak stará.
 */
export interface ProvenanceHop {
  source_slug: string;
  /** ISO-8601 — kdy tenhle skok údaj doručil (tik konektoru, běh ingestu). */
  at?: string;
}

/**
 * „N z M" — kolik z celku údaj POKRÝVÁ. Bez toho se useknutý seznam (50 z 97
 * dlužníků, 2026-09-23) nebo nepotvrzený základ (smluv 4, strany potvrzeny 0 z 4)
 * čte jako celek. `label_key` říká, ČEHO jsou n a m (řádků, dokladů, stran).
 */
export interface Coverage {
  n: number;
  m: number;
  label_key?: string;
}

export interface Provenance {
  source_slug: string;
  /** ISO-8601 timestamp of source freshness. */
  freshness_at: string;
  trace_id: string;
  /**
   * Present only when the caller asked under a scope. Absent means "nobody
   * asked", which is not the same as "nothing was applied" — a client that
   * sends no scope sees exactly the envelope it saw before this field existed.
   */
  scope_requested?: ScopeCoordinate[];
  /** What the single owner of the rule (scope_effective) actually let through. */
  scope_effective?: ScopeCoordinate[];
  /** Requested coordinates that did not survive, with the reason. */
  scope_dropped?: ScopeDrop[];
  /** ai_runs.id of the recorded run — the handle by which this answer stays attributable. */
  run_id?: string;
  /** Why no run was recorded (e.g. spend admission refused). Never silent. */
  run_note?: string;
  /** Řetěz původu od zdroje pravdy k místu čtení (viz ProvenanceHop). Volitelný: starý producent ho nevydává. */
  chain?: ProvenanceHop[];
  /** „N z M" (viz Coverage). Volitelné; producent, který neví, kolik je M, ho neposílá — nehádá. */
  coverage?: Coverage;
}

/**
 * JEDINÉ místo, kde se vyjmenovávají masky. TS unie {@link BlockType} se
 * ODVOZUJE odsud a runtime enum ve schématech (schemas.ts) se importuje odsud —
 * do 2026-08-17 to byly DVA ručně vedené seznamy a nic je neporovnávalo,
 * takže maska přidaná do unie mohla v produkci padat na validaci layoutu.
 */
export const BLOCK_TYPES = [
  'kpi_tile',
  'chart',
  'table',
  'timeline',
  'alert_feed',
  'narrative',
  'record_detail',
  'review_queue',
  'findings',
  'goal_progress',
  'timing_tower',
  'handover_confirm',
  'action_form',
  'relation_web',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

/**
 * A surface is a SECTION of the extranet (ask, workflow, registry, workbench,
 * porada, …), not a device. Open text on purpose: which sections exist, what
 * they contain and in what order is DATA the backend serves — a new section is
 * a row, never a migration or a client release. Same convention as
 * `ide_sessions.source` ("Open text — new sources appear without schema change").
 *
 * Device adaptation (phone vs desktop) is the renderer's job, NOT an axis here.
 * It used to be one: the same block was duplicated per device, which is how
 * 'porada' ended up defined twice — a curated 7-block web layout, plus a subset
 * smuggled into 'mobile' — and the mobile daily-brief screen rendered neither.
 *
 * Contrast {@link BlockType}, which is deliberately CLOSED: it names a renderer,
 * and a renderer cannot be sent over the wire.
 */
export type Surface = string;

/**
 * NA CO blok ukazuje — druh entity a její id.
 *
 * `entity_kind` je OTEVŘENÝ slug ze stejného důvodu jako {@link Surface}:
 * pojmenovává VĚC (dodák, měřidlo, smlouva, běh), a čím věci jsou, to jsou
 * v tomhle systému data. Uzavřený zůstává {@link BlockType} — ten pojmenovává
 * renderer, tedy něco, co klient musí už umět. Klient, který druh nezná, cíl
 * neotevře; je to nabídka, ne příkaz.
 */
export interface BlockTarget {
  entity_kind: string;
  entity_id: string;
  /** Čím se cíl představí člověku (číslo dokladu, jméno měřidla). */
  label?: string;
}

export interface BlockBase {
  schema_version: 1;
  block_slug: string;
  block_type: BlockType;
  /** i18n key — never a literal string. */
  title_key: string;
  sensitivity: Sensitivity;
  provenance: Provenance;
  /**
   * Volitelný odkaz do sítě entit: „a je to tenhle záznam". Sourozenec `data`
   * a `provenance` — cíl není údaj o původu ani řádek tabulky.
   */
  target?: BlockTarget;
}

export type KpiState = 'ok' | 'warning' | 'loss';

export interface KpiTileBlock extends BlockBase {
  block_type: 'kpi_tile';
  data: {
    /** `null` = NEMĚŘENO (renderer kreslí '—'). Nula by tvrdila měření, které
     *  nikdo neprovedl — viz schemas.ts. */
    value: number | string | null;
    unit_key?: string;
    delta_pct?: number;
    state?: KpiState;
  };
}

/** Which visualisation renders the points. Closed: it names a renderer. */
export type ChartKind = 'trend' | 'bar' | 'donut';

export interface ChartPoint {
  /** Jazykově neutrální popisek (měsíc `2026-09`, rozsah `31–90`). */
  label: string;
  /** Když popisek JE slovo, nese ho i18n klíč; renderer má přednost klíči. */
  label_key?: string;
  value: number;
  /** 0–100. Drives bar width and donut fill. */
  pct?: number;
  note?: string;
  state?: KpiState;
}

/**
 * One chart type covers the whole visual family — a trend line, a bar row and
 * a donut are one renderer picking a visualisation by `kind`, not three entries
 * in the mask catalogue. `points` is uniform so one validator covers all three.
 */
export interface ChartBlock extends BlockBase {
  block_type: 'chart';
  data: {
    kind: ChartKind;
    points: ChartPoint[];
    /** Reference line (trend) — the plan the series is measured against. */
    target?: number;
    unit_key?: string;
    delta_pct?: number;
    /**
     * Druhá řada TÉŽE otázky (např. vyfakturováno × z toho uhrazeno), sdílí osu
     * a popisky s `points`. Jen `trend`. Víc řad = víc otázek = víc bloků.
     */
    compare?: ChartPoint[];
    /** Pojmenování řad [points, compare] — i18n klíče. Dvě řady bez legendy by se četly jako jedna. */
    legend_keys?: string[];
  };
}

/** Presentation state of a run. Closed: it is a colour the client must ship. */
export type RunFlag = 'green' | 'yellow' | 'red' | 'box' | 'finish';

export interface RunSector {
  code: string;
  name: string;
  order: number;
  status: string;
  /** Raw phase timestamps; the READER computes durations (a running phase's
   *  length depends on when you ask, so a stored one is stale on arrival). */
  started_at?: string | null;
  completed_at?: string | null;
  /** What the gate says when this phase is the one waiting on a person.
   *  `assigned_role` is a ROLE — no personal name reaches the tower. */
  description?: string | null;
  assigned_role?: string | null;
}

/**
 * Mission Control's tower — live standings of the runs the VIEWER may see.
 * Same runs as goal_progress, a different renderer: ranked board instead of
 * progress bars. `sectors` come from each run's own process template, so a
 * different template simply draws a different number of segments — the five
 * phases in the mockup are one template, never a platform truth.
 */
export interface TimingTowerBlock extends BlockBase {
  block_type: 'timing_tower';
  data: {
    runs: Array<{
      batch_id: string;
      story_id?: string;
      title: string;
      priority?: string;
      status?: string;
      state?: string;
      pos: number;
      total?: number;
      completed?: number;
      failed?: number;
      sectors: RunSector[];
      flag: RunFlag;
      /**
       * Seconds spent in the CURRENT phase. Optional on purpose: a step with no
       * `started_at` has nothing to measure, and the renderer must be able to
       * tell "not measured" (draws '—') from "measured zero".
       */
      ent?: number | null;
      /**
       * Durations of finished phases, in PHASE ORDER (seconds). An entry may be
       * null where a phase carries no times — the array is never compacted,
       * because the index is the anchor on the track.
       */
      done?: Array<number | null>;
      /** Who/what is being waited on. Absent = nobody is. */
      gate?: { label?: string; desc?: string; owner?: string } | null;
      entered_at?: string;
      updated_at?: string;
    }>;
  };
}

export interface TableBlock extends BlockBase {
  block_type: 'table';
  data: {
    /** Hlavička je VŽDY překladový klíč: extranet běží v šesti jazycích, takže
     *  hotový text by překlad obešel pro všechny ostatní. Viz schemas.ts. */
    /**
     * `value_keys: true` = buňky toho sloupce jsou i18n KLÍČE (stav dokladu apod.),
     * renderer je přeloží. Slovo do řádku nepatří jako hotový text (šest jazyků);
     * data nesou klíč, jazyk dodá plocha.
     */
    columns: Array<{ key: string; label_key: string; align?: 'left' | 'right' | 'center'; value_keys?: boolean }>;
    rows: Array<Record<string, string | number | null>>;
    /**
     * CO řádek JE — druh záznamu, na který ukazuje jeho `id`. Vydává ho RPC,
     * protože jedině ona ví, co do `id` dala. Čím se druh otevírá, deklaruje
     * instance (`workbench.detail_by_kind`). Absence = 'document'.
     */
    row_kind?: string;
    /**
     * Sloupec, jehož NEPRÁZDNÁ buňka znamená „tento řádek NAHRADILA novější verze"
     * (hodnota = klíč nástupce). Renderer takový řádek kreslí jako HISTORII —
     * ztlumený, se slovem „nahrazeno" — a nikdy ho nesčítá (JAZYK-11). Naměřeno
     * 2026-09-25: dvě verze téže faktury vedle sebe = dvojnásobný dluh po splatnosti.
     */
    superseded_key?: string;
    /** Sloupec s pořadovým číslem verze řádku (1 = první doručení); jen k zobrazení. */
    version_key?: string;
  };
}

export interface TimelineBlock extends BlockBase {
  block_type: 'timeline';
  data: {
    items: Array<{
      at: string;
      /** Runtime data text (from a grounded source), OR an i18n key — one of the two. */
      label?: string;
      label_key?: string;
      state?: KpiState;
    }>;
  };
}

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertFeedBlock extends BlockBase {
  block_type: 'alert_feed';
  data: {
    items: Array<{
      id: string;
      /** Alert kind as i18n key (catalog rule id); explanation text is fetched online, never pushed/cached. */
      kind_key: string;
      at: string;
      severity: AlertSeverity;
      deeplink?: string;
    }>;
  };
}

export interface NarrativeBlock extends BlockBase {
  block_type: 'narrative';
  data: {
    /** Grounded, provenance-tagged narrative (story-loop output). Runtime data, not chrome. */
    markdown: string;
  };
}

/**
 * Extraction/review lifecycle state carried by document-management blocks.
 * Mirrors the ingest engine candidate_status vocabulary; unknown values are handled
 * fail-closed by the renderer (no privileged styling for an unrecognised state).
 */
export type FieldState = 'auto_pass' | 'needs_review' | 'human_confirmed' | 'rejected' | 'failed';

/** Char span into the source document — display-only provenance drill-down, never an authority. */
export interface SourceRef {
  char_start: number;
  char_end: number;
  page?: number | null;
}

export interface RecordField {
  key: string;
  /** i18n key for the field label — never a literal. */
  label_key: string;
  /** Runtime data value from a grounded source, OR an i18n key — one of the two. */
  value?: string | number | null;
  value_key?: string;
  state?: FieldState;
  /** 0..1 extraction confidence (advisory display only, never a gate). */
  confidence?: number;
  source_ref?: SourceRef;
}

/** Read-only rich detail of one document/contract (extracted fields + status + provenance). */
export interface RecordDetailBlock extends BlockBase {
  block_type: 'record_detail';
  data: {
    /** `null` = blok o ŽÁDNÉM záznamu (nenalezeno / bez klíče). Viz schemas.ts. */
    record_id: string | null;
    /** Status chips rendered as i18n keys (e.g. doc_type, classification, lifecycle). */
    badges?: string[];
    fields: RecordField[];
    /** Optional grounded citation (runtime data from the source document). */
    quote?: string;
    /** ZA CO, ne jen kolik — řádkové položky dokladu, jak je zapsal ingest. */
    line_items?: DocumentLine[];
    /** Kolik řádků ještě čeká na člověka. */
    lines_pending?: number;
    /** Co dokladu chybí do úplnosti. Neúplný doklad se má poznat. */
    missing?: string[];
    /** Zdrojový záznam z ERP verbatim; jen na `include_source=true`, jinak null. */
    source_record?: unknown;
  };
}

/**
 * Jedna řádková položka dokladu. OTEVŘENÁ: registr ji posílá tak, jak ji zapsal
 * ingest, takže uzavřít ji by znamenalo, že klient rozhoduje, co smí ingest
 * zaznamenat — a jedna nová vlastnost by shodila celý blok. Viz schemas.ts.
 */
export interface DocumentLine {
  line_index: number;
  status?: string;
  method?: string;
  /** Klíče jsou DATA (item_name, quantity, unit_price, line_total, unit…). */
  fields?: Record<string, unknown>;
  issues?: unknown[];
  [dalsi: string]: unknown;
}

export type ReviewIntent = 'approve' | 'reject' | 'neutral';
/**
 * Which register a review decision is applied to (single fixed write RPC dispatches on it).
 * 'workflow_step' is a process milestone confirmed by the person who owns it, not a
 * back-office review — the write RPC authorizes that branch by the milestone's own
 * predicate (assignment · role · confirmed twin binding) instead of a reviewer role.
 */
/**
 * O ČEM se rozhoduje. UZAVŘENÝ výčet, protože to je CÍL ZÁPISU: klient hodnotu
 * nekreslí, posílá ji do `submitReview` a server na ni dispatchuje. Nová doména
 * se přidává sem, vědomě. (Liší se tím od `BlockTarget.entity_kind`, který je
 * otevřený — ten je jen navigační nabídka.) Viz schemas.ts.
 */
export type ReviewEntityKind =
  | 'extraction'
  | 'obligation'
  | 'document'
  | 'workflow_step'
  | 'twin_identity'
  /** Dotaz na pravdu nad nálezy ingestu: pravidlo × druh nálezu, ne jeden doklad. */
  | 'finding'
  /** Skupiny návrhů hran mezi dvojčaty (návrhy vazeb ke schválení). */
  | 'twin_relation'
  /** Skupina návrhů identit — třída shody dvou nezávislých zdrojů pravdy (hromadné schválení). */
  | 'twin_identity_group';

/**
 * What a person must supply before the decision can be recorded. Closed on
 * purpose: the client has to KNOW how to draw each one, so a block must not be
 * able to ask for something no renderer implements.
 */
export type ReviewCapture = 'recipient' | 'signature' | 'note';

export interface ReviewAction {
  /** i18n key for the button label. */
  action_key: string;
  /**
   * When present, this action opens a capture panel instead of submitting at
   * once — the deviation-is-the-exception rule still holds: a plain action stays
   * one tap.
   */
  capture?: ReviewCapture[];
  /** Decision value passed verbatim to the platform write RPC (e.g. 'HUMAN_CONFIRMED'). */
  decision: string;
  /** Semantics/styling only — never authorization. */
  intent: ReviewIntent;
}

/**
 * Co o předmětu tvrdí ZDROJ (účetnictví, registr dokladů) — ne stav naší práce.
 * Záměrně mimo `FieldState`: ta škála popisuje, jak daleko je člověk
 * s rozhodováním, kdežto tohle je věta odjinud, kterou nikdo z lidí ve frontě
 * neřekl. Který údaj to je, určuje konfigurace bloku (`source_state`), aby týž
 * tvar sloužil dodáku, faktuře i smlouvě.
 */
export interface SourceState {
  /** Co zdroj tvrdí, jako i18n klíč. */
  label_key: string;
  /** Volitelně hodnota jako i18n klíč — pro výčtové stavy. */
  value_key?: string;
  /** Kdy to zdroj řekl (ISO). */
  as_of?: string;
  /** Odkud to víme — slug zdroje. */
  source_slug?: string;
}

export interface ReviewItem {
  id: string;
  /** Runtime title text OR an i18n key — one of the two. */
  title?: string;
  title_key?: string;
  subtitle_key?: string;
  state?: FieldState;
  fields?: RecordField[];
  /** Grounded citation (runtime data from the source document). */
  quote?: string;
  /** Tvrzení zdroje o předmětu (viz SourceState). */
  source_state?: SourceState;
}

/**
 * The "příprava" (preparation) block: human-in-the-loop review of extractions/obligations.
 * The client submits decisions through ONE fixed audited RPC (submit_evidence_review_audited);
 * the block only declares the entity_kind and the allowed decision values — no dynamic RPC name.
 */
export interface ReviewQueueBlock extends BlockBase {
  block_type: 'review_queue';
  data: {
    entity_kind: ReviewEntityKind;
    items: ReviewItem[];
    actions: ReviewAction[];
  };
}

/**
 * Potvrzení jednoho úkonu v terénu — dodací list, předání, odečet.
 *
 * ⭐ NENÍ TO „obrazovka dodacích listů". Dodací list je ŠABLONA uzlů workflow,
 * ne typ v klientovi; táž maska odbaví předání i odečet, protože se ptá DAT,
 * ne jména kroku. Kdyby maska znala „dodák", byl by v ní zadrátovaný jeden
 * proces jednoho zákazníka a druhý by potřeboval release.
 *
 * ⭐ CHYTRISTIKA SEM NEPATŘÍ. Stroj (OCR, model, cizí systém) smí NAVRHNOUT —
 * `suggested` u měření, `weight` u pořadí — a jeho návrh se kreslí jako ZDROJ
 * vedle hodnoty, nikdy jako hodnota. Fakt vzniká až potvrzením člověka; to je
 * jediné, co tahle maska umí zapsat.
 *
 * Váha ovlivňuje POŘADÍ a DŮRAZ, ne pravdu — proto je to číslo v datech a ne
 * úsudek v komponentě.
 */
export interface HandoverConfirmBlock extends BlockBase {
  block_type: 'handover_confirm';
  data: {
    /** Uzel workflow, který se potvrzuje (get_workflow_step_detail). */
    step_id: string;
    /** Co se potvrzuje — člověku čitelně, ne kód kroku. */
    title: string;
    /** Kroky procesu; `now` je ten, na kterém člověk stojí. */
    steps?: { label: string; state: 'done' | 'now' | 'next' }[];
    /** Údaje k přečtení. Prázdná hodnota se NEKRESLÍ (JAZYK-03). */
    facts?: { label: string; value?: string | null }[];
    /** Naměřená hodnota, pokud uzel nese subjekt (měřidlo). */
    measure?: {
      label?: string;
      unit?: string;
      /** Odhad stroje — NIKDY se nestane hodnotou bez potvrzení (JAZYK-05). */
      suggested?: string | null;
    };
    /** Které doklady se čekají a které jsou zaplněné (JAZYK-08/09). */
    evidence?: { slot: string; label?: string; filled: boolean }[];
    /** Vyžaduje podpis příjemce? */
    signature_required?: boolean;
    /** Váha z vyhodnocení — řadí a zvýrazňuje, NEROZHODUJE. */
    weight?: number;
  };
}

export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A grounded evidence reference for a cross-document finding: which source doc backs it. */
export interface EvidenceRef {
  /** Stable source-document slug (identity across ingests). */
  source_slug: string;
  /** Content hash of the source at extraction time (tamper-evidence). */
  source_sha256?: string;
  /** Original filename for display. */
  filename?: string;
}

export interface FindingItem {
  id: string;
  /** i18n key for the finding title (catalog rule id) — never a literal. */
  title_key?: string;
  severity: FindingSeverity;
  /** Grounded fields backing the finding (counts, values). */
  fields?: RecordField[];
  /** Source documents this finding was derived from. */
  evidence?: EvidenceRef[];
}

/**
 * Cross-document findings (li_findings): richer than an alert_feed item — each finding
 * carries its grounded fields + the evidence documents it was derived from (invoices,
 * contracts, delivery notes). Read-only; drill-down to the source lives in the detail view.
 */
export interface FindingsBlock extends BlockBase {
  block_type: 'findings';
  data: {
    items: FindingItem[];
  };
}

/**
 * A process run projected on its milestone track ("oval" family of skins —
 * RaceTrack et al. read exactly this contract). Fully data-derived: milestone
 * names come from the instance's workflow template, `pos` is the continuous
 * position on the track (0..1 — step ratio today, e.g. route share tomorrow),
 * `goal` mirrors the story-loop evaluation of the run's success criteria.
 */
export interface GoalProgressBlock extends BlockBase {
  block_type: 'goal_progress';
  data: {
    runs: Array<{
      batch_id: string;
      story_id?: string | null;
      /** Runtime title derived from instance data (batch/template), not an i18n key. */
      title: string;
      /** Continuous track position, 0..1. */
      pos: number;
      /** Code of the last reached milestone ('created' before the first). */
      state: string;
      total: number;
      completed: number;
      failed: number;
      milestones: Array<{ code: string; name: string; order: number; status: string }>;
      goal?: {
        met?: boolean;
        completed?: number;
        total?: number;
        failed?: number;
      } | null;
      updated_at?: string;
    }>;
  };
}

/**
 * Pole formuláře akce — DEKLARACE z allowlistu `surface_actions.fields`, ne
 * komponenta. Renderer podle `type` vybere vstup; server (submit_surface_action)
 * hodnotu ověří znovu a nezávisle (typ, povinnost, výčet) — klientská validace
 * jen šetří kolečko.
 */
/**
 * `secret` = tajná hodnota (heslo, klíč dodavatele): klient ji kreslí skrytě, po
 * odeslání ji zahodí a server ji nevypíše do chyby ani do auditu.
 */
export type ActionFieldType = 'text' | 'textarea' | 'uuid' | 'date' | 'timestamptz' | 'integer' | 'boolean' | 'enum' | 'secret';

export interface ActionField {
  key: string;
  /** i18n key — never a literal string. */
  label_key: string;
  type: ActionFieldType;
  required?: boolean;
  /** Výčet pro `enum`: hodnota jde na server, popisek je i18n klíč. */
  options?: Array<{ value: string; label_key: string }>;
  default?: string;
}

/** Jedna akce správy dostupná volajícímu — řádek allowlistu, jak ho vydal server. */
export interface ActionDef {
  /** `action_slug` z allowlistu; jediné, co klient při submitu pošle vedle cíle a payloadu. */
  slug: string;
  title_key: string;
  description_key?: string;
  fields: ActionField[];
}

/**
 * AKCE SPRÁVY Z PLOCHY (ADR-003, K4) — zrcadlo allowlistu čtení pro ZÁPIS.
 *
 * ⭐ AKCE JSOU DATA, MASKA JE JEDNA. Řádek `surface_actions` (instanční overlay)
 * říká: cílové RPC, mapa argumentů, deklarace polí, publikum. Blok vydá jen to,
 * co RLS volajícímu pustí. Klient kreslí tlačítka a formulář z deklarace a při
 * odeslání posílá `slug` + cíl + payload do JEDNOHO auditovaného RPC
 * (`submit_surface_action`) — jméno cílové funkce klient nikdy nezná
 * ani neposílá (táž disciplína jako `get_block_data`: „no dynamic RPC name").
 *
 * `target_id` je identita záznamu, nad kterým akce běží (z parametru detailu);
 * `null` = blok stojí mimo detail a akce se nabízejí až po výběru záznamu.
 */
export interface ActionFormBlock extends BlockBase {
  block_type: 'action_form';
  data: {
    target_kind: 'twin' | 'actor' | 'story' | 'none';
    target_id: string | null;
    actions: ActionDef[];
  };
}

/**
 * Jistota vazby v síti: potvrdil člověk · navrhl stroj · odvozeno shodou parametru.
 * Uzavřený výčet: renderer ji MUSÍ umět nakreslit jinak (styl hrany + slovo).
 */
export type RelationCertainty = 'confirmed' | 'proposed' | 'derived';

/** Uzel sítě vazeb. Text jen jako data (jména, čísla smluv) — slova nesou klíče. */
export interface RelationNode {
  /** S `kind` tvoří proklik: host otevře detail druhu `kind` (workbench.detail_by_kind). */
  id?: string;
  kind?: string;
  label: string;
  /** Jazykově neutrální doplněk (datum, IČO, lokalita). */
  sub?: string;
  /** Velikost uzlu a tloušťka hrany; zobrazí se s `unit_key`. */
  value?: number;
  unit_key?: string;
  state?: 'ok' | 'wait' | 'fault';
  state_key?: string;
  certainty: RelationCertainty;
}

/**
 * Síť vazeb entity (ESDK `es-web`): entita uprostřed, skupiny vazeb kolem.
 * ⭐ Jistota se nese v DATECH — graf nesmí z návrhu stroje udělat fakt.
 */
export interface RelationWebBlock extends BlockBase {
  block_type: 'relation_web';
  data: {
    center: { label: string; sub?: string };
    groups: { key: string; label_key: string; nodes: RelationNode[] }[];
  };
}

export type SurfaceBlock =
  | KpiTileBlock
  | ChartBlock
  | TimingTowerBlock
  | TableBlock
  | TimelineBlock
  | AlertFeedBlock
  | NarrativeBlock
  | RecordDetailBlock
  | ReviewQueueBlock
  | FindingsBlock
  | GoalProgressBlock
  | HandoverConfirmBlock
  | ActionFormBlock
  | RelationWebBlock;

export interface SurfaceLayoutItem {
  block_slug: string;
  block_type: BlockType;
  title_key: string;
  position: number;
  /** Arrangement hint from block config (layout-supplied; unknown → default). */
  presentation?: string;
}

export interface SurfaceLayout {
  schema_version: 1;
  surface: Surface;
  blocks: SurfaceLayoutItem[];
}

/** Unsigned snapshot payload (emission side). */
export interface SnapshotEnvelope {
  schema_version: 1;
  snapshot_slug: string;
  surface: Surface;
  published_at: string;
  expires_at: string;
  max_sensitivity: Sensitivity;
  blocks: SurfaceBlock[];
}

/** Published, signed snapshot (what a client may cache offline). */
export interface SignedSnapshot extends SnapshotEnvelope {
  sha256: string;
  /** base64url Ed25519 signature over the canonical JSON of the envelope. */
  signature: string;
  key_id: string;
}
