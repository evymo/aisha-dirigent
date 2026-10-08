/**
 * li-driver — the platform-side consumer for local-ingest export bundles.
 *
 * POSITION IN THE ARCHITECTURE (the "ala vehicles" seam):
 *   local-ingest is a SOURCE, not a callee. It runs on an analyst machine
 *   (or a hardened experimental container), stays loopback-only, and the stack
 *   NEVER reaches into it. It emits verify-gated OUTPUT BUNDLES; this driver is
 *   the thin mapper that replays them into first-party SoT.
 *
 *   [analyst box]                         [platform / svc-source-broker]
 *   POST /api/export → export/<id>/       li-driver (this file)
 *     manifest.json (cursor unit)  ──►      tick → read manifest → verify
 *     *.jsonl (sha256, verify-gated)        sha256 + verify-result (fail-closed)
 *                                           → upsert via li_* + KB RPCs
 *                                           → advance cursor (per manifest)
 *
 * TRANSPORT — PULL, NO EGRESS (recommended v1):
 *   The broker ticks a shared DROP LOCATION (config.localIngestDropDir): the
 *   `ingest-out` volume surfaced read-only, or a synced object drop. The ingest
 *   container never pushes (AISHA_EXPORT_PUSH_URL stays unset). Push is the
 *   fallback and is NOT this driver's concern — the driver is transport-agnostic
 *   as long as the bundle lands in the drop dir.
 *
 * IDEMPOTENCY + PROVENANCE:
 *   - Manifest cursor: monotone `export_id`; the driver remembers the last one
 *     processed (audience_broker_sync_state.metadata) and only replays newer
 *     bundles → no double-processing.
 *   - Row-level: the li_* RPCs dedup server-side (registry by source_sha256;
 *     the rest by a deterministic content key the RPC computes) so a partial
 *     re-run of the SAME manifest is a no-op, not a duplicate.
 *   - The artifact fields are named 1:1 as the RPC params, so the mapper is
 *     nearly the identity function — the whole point of the local box emitting
 *     "RPC-only-safe" artifacts.
 *
 * TRUST BOUNDARY (fail-closed):
 *   - A bundle is replayed ONLY if manifest.verify.ok === true AND every file's
 *     recomputed sha256 matches the manifest. Any mismatch → the whole manifest
 *     is refused (KB corruption from a tampered/edited bundle never lands).
 *   - Local paths in the manifest (config/input) are DIAGNOSTICS — never stored.
 *   - Legal/obligation content always lands as NEEDS_REVIEW (enforced in-RPC);
 *     entity suggestions stay advisory. The driver cannot promote either.
 *
 * SINGLE WRITER: every write goes through a SECURITY DEFINER RPC on the
 * service-role Postgres connection (config.postgresUrl) — the SAME neighbour
 * pattern the engagement scheduler uses. NEVER a raw table write, NEVER
 * a banned legacy-client rpc.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { Client as PgClient } from 'pg';
import { errMessage } from '../errors.js';
import type { SourceBrokerConfig } from '../config.js';
import {
  emptyPromotionCounts,
  emptyProposalCounts,
  proposeTwinsFromProfiles,
  replayPromotions,
  type PromotionReplayCounts,
  type TwinProposalCounts,
} from './twin-producer.js';
import {
  openRelationsFromLinks,
  recordTouchesAsEvents,
  type RelationLaneCounts,
  type TouchLaneCounts,
} from './crm-lanes.js';

/** The source_slug this driver owns — its row in audience_broker_sync_state. */
export const LI_SOURCE_SLUG = 'local-ingest';

/** One file entry in an export manifest (name + integrity + record count). */
export interface LiManifestFile {
  name: string;
  sha256: string;
  records: number;
}

/** The export manifest — the cursor unit the driver consumes. */
export interface LiManifest {
  export_id: string;
  created_at?: string;
  engine_version?: string;
  source_slug?: string;
  verify?: { ok?: boolean; checked?: unknown };
  files: LiManifestFile[];
  /** Stav vektorů běhu, který balíček vyrobil (engine ≥ vektory přírůstkově). Starší nemá. */
  embed?: LiEmbedStav | null;
  // config / input are local-box diagnostics — intentionally NOT consumed.
}

/**
 * Co engine hlásí o vektorech. ⛔ Naměřeno na riq 2026-09-16…29: 157 balíčků, všechny
 * s `embed.backend=error` (v obrazu chyběla knihovna embedderu), a driver viděl jen
 * `kbEmbeddings: 0` — tichou nulu, k nerozeznání od „vektory nejsou potřeba". Vektorový
 * index zamrzl na 30. 8. a vyhledávání nenacházelo 725 z 813 smluv.
 */
export interface LiEmbedStav {
  backend?: string | null;
  model?: string;
  vectors?: number;
  embedded?: number;
  reused?: number;
  shared?: number;
  pending?: number;
  exported?: number;
  error?: string;
  export_error?: string;
  degraded?: boolean;
}

/** A discovered bundle on disk: its directory + parsed manifest. */
export interface LiBundle {
  dir: string;
  manifest: LiManifest;
}

/** Aggregate result of ingesting one or more bundles in a tick. */
export interface LiIngestResult {
  bundlesSeen: number;
  bundlesIngested: number;
  /** Balíčky odložené kvůli TRVALÉ příčině (čekají na rozhodnutí člověka). */
  karantena: string[];
  cursorExportId: string | null;
  counts: LiUpsertCounts;
  errors: number;
  /** Stav vektorů posledního přehraného balíčku (+ jeho export_id) — do stavu zdroje. */
  embed?: (LiEmbedStav & { export_id: string }) | null;
  /** Pokrytí vektory změřené platformou po posledním balíčku — do stavu zdroje. */
  pokryti?: LiPokrytiVektoru | null;
}

/** Stav vektorů chunků zdroje vůči ŽIVÉ identitě (model resolveru v1 + deklarovaný pin vah). */
export interface LiPokrytiStavy {
  useku: number;
  /** vektor živé identity (gguf:<pin>, jakýkoli recept) — vyhledávání ho najde a je pravdivý */
  zivy: number;
  /** jméno živého modelu, ale jiný runtime/verze (např. sentence-transformers) — viditelný, k přepočtu */
  stary_runtime: number;
  /** jiné jméno modelu (např. MLX) — vyhledávání ho nevidí, k přepočtu */
  jiny_model: number;
  /** záměrně nezakódováno: text delší než declared.max_tokens (tichý ořez) */
  nad_limitem: number;
  /** žádný vektor */
  bez_vektoru: number;
}

/**
 * Pokrytí vektory po třídách; `model`/`identita` null = prostor v1 nemá model (živé nelze odlišit).
 * Nedeklarovaná identita vah (pin nebo formát) = měření NEZMĚŘENO (celé null), ne nuly.
 */
export interface LiPokrytiVektoru extends LiPokrytiStavy {
  model: string | null;
  identita: string | null;
  tridy: Record<string, LiPokrytiStavy>;
  export_id: string;
}

/** Per-artifact upsert tallies (mirrors the RPC {total,inserted,updated}). */
export interface LiUpsertCounts {
  registry: number;
  findings: number;
  links: number;
  obligations: number;
  entitySuggestions: number;
  relations: number;
  kbItems: number;
  kbChunks: number;
  /** Dokumenty se změněným rozložením chunků → staré chunky i vektory smazány a zapsány znovu (atomicky). */
  kbItemsRelaid: number;
  /** Vektory PŘEVZATÉ z bundlu — platforma je nepočítá znovu (viz replayEmbeddings). */
  kbEmbeddings: number;
  /** Pokrytí vektory po přehrání (měření, ne součet) — viz zmerPokrytiVektoru. */
  pokryti?: LiPokrytiVektoru | null;
  /** Twins offered to the review lane from entity profiles (state=proposed). */
  twinProposals: TwinProposalCounts;
  /** Engine-decided identity extract replayed 1:1 (promotions_artifact). */
  promotions: PromotionReplayCounts;
  /**
   * links_artifact rows naming twins on both ends → twin_relations (crm-lanes).
   *
   * ⛔ NE `relations`: tak se už jmenuje upsert `relations_artifact` výš (číslo).
   * Slití forku 2026-09-13 přineslo obě vlastnosti pod TÝMŽ klíčem a git je
   * slepil bez konfliktu, protože ležely na různých řádcích — typově to bylo
   * `number` i `RelationLaneCounts` zároveň a služba se nesestavila. Jsou to dva
   * RŮZNÉ pruhy (návrhy vazeb × vazby dvojčat z CRM odkazů), proto dvě jména;
   * `twinRelations` sedí k cílové tabulce i k sousednímu `touches` → twin_events.
   */
  twinRelations: RelationLaneCounts;
  /** communication registry rows + touch:* links → twin_events (crm-lanes). */
  touches: TouchLaneCounts;
}

function emptyCounts(): LiUpsertCounts {
  return {
    registry: 0,
    findings: 0,
    links: 0,
    obligations: 0,
    entitySuggestions: 0,
    relations: 0,
    kbItems: 0,
    kbChunks: 0,
    kbItemsRelaid: 0,
    kbEmbeddings: 0,
    twinProposals: emptyProposalCounts(),
    promotions: emptyPromotionCounts(),
    twinRelations: { opened: 0, already: 0, deferred: 0, ambiguous: 0 },
    touches: { events: 0, orphaned: 0, ambiguous: 0 },
  };
}

/** sha256 hex of a byte buffer (matches the local box's dedup.sha256_bytes). */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Parse a JSONL file into an array of records (blank lines skipped). */
export function readJsonl(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf-8');
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as Record<string, unknown>);
  }
  return out;
}

/**
 * Discover export bundles under the drop dir. A bundle is any immediate
 * subdirectory that contains a `manifest.json`. Returns them sorted by
 * `export_id` ascending (the monotone cursor order the local box mints).
 *
 * Robust to two common drop layouts: the drop dir IS the exports root
 * (`<drop>/<export_id>/manifest.json`), or it wraps an `export/` dir
 * (`<drop>/export/<export_id>/manifest.json`) — both are scanned.
 */
