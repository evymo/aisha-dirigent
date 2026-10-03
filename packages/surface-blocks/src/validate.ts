import AjvImport from 'ajv';
import type { ValidateFunction } from 'ajv';
import addFormatsImport from 'ajv-formats';

/* NodeNext/CJS interop: the constructor lives on .default when the d.ts is ESM-shaped;
 * at runtime Node/bundlers expose both. Resolve once, keep full typing. */
type AjvCtor = typeof AjvImport.default;
const Ajv: AjvCtor =
  (AjvImport as unknown as { default?: AjvCtor }).default ?? (AjvImport as unknown as AjvCtor);
type AddFormats = typeof addFormatsImport.default;
const addFormats: AddFormats =
  (addFormatsImport as unknown as { default?: AddFormats }).default ??
  (addFormatsImport as unknown as AddFormats);
import { blockSchema, layoutSchema, snapshotEnvelopeSchema } from './schemas.js';
import {
  OFFLINE_MAX_SENSITIVITY,
  SENSITIVITY_ORDER,
  type Sensitivity,
  type SurfaceBlock,
  type SurfaceLayout,
  type SnapshotEnvelope
} from './types.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(blockSchema);
ajv.addSchema(layoutSchema);
ajv.addSchema(snapshotEnvelopeSchema);

/**
 * ⭐ PLOŠNÉ PRAVIDLO: NEZNÁMÉ NESMÍ ZABÍT ZNÁMÉ.
 *
 * Táž kopie schématu, jen s otevřenými objekty. Neděje se to výčtem masek —
 * strom se projde a KAŽDÉ `additionalProperties: false` se přepne na `true`,
 * v jakékoli hloubce. Maska, která vznikne zítra, je pokrytá bez zásahu.
 *
 * PROČ VŮBEC (naměřeno 2026-08-08 na produkci): Ajv je všechno-nebo-nic, takže
 * jedna vlastnost navíc nezneplatní sebe, ale CELÝ blok. Čtečka dokladu přidala
 * 2026-08-05 čtyři užitečné klíče a od té chvíle detail faktury hlásil „Data se
 * nepodařilo načíst" nad 25 poli, která dorazila v pořádku. Týmž způsobem
 * z konzole tiše zmizelo šest bloků. Opravit ty funkce nestačí — příští
 * rozšíření producenta by shodilo obrazovku znovu.
 *
 * Přísnost se NERUŠÍ, jen se stěhuje tam, kde je užitečná: schéma zůstává
 * uzavřené pro brány v CI (tam se drift má opravit), kdežto před uživatelem
 * se blok raději vykreslí bez toho, čemu klient nerozumí. Chybějící POVINNÁ
 * vlastnost je něco jiného — tu vykreslit nejde a odmítnutí platí dál.
 */
function otevrit(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(otevrit);
  if (x === null || typeof x !== 'object') return x;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    out[k] = k === 'additionalProperties' && v === false ? true : otevrit(v);
  }
  return out;
}

// Vlastní instance: totéž $id nesmí kolidovat s přísným registrem.
const ajvTolerantni = new Ajv({ allErrors: true, strict: false });
addFormats(ajvTolerantni);
const vBlockTolerantni = ajvTolerantni.compile(
  otevrit(blockSchema) as Record<string, unknown>,
);

/**
 * Pořadí větve, která popisuje DANOU masku. Odvozeno ze schématu podle
 * `block_type` — seznam masek se sem nepíše, takže maska přidaná zítra je
 * pokrytá bez zásahu.
 */
function vetevMasky(typ: unknown): number {
  const anyOf = (blockSchema as unknown as {
    anyOf: Array<{ properties?: { block_type?: { const?: string } } }>;
  }).anyOf;
  return anyOf.findIndex((b) => b.properties?.block_type?.const === typ);
}

/**
 * Které vlastnosti klient NEZNÁ.
 *
 * Filtruje se na větev SVÉ masky: `anyOf` zkouší všechny, takže bez toho by se
 * mezi nálezy dostalo i „`/data/columns` nezná kpi_tile" — pravda, ale o jiném
 * bloku, a ve výpisu je to šum, který zakryje ten jeden skutečný drift.
 */
