/**
 * av-nahravka.ts — antivirový sken souboru nahraného do znalostní báze.
 *
 * ⛔ NAMĚŘENO 2026-10-03: `/ragnarok/upload` předával buffer rovnou vyhledávacímu enginu.
 * `ingestion-safety.ts` hlídá prompt-injection v TEXTU; malware v SOUBORU nehlídal nikdo —
 * antivirem procházely jen nahrávky přes storage-auth. Soubor z administrace se přitom
 * parsuje (PDF, DOCX, XLSX) a jeho obsah se pak vrací uživatelům v odpovědích.
 *
 * FAIL-CLOSED: dál smí jen verdikt `clean`. Nedostupný clamd, vypršený čas i nedoručený
 * cíl jsou `error` — a `error` se zachází stejně jako s nálezem (nahrání se odmítne),
 * jen s jinou hláškou, aby správce věděl, že nejde o soubor, ale o platformu.
 *
 * Klient clamd je sdílený (`@aisha/security/av-scan`) — týž, kterým skenuje storage-auth
 * i synchronizace dokumentů do ingestu. Druhá kopie protokolu se nezavádí.
 */
import { scanBuffer, type AvVerdict } from '@aisha/security/av-scan';
import { config } from '../config.js';

/**
 * `skipped`  = sken je výslovně vypnutý (AV_SCAN_ENABLED=false) MIMO produkci — lokální vývoj.
 * `disabled` = týž vypínač v produkci: soubor se NEPUSTÍ, nahrání se odmítne.
 */
export type VerdiktNahravky = AvVerdict | { status: 'skipped' } | { status: 'disabled' };

export async function skenujNahravku(data: Buffer): Promise<VerdiktNahravky> {
  if (!config.avScanEnabled) return config.produkce ? { status: 'disabled' } : { status: 'skipped' };
  if (!config.clamdHost || !Number.isInteger(config.clamdPort) || config.clamdPort <= 0) {
    // Bez pokusu o spojení: prázdné jméno by `net.connect` přeložil na localhost.
    return { status: 'error', reason: 'clamd target not delivered (CLAMD_HOST / CLAMD_PORT)' };
  }
  return scanBuffer(data, {
    host: config.clamdHost,
    port: config.clamdPort,
    timeoutMs: config.uploadScanBudgetMs,
  });
}