export function discoverBundles(dropDir: string): LiBundle[] {
  const roots = [dropDir, path.join(dropDir, 'export')].filter(
    (d) => existsSync(d) && statSync(d).isDirectory()
  );
  const bundles: LiBundle[] = [];
  const seenDirs = new Set<string>();
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      const dir = path.join(root, name);
      if (seenDirs.has(dir)) continue;
      let isDir = false;
      try {
        isDir = statSync(dir).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      const manifestPath = path.join(dir, 'manifest.json');
      if (!existsSync(manifestPath)) continue;
      let manifest: LiManifest;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as LiManifest;
      } catch {
        continue; // an unparseable manifest is skipped (a later valid one wins)
      }
      if (!manifest.export_id || !Array.isArray(manifest.files)) continue;
      seenDirs.add(dir);
      bundles.push({ dir, manifest });
    }
  }
  bundles.sort((a, b) => a.manifest.export_id.localeCompare(b.manifest.export_id));
  return bundles;
}

/**
 * Fail-closed integrity gate for one bundle. Throws (refusing the whole
 * manifest) unless the local box's own verify passed AND every listed file's
 * recomputed sha256 matches. This is the tamper/corruption window guard: an
 * artifact edited between the local run and this replay is rejected, never
 * ingested as if authoritative.
 */
export function assertBundleTrusted(bundle: LiBundle): void {
  const { dir, manifest } = bundle;
  if (manifest.verify?.ok !== true) {
    throw new Error(
      `li-driver: bundle '${manifest.export_id}' refused — manifest.verify.ok is not true `
      + '(the local box does not vouch for these artifacts)'
    );
  }
  for (const f of manifest.files) {
    const filePath = path.join(dir, f.name);
    if (!existsSync(filePath)) {
      throw new Error(
        `li-driver: bundle '${manifest.export_id}' refused — manifest lists '${f.name}' `
        + 'but the file is missing from the bundle'
      );
    }
    const actual = sha256Hex(readFileSync(filePath));
    if (actual !== f.sha256) {
      throw new Error(
        `li-driver: bundle '${manifest.export_id}' refused — sha256 mismatch on '${f.name}' `
        + `(manifest ${String(f.sha256).slice(0, 16)}…, disk ${actual.slice(0, 16)}…) — tampered or corrupted`
      );
    }
  }
}

/**
 * Rozpočet na JEDNO volání dávkové RPC.
 *
 * ⛔ NAMĚŘENO 2026-08-06 na produkci: replay 44 320 dokladů padl na
 *   `total size of jsonb array elements exceeds the maximum of 268435455 bytes`
 * a driver balík odmítal tik za tikem (kurzor správně držel na posledním dobrém
 * exportu, takže se nic nepoškodilo — jen se nic nezapsalo).
 *
 * 268 435 455 B je TVRDÝ strop Postgresu na součet prvků `jsonb` pole; není to
 * konfigurace, kterou by šlo zvednout. Dávková RPC přitom brala vstup bez
 * jakéhokoli omezení — bomba s doutnákem: fungovalo to, dokud byl korpus malý.
 * Spustilo to obohacení řádků o `source_record` (~2 kB/řádek × 44 320 ≈ 90 MB),
 * ale narazilo by to i bez toho, jen později a nejspíš v horší chvíli.
 *
 * Rozpočet je záměrně hluboko pod stropem: kolem řádků je ještě obálka dotazu,
 * server má `work_mem` a jsonb v paměti zabírá víc než jeho serializovaný tvar.
 * Těsně pod tvrdý strop se nechodí.
 */
const MAX_BATCH_BYTES = 48 * 1024 * 1024;

/**
 * Rozdělí řádky na dávky podle SKUTEČNÉ velikosti, ne podle počtu.
 *
 * Počet řádků je špatné měřítko: doklad se zdrojem verbatim a položkami je
 * řádově větší než holý řádek vazby. Pevný počet by u jedné vrstvy plýtval
 * a u druhé přetekl — proto se měří to, co Postgres skutečně omezuje.
 *
 * Řádek, který se sám nevejde do rozpočtu, se NEPŘESKAKUJE: rozdělit ho nelze
 * a tiše ho zahodit by znamenalo neúplný registr, který se tváří jako úplný.
 */
export function chunkBySize(
  rows: Record<string, unknown>[],
  budget = MAX_BATCH_BYTES
): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  let davka: Record<string, unknown>[] = [];
  let velikost = 0;
  for (const row of rows) {
    const b = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (b > budget) {
      throw new Error(
        `li-driver: jeden řádek má ${Math.round(b / 1024 / 1024)} MB a nevejde se do `
        + `rozpočtu dávky (${Math.round(budget / 1024 / 1024)} MB) — rozdělit ho nelze. `
        + 'Zdroj takhle velký nepatří do řádku registru, ale do úložiště objektů.'
      );
    }
    // +1 za oddělovač v poli; prázdná dávka se nesmí zavřít, jinak vznikne [].
    if (davka.length > 0 && velikost + b + 1 > budget) {
      out.push(davka);
      davka = [];
      velikost = 0;
    }
    davka.push(row);
    velikost += b + 1;
  }
  if (davka.length > 0) out.push(davka);
  return out;
}

/** Call one li_upsert_* batch RPC; returns the RPC's `total` (rows accepted). */
/**
 * Zdroj není registrovaný ani aktivní — a SÁM SE TO NESPRAVÍ.
 *
 * Rozdíl proti ostatním poruchám je v tom, KDO je může odstranit. Spadlá
 * databáze nebo utržené spojení pominou samy; neznámý zdroj čeká na ROZHODNUTÍ
 * ČLOVĚKA (klasifikace + aktivace). Držet na něm kurzor znamená zastavit celou
 * frontu na neurčito — naměřeno 2026-08-30: jeden takový balíček zablokoval
 * zbylých pět a driver ho půl hodiny zkoušel dokola.
 *
 * Typ, ne porovnání textu: hláška se může změnit, vlastnost ne.
 */
export class ZdrojNeniAktivni extends Error {
  readonly sourceSlug: string;
  constructor(sourceSlug: string, zprava: string) {
    super(zprava);
    this.name = 'ZdrojNeniAktivni';
    this.sourceSlug = sourceSlug;
  }
}

/**
 * Story ingestovaného zdroje — NAJDE se podle identity, nezadává se.
 *
 * `ensure_source_story` je idempotentní: zdroj si `story_id` drží, druhý replay
 * téhož balíčku tedy druhou story nezaloží (`created:false`). Týž tvar jako
 * `ensure_production_batch_story` — věc, o které story je, ji vlastní.
 *
 * Fail-closed dvakrát, obojí záměrně:
 *   · balíček bez `source_slug` nepojmenoval svůj zdroj ⇒ kontext se NEODVOZUJE,
 *   · neregistrovaný nebo neaktivní zdroj ⇒ STOP, ne založení story.
 * Obsah bez kontextu nemá scope, a scope je to, z čeho se odvozují oprávnění.
 */
/**
 * Artefakty, které svc-source-broker ČTE.
 *
 * Není to konfigurace, ale deklarace vlastního chování — brána
 * `balicek-nesmi-mit-nekonzumovany-artefakt` ji porovnává s tím, co v kódu
 * SKUTEČNĚ stojí, takže se s realitou nemůže rozejít nepozorovaně.
 */
export const KONZUMOVANE_ARTEFAKTY: ReadonlySet<string> = new Set([
  'registry_artifact.jsonl',
  'links_artifact.jsonl',
  'findings_artifact.jsonl',
  'obligations_artifact.jsonl',
  'entity_suggestions_artifact.jsonl',
  'entity_relation_artifact.jsonl',
  'relation_proposal_artifact.jsonl',
  'workflow_runs_artifact.jsonl',
  'flow_map_artifact.jsonl',
  'kb_artifact.jsonl',
  'embeddings_artifact.jsonl',
  'entity_profile_artifact.jsonl',
  'promotions_artifact.jsonl',
]);

async function resolveSourceStory(
  pg: PgClient,
  manifest: LiManifest,
  logger: FastifyBaseLogger
): Promise<string> {
  const slug = (manifest.source_slug ?? '').trim();
  if (!slug) {
    throw new Error(
      `li-driver: balíček '${manifest.export_id}' nemá manifest.source_slug — `
      + 'kontext se NEODVOZUJE, balíček musí pojmenovat svůj zdroj'
    );
  }
  const res = await pg.query<{
    result: {
      ok?: boolean; story_id?: string; created?: boolean; error?: string; proposed?: boolean;
    };
  }>('SELECT public.ensure_source_story($1::text, $2::text) AS result', [slug, null]);
  const r = res.rows[0]?.result;
  if (r?.ok !== true || !r.story_id) {
    // Zdroj najde ingest, aktivuje ho člověk. Když se ohlásil poprvé, RPC po
    // sobě nechá neaktivní návrh — a to musí být slyšet, jinak stopa vznikne
    // a nikdo o ní neví (přesně ten stav, kvůli kterému návrh zavádíme).
    if (r?.proposed === true) {
      logger.warn(
        { source_slug: slug },
        'li-driver: zdroj se ohlásil poprvé — založen NEAKTIVNÍ návrh, čeká na 4D klasifikaci'
      );
    }
    const zprava =
      `li-driver: zdroj '${slug}' nemá kontext — ${r?.error ?? 'ensure_source_story nevrátila story'}`
      + (r?.proposed === true
        ? '; návrh zdroje založen jako NEAKTIVNÍ a čeká na klasifikaci (schvaluje člověk)'
        : '; zdroj musí být registrovaný a aktivní (onboarding je podmínka, ne formalita)');
    if (r?.error === 'unknown or inactive source') throw new ZdrojNeniAktivni(slug, zprava);
    throw new Error(zprava);
  }
  if (r.created === true) {
    logger.info(
      { source_slug: slug, story_id: r.story_id },
      'li-driver: story zdroje založena ve stavu inbox — vzniká automaticky, viditelnost schvaluje člověk'
    );
  }
  return r.story_id;
}

