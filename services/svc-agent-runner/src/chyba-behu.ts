import type { LogLine } from './backends/sentinel.js';

// ── Souhrn chyby běhu: PROČ, ne jen „Exit code N“ ───────────────────────────
//
// ⛔ NAMĚŘENO 2026-09-30 na instanci: běhy pluginů s konektory končily hodinu co hodinu jen
// „Exit code 255“. Výstup kontejneru runner přečetl, vrátil volajícímu a ten ho
// zahodil; agent_runs.outputs zůstalo prázdné. Příčinu (broker nedosažitelný)
// šlo najít jen měřením mimo systém. Konec výstupu proto jde do error_summary.
//
// Výstup je vstup z cizího kódu: tokeny a hesla se maskují, délka má strop,
// řídicí znaky (rámce multiplexu Dockeru) se zahazují.

const POSLEDNICH_RADKU = 5;
const STROP = 600;

const MASKY: Array<[RegExp, string]> = [
  [/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '<jwt>'],
  [/(bearer\s+)[^\s"',;]+/gi, '$1<skryto>'],
  [/((?:token|password|passwd|heslo|secret|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1<skryto>'],
];

export function maskuj(text: string): string {
  let s = text;
  for (const [vzor, nahrada] of MASKY) s = s.replace(vzor, nahrada);
  return s;
}

function bezRidicich(text: string): string {
  let out = '';
  for (const ch of text) {
    const kod = ch.codePointAt(0) ?? 0;
    out += kod < 0x20 || kod === 0x7f ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function souhrnChyby(exitCode: number, logs: readonly LogLine[]): string {
  const ocas = logs
    .slice(-POSLEDNICH_RADKU)
    .map((l) => `${l.level}: ${bezRidicich(l.message)}`)
    .filter((r) => r.length > 0)
    .join(' | ');
  const souhrn = maskuj(ocas ? `Exit code ${exitCode} — ${ocas}` : `Exit code ${exitCode}`);
  return souhrn.length > STROP ? `${souhrn.slice(0, STROP - 1)}…` : souhrn;
}
