/**
 * FEEDER — doklady ze zdroje do ingestu. Poslední chybějící článek.
 *
 * DO DNEŠKA: broker uměl doklady jen ČÍST (`/source/<story>/documents`, záměrně
 * bez write-through) a ingest uměl vyrábět balíčky — ale nikdo mu nic nedodal.
 * Naměřeno 2026-08-29: `local-ingest` dva dny běžel zdravý s `documents: 0`,
 * `watch.last_change: null`. Do vstupního svazku nepsal nikdo.
 *
 * CESTA (rozhodnutí majitele — twiny VÝHRADNĚ přes ingest):
 *
 *   adaptér.listEntities()  →  .json + marker  →  /upload → /run → /export
 *                                                     ↓
 *                                               balíček v dropu
 *                                                     ↓
 *                                        li-driver → twin-producer → twiny
 *
 * Feeder NEZAPISUJE do SoT vůbec nic a nemá čím. Entity odvozuje ingest, který
 * u nich MĚŘÍ exkluzivitu a jistotu; potvrzení zůstává lidské.
 *
 * ⭐ POSÍLÁ SE SYROVÝ ZÁZNAM, NE PŘEKLAD. Engine má pro konektorový JSON vlastní
 * dráhu (E7 structured-source, `json_source.py` — hlavička jmenuje „source-broker
 * DocumentRecord" doslova): marker vybere DEKLAROVANOU mapu v instančním bundlu a
 * ta teprve adresuje pole. Mapy přitom adresují VENDOR jména (`CisloDokladu`,
 * `AdresaNazev`), takže se posílá `raw` — původní odpověď zdroje.
 *
 * ⛔ PROČ NE VLASTNÍ PŘEVOD (naměřeno 2026-08-29): první verze renderovala vlastní
 * CSV. Engine z něj udělal JEDEN dokument (600 dokladů = 1 soubor), vytěžil NULA
 * polí a neodvodil žádnou entitu. Přes deklarovanou dráhu: 600 dokumentů, 0 chyb,
 * 3 462 polí AUTO_PASS, 33 profilů entit s identitou
 * `['driver_name','vehicle_registration']` — kterou si engine určil SÁM.
 * Lopata, která překládá, obírá rozhodovací vrstvu o vstup.
 *
 * ⭐ MARKER JE DEKLARACE, NE ROZHODNUTÍ LOPATY. Který doklad patří které mapě, je
 * vlastnost zdroje (instanční konfigurace), ne úsudek brokeru. Feeder ho jen
 * orazítkuje a fail-closed odmítne běh bez něj.
 *
 * ⭐ UNIVERZÁLNÍ: žádný dodavatel se tu nejmenuje. Kdo přidá další ERP, deklaruje
 * mapu a marker; tahle cesta funguje beze změny kódu.
 */

import type { FastifyBaseLogger } from 'fastify';

import { IngestClient, IngestError } from './ingest-client.js';

/** Doklad ve zdrojově agnostickém tvaru. Strukturálně — žádný import z adaptéru. */
export interface DocumentRecordLike {
  externalId?: string | null;
  documentNumber?: string | null;
  /** Původní odpověď zdroje — právě tu adresují deklarované mapy. */
  raw?: unknown;
  [k: string]: unknown;
}

export interface FeedResult {
  /** Kolik dokladů zdroj vydal. */
  documents: number;
  /** Kolik souborů se podařilo vložit do ingestu. */
  uploaded: number;
  /** Doklady bez použitelného obsahu — přeskočené, NIKDY tiše. */
  skipped: number;
  ran: boolean;
  exported: boolean;
  /** Odpověď exportu — nese identitu balíčku, kterou pak uvidí li-driver. */
  exportResult?: unknown;
}

export interface FeedOptions {
  /** Slug zdroje — jde do jména souboru, aby byl původ vidět i v dropu. */
  sourceSlug: string;
  /**
   * `_marker` deklarované mapy (např. pro dodací listy nebo faktury daného ERP).
   * Bez něj engine neví, kterou mapu použít, a doklad by propadl na OCR dráhu.
   */
  marker: string;
  /** Časová značka do jména souboru. PŘEDÁVÁ SE — jinak funkce není testovatelná. */
  stamp: string;
  dryRun?: boolean;
  /** Spustit po nahrání i zpracování a export. Vypnuté = jen doručit vstup. */
  runAndExport?: boolean;
}

