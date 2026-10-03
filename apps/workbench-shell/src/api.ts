import {
  assertRenderable,
  validateBlock,
  validateLayout,
  type ReviewEntityKind,
  type Sensitivity,
  type SurfaceBlock,
  type SurfaceLayout
} from '@aisha/surface-blocks';
import { instance } from './instance.js';
import { getToken } from './auth.js';

/**
 * Workbench is a LIVE operator surface (document management + preparation). It renders
 * confidential registry rows the RLS has already authorised for this operator, so the
 * client cap is 'confidential' — the highest — meaning the fail-closed gate here only
 * rejects an UNKNOWN sensitivity value (defense-in-depth), never a legitimate one.
 * Nothing is cached: the workbench has no service worker and never builds offline snapshots.
 */
export const WORKBENCH_SURFACE_CAP: Sensitivity = 'confidential';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
  }
}

/** RPC-only data access (platform rule): POST <postgrest>/rpc/<fn>. Never a table endpoint. */
/** Latency ledger the owner asked for: every RPC's wall time, inspectable as
 * `window.__AISHA_PERF` and warned to console when a call crosses 800 ms. The
 * measurement lives HERE because guessing where the wait comes from already
 * cost a day — the browser knows, so let it say. */
const perf: Array<{ fn: string; ms: number; at: string }> = [];
(globalThis as Record<string, unknown>).__AISHA_PERF = perf;
function recordPerf(fn: string, t0: number): void {
  const ms = Math.round(performance.now() - t0);
  perf.push({ fn, ms, at: new Date().toISOString() });
  if (perf.length > 200) perf.shift();
  if (ms > 800) console.warn(`[perf] ${fn} ${ms} ms`);
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}, query = ''): Promise<T> {
  const t0 = performance.now();
  const token = await getToken();
  if (!token) throw new ApiError('unauthenticated', 401);
  const qs = query ? `?${query}` : '';
  const res = await fetch(`${instance.config.api.postgrest_url.replace(/\/$/, '')}/rpc/${fn}${qs}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(args)
  });
  if (!res.ok) {
    recordPerf(fn, t0);
    throw new ApiError(`rpc ${fn} failed`, res.status);
  }
  const out = (await res.json()) as T;
  recordPerf(fn, t0);
  return out;
}

/** One navigable section of the extranet, as the backend serves it. */
export interface SurfaceSection {
  section: string;
  block_count: number;
  /** Merged nav metadata (template ?? admin override), all optional — a backend
   *  without a section template serves plain {section, block_count} and the nav
   *  still works. Names are i18n KEYS, never text: renames live in translations. */
  title_key?: string;
  icon?: string;
  group_key?: string;
  group_order?: number;
  position?: number;
  /** 'inactive' = declared but not yet connected to a source: rendered greyed
   *  with a reason, never hidden. */
  state?: 'active' | 'inactive';
  reason_key?: string;
}

/**
 * Which sections exist is DATA — the client discovers them instead of shipping a
 * list. This shell used to hardcode 'workbench', which is why 'porada' (7 blocks,
 * real data) had no web client at all: the section existed and nobody asked for it.
 * A new section now appears in the nav without a client release.
 */
export async function fetchSections(): Promise<SurfaceSection[]> {
  const raw = await rpc<unknown>('list_surface_sections', {});
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is SurfaceSection =>
      !!s && typeof s === 'object' && typeof (s as SurfaceSection).section === 'string'
  );
}

/** Jedna volba přepínače pohledu: hodnota tak, jak stojí v datech, a kolik jí odpovídá. */
export interface ScopeOption {
  value: string;
  count: number;
}

/**
 * Volby přepínače pohledu.
 *
 * Seznam se NEDRŽÍ v klientovi: která z našich firem existuje a kolik má dokladů
 * je vlastnost podniku a mění se bez releasu. Klient se proto ptá databáze a
 * dostane, co v datech skutečně je — a protože RPC běží jako SECURITY INVOKER,
 * nabídne rovnou jen to, na co má přihlášený nárok.
 *
 * Selhání není chyba obrazovky: bez voleb se přepínač nevykreslí a sekce se chová
 * jako dřív (všechna data). Proto se tu chyba polyká, ne vyhazuje.
 */
/** Jedna osa přepínače: jméno parametru, pod kterým jde volba do bloků, a co lze zvolit. */
export interface ScopeAxis {
  axis_key: string;
  title_key: string;
  dim: string;
  options: ScopeOption[];
}

/**
 * Osy přepínače pohledu PRO SEKCI — deklarace i volby z dat.
 *
 * ⛔ NAMĚŘENO 2026-09-06: seznam os byl konstantou v tomhle klientovi a nesl
 * jména věcí jedné instance (`owner_company`, `unit_site`). Jiná instance tím
 * dostala přepínač, který mlčí: obě osy vracely nula voleb, lišta se nevykreslila
 * a přidat vlastní osu šlo jen editací forku. Osy jsou proto data (K5) —
 * `surface_scope_axes` + `get_surface_scope_axes`, RLS rozhoduje o obojím.
 *
 * Osa bez voleb se nevrací, takže klient nic nefiltruje: co přijde, to jde na
 * lištu. Selhání se polyká stejně jako u voleb — bez přepínače sekce funguje
 * jako dřív (všechna data), a to není chyba obrazovky.
 */
export async function fetchScopeAxes(surface: string): Promise<ScopeAxis[]> {
  try {
    const raw = await rpc<{ data?: { axes?: unknown } }>('get_surface_scope_axes', { p_params: { surface } });
    const list = raw?.data?.axes;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (a): a is ScopeAxis =>
        !!a && typeof a === 'object'
        && typeof (a as ScopeAxis).axis_key === 'string'
        && typeof (a as ScopeAxis).dim === 'string'
        && Array.isArray((a as ScopeAxis).options)
    );
  } catch {
    return [];
  }
}

export async function fetchScopeOptions(params: Record<string, unknown> = {}): Promise<ScopeOption[]> {
  try {
    const raw = await rpc<{ data?: { options?: unknown } }>('get_scope_options', { p_params: params });
    const list = raw?.data?.options;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (o): o is ScopeOption =>
        !!o && typeof o === 'object'
        && typeof (o as ScopeOption).value === 'string' && (o as ScopeOption).value.length > 0
    );
  } catch (err) {
    console.warn('[workbench] scope options unavailable — filtr se nevykreslí:', err);
    return [];
  }
}

/**
 * UI metadata bloku: jak ho nabídnout (ovladače parametrů, výchozí řazení, hledání).
 * Deklaruje je konfigurace bloku (`source_params`), vydává `get_surface_layout_ui`.
 */
export interface BlockUi {
  client_params?: Record<string, unknown>;
  default_sort?: { key: string; dir: 1 | -1 };
  search?: boolean;
}

/**
 * UI metadata bloků sekce. Je to NÁSTAVBA: když funkce na serveru ještě není
 * (starší nasazení) nebo odpoví něčím nečekaným, sekce se vykreslí jako dřív —
 * bez ovladačů, ne bez bloků. Proto žádná výjimka ven.
 */
export async function fetchSectionUi(section: string): Promise<Record<string, BlockUi>> {
  try {
    const raw = await rpc<{ blocks?: unknown }>('get_surface_layout_ui', { p_surface: section });
    const blocks = raw?.blocks;
    if (!blocks || typeof blocks !== 'object' || Array.isArray(blocks)) return {};
    const out: Record<string, BlockUi> = {};
    for (const [slug, v] of Object.entries(blocks as Record<string, unknown>)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const o = v as Record<string, unknown>;
      const ui: BlockUi = {};
      if (o.client_params && typeof o.client_params === 'object' && !Array.isArray(o.client_params)) {
        ui.client_params = o.client_params as Record<string, unknown>;
      }
      const ds = o.default_sort as { key?: unknown; dir?: unknown } | undefined;
      if (ds && typeof ds.key === 'string' && ds.key) {
        ui.default_sort = { key: ds.key, dir: ds.dir === -1 ? -1 : 1 };
      }
      if (o.search === true) ui.search = true;
      out[slug] = ui;
    }
    return out;
  } catch (err) {
    console.warn('[workbench] UI metadata sekce nedostupná — bloky bez ovladačů:', err);
    return {};
  }
}

export async function fetchSectionLayout(section: string): Promise<SurfaceLayout> {
  const raw = await rpc<unknown>('get_surface_layout', { p_surface: section });
  const val = validateLayout(raw);
  if (!val.ok || !val.value) throw new ApiError(`layout contract violation: ${val.errors.join('; ')}`);
  return val.value;
}

/**
 * Fetch one block's data. `params` reaches the underlying data RPC via get_block_data's
 * source_params||p_params merge — this is how a document detail is scoped by record id.
 */
export async function fetchBlockData(blockSlug: string, params: Record<string, unknown> = {}): Promise<SurfaceBlock> {
  const raw = await rpc<unknown>('get_block_data', { p_block_slug: blockSlug, p_params: params });
  const val = validateBlock(raw);
  if (!val.ok || !val.value) throw new ApiError(`block contract violation: ${val.errors.join('; ')}`);
  // Blok prošel, ale nese něco, co tenhle bundle nezná. Vykreslí se bez toho —
  // a drift se ohlásí, protože tichá tolerance je jen jiný způsob, jak nevědět.
  // Adresát je vývoj (a brána v CI), ne uživatel: pro něj se nic nezkazilo.
  if (val.degraded && val.degraded.length > 0) {
    console.warn(
      `[workbench] blok '${blockSlug}' nese vlastnosti, které kontrakt nezná ` +
        `(vykresleno bez nich): ${val.degraded.join(', ')}`,
    );
  }
  // Fail-closed: an unknown/malformed sensitivity value never reaches a renderer.
  assertRenderable(val.value, WORKBENCH_SURFACE_CAP);
  return val.value;
}

/**
 * Stáhne VŠECHNY řádky množinové RPC, i když server odpověď useká.
 *
 * ⛔ NAMĚŘENO 2026-09-23 na produkci: PostgREST vrací z RPC nejvýš `max-rows`
 * (1 000) řádků a zbytek TIŠE zahodí — status 206, žádná chyba. Překladů
 * extranetu je 1 860, shell tedy dostal 1 000 a 860 textů (46 %) mu chybělo.
 * `get_translations` řadí podle (key, locale), takže odpadl vždy abecední konec
 * a po celé ploše se místo textů ukazovaly klíče nebo anglická záloha
 * („Credits", „app.twins.col.unit_address").
 *
 * Strop serveru se nezná předem a nemá se zadrátovat: velikost první stránky
 * JE strop. Stránkuje se `offset`em, dokud nepřijde kratší stránka; přesný
 * násobek stropu skončí odpovědí 416 („za koncem"), a to je konec, ne chyba.
 */
export async function fetchAllPages(
  page: (query: string) => Promise<unknown>,
  maxPages = 50
): Promise<unknown[]> {
  const all: unknown[] = [];
  let cap = 0;
  for (let i = 0; i < maxPages; i += 1) {
    let rows: unknown;
    try {
      rows = await page(all.length > 0 ? `offset=${all.length}` : '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 416 && all.length > 0) break;
      throw err;
    }
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (cap === 0) cap = rows.length;
    if (rows.length < cap) break;
  }
  return all;
}

export interface TranslationRow {
  key: string;
  locale: string;
  value: string;
}

/**
 * Display strings for a namespace, from the DB — the same `translations` table
 * and `get_translations` RPC the admin surface reads, so a string edited in the
 * translation UI reaches this shell without a rebuild.
 *
 * The extranet is always authenticated, so this runs under the caller's identity
 * (the RPC is granted to `authenticated`); there is no anonymous path to keep
 * working.
 */
export async function fetchTranslations(namespace: string): Promise<TranslationRow[]> {
  const rows = await fetchAllPages((query) => rpc<unknown>('get_translations', { p_namespace: namespace }, query));
  return rows.flatMap((r) => {
    const row = r as Partial<TranslationRow>;
    return typeof row.key === 'string' && typeof row.locale === 'string' && typeof row.value === 'string'
      ? [{ key: row.key, locale: row.locale, value: row.value }]
      : [];
  });
}

export interface ReviewResult {
  entity_kind: ReviewEntityKind;
  entity_id: string;
  decision: string;
  /** New lifecycle state after the decision (echoed by the RPC). */
  state: string;
}

/**
 * The "příprava" write path — the first user-facing write in the repo. Goes through ONE
 * fixed audited RPC (submit_evidence_review_audited); the platform is the single writer and
 * enforces the reviewer authorization + audit. Human-in-the-loop for obligations (E5) means
 * a decision here is what flips an extraction/obligation from NEEDS_REVIEW to confirmed.
 */
/** What a person supplied in the capture panel. Shape mirrors the contract's ReviewCapture. */
export interface MilestoneCapture {
  recipient?: string;
  /** PNG data URI from the signature pad. */
  signature?: string;
  /** Reason for a deviation. */
  note?: string;
}

/**
 * ONE hardwired RPC for every decision in a review queue, milestones included.
 *
 * It used to be two: milestones went straight to complete_workflow_step, because the
 * dispatcher carried four scalars and could not take a signature. That made the write
 * with legal weight the only write that produced NO audit_journal row, while an
 * ordinary obligation review produced one. The dispatcher now takes `p_evidence`, so
 * the bypass is gone and the audit is back.
 *
 * The block contract still must never choose the writer — that is what stops block
 * DATA from redirecting a write — so the name lives here, in the client, and the
 * server dispatches on entity_kind.
 *
 * Position is NOT sent. It is derived server-side from the run's own arrival signal
 * and telematics: a coordinate supplied by the party being documented is not evidence.
 */
export async function submitReview(
  entityKind: ReviewEntityKind,
  entityId: string,
  decision: string,
  capture?: MilestoneCapture
): Promise<ReviewResult> {
  const evidence = {
    ...(capture?.recipient ? { recipient: capture.recipient } : {}),
    ...(capture?.signature ? { signature: capture.signature } : {})
  };
  return rpc<ReviewResult>('submit_evidence_review_audited', {
    p_entity_kind: entityKind,
    p_entity_id: entityId,
    p_decision: decision,
    p_note: capture?.note ?? null,
    ...(Object.keys(evidence).length > 0 ? { p_evidence: evidence } : {})
  });
}

/**
 * AKCE SPRÁVY Z PLOCHY (ADR-003, K4) — druhá zápisová cesta po review, a poslední:
 * cokoli dalšího je ŘÁDEK v allowlistu `surface_actions`, ne nové RPC v klientovi.
 * Posílá se jen `slug` + cíl + payload; server slug přeloží přes allowlist,
 * payload ověří proti deklaraci polí a cílové RPC zavolá s právy volajícího.
 * Jméno cílové funkce tady nikdy není — táž disciplína jako u get_block_data.
 */
export interface ActionResult {
  ok: boolean;
  action_slug: string;
  result: unknown;
}

export async function submitSurfaceAction(
  slug: string,
  target: Record<string, string>,
  payload: Record<string, string>
): Promise<ActionResult> {
  // Parametry abecedně (stejné pravidlo jako mobil: brána rpc-params-alphabetical).
  return rpc<ActionResult>('submit_surface_action', {
    p_action_slug: slug,
    p_payload: payload,
    p_target: target
  });
}
