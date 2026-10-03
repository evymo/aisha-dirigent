/**
 * Oskenuj a promuj objekt z karantény — JEDNO místo pro synchronní cestu.
 *
 * Volají ho dva spouštěče (2026-09-23):
 *   • `PUT /nahrani/<token>` — na konci PUTu přes API, pokud token míří do karantény;
 *   • `POST /upload-complete` — presigned cesta (instance bez STORAGE_PUBLIC_URL),
 *     kde PUT jde mimo storage-auth a server by se o dotečení jinak nedozvěděl.
 *
 * Oba potřebují TOTÉŽ: stejné závislosti, stejný strop skenu (`uploadScanBudgetMs`,
 * pod stropem gateway 300 s) a stejné čtení verdiktu. Dvě kopie by se rozešly
 * právě v tom, na čem záleží — třeba jedna by zapomněla strop.
 */
import { getObjectStream, copyObject, deleteObject } from '../minio.js';
import { scanStream } from './av-scan.js';
import {
  scanAndPromote,
  postRecordDocumentAvScan,
  type ScanPromoteDeps,
  type PromoteOutcome,
} from './upload-scan-promote.js';
import { config } from '../config.js';

const zavislosti: ScanPromoteDeps = {
  getObjectStream,
  copyObject,
  deleteObject,
  scan: (proud) => scanStream(proud, { timeoutMs: config.uploadScanBudgetMs }),
  recordVerdict: postRecordDocumentAvScan,
};

/** Výsledek pro odpověď klientovi: co se stalo a jaký HTTP kód tomu odpovídá. */
export type VysledekPromoce =
  | { stav: 'cisty'; bucket: string; klic: string }
  | { stav: 'infikovany'; podpis: string }
  | { stav: 'nedokonceno'; duvod: string };

export async function promujZKaranteny(
  karantenniKlic: string,
  documentId: string | null,
): Promise<VysledekPromoce> {
  const v: PromoteOutcome = await scanAndPromote(
    config.uploadsQuarantineBucket,
    karantenniKlic,
    documentId,
    zavislosti,
  );
  if (v.verdict.status === 'infected') {
    return { stav: 'infikovany', podpis: v.verdict.signature };
  }
  if (!v.promoted) {
    // Nedostupný skener, vyčerpaný strop i selhaná kopie: FAIL-CLOSED. Objekt zůstává
    // v karanténě (neservíruje se) a smí se zkusit znovu.
    const duvod = v.verdict.status === 'error' ? v.verdict.reason : 'promote failed';
    return { stav: 'nedokonceno', duvod };
  }
  return { stav: 'cisty', bucket: v.durableBucket, klic: v.durableKey };
}