async function upsertBatch(
  pg: PgClient,
  fn: string,
  rows: Record<string, unknown>[],
  manifest: LiManifest,
  logger?: FastifyBaseLogger
): Promise<number> {
  if (rows.length === 0) return 0;
  const davky = chunkBySize(rows);
  if (davky.length > 1) {
    logger?.info(
      { fn, export_id: manifest.export_id, rows: rows.length, batches: davky.length },
      'li-driver: dávka rozdělena podle velikosti (strop jsonb pole v Postgresu)'
    );
  }
  let total = 0;
  let keptBetter = 0;
  // Sekvenčně: RPC je idempotentní přes source_sha256, ale souběžné dávky by
  // soupeřily o tytéž řádky a audit by ztratil pořadí.
  for (const davka of davky) {
    const res = await pg.query<{ result: { total?: number; kept_better?: number } }>(
      `SELECT public.${fn}($1::jsonb, $2::text, $3::text, $4::boolean) AS result`,
      [
        JSON.stringify(davka),
        manifest.export_id,
        manifest.engine_version ?? null,
        manifest.verify?.ok === true,
      ]
    );
    total += Number(res.rows[0]?.result?.total ?? 0);
    keptBetter += Number(res.rows[0]?.result?.kept_better ?? 0);
  }
  // Brána monotonicity v RPC: řádky, jejichž příchozí vytěžení nemělo ani
  // polovinu použitelných polí existujícího, se NEPŘEPSALY. To není chyba
  // balíku k odmítnutí (kurzor jede dál), ale ani ticho — 2026-07-30 přesně
  // takhle tiše prošel balík, který smlouvám shodil 11 z 20 polí.
  if (keptBetter > 0) {
    logger?.warn(
      { fn, export_id: manifest.export_id, kept_better: keptBetter },
      'li-driver: balík vytěžil méně než polovinu polí — existující řádky ponechány'
    );
  }
  return total;
}

/**
 * Replay ONE trusted bundle into SoT. Assumes assertBundleTrusted() already
 * passed. Evidence tables via the li_* RPCs (fields are 1:1 params); KB items
 * via the existing upsert_story_knowledge_item_audited + insert_knowledge_chunk
 * (the artifact's knowledge_item / chunks fields are already named as their
 * p_* params). Returns per-artifact counts.
 */
/**
 * Open a process run for every subject the bundle says implies one.
 *
 * WHY THE ARTIFACT, NOT A RULE HERE: this driver is a generic channel and must
 * not know that a delivery note starts an expedition, any more than it knows
 * what a delivery note is. Which documents imply which process — and under
 * which template name — is instance vocabulary, so it is decided where the rest
 * of the instance vocabulary lives: in the ingest bundle. The driver replays
 * what the bundle declares, exactly as it does for every other artifact.
 *
 * WHY THE DRAIN AND NOT A CRON OR A TRIGGER: the pass that brings a document in
 * is the only one that knows it is new rather than replayed. A cron would be a
 * second writer on its own clock, re-deriving what this pass already has; a
 * trigger would run inside the ingest transaction and couple the two so that a
 * failing process definition would refuse the document itself.
 *
 * Safe to replay: ensure_workflow_run_for_subject is idempotent on run_code, so
 * a re-drained bundle returns the existing run instead of opening a second one.
 * That property is what lets this sit in the drain without a "have I been here"
 * check of its own.
 *
 * A row that fails does NOT fail the bundle. The evidence is already in; losing
 * the whole ingest because one process template was renamed would trade a large
 * certainty for a small one. Failures are counted and logged.
 */
async function openWorkflowRuns(
  pg: PgClient,
  rows: Record<string, unknown>[],
  logger: FastifyBaseLogger
): Promise<number> {
  let opened = 0;
  for (const row of rows) {
    const template = typeof row.template_name === 'string' ? row.template_name : null;
    const runCode = typeof row.run_code === 'string' ? row.run_code : null;
    if (!template || !runCode) {
      logger.warn({ row }, 'li-driver: workflow run row without template_name/run_code, skipped');
      continue;
    }
    try {
      const res = await pg.query<{ result: { ok?: boolean; already_open?: boolean; error?: string } }>(
        `SELECT public.ensure_workflow_run_for_subject(
           $1::text, $2::text, $3::text, $4::date, $5::jsonb, $6::jsonb) AS result`,
        [
          template,
          runCode,
          typeof row.subject_label === 'string' ? row.subject_label : null,
          typeof row.due_date === 'string' ? row.due_date : null,
          JSON.stringify(row.subject ?? {}),
          JSON.stringify(row.node_bindings ?? {}),
        ]
      );
      const out = res.rows[0]?.result;
      if (out?.ok !== true) {
        logger.warn({ runCode, error: out?.error }, 'li-driver: workflow run refused');
        continue;
      }
      if (out.already_open !== true) opened += 1;
    } catch (err) {
      logger.warn({ runCode, err }, 'li-driver: workflow run failed, bundle continues');
    }
  }
  return opened;
}

/**
/**
 * Vektory z bundlu do `knowledge_embeddings` — bez přepočtu.
 *
 * Spojení je `source_hash` = chunk_sha256, tedy OBSAH: chunk už v DB je (zapsal
 * ho `insert_knowledge_chunk` se stejným hashem), takže se nespoléhá na pořadí
 * řádků ani na to, že oba soubory vznikly ve stejném běhu.
 *
 * FAIL-LOUD NA ROZMĚR: nesedící dim Postgres odmítne, a je to tak správně —
 * mlčky zkrácený nebo doplněný vektor se do kosinové podobnosti započítá stejně
 * ochotně jako správný, takže vada by se projevila až jako nevysvětlitelně horší
 * vyhledávání. Chyba se počítá a hlásí, ale bundle kvůli ní nepadá: evidenční
 * vrstva (li_*) je jeho kontrakt, vektory jsou přídavek.
 */
async function replayEmbeddings(
  pg: PgClient,
  dir: string,
  logger: FastifyBaseLogger
): Promise<number> {
  const file = path.join(dir, 'embeddings_artifact.jsonl');
  if (!existsSync(file)) return 0;

  let written = 0;
  let failed = 0;
  const dims = new Set<number>();
  for (const rec of readJsonl(file)) {
    const sourceHash = rec.source_hash as string | undefined;
    const b64 = rec.embedding_f32_b64 as string | undefined;
    const dim = rec.dim as number | undefined;
    if (!sourceHash || !b64 || !dim) {
      failed += 1;
      continue;
    }
    dims.add(dim);
    // base64 → float32 → textový tvar, který pgvector přijímá (`[a,b,c]`).
    const buf = Buffer.from(b64, 'base64');
    if (buf.length !== dim * 4) {
      logger.warn(
        { sourceHash, dim, bytes: buf.length },
        'li-driver: embedding délka nesedí na deklarovaný dim — přeskakuji'
      );
      failed += 1;
      continue;
    }
    const vals: number[] = new Array(dim);
    for (let i = 0; i < dim; i += 1) vals[i] = buf.readFloatLE(i * 4);

    try {
      const res = await pg.query(
        `SELECT public.insert_knowledge_embedding(
           kc.id, $1::text, kc.knowledge_item_id, $2::text, $3::text, kc.locale
         ) AS out
         FROM public.knowledge_chunks kc
         WHERE kc.source_hash = $4::text`,
        [`[${vals.join(',')}]`, rec.model ?? null, rec.model_version ?? null, sourceHash]
      );
      // Žádný řádek = vektor bez chunku. Není to chyba zápisu, ale mezera v
      // datech, a musí být vidět — jinak by „0 zapsaných" vypadalo jako prázdný
      // soubor místo jako nespojený bundle.
      if (res.rows.length === 0) failed += 1;
      else written += res.rows.length;
    } catch (err) {
      logger.warn({ sourceHash, err }, 'li-driver: embedding odmítnut');
      failed += 1;
    }
  }

  if (dims.size > 1) {
    logger.warn({ dims: [...dims] }, 'li-driver: bundle míchá víc embedding prostorů');
  }
  logger.info({ written, failed, dims: [...dims] }, 'li-driver: vektory převzaty z bundlu');
  return written;
}

/**
 * Propose flow-map nodes the bundle measured (flow_map_artifact, kind='node').
 *
 * NODES ONLY here, by design of the flow abstraction: an edge is not a
 * declaration to store — it is an OBSERVED MOVEMENT, so replaying edges as rows
 * would create a second writer for facts that already live in the measured
 * corpus.
 *
 * ⚠️ An earlier version of this comment claimed the edge/coverage/mover rows are
 * "evidence for the ratification UI, which reads the artifact itself". That was
 * wrong and is worth recording: nothing on the platform opens drop bundles, so
 * those rows reached nobody. Evidence nobody can reach is not evidence. They now
 * have a consumer — proposeFlowProcess binds the WHOLE map into one proposed
 * process (steps/transitions/movers), which is what the map actually describes.
 *
 * Everything goes through propose_production_flow_node, which FORCES
 * is_active=false — a proposal can never activate production. Activation stays
 * a human act in the administration. Idempotent on node_code: a re-drained
 * bundle refreshes the proposal's evidence instead of duplicating it, and an
 * already-ratified (active) node is never touched.
 *
 * A row that fails does NOT fail the bundle — same contract as workflow runs:
 * losing the whole ingest because one node_type fell outside the table CHECK
 * would trade a large certainty for a small one. Failures are logged.
 */
