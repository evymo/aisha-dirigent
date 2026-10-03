/**
 * Pruh katalogů zdroje — přelije katalogy, které adaptér deklaruje
 * (`config.catalogs`), do jádra přes `audience_sync_source_catalog`.
 *
 * ⛔ PROČ: plocha extranetu čte jen tabulky jádra, nikdy živé /source/* routy
 * (naměřeno 2026-09-15 — KPI komunity, akce, místa i členové existovali jen
 * živě pro Appsmith). Co má být na ploše, musí broker v taktu uložit.
 *
 * Každý katalog je samostatný: chyba jednoho (výjimka adaptéru, odmítnutá
 * dávka) se započítá a zaloguje, ostatní katalogy i zbytek taktu běží dál.
 * Prázdný snapshot nad neprázdnými daty jádro odmítne (`refused_empty`) —
 * tady se to jen hlásí, nikdy se to neobchází.
 */
import type {
  IDataSource,
  SourceCatalogDeclaration,
  SourceConnection,
} from '@aisha/audience-types';
import { errMessage } from '../errors.js';

/** Minimum z pg klienta, které pruh potřebuje (kvůli testu bez databáze). */
export interface CatalogPg {
  query<R = unknown>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface CatalogLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface CatalogKindResult {
  kind: string;
  mode: SourceCatalogDeclaration['mode'];
  fetched: number;
  upserted: number;
  removed: number;
  refusedEmpty: boolean;
  error?: string;
}

export interface CatalogLaneResult {
  kinds: CatalogKindResult[];
  /** Součet upsertovaných řádků přes všechny katalogy. */
  upserted: number;
  errors: number;
}

const KIND_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** Deklarace, které má smysl volat: platný slug, známý režim, bez duplicit. */
export function declaredCatalogs(adapter: IDataSource): SourceCatalogDeclaration[] {
  const seen = new Set<string>();
  const out: SourceCatalogDeclaration[] = [];
  for (const d of adapter.config.catalogs ?? []) {
    if (!KIND_RE.test(d.kind) || (d.mode !== 'snapshot' && d.mode !== 'series')) continue;
    if (seen.has(d.kind)) continue;
    seen.add(d.kind);
    out.push(d);
  }
  return out;
}

export async function syncSourceCatalogs(
  adapter: IDataSource,
  conn: SourceConnection,
  aishaPg: CatalogPg,
  sourceSlug: string,
  log: CatalogLog,
): Promise<CatalogLaneResult> {
  const result: CatalogLaneResult = { kinds: [], upserted: 0, errors: 0 };
  if (typeof adapter.listCatalog !== 'function') return result;

  const declared = declaredCatalogs(adapter);
  const invalid = (adapter.config.catalogs ?? []).length - declared.length;
  if (invalid > 0) {
    // Vadná deklarace je chyba adaptéru, ne dat — nahlas, ale nezastaví platné katalogy.
    result.errors += invalid;
    log.error({ source: sourceSlug, invalid }, 'catalog-lane: ignoring invalid or duplicate catalog declarations');
  }

  for (const decl of declared) {
    const kr: CatalogKindResult = {
      kind: decl.kind, mode: decl.mode, fetched: 0, upserted: 0, removed: 0, refusedEmpty: false,
    };
    try {
      const rows = await adapter.listCatalog(decl.kind, conn);
      kr.fetched = rows.length;
      const res = await aishaPg.query<{ r: { upserted: number; removed: number; refused_empty: boolean } }>(
        `SELECT public.audience_sync_source_catalog($1::text, $2::text, $3::text, $4::jsonb, false) AS r`,
        [sourceSlug, decl.kind, decl.mode, JSON.stringify(rows)],
      );
      const r = res.rows[0]?.r;
      kr.upserted = r?.upserted ?? 0;
      kr.removed = r?.removed ?? 0;
      kr.refusedEmpty = r?.refused_empty === true;
      result.upserted += kr.upserted;
      if (kr.refusedEmpty) {
        log.warn(
          { source: sourceSlug, kind: decl.kind },
          'catalog-lane: empty snapshot refused — core keeps the previous rows (source returned nothing)',
        );
      }
    } catch (err) {
      kr.error = errMessage(err);
      result.errors += 1;
      log.error({ source: sourceSlug, kind: decl.kind, err: kr.error }, 'catalog-lane: catalog sync failed');
    }
    result.kinds.push(kr);
  }

  log.info(
    {
      source: sourceSlug,
      catalogs: result.kinds.map((k) => ({
        kind: k.kind, fetched: k.fetched, upserted: k.upserted, removed: k.removed,
        refusedEmpty: k.refusedEmpty, failed: Boolean(k.error),
      })),
    },
    'catalog-lane: done',
  );
  return result;
}