function neznameVlastnosti(v: ValidateFunction, vetev: number): string[] {
  const out = new Set<string>();
  for (const e of v.errors ?? []) {
    if (e.keyword !== 'additionalProperties') continue;
    if (vetev >= 0 && !e.schemaPath.includes(`/anyOf/${vetev}/`)) continue;
    const jmeno = (e.params as { additionalProperty?: string }).additionalProperty;
    if (jmeno) out.add(`${e.instancePath || '/'}/${jmeno}`);
  }
  return [...out].sort();
}

export interface Overeni<T> {
  ok: boolean;
  errors: string[];
  value?: T;
  /**
   * Blok prošel, ale nesl vlastnosti, které klient nezná — vykreslí se bez nich.
   * NENÍ to chyba k zobrazení uživateli, je to hlášení o driftu pro vývoj a pro
   * bránu. Prázdné pole = kontrakt a producent si dnes rozumí úplně.
   */
  degraded?: string[];
}

function run<T>(v: ValidateFunction, x: unknown): Overeni<T> {
  if (v(x) as boolean) return { ok: true, errors: [], value: x as T };
  const errors = (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
  return { ok: false, errors };
}

const vBlock = ajv.getSchema(blockSchema.$id)!;
const vLayout = ajv.getSchema(layoutSchema.$id)!;
const vSnapshot = ajv.getSchema(snapshotEnvelopeSchema.$id)!;

/**
 * One compiled validator per mask, for the `data` half alone. Derived FROM the
 * schema — the list of masks is never written down here, so a mask added to
 * `blockSchema` is covered without touching this file.
 */
type MaskBranch = {
  properties?: {
    block_type?: { const?: string };
    data?: { required?: string[] } & Record<string, unknown>;
  };
};

const dataMasks: Array<{ mask: string; required: string[]; validate: ValidateFunction }> = (
  (blockSchema as unknown as { anyOf?: MaskBranch[] }).anyOf ?? []
).flatMap((branch) => {
  const mask = String(branch.properties?.block_type?.const ?? '');
  const schema = branch.properties?.data;
  if (mask.length === 0 || !schema) return [];
  return [{ mask, required: schema.required ?? [], validate: ajv.compile(schema) }];
});

/**
 * Blok pro VYKRESLENÍ — dva průchody, protože přísnost a použitelnost nemají
 * stejného adresáta.
 *
 *   1. přísný  — sedí všechno? pak je hotovo a `degraded` je prázdné
 *   2. tolerantní — sedí to až na vlastnosti, které klient nezná? pak se blok
 *      VYKRESLÍ a neznámé se vyjmenují do `degraded`
 *   3. jinak    — chybí povinné nebo nesedí typ; to vykreslit nejde a odmítá se
 *
 * Neznámé vlastnosti se ZÁMĚRNĚ NEODSTRAŇUJÍ: renderery čtou jmenovitě, co znají,
 * takže je klidně ignorují — a kdyby se odřezávaly, ztratil by se ten jediný
 * důkaz o driftu, který má klient v ruce.
 */
/**
 * Vlastnosti, které JSON schéma vyjádřit neumí, a přitom bez nich blok lže:
 *  - `provenance.coverage`: n ≤ m („5 z 3" není pokrytí, je to překlep producenta),
 *  - `table.superseded_key` / `version_key`: musí jmenovat sloupec, který v `columns`
 *    JE — ukazatel na sloupec, který nikdo neposlal, by renderer tiše četl jako
 *    „nic není nahrazeno" a historie by se zase sčítala s platnými řádky.
 * Je to rozpor ve ZNÁMÝCH vlastnostech, ne drift neznámých — proto odmítnutí,
 * ne `degraded`.
 */
function semantickeVady(x: unknown): string[] {
  const out: string[] = [];
  const b = x as { block_type?: unknown; provenance?: { coverage?: { n?: unknown; m?: unknown } };
                   data?: { columns?: Array<{ key?: unknown }>; superseded_key?: unknown; version_key?: unknown } } | null;
  const cov = b?.provenance?.coverage;
  if (cov && typeof cov.n === 'number' && typeof cov.m === 'number' && cov.n > cov.m) {
    out.push(`/provenance/coverage n (${cov.n}) > m (${cov.m}) — pokrytí nemůže být větší než celek`);
  }
  if (b?.block_type === 'table' && Array.isArray(b.data?.columns)) {
    const klice = new Set(b.data!.columns!.map((c) => c?.key));
    for (const pole of ['superseded_key', 'version_key'] as const) {
      const v = b.data?.[pole];
      if (typeof v === 'string' && !klice.has(v)) {
        out.push(`/data/${pole} jmenuje sloupec '${v}', který v columns není`);
      }
    }
  }
  return out;
}

export const validateBlock = (x: unknown): Overeni<SurfaceBlock> => {
  const prisny = run<SurfaceBlock>(vBlock, x);
  if (prisny.ok) {
    const vady = semantickeVady(x);
    return vady.length ? { ok: false, errors: vady } : { ...prisny, degraded: [] };
  }
  if (!(vBlockTolerantni(x) as boolean)) return prisny;
  const vady = semantickeVady(x);
  if (vady.length) return { ok: false, errors: vady };
  const typ = (x as { block_type?: unknown } | null)?.block_type;
  return {
    ok: true,
    errors: [],
    value: x as SurfaceBlock,
    degraded: neznameVlastnosti(vBlock, vetevMasky(typ)),
  };
};
export const validateLayout = (x: unknown) => run<SurfaceLayout>(vLayout, x);
export const validateSnapshotEnvelope = (x: unknown) => run<SnapshotEnvelope>(vSnapshot, x);

/**
 * The `data` half of the contract, checked on its own.
 *
 * `validateBlock` needs a whole envelope, which only the dispatcher can build —
 * it reads `block_type`, `title_key` and `sensitivity` from the block catalog.
 * A producer RPC (`get_twin_register`, `get_flow_node_queue`, …) returns just
 * `{ data, provenance }`, so a gate that wants to check the producer BEFORE a
 * catalog exists has no envelope to validate. This does exactly that: does the
 * payload fit ANY mask this design system can render?
 *
 * It lives here, next to the schema, because ajv must be the version this
 * package declares — a caller compiling the sub-schemas with its own ajv would
 * silently measure a different property.
 *
 * On failure it names the mask the payload was clearly AIMING at — the one whose
 * required keys the payload actually carries, counted absolutely so a SPECIFIC
 * mask beats a general one (`{entity_kind, items, actions}` is a broken
 * `review_queue`, not a `timeline` with two stray keys). Reporting instead the
 * mask with the fewest errors always names the smallest schema, which tells the
 * reader nothing about what the producer meant to build.
 */
export function validateBlockData(
  data: unknown,
): { ok: true; mask: string } | { ok: false; mask: string; errors: string[] } {
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
  const candidates: Array<{ mask: string; hit: number; ratio: number; errors: string[] }> = [];

  for (const { mask, required, validate } of dataMasks) {
    if (validate(data) as boolean) return { ok: true, mask };
    const hit = required.filter((k) => keys.includes(k)).length;
    candidates.push({
      mask,
      hit,
      ratio: required.length === 0 ? 0 : hit / required.length,
      errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()),
    });
  }
  candidates.sort((a, b) => b.hit - a.hit || b.ratio - a.ratio || a.errors.length - b.errors.length);
  const best = candidates[0];
  return { ok: false, mask: best?.mask ?? '(žádná maska)', errors: best?.errors ?? ['no mask defined'] };
}

/** Fail-closed sensitivity comparison: any UNKNOWN value is treated as above the cap. */
export function sensitivityWithinCap(value: string, cap: Sensitivity): boolean {
  const v = SENSITIVITY_ORDER[value as Sensitivity];
  const c = SENSITIVITY_ORDER[cap];
  if (v === undefined || c === undefined) return false;
  return v <= c;
}

export class SensitivityError extends Error {}

/**
 * Gate before rendering/caching a block on a given surface cap.
 * Throws (fail-closed) instead of returning false so callers cannot silently ignore it.
 */
export function assertRenderable(block: SurfaceBlock, cap: Sensitivity): void {
  if (!sensitivityWithinCap(block.sensitivity, cap)) {
    throw new SensitivityError(
      `block '${block.block_slug}' sensitivity '${block.sensitivity}' exceeds cap '${cap}'`
    );
  }
}

/** Gate for anything persisted on a client device. */
export function assertCacheable(block: SurfaceBlock): void {
  assertRenderable(block, OFFLINE_MAX_SENSITIVITY);
}