async function proposeFlowNodes(
  pg: PgClient,
  rows: Record<string, unknown>[],
  logger: FastifyBaseLogger
): Promise<number> {
  let proposed = 0;
  for (const row of rows) {
    const nodeCode = typeof row.node_code === 'string' ? row.node_code : null;
    const nodeName = typeof row.node_name === 'string' ? row.node_name : null;
    if (!nodeCode || !nodeName) {
      logger.warn({ row }, 'li-driver: flow node row without node_code/node_name, skipped');
      continue;
    }
    try {
      const res = await pg.query<{
        result: { ok?: boolean; created?: boolean; refreshed?: boolean; error?: string };
      }>(
        `SELECT public.propose_production_flow_node(
           $1::text, $2::text, $3::text, $4::jsonb, $5::jsonb) AS result`,
        [
          nodeCode,
          nodeName,
          typeof row.proposed_node_type === 'string' ? row.proposed_node_type : 'storage',
          JSON.stringify(row.measured ?? {}),
          row.pair === undefined ? null : JSON.stringify(row.pair),
        ]
      );
      const out = res.rows[0]?.result;
      if (out?.ok !== true) {
        logger.warn({ nodeCode, error: out?.error }, 'li-driver: flow node proposal refused');
        continue;
      }
      if (out.created === true || out.refreshed === true) proposed += 1;
    } catch (err) {
      logger.warn({ nodeCode, err }, 'li-driver: flow node proposal failed, bundle continues');
    }
  }
  return proposed;
}

/**
 * Bind the WHOLE measured map into ONE proposed process (inactive, versioned).
 *
 * The nodes above land as flow nodes — stations. But a station list is not a
 * process: 435 nodes arrived from 36 724 rides while 1 665 edges and 141 mover
 * signatures had no consumer at all. The comment on proposeFlowNodes says those
 * rows are "evidence for the ratification UI, which reads the artifact itself" —
 * and that is precisely what does not happen: the artifact stays in the drop
 * bundle on disk, and nothing on the platform opens bundles. Evidence nobody can
 * reach is not evidence.
 *
 * It also cannot go where that comment points. `production_flow_records` is
 * substance movement — substance_id, volume_l, concentration_pct, all NOT NULL.
 * An observed A→B with an observation count has none of them, and inventing a
 * volume to fit the table would be fabricating measurement.
 *
 * So the map does not get a second graph beside production. It becomes what it
 * actually describes — a PROCESS:
 *   nodes   → workflow_steps      (the stations one passes through)
 *   edges   → workflow_data.transitions
 *   movers  → workflow_data.movers (which machine plays which role)
 * One row per map, not one row per edge — so this is not the "second writer for
 * facts that already live in the corpus" the nodes-only rule guards against.
 *
 * And it closes the loop: a ratified template drives
 * ensure_workflow_run_for_subject → production_batches →
 * production_workflow_steps → the driver's tape. From an observed ride to a
 * confirmation on the phone there is then ONE path, not two.
 *
 * `source_key` is derived from the measured pair, never from export_id: a key
 * that changed every run would mint a new proposal per drain instead of
 * refreshing the one a human is looking at.
 */
async function proposeFlowProcess(
  pg: PgClient,
  rows: Record<string, unknown>[],
  sourceSlug: string,
  logger: FastifyBaseLogger
): Promise<{ proposed: boolean; steps: number; transitions: number; movers: number }> {
  const nodes = rows.filter((r) => r.kind === 'node');
  const edges = rows.filter((r) => r.kind === 'edge');
  const movers = rows.filter((r) => r.kind === 'mover_signature');
  const out = { proposed: false, steps: nodes.length, transitions: edges.length, movers: movers.length };
  if (nodes.length === 0) return out;

  // The pair the engine measured over ("place_from"→"place_to") identifies WHICH
  // process this is; a corpus may yield several.
  const pair = (nodes[0]?.pair as unknown[] | undefined) ?? [];
  const sourceKey = `${sourceSlug}:${Array.isArray(pair) ? pair.join('>') : 'default'}`;

  const steps = nodes.map((n, i) => ({
    step_code: String(n.node_code ?? `step-${i + 1}`),
    step_name: String(n.node_name ?? n.node_code ?? `Krok ${i + 1}`),
    step_order: i + 1,
    node_type: n.proposed_node_type ?? null,
    measured: n.measured ?? {},
  }));
  const transitions = edges.map((e) => ({
    from: e.from ?? null,
    to: e.to ?? null,
    observations: e.observations ?? null,
  }));
  const moverRows = movers.map((m) => ({
    parameter: m.parameter ?? null,
    value: m.value ?? null,
    signature: m.signature ?? null,
    observations: m.observations ?? null,
    measured: m.measured ?? {},
  }));
  const coverage = rows.find((r) => r.kind === 'coverage') ?? {};

  try {
    const res = await pg.query<{ result: { ok?: boolean; error?: string; version?: number } }>(
      `SELECT public.propose_production_workflow_template(
         $1::text, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb) AS result`,
      [
        sourceKey,
        JSON.stringify(steps),
        JSON.stringify(transitions),
        JSON.stringify(moverRows),
        JSON.stringify(coverage),
      ]
    );
    const r = res.rows[0]?.result;
    if (r?.ok !== true) {
      logger.warn({ sourceKey, error: r?.error }, 'li-driver: process proposal refused');
      return out;
    }
    out.proposed = true;
    logger.info({ sourceKey, version: r.version, ...out }, 'li-driver: process proposed from flow map');
  } catch (err) {
    logger.warn({ sourceKey, err }, 'li-driver: process proposal failed, bundle continues');
  }
  return out;
}

/**
 * Je ta chyba TRVALÁ — tedy taková, kterou bez rozhodnutí člověka nespraví ani
 * opakování? Pak balíček patří do karantény a fronta jede dál.
 *
 * Dvě cesty, jak sem trvalá příčina dorazí, a obě musí platit:
 *  · PŘÍMO — kontext je PODMÍNKA, takže `ZdrojNeniAktivni` letí z `ingestBundle`
 *    ven bez obalu (a právě proto se nespustí ani jeden pruh);
 *  · V OBALU — kdyby ji vyhodil některý pruh, přijde zabalená s příznakem.
 * Kontrolovat jen jednu z nich by tu druhou tiše překlopilo v „přechodnou"
 * a fronta by zas stála.
 */
export function jeTrvalaPricina(err: unknown): boolean {
  return (
    err instanceof ZdrojNeniAktivni ||
    (err as { trvalaPricina?: boolean })?.trvalaPricina === true
  );
}

/**
 * Verdikt běhu. ⛔ NAMĚŘENO 2026-09-02 V PROVOZU: karanténa se počítala jako
 * selhání, takže běh, ve kterém projde 3862 položek a tři balíčky čekají na
 * rozhodnutí člověka, se hlásil jako selhaný:
 *
 *     total_syncs = 1435   failures = 1435   consecutive = 1435
 *     last_success_at = NULL   „one or more bundles failed"
 *
 * Tři balíčky ze 3.–4. 8. čekaly od té doby, a signál zdraví tím PŘESTAL
 * ROZLIŠOVAT — kdyby se ingest opravdu rozbil, `consecutive_failures` se
 * nezmění a nikdo si toho nevšimne. Karanténa je přitom NAVRŽENÉ chování
 * („fronta pokračuje"), ne porucha.
 *
 * Odložený balíček se neztratí: `karantena` ho drží jmenovitě a administrace
 * ho ukazuje. Do verdiktu tedy nepatří — patří do fronty k vyřízení.
 */
export function verdiktBehu(r: { errors: number; karantena: readonly string[] }): {
  ok: boolean;
  chyba?: string;
} {
  if (r.errors > 0) return { ok: false, chyba: 'one or more bundles failed' };
  return { ok: true };
}

