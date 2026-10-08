/**
 * Brána: workflow n8n volá u dispečeru jen akce, které dispečer opravdu zná
 *
 * VZNIKLA Z NÁLEZU (2026-10-07): `WF_PROPOSAL_OUTCOME_REVIEW` (jeden ze dvou workflow
 * smyčky učení, které zůstaly zapnuté) kotvil výsledek návrhu voláním
 * `edge_blockchain_audit('proposal_outcome_anchor', …)`. Tu akci dispečer nikdy neměl
 * — zná jen `count_requests` a `insert_record` a na ostatní odpoví
 * „Unsupported action“. Uzel je fail-open (`continueRegularOutput`), takže každý běh
 * kotvení tiše ztratil. Brána OPANCHOR to neviděla: hledá v souboru jen JMÉNO
 * dispečeru, ne akci.
 *
 * CO BRÁNA HLÍDÁ: uzel `n8n-nodes-aisha.aishaRpc`, jehož `functionName` je dispečer
 * (SoT funkce s větví `RAISE … 'Unsupported action'`) a jehož `rpcParams` nese
 * doslovnou `p_action: '…'`, musí volat akci, kterou SoT dispečeru obsluhuje
 * (`p_action = '…'` nebo `p_action IN (…)`). Funkce, které `p_action` berou jako
 * volný text (např. log_integration_action), dispečery nejsou a brána je nechá být.
 *
 * Spouští se přes: npm run test:gates -- n8n-vola-jen-akce-dispeceru
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const WF_DIR = join(ROOT, 'n8n/workflows');
const FUNCTIONS_DIR = join(ROOT, 'aisha/db/sql/functions');

interface Uzel {
  name: string;
  type?: string;
  parameters?: { functionName?: unknown; rpcParams?: unknown };
}

function bezKomentaru(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/** Je SoT funkce dispečer (odmítá neznámou akci)? */
export function jeDispecer(sql: string): boolean {
  return /Unsupported action/i.test(bezKomentaru(sql));
}

/** Obsluhuje dispečer danou akci? */
export function znaAkci(sql: string, akce: string): boolean {
  const telo = bezKomentaru(sql);
  const a = akce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`p_action\\s*=\\s*'${a}'`).test(telo) || new RegExp(`p_action\\s+IN\\s*\\([^)]*'${a}'`, 'i').test(telo);
}

/** Doslovné akce z rpcParams uzlu. */
export function akceUzlu(rpcParams: string): string[] {
  return [...rpcParams.matchAll(/p_action\s*:\s*['"]([a-z0-9_]+)['"]/gi)].map((m) => m[1]);
}

describe('n8n volá u dispečeru jen akce, které dispečer zná', () => {
  const workflow = existsSync(WF_DIR) ? readdirSync(WF_DIR).filter((f) => f.endsWith('.json')) : [];

  test('měřidlo má co měřit (workflow a dispečery existují)', () => {
    expect(workflow.length).toBeGreaterThan(20);
    const s = readFileSync(join(FUNCTIONS_DIR, 'edge_blockchain_audit.sql'), 'utf8');
    expect(jeDispecer(s)).toBe(true);
  });

  test('kontrolní vzorek: neznámou akci pozná, známou pustí, komentář ji nepřidá', () => {
    const disp = `CREATE FUNCTION f(p_action text) RETURNS jsonb AS $$ BEGIN
      IF p_action = 'insert_record' THEN RETURN '{}'; END IF;
      IF p_action IN ('a', 'b') THEN RETURN '{}'; END IF;
      -- IF p_action = 'proposal_outcome_anchor'
      RAISE EXCEPTION 'Unsupported action: %', p_action; END $$;`;
    expect(jeDispecer(disp)).toBe(true);
    expect(znaAkci(disp, 'insert_record')).toBe(true);
    expect(znaAkci(disp, 'b')).toBe(true);
    expect(znaAkci(disp, 'proposal_outcome_anchor')).toBe(false);
    expect(akceUzlu(`={{ JSON.stringify({ p_action: 'proposal_outcome_anchor', p_payload: {} }) }}`)).toEqual([
      'proposal_outcome_anchor',
    ]);
    expect(jeDispecer(`CREATE FUNCTION log_x(p_action text) RETURNS void AS $$ BEGIN INSERT INTO t VALUES (p_action); END $$;`)).toBe(
      false,
    );
  });

  test('žádný workflow nevolá akci, kterou dispečer neobsluhuje', () => {
    const nalezy: string[] = [];
    let mereno = 0;
    for (const f of workflow) {
      let wf: { nodes?: Uzel[] };
      try {
        wf = JSON.parse(readFileSync(join(WF_DIR, f), 'utf8'));
      } catch {
        continue;
      }
      for (const n of wf.nodes ?? []) {
        const fn = n.parameters?.functionName;
        const rp = n.parameters?.rpcParams;
        if (n.type !== 'n8n-nodes-aisha.aishaRpc' || typeof fn !== 'string' || typeof rp !== 'string') continue;
        const sot = join(FUNCTIONS_DIR, `${fn}.sql`);
        if (!existsSync(sot)) continue;
        const sql = readFileSync(sot, 'utf8');
        if (!jeDispecer(sql)) continue;
        for (const a of akceUzlu(rp)) {
          mereno++;
          if (!znaAkci(sql, a)) nalezy.push(`${f} › „${n.name}“: ${fn}('${a}')`);
        }
      }
    }
    expect(mereno, 'brána nenašla jediné volání dispečeru — měří nad ničím').toBeGreaterThan(0);
    expect(
      nalezy,
      'Workflow volá akci, kterou dispečer nezná — odpoví „Unsupported action“ a fail-open uzel ' +
        'chybu spolkne. Doplň akci do SoT dispečeru, nebo workflow přepoj na existující akci.',
    ).toEqual([]);
  });
});