/** Bezpečné jméno souboru — server odmítá prázdné a tečkou začínající. */
export function documentFileName(sourceSlug: string, doc: DocumentRecordLike, stamp: string): string {
  const ocisti = (v: unknown) => String(v ?? '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '');
  const slug = ocisti(sourceSlug) || 'source';
  const id = ocisti(doc.documentNumber) || ocisti(doc.externalId) || ocisti(stamp);
  return `${slug}-${id}.json`;
}

/**
 * Co se pošle enginu: SYROVÝ záznam zdroje + marker deklarované mapy.
 *
 * `raw` je původní odpověď — mapy adresují její vendor jména. Když ji doklad
 * nenese (adaptér ji nevyplnil), pošle se celý záznam: pořád je to víc než výběr,
 * který by udělala lopata.
 */
export function ingestPayload(doc: DocumentRecordLike, marker: string): Record<string, unknown> {
  const zaklad =
    doc.raw && typeof doc.raw === 'object' && !Array.isArray(doc.raw)
      ? (doc.raw as Record<string, unknown>)
      : (doc as Record<string, unknown>);
  return { ...zaklad, _marker: marker };
}

/**
 * Pošle doklady do ingestu — jeden soubor na doklad.
 *
 * ⛔ Prázdný vstup NEspouští běh: prázdná dávka by prošla zpracováním a vydala
 * balíček bez obsahu — tedy práci, která vypadá jako výsledek.
 */
export async function feedDocumentsToIngest(
  client: IngestClient,
  documents: DocumentRecordLike[],
  logger: FastifyBaseLogger,
  opts: FeedOptions,
): Promise<FeedResult> {
  if (!opts.marker?.trim()) {
    // Bez markeru by doklad minul deklarovanou mapu a propadl na OCR dráhu —
    // tiše, s nulou vytěžených polí. Radši nezačínat.
    throw new IngestError('transport', 'chybí marker deklarované mapy — mapa se NEODVOZUJE');
  }

  const result: FeedResult = { documents: documents.length, uploaded: 0, skipped: 0, ran: false, exported: false };
  if (documents.length === 0) {
    logger.info({ source: opts.sourceSlug }, 'feeder: zdroj nevydal žádný doklad — ingest se nespouští');
    return result;
  }

  const enc = new TextEncoder();
  try {
    for (const doc of documents) {
      const payload = ingestPayload(doc, opts.marker);
      // Sám marker není obsah: záznam bez jediného dalšího pole by vyrobil
      // prázdný dokument a zkreslil korpus, ze kterého engine odvozuje entity.
      if (Object.keys(payload).length <= 1) {
        result.skipped += 1;
        continue;
      }
      if (opts.dryRun) continue;
      await client.upload(
        documentFileName(opts.sourceSlug, doc, opts.stamp),
        enc.encode(JSON.stringify(payload)),
      );
      result.uploaded += 1;
    }

    if (!opts.dryRun && opts.runAndExport && result.uploaded > 0) {
      await client.run('run');
      result.ran = true;
      result.exportResult = await client.export(`${opts.sourceSlug} ${opts.stamp}`);
      result.exported = true;
    }
  } catch (e) {
    // Chyby ingestu jsou ROZLIŠUJÍCÍ (auth × host × server) a každá posílá jinam.
    // Slepit je do „feed failed" by stálo přesně ten čas, který stála 2026-08-29,
    // kdy 421 vypadalo jako vada klienta a byla to jedna položka v allowlistu.
    if (e instanceof IngestError) {
      logger.error({ source: opts.sourceSlug, kind: e.kind, err: e.message }, 'feeder: ingest odmítl');
    }
    throw e;
  }

  if (result.skipped > 0) {
    logger.warn(
      { source: opts.sourceSlug, skipped: result.skipped },
      'feeder: doklady bez obsahu přeskočeny — nejdou do korpusu',
    );
  }
  logger.info({ source: opts.sourceSlug, ...result, exportResult: undefined }, 'feeder: doklady doručeny do ingestu');
  return result;
}