export async function ingestBundle(
  pg: PgClient,
  bundle: LiBundle,
  logger: FastifyBaseLogger
): Promise<LiUpsertCounts> {
  const { dir, manifest } = bundle;
  const counts = emptyCounts();
  // ── DOSAH SELHÁNÍ: jeden pruh nesmí stát celý korpus ────────────────────────
  //
  // Naměřeno 2026-08-03: `entity_suggestions_artifact` nesl JEDEN řádek s druhem,
  // který CHECK v cíli neznal. Výjimka shodila celý `ingestBundle`, takže se
  // NEPŘEHRÁLO 44 320 dokladů — KB, chunky, vektory ani twiny, ačkoli s návrhy
  // entit nemají nic společného. Cena za jeden neznámý řetězec byl celý korpus.
  //
  // Pruhy jsou na sobě NEZÁVISLÉ (jiné tabulky, jiné RPC), takže je nezávisle
  // i pouštíme. Chyby se SBÍRAJÍ a hlásí pojmenovaně; co prošlo, zůstává
  // zapsané — všechny upserty jsou idempotentní, takže retry nic nerozdvojí.
  //
  // ⛔ KURZOR SE PŘESTO NEPOSUNE (throw na konci): kdyby postoupil, vadný pruh
  // by se už nikdy nepřehrál a chyběl by TIŠE. Rozdíl proti dnešku není „chyba
  // se promine", ale „chyba stojí jen SVŮJ pruh, ne všechny ostatní" — a po
  // opravě kontraktu doběhne retry jen to, co chybí. Výjimka je diagnostika.
  const lanePotize: { lane: string; err: unknown }[] = [];
  const pruh = async <T>(lane: string, prace: () => Promise<T>, kam: (v: T) => void) => {
    try {
      kam(await prace());
    } catch (err) {
      lanePotize.push({ lane, err });
      logger.error(
        { export_id: manifest.export_id, lane, err },
        'li-driver: pruh selhal — ostatní pruhy pokračují, kurzor se nehne'
      );
    }
  };

  // ⭐ KONTEXT JE PODMÍNKA, NE PRUH — a je to oprava dřívějšího návrhu.
  //
  // Do 2026-08-31 se resolvoval jako `pruh('story')`, tedy jeden z mnoha.
  // Pruhy jsou ZÁMĚRNĚ izolované („jeden vadný drop nesmí shodit ostatní"),
  // jenže ta izolace se uplatnila PLOŠNĚ — i na pruhy, které na kontextu
  // závisí. Nezávislost se předpokládala, neověřila.
  //
  // ⛔ Dva doložené následky (naměřeno na produkci 2026-08-30):
  //  · SPRÁVNOST — z NEAUTORIZOVANÉHO zdroje dosedlo 854 vazeb a 615 návrhů
  //    entit. Fail-closed chránil jen `story`, `registry` a `kb`; zbytek prošel.
  //  · ŽIVOST — pruh vektorů běžel i pro balíček, který dosednout nemůže,
  //    a 70 minut přepisoval 40 tisíc existujících řádků. Tik proto nikdy
  //    nedoběhl, a protože se o karanténě rozhoduje AŽ NA JEHO KONCI, fronta
  //    stála na 11 z 16 balíčků celé hodiny.
  //
  // Bez kontextu nemá balíček co dosednout — ani zčásti. Proto se resolvuje
  // PŘED prvním pruhem a při trvalé poruše se vyhodí OKAMŽITĚ: nespustí se nic,
  // karanténa padne za sekundy a fronta jede dál.
  const storyId: string = await resolveSourceStory(pg, manifest, logger);

  // Evidence layer — thin 1:1 batch upserts (the RPC computes dedup keys).
  // Registru se kontext DOSAZUJE tady, ne v enginu: engine neví, jaká story
  // ve světě právě je. Bez kontextu se řádek pořád zapíše (sloupec je NULL-able)
  // — evidence dokladu je hodnotná i bez zařazení a nemá padat s ním.
  await pruh('registry', () => upsertBatch(
    pg, 'li_upsert_source_registry',
    readJsonl(path.join(dir, 'registry_artifact.jsonl'))
      .map((r) => ({ ...r, story_id: storyId })),
    manifest,
    logger
  ), (v) => { counts.registry = v; });
  await pruh('links', () => upsertBatch(
    pg, 'li_upsert_links', readJsonl(path.join(dir, 'links_artifact.jsonl')), manifest
  ), (v) => { counts.links = v; });
  await pruh('findings', () => upsertBatch(
    pg, 'li_upsert_findings', readJsonl(path.join(dir, 'findings_artifact.jsonl')), manifest
  ), (v) => { counts.findings = v; });
  await pruh('obligations', () => upsertBatch(
    pg, 'li_upsert_obligations', readJsonl(path.join(dir, 'obligations_artifact.jsonl')), manifest
  ), (v) => { counts.obligations = v; });
  await pruh('entity_suggestions', () => upsertBatch(
    pg, 'li_upsert_entity_suggestions',
    readJsonl(path.join(dir, 'entity_suggestions_artifact.jsonl')), manifest
  ), (v) => { counts.entitySuggestions = v; });
  // Vazby. Engine je odvozoval a driver je NEČETL — naměřeno 2026-08-30:
  // 345 odvozených vztahů, a přitom `graph_nodes` i `graph_edges` nula řádků.
  // Síť, ze které má story vznikat, se zahazovala u dveří.
  //
  // Oba artefakty míří do JEDNÉ tabulky a rozlišuje je `record_type` — druh je
  // vlastnost, ne výčet (sesterská tabulka na uzavřeném výčtu padla třikrát).
  // Zůstávají NÁVRHEM: engine oba razítkuje `advisory`, vazbu otevře ratifikace.
  await pruh('relations', () => upsertBatch(
    pg, 'li_upsert_relation_suggestions',
    [
      ...readJsonl(path.join(dir, 'entity_relation_artifact.jsonl')),
      ...readJsonl(path.join(dir, 'relation_proposal_artifact.jsonl')),
    ],
    manifest
  ), (v) => { counts.relations = v; });

  // Optional artifact: a bundle that declares no runs simply opens none.
  const runRows = readJsonl(path.join(dir, 'workflow_runs_artifact.jsonl'));
  if (runRows.length > 0) {
    const opened = await openWorkflowRuns(pg, runRows, logger);
    logger.info({ declared: runRows.length, opened }, 'li-driver: workflow runs opened');
  }

  // Optional artifact: measured flow-map proposals (nodes land inactive,
  // edges stay evidence — see proposeFlowNodes for why).
  const flowRows = readJsonl(path.join(dir, 'flow_map_artifact.jsonl'));
  const nodeRows = flowRows.filter((r) => r.kind === 'node');
  if (nodeRows.length > 0) {
    const proposed = await proposeFlowNodes(pg, nodeRows, logger);
    logger.info(
      { declared: nodeRows.length, proposed, other_rows: flowRows.length - nodeRows.length },
      'li-driver: flow nodes proposed'
    );
    // …and the same map as ONE process proposal, so the edges and mover
    // signatures stop being rows nobody can reach (see proposeFlowProcess).
    await proposeFlowProcess(pg, flowRows, LI_SOURCE_SLUG, logger);
  }

  // Two vocabularies meet here. The ingest engine tags content with IETF
  // language tags ("cs-CZ"); the platform's supported_languages table keys on
  // bare ISO-639-1 codes ("cs", "en", … plus "global"). Neither side is wrong —
  // the translation belongs at the seam, and this adapter IS the seam. Without
  // it every KB write failed on knowledge_items_locale_fkey and the whole bundle
  // was refused (first end-to-end replay, 2026-07-20: 4403 rows tagged cs-CZ
  // against a table that only knows cs).
  //
  // The region is dropped, not guessed: cs-CZ and cs-SK are both Czech content
  // to a table that does not model regions. If even the base language is unknown
  // to this deployment we do NOT quietly fall back to 'global' — that would file
  // Czech contracts under a locale nobody searches. Fail loud instead.
  const supportedLocales = new Set(
    (await pg.query<{ code: string }>('SELECT code FROM public.supported_languages')).rows.map(
      (r) => r.code
    )
  );
  const normalizeLocale = (raw: unknown): string => {
    const tag = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'global';
    if (supportedLocales.has(tag)) return tag;
    const base = tag.split(/[-_]/)[0]!.toLowerCase();
    if (supportedLocales.has(base)) return base;
    throw new Error(
      `bundle uses locale "${tag}" which this deployment does not support ` +
        `(supported_languages: ${[...supportedLocales].sort().join(', ')})`
    );
  };

  // KB layer — reuse the existing audited RPCs. Each kb_emit row carries a
  // knowledge_item (1:1 p_* params) + chunks (1:1 p_* params). Vektory v tomhle
  // záznamu NEJSOU — vozí je `embeddings_artifact.jsonl` a zapisují se níž
  // (replayEmbeddings), protože kb_artifact vzniká dřív než embed fáze.
  //
  // Vlastní pruh: KB je nejdražší část replaye a nesmí padat kvůli cizí vrstvě
  // (ani naopak). Co se stihlo zapsat, zůstává — RPC jsou idempotentní přes slug.
  await pruh('kb', async () => {
  // Kořen kontextu se RESOLVUJE z identity zdroje — nebere se z balíčku.
  //
  // Dřív ho vezl každý řádek jako `p_story_id`, což bylo UUID vypsané do
  // `impl.json`. Takový balíček nepřežije přestavbu DB: naměřeno 2026-08-30,
  // 3 822 řádků mířilo na story, která má v databázi NULA řádků, a replay se
  // o ni zastavil. Twins tutéž přestavbu přežívají, protože jsou klíčované
  // identitou, ne UUID — tohle je táž oprava, jen o vrstvu výš.
  //
  // Fail-closed zůstává: neregistrovaný zdroj shodí TENTO pruh (a jen jeho),
  // obsah bez kontextu se nezapíše. Nejistota se neobchází výchozí hodnotou.
  for (const rec of readJsonl(path.join(dir, 'kb_artifact.jsonl'))) {
    const item = (rec.knowledge_item ?? {}) as Record<string, unknown>;
    // Identitu zdroje balíček VEZE — a driver ji předá. Dřív se zahazovala
    // (volalo se s p_id = NULL a bez provenience), takže každý replay téhož
    // balíčku vyrobil další kopii a záznam spadl na source_type='manual'
    // s prázdným slugem — obě strukturální pojistky platformy proti duplicitě
    // tím zůstaly bez opory. Naměřeno 2026-07-30: 137 097 duplicit z 217 160
    // položek. Se slugem si RPC existující záznam NAJDE a jde UPDATE větví.
    const itemRes = await pg.query<{ id: string }>(
      `SELECT public.upsert_story_knowledge_item_audited(
         $1::uuid, NULL::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
         $7::text[], NULL::text, $8::text, $9::text, $10::text, $11::text, $12::text
       ) AS id`,
      [
        storyId,
        item.p_title ?? null,
        item.p_body_markdown ?? null,
        // Fallback dřív mlčky přiřadil 'engineering_doc' KAŽDÉ položce bez typu
        // — 264 tis. dokladů korpusu (dodáky, jízdy, faktury) tak stálo vedle
        // vlastní dokumentace platformy. Skutečná třída je v p_category; korpus
        // z local-ingestu je doménový obsah → 'domain_doc' (týž závěr, k jakému
        // došla approve_story_promotion pro story obsah). engineering_doc zbývá
        // jen položkám, které kategorii nenesou vůbec.
        item.p_item_type ?? (item.p_category ? 'domain_doc' : 'engineering_doc'),
        item.p_summary ?? null,
        item.p_category ?? null,
        (item.p_ai_context_tags as string[] | undefined) ?? [],
        item.p_visibility ?? 'private',
        normalizeLocale(item.p_locale),
        (item.source_type as string | undefined) ?? null,
        (item.source_slug as string | undefined) ?? null,
        (item.source_hash as string | undefined) ?? null,
      ]
    );
    const itemId = itemRes.rows[0]?.id;
    counts.kbItems += 1;

    const chunks = (rec.chunks as Record<string, unknown>[] | undefined) ?? [];
    // ── PŘESKLÁDÁNÍ ──────────────────────────────────────────────────────────
    // Chunky se tu drží po POZICI (knowledge_item_id, chunk_index, locale) a
    // insert_knowledge_chunk řádek se změněným obsahem PŘEPÍŠE NA MÍSTĚ — vektor
    // (knowledge_embeddings.chunk_id, bez FK i triggeru) by pak zůstal u JINÉHO
    // textu. Rozdělení jednoho úseku posune indexy všech dalších (naměřeno na riq
    // 2026-09-29: 2 527 úseků přes strop embedderu → 5 216 kusů); totéž nová verze
    // dokumentu. Když se rozložení liší, dokument se přeskládá: staré chunky i vektory
    // pryč, zápis znovu — JEDNOU transakcí, aby pád mezi smazáním a zápisem nenechal
    // dokument bez chunků (ROLLBACK; kurzor se nepohne, opakovaný běh ho dotáhne).
    // Engine vektory takového dokumentu odveze celé znovu (vector_store.relayout).
    const preskladat = !!itemId && (await rozlozeniSeZmenilo(pg, itemId, chunks, normalizeLocale));
    if (preskladat) await pg.query('BEGIN');
    try {
      if (preskladat) {
        for (const loc of new Set(chunks.map((ch) => normalizeLocale(ch.p_locale)))) {
          await pg.query('SELECT public.clear_knowledge_item_chunks($1::uuid, $2::text)', [itemId, loc]);
        }
      }
      for (const ch of chunks) {
        const prov = (ch.provenance ?? {}) as Record<string, unknown>;
        await pg.query(
          `SELECT public.insert_knowledge_chunk(
             $1::integer, $2::text, $3::uuid, $4::text, $5::text, $6::integer,
             $7::text, $8::text, $9::integer, $10::integer
           )`,
          [
            ch.p_chunk_index ?? null,
            ch.p_chunk_text ?? null,
            itemId,
            ch.p_section_title ?? null,
            ch.p_source_field ?? 'body',
            ch.p_token_count ?? null,
            normalizeLocale(ch.p_locale),
            ch.source_hash ?? null,
            prov.char_start ?? null,
            prov.char_end ?? null,
          ]
        );
        counts.kbChunks += 1;
      }
      if (preskladat) {
        await pg.query('COMMIT');
        counts.kbItemsRelaid += 1;
      }
    } catch (err) {
      if (preskladat) await pg.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
  }, () => { /* počty se zvyšují uvnitř smyčky, aby přežily i částečný průchod */ });

  // ── Vektory z bundlu ──────────────────────────────────────────────────────
  // Přebírají se, NEPOČÍTAJÍ se znovu: přeembedování téhož korpusu stojí na
  // tomhle stroji 8,74 s na chunk (~14,5 dne na 143 tis. chunků), zatímco
  // ingest je spočítal na MLX při běhu, který bundle vyrobil.
  //
  // Soubor je VOLITELNÝ: starší bundly ho nemají a to není chyba — jen pro ně
  // zůstane vektorová vrstva prázdná, dokud se nepřegenerují.
  await pruh('embeddings', () => replayEmbeddings(pg, dir, logger),
    (v) => { counts.kbEmbeddings = v; });

  // Twin lane LAST: the evidence upserts above are the bundle's contract, and a
  // twin proposal is additive. Ordering it here means a catalog gap can never cost
  // the bundle its li_* rows.
  await pruh('twin_proposals', () => proposeTwinsFromProfiles(pg, bundle, logger),
    (v) => { counts.twinProposals = v; });
  // The DECIDED half of the same lane: signed merges + measured identifications.
  await pruh('promotions', () => replayPromotions(pg, bundle, logger),
    (v) => { counts.promotions = v; });
  // CRM lanes (2026-09-06): links with twins on both ends → twin_relations;
  // communication documents + touch:* links → twin_events. Both resolve twins
  // ONLY through confirmed primary_id refs and defer the rest (see crm-lanes.ts).
  // Label pruhu je i jeho jméno v logu a v `lanePotize` — dvakrát 'relations'
  // by selhání jednoho z nich nešlo odlišit od druhého.
  await pruh('twinRelations', () => openRelationsFromLinks(pg, bundle, logger),
    (v) => { counts.twinRelations = v; });
  await pruh('touches', () => recordTouchesAsEvents(pg, bundle, logger),
    (v) => { counts.touches = v; });

  // ── ROZPORY STARŠÍCH TVRZENÍ × ČERSTVÉ DERIVACE ────────────────────────────
  // Nové doklady mění to, co z nich plyne — a starší tvrzení o týchž věcech tím
  // buď potvrdí, nebo zestárne. Ten rozdíl je NÁLEZ, ne chyba: patří do
  // rozhodovacího kanálu jako otázka s oběma stranami, ne do logu.
  //
  // Proto se počítá TADY: hned po replayi, kdy jsou fakta nejčerstvější. Kdyby
  // se spouštěl ručně, měřil by se stav, který si někdo vyžádal — a „kolik jsme
  // se za tenhle běh naučili" by nešlo říct vůbec.
  //
  // Konfigurace je DATA (vzory nájemních položek zná instance, ne platforma);
  // bez ní funkce nic nederivuje a řekne to. Vlastní pruh: je to nadstavba nad
  // evidencí, takže její selhání nesmí stát doklady, ale ani zmizet.
  const rentCfg = process.env.LI_RENT_CLAIM_CHECK_PARAMS;
  if (rentCfg) {
    await pruh('rent_claim_contradictions', async () => {
      const res = await pg.query<{ out: unknown }>(
        'SELECT public.emit_rent_claim_contradictions($1::jsonb) AS out', [rentCfg]
      );
      return res.rows[0]?.out ?? null;
    }, (v) => {
      // Kotva (shodující se případy) je podmínka důvěryhodnosti celého nálezu:
      // bez ní nejde říct, jestli rozdíly ukazují stárnutí dat, nebo vadu
      // derivace. Proto se loguje CELÝ souhrn, ne jen počet otázek.
      logger.info({ export_id: manifest.export_id, rent_claims: v },
        'li-driver: rozpory tvrzení × derivace vydány jako otázky');
    });
  }
  if (counts.promotions.bridged > 0) {
    // Nahlas: most, který si driver doplnil sám, je stopa po tom, že instanční
    // data běžela dřív než data, na která se vážou (typicky po cold startu).
    logger.info(
      { export_id: bundle.manifest.export_id, ...counts.promotions },
      'li-driver: most identity doplněn za běhu — instanční SQL běželo před daty'
    );
  }

  // ── CO BALÍČEK VEZE A NIKDO NEČTE ──────────────────────────────────────────
  // Univerzum se tu nepíše rukou: balíček SÁM říká, co veze (`manifest.files`),
  // takže měřidlo nemůže minout artefakt, o kterém neví.
  //
  // Nekonzumovaný artefakt NENÍ důvod balíček odmítnout — uzavřený kontrakt mezi
  // enginem a platformou už jednou zastavil replay 44 320 dokladů kvůli jedinému
  // neznámému řádku. Ale ani ticho: přesně takhle se 345 odvozených VZTAHŮ
  // zahazovalo u dveří, aniž by kdekoli vznikla chyba (naměřeno 2026-08-30 —
  // `graph_nodes` i `graph_edges` nula řádků). Ticho se četlo jako „vše prošlo".
  const nekonzumovane = manifest.files.filter(
    (f) => f.name.endsWith('.jsonl') && f.records > 0 && !KONZUMOVANE_ARTEFAKTY.has(f.name)
  );
  if (nekonzumovane.length > 0) {
    logger.warn(
      {
        export_id: manifest.export_id,
        artefakty: nekonzumovane.map((f) => `${f.name}:${f.records}`),
      },
      'li-driver: balíček veze artefakty, které nikdo nečte — odvozená data se zahazují'
    );
  }

  // ── ENGINE HLÁSÍ SELHÁNÍ EMBEDDERU ─────────────────────────────────────────
  // Balíček se NEODMÍTÁ: úseky a evidence jsou jeho kontrakt, vektory přídavek.
  // Ale nesmí to být ticho — `kbEmbeddings: 0` samo nerozliší rozbitý embedder
  // od běhu bez nových vektorů. Stav jde i do sync-state (správa zdroje).
  if (manifest.embed?.degraded) {
    logger.warn(
      {
        export_id: manifest.export_id,
        embed: {
          backend: manifest.embed.backend ?? null,
          model: manifest.embed.model ?? null,
          error: manifest.embed.error ?? null,
          export_error: manifest.embed.export_error ?? null,
          pending: manifest.embed.pending ?? null,
        },
      },
      'li-driver: engine hlásí selhání embedderu — úseky dosednou BEZ vektorů, vektorové vyhledávání je nenajde'
    );
  }

  // ── VYHODNOCENÍ PRUHŮ ──────────────────────────────────────────────────────
  // Co prošlo, JE ZAPSANÉ (idempotentně) — a to je celý rozdíl proti dřívějšku,
  // kdy první výjimka zahodila i práci pruhů, které s ní nesouvisely. Kurzor se
  // ale nehne, takže vadný pruh se po opravě kontraktu dohraje retry; mlčky
  // chybět nemůže. Chyba nese JMÉNA pruhů, ne jen první hlášku — jinak se
  // z logu nepozná, jestli padl jeden pruh, nebo všechny.
  if (lanePotize.length > 0) {
    logger.warn(
      { export_id: manifest.export_id, counts, failed_lanes: lanePotize.map((p) => p.lane) },
      'li-driver: bundle ČÁSTEČNĚ přehrán — úspěšné pruhy zapsány, kurzor držen'
    );
    const detail = lanePotize
      .map((p) => `${p.lane}: ${p.err instanceof Error ? p.err.message : String(p.err)}`)
      .join(' | ');
    const trvala = lanePotize.find((p) => p.err instanceof ZdrojNeniAktivni)?.err as
      | ZdrojNeniAktivni
      | undefined;
    const chyba = new Error(
      `li-driver: bundle '${manifest.export_id}' — ${lanePotize.length} z pruhů selhalo `
      + `(${lanePotize.map((p) => p.lane).join(', ')}); ostatní pruhy zapsány, kurzor držen. ${detail}`
    );
    // Příznak putuje ven s chybou: rozhodnutí „držet kurzor vs. karanténa" patří
    // smyčce nad balíčky, ne sem — tady se jen NEZTRATÍ, co je příčinou.
    if (trvala) Object.assign(chyba, { trvalaPricina: true, sourceSlug: trvala.sourceSlug });
    throw chyba;
  }

  counts.pokryti = await zmerPokrytiVektoru(pg, storyId, manifest.export_id, logger);
  logger.info({ export_id: manifest.export_id, counts }, 'li-driver: bundle ingested');
  return counts;
}

/**
 * Kolik chunků zdroje NEMÁ vektor pod modelem, kterým platforma kóduje dotazy (prostor v1).
 *
 * Druhý, nezávislý svědek vedle `manifest.embed.complete` od enginu: engine ví, co odvezl,
 * ale ne, co v DB opravdu je (balíček ztracený v dopravě, přeskládání, obnova DB). Chunk
 * bez vektoru živého modelu vektorové vyhledávání NENAJDE — počet musí být vidět ve stavu
 * zdroje, ne tiše. Měření, ne kontrakt: selhání balíček neshodí (null + varování).
 */
export async function zmerPokrytiVektoru(
  pg: PgClient,
  storyId: string,
  exportId: string,
  logger: FastifyBaseLogger
): Promise<LiPokrytiVektoru | null> {
  try {
    // Živá identita = JEDINÝ domov public.fn_ziva_identita_v1() — TÁŽ, kterou čte dopočet
    // (fn_get_chunks_needing_v1); `<formát>:<sha>` vah z deklarace instance, ne napevno gguf.
    // Nedeklarovaný pin/formát tam selže s návodem → NEZMĚŘENO (catch níž). Bez modelu v1
    // jeden řádek s null (LEFT JOIN), aby se úseky dál počítaly (vše „jiný model“).
    const res = await pg.query<LiPokrytiStavy & { model: string | null; identita: string | null; trida: string }>(
      `WITH p AS (SELECT z.model_id AS model, z.identita
                    FROM (SELECT 1) j LEFT JOIN public.fn_ziva_identita_v1() z ON true)
       SELECT p.model, p.identita, coalesce(ki.category, '?') AS trida,
              count(*)::int AS useku,
              (count(*) FILTER (WHERE e.stav = 'zivy'))::int AS zivy,
              (count(*) FILTER (WHERE e.stav = 'stary_runtime'))::int AS stary_runtime,
              (count(*) FILTER (WHERE e.stav = 'jiny_model'))::int AS jiny_model,
              (count(*) FILTER (WHERE e.stav IS NULL AND v.chunk_id IS NOT NULL))::int AS nad_limitem,
              (count(*) FILTER (WHERE e.stav IS NULL AND v.chunk_id IS NULL))::int AS bez_vektoru
         FROM public.knowledge_chunks kc
         JOIN public.knowledge_items ki ON ki.id = kc.knowledge_item_id
        CROSS JOIN p
         LEFT JOIN LATERAL (
              SELECT CASE
                       WHEN ke.model = p.model AND p.identita IS NOT NULL
                        AND split_part(coalesce(ke.model_version, ''), ';', 1) = p.identita THEN 'zivy'
                       WHEN ke.model = p.model THEN 'stary_runtime'
                       ELSE 'jiny_model'
                     END AS stav
                FROM public.knowledge_embeddings ke
               WHERE ke.chunk_id = kc.id AND ke.locale = kc.locale
               LIMIT 1) e ON true
         LEFT JOIN public.knowledge_embedding_vynechani v
                ON v.chunk_id = kc.id AND v.locale = kc.locale AND v.identita = p.identita
        WHERE ki.story_id = $1::uuid
        GROUP BY p.model, p.identita, 3
        ORDER BY 3`,
      [storyId]
    );
    const rows = res.rows ?? [];
    const STAVY = ['useku', 'zivy', 'stary_runtime', 'jiny_model', 'nad_limitem', 'bez_vektoru'] as const;
    const soucet = (): LiPokrytiStavy =>
      Object.fromEntries(STAVY.map((k) => [k, rows.reduce((a, r) => a + (r[k] ?? 0), 0)])) as unknown as LiPokrytiStavy;
    const tridy: LiPokrytiVektoru['tridy'] = {};
    for (const r of rows) {
      tridy[r.trida] = Object.fromEntries(STAVY.map((k) => [k, r[k] ?? 0])) as unknown as LiPokrytiStavy;
    }
    return {
      model: rows[0]?.model ?? null,
      identita: rows[0]?.identita ?? null,
      ...soucet(),
      tridy,
      export_id: exportId,
    };
  } catch (err) {
    logger.warn({ export_id: exportId, err: errMessage(err) }, 'li-driver: pokrytí vektory NEZMĚŘENO');
    return null;
  }
}

/**
 * Balíčky v KARANTÉNĚ — evidence, ne zapomnění.
 *
 * Kurzor je VODOZNAK: co je pod ním, se už znovu nenabídne. Kdyby se
 * nezpracovatelný balíček jen přeskočil, zmizel by navždy. Karanténa ho proto
 * drží JMENOVITĚ a smyčka ho zkouší dál — jakmile člověk zdroj aktivuje,
 * projde sám a z karantény vypadne. Bez ručního zásahu.
 */
async function readKarantena(pg: PgClient): Promise<Set<string>> {
  try {
    const res = await pg.query<{ karantena: string[] | null }>(
      `SELECT ARRAY(SELECT jsonb_array_elements_text(
                 COALESCE(metadata->'karantena', '[]'::jsonb))) AS karantena
         FROM public.audience_broker_sync_state
        WHERE source_slug = $1`,
      [LI_SOURCE_SLUG]
    );
    return new Set(res.rows[0]?.karantena ?? []);
  } catch {
    return new Set();   // bez stavu se prostě nic nekarantenuje
  }
}

/**
 * Liší se uložené rozložení chunků dokumentu (locale, index, source_hash) od balíčku?
 * Nový dokument (nic uloženo) = ne — není co přeskládat.
 */
export async function rozlozeniSeZmenilo(
  pg: PgClient,
  itemId: string,
  chunks: Record<string, unknown>[],
  normalizeLocale: (raw: unknown) => string
): Promise<boolean> {
  const res = await pg.query<{ chunk_index: number; source_hash: string | null; locale: string }>(
    `SELECT chunk_index, source_hash, locale
       FROM public.knowledge_chunks
      WHERE knowledge_item_id = $1::uuid
      ORDER BY locale, chunk_index`,
    [itemId]
  );
  const ulozene = res.rows ?? [];
  if (ulozene.length === 0) return false;
  const klic = (l: string, i: unknown, h: unknown) => `${l}|${String(i)}|${h ?? ''}`;
  const a = ulozene.map((r) => klic(r.locale, r.chunk_index, r.source_hash)).sort();
  const b = chunks
    .map((ch) => klic(normalizeLocale(ch.p_locale), ch.p_chunk_index, ch.source_hash))
    .sort();
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}

/**
 * Stav vektorů z minulého tiku. Metadata se každým tikem přepisují CELÁ, takže tik
 * bez balíčku by jinak stav smazal — a správa zdroje by ukázala „nic", právě když
 * embedder dál selhává.
 */
async function readEmbedStav(pg: PgClient): Promise<LiIngestResult['embed']> {
  try {
    const res = await pg.query<{ embed: LiIngestResult['embed'] }>(
      `SELECT metadata->'embed' AS embed
         FROM public.audience_broker_sync_state
        WHERE source_slug = $1`,
      [LI_SOURCE_SLUG]
    );
    return res.rows[0]?.embed ?? null;
  } catch {
    return null;
  }
}

/** Pokrytí vektory z minulého tiku (metadata se přepisují celá — tik bez balíčku ho přenese). */
async function readPokryti(pg: PgClient): Promise<LiPokrytiVektoru | null> {
  try {
    const res = await pg.query<{ p: LiPokrytiVektoru | null }>(
      `SELECT metadata->'pokryti_vektoru' AS p
         FROM public.audience_broker_sync_state
        WHERE source_slug = $1`,
      [LI_SOURCE_SLUG]
    );
    return res.rows[0]?.p ?? null;
  } catch {
    return null;
  }
}

/** Read the driver's last processed export_id from its sync-state row. */
async function readCursor(pg: PgClient): Promise<string | null> {
  try {
    const res = await pg.query<{ last_export_id: string | null }>(
      `SELECT metadata->>'last_export_id' AS last_export_id
         FROM public.audience_broker_sync_state
        WHERE source_slug = $1`,
      [LI_SOURCE_SLUG]
    );
    return res.rows[0]?.last_export_id ?? null;
  } catch {
    return null; // no row yet → cold start (process every discovered bundle)
  }
}

/**
 * Persist the tick outcome + advanced cursor via the SAME audited sync-state RPC
 * the engagement scheduler uses (the broker writer role has no UPDATE grant on
 * the table — this RPC is the only path). The cursor rides in metadata.
 */
async function persistCursor(
  pg: PgClient,
  startedAt: Date,
  finishedAt: Date,
  ok: boolean,
  errorMessage: string | undefined,
  result: LiIngestResult
): Promise<void> {
  try {
    await pg.query(
      `SELECT public.audience_broker_record_sync(
         $1::text, $2::timestamptz, $3::timestamptz, $4::boolean,
         $5::text, $6::integer, $7::integer, $8::jsonb
       )`,
      [
        LI_SOURCE_SLUG,
        startedAt.toISOString(),
        finishedAt.toISOString(),
        ok,
        errorMessage ?? null,
        result.bundlesSeen,
        result.bundlesIngested,
        JSON.stringify({
          last_export_id: result.cursorExportId,
          // Karanténa MUSÍ přežít restart: kurzor je vodoznak a bez tohoto
          // seznamu by odložený balíček po restartu zmizel pod ním navždy.
          karantena: result.karantena,
          counts: result.counts,
          errors: result.errors,
          embed: result.embed ?? null,
          pokryti_vektoru: result.pokryti ?? null,
        }),
      ]
    );
  } catch (err) {
    // Non-fatal: the cursor also lives in-memory for this process lifetime.
    // Next tick re-reads from the DB; on failure it may re-see a bundle, which
    // the idempotent RPCs absorb harmlessly.
    void err;
  }
}

export interface LiDriverHandle {
  /** Run one ingestion tick (used by the loop + testable in isolation). */
  ingestOnce(): Promise<LiIngestResult>;
  start(): void;
  stop(): void;
}

/**
 * Create the li-driver. Independent of the engagement scheduler (different
 * source, different cadence, different failure domain) — one bad drop never
 * touches the source drain and vice-versa. Off unless a drop dir is configured,
 * so the local-ingest capability is OPTIONAL exactly like a missing plugin.
 */
export function createLiDriver(
  config: SourceBrokerConfig,
  logger: FastifyBaseLogger
): LiDriverHandle {
  let timer: NodeJS.Timeout | null = null;
  let inflight = false;
  // Normalise the optional interval once — undefined means disabled (0).
  const intervalMs = config.localIngestIntervalMs ?? 0;

  async function ingestOnce(): Promise<LiIngestResult> {
    const result: LiIngestResult = {
      bundlesSeen: 0,
      bundlesIngested: 0,
      karantena: [],
      cursorExportId: null,
      counts: emptyCounts(),
      errors: 0,
    };
    const dropDir = config.localIngestDropDir;
    if (!dropDir) return result; // not configured → no-op

    const startedAt = new Date();
    const pg = new PgClient({
      connectionString: config.postgresUrl,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 60_000,
      query_timeout: 60_000,
    });
    let tickError: string | undefined;
    try {
      await pg.connect();
      // Present this connection as service_role, in BOTH the forms the RPCs
      // check. A direct libpq connection carries no JWT, so without this the
      // driver read every bundle correctly and was refused at the write.
      //
      // Two guard styles exist in the schema and they do NOT accept the same
      // evidence, which is why one of these alone is not enough:
      //   public.is_service_role()  → JWT claim OR session role
      //   the stricter RPCs         → JWT claim ONLY, i.e.
      //       current_setting('request.jwt.claims')::jsonb->>'role'
      // Setting only the role got past the first guard and then failed the
      // second with "Service role required" (first end-to-end replay).
      //
      // Claims first, then the role: once the session is service_role it may no
      // longer be permitted to set the GUC. Both are session-scoped and die with
      // the connection, which this tick opens and closes itself.
      await pg.query(`SET request.jwt.claims = '{"role":"service_role"}'`);
      await pg.query('SET ROLE service_role');
      const cursor = await readCursor(pg);
      result.cursorExportId = cursor;

      const karantena = await readKarantena(pg);
      result.embed = await readEmbedStav(pg);
      result.pokryti = await readPokryti(pg);
      // Nad kurzorem SJEDNOCENO s karanténou: zablokovaný balíček se pod kurzor
      // dostane, jakmile ho pozdější úspěchy přeskočí — a bez tohohle sjednocení
      // by se pak už nikdy nenabídl, i kdyby zdroj mezitím někdo aktivoval.
      const bundles = discoverBundles(dropDir).filter(
        (b) =>
          cursor === null
          || b.manifest.export_id.localeCompare(cursor) > 0
          || karantena.has(b.manifest.export_id)
      );
      result.bundlesSeen = bundles.length;

      for (const bundle of bundles) {
        try {
          // Drift canary: an engine_version we don't expect could mean the
          // artifact schema moved under us. We record it but proceed — the
          // artifact fields are additive-stable; a HARD mismatch surfaces as an
          // RPC/shape error below and stops the cursor at the last good bundle.
          assertBundleTrusted(bundle);
          const c = await ingestBundle(pg, bundle, logger);
          result.counts.registry += c.registry;
          result.counts.findings += c.findings;
          result.counts.links += c.links;
          result.counts.obligations += c.obligations;
          result.counts.entitySuggestions += c.entitySuggestions;
          result.counts.relations += c.relations;
          result.counts.kbItems += c.kbItems;
          result.counts.kbChunks += c.kbChunks;
          if (c.pokryti !== undefined) result.pokryti = c.pokryti;
          // Advance the cursor ONLY after a whole manifest succeeds.
          result.cursorExportId = bundle.manifest.export_id;
          // Starší engine stav vektorů nehlásí → null = „neví", ne „v pořádku".
          result.embed = bundle.manifest.embed
            ? { export_id: bundle.manifest.export_id, ...bundle.manifest.embed }
            : null;
          result.bundlesIngested += 1;
          // Prošel — z karantény ven. Aktivace zdroje ho tím vyřeší sama.
          if (karantena.delete(bundle.manifest.export_id)) {
            logger.info(
              { export_id: bundle.manifest.export_id },
              'li-driver: balíček z karantény prošel — příčina byla odstraněna'
            );
          }
        } catch (err) {
          // ⛔ NAMĚŘENO 2026-09-02 V PROVOZU: `errors` se zvyšovalo JEŠTĚ PŘED
          // rozlišením trvalé příčiny, takže balíček odložený DO KARANTÉNY —
          // tedy podle návrhu, „fronta pokračuje" — se počítal jako selhání
          // běhu. Tři balíčky ze 3.–4. 8. čekají na rozhodnutí člověka, a proto:
          //
          //     total_syncs = 1435   failures = 1435   consecutive = 1435
          //     last_success_at = NULL   „one or more bundles failed"
          //
          // Běh, ve kterém projde 3862 položek a tři čekají na člověka, se hlásil
          // jako selhaný. Zdravotní signál tím PŘESTAL ROZLIŠOVAT: kdyby se
          // ingest opravdu rozbil, `consecutive_failures` se nezmění a nikdo si
          // toho nevšimne. Táž třída jako „nezměřeno se vydává za nález".
          //
          // Inkrement se proto přesouvá za rozlišení: karanténa má vlastní
          // evidenci (`result.karantena`) a do `errors` nepatří.
          // Dvě cesty, jak sem trvalá příčina dorazí, a obě musí platit:
          //  · PŘÍMO — kontext je teď PODMÍNKA, takže `ZdrojNeniAktivni` letí
          //    z `ingestBundle` ven bez obalu (a právě proto se nespustí
          //    ani jeden pruh);
          //  · V OBALU — kdyby ji v budoucnu vyhodil některý pruh, přijde
          //    zabalená v souhrnné chybě s příznakem.
          // Kontrolovat jen jednu z nich by tu druhou tiše překlopilo
          // v „přechodnou" a fronta by zas stála.
          if (jeTrvalaPricina(err)) {
            // ⭐ TRVALÁ příčina: bez rozhodnutí člověka se nespraví. Držet na ní
            // kurzor znamená zastavit frontu na neurčito — naměřeno 2026-08-30,
            // jeden balíček zablokoval zbylých pět. Do karantény a jede se dál;
            // ztratit se nemůže, evidence ho drží jmenovitě.
            karantena.add(bundle.manifest.export_id);
            logger.warn(
              {
                export_id: bundle.manifest.export_id,
                source_slug: (err as { sourceSlug?: string })?.sourceSlug,
                err: errMessage(err),
              },
              'li-driver: balíček do KARANTÉNY — zdroj čeká na rozhodnutí člověka; fronta pokračuje'
            );
            continue;
          }
          // Až sem dojde jen NEČEKANÉ selhání — to se počítá.
          result.errors += 1;
          // Přechodná porucha (spadlá DB, utržené spojení) pomine sama —
          // kurzor drží, aby se nevznikla mezera, a příští tik to zopakuje.
          logger.error(
            { export_id: bundle.manifest.export_id, err: errMessage(err) },
            'li-driver: bundle refused/failed — cursor held at last good export'
          );
          break;
        }
      }

      result.karantena = [...karantena].sort();
      if (result.karantena.length > 0) {
        logger.warn(
          { karantena: result.karantena },
          'li-driver: balíčky v karanténě čekají na rozhodnutí — fronta jede dál'
        );
      }

      const finishedAt = new Date();
      const verdikt = verdiktBehu(result);
      await persistCursor(pg, startedAt, finishedAt, verdikt.ok, verdikt.chyba, result);
      logger.info(
        { seen: result.bundlesSeen, ingested: result.bundlesIngested, cursor: result.cursorExportId },
        'li-driver: tick complete'
      );
      return result;
    } catch (err) {
      tickError = errMessage(err);
      result.errors += 1;
      logger.error({ err: tickError }, 'li-driver: tick failed');
      const finishedAt = new Date();
      await persistCursor(pg, startedAt, finishedAt, false, tickError, result);
      return result;
    } finally {
      await pg.end().catch(() => undefined);
    }
  }

  function scheduleNext(): void {
    if (intervalMs <= 0) return;
    timer = setTimeout(() => {
      runGuarded()
        .catch(() => undefined)
        .finally(() => scheduleNext());
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function runGuarded(): Promise<void> {
    if (inflight) {
      logger.warn('li-driver: skipping tick (previous still inflight)');
      return;
    }
    inflight = true;
    try {
      await ingestOnce();
    } finally {
      inflight = false;
    }
  }

  return {
    ingestOnce,
    start(): void {
      if (timer) return;
      if (!config.localIngestDropDir) {
        logger.info('li-driver: disabled (LOCAL_INGEST_DROP_DIR unset)');
        return;
      }
      if (intervalMs <= 0) {
        logger.info('li-driver: disabled (LOCAL_INGEST_INTERVAL_MS=0)');
        return;
      }
      logger.info(
        { dropDir: config.localIngestDropDir, intervalMs },
        'li-driver: starting pull-from-drop loop'
      );
      // Drain once NOW, then on the interval. Scheduling only the timer meant a
      // broker that came up with a full drop sat idle for a whole interval — 24 h
      // by default — and because the timer restarts with the process, a stack
      // that redeploys daily would never drain the drop at all. Bundles already
      // waiting at boot is the normal case, not the exception.
      //
      // Fire-and-forget on purpose: start() must not block server startup, and
      // runGuarded() already swallows failures and records them on the cursor.
      void runGuarded().catch(() => undefined);
      scheduleNext();
    },
    stop(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        logger.info('li-driver: stopped');
      }
    },
  };
}
