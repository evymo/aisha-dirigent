/**
 * Gate test: Mission Control — kanban cost/budget surfacing.
 *
 * Enforces:
 *   1. kanban_stories_view exposes the new cost + budget columns
 *   2. The view aggregates canonical ai_runs.cost_total_json->>'total' and
 *      LEFT JOINs ai_budget (one query, not N+1)
 *   3. KanbanRowSchema (useKanbanBoard) is in sync with the view's new columns
 *   4. The card surfaces cost via the typed RPC path — no direct .from()/.select("*")
 *   5. The cost-write contract is repaired: finish_ai_run emits total
 *      (canonical), the reader/board key
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd();
const VIEW = path.join(ROOT, 'aisha/db/sql/functions/kanban_stories_view.sql');
const HOOK = path.join(ROOT, 'src/hooks/useKanbanBoard.ts');
const CARD = path.join(ROOT, 'src/components/admin/kanban/KanbanCard.tsx');
const FINISH = path.join(ROOT, 'aisha/db/sql/functions/finish_ai_run.sql');

function readText(p: string): string {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

const NEW_COLUMNS = [
  'cost_to_date',
  'tokens_to_date',
  'budget_cost_limit',
  'budget_consumed',
  'budget_state',
];

describe('kanban_stories_view — cost/budget columns', () => {
  const src = readText(VIEW);

  it.each(NEW_COLUMNS)('RETURNS TABLE declares %s', (col) => {
    // declared in the RETURNS TABLE signature
    expect(src).toMatch(new RegExp(`RETURNS\\s+TABLE[\\s\\S]+${col}[\\s\\S]+\\$\\$`, 'i'));
  });

  it('aggregates canonical total from ai_runs', () => {
    expect(src).toMatch(/SUM\s*\([\s\S]{0,40}cost_total_json->>'total'/i);
  });

  it('LEFT JOINs ai_budget for the per-story cap', () => {
    expect(src).toMatch(/LEFT\s+JOIN\s+public\.ai_budget[\s\S]{0,120}scope_type\s*=\s*'story'/i);
  });

  it('derives budget_state ok/approaching/stopped', () => {
    expect(src).toMatch(/'stopped'/);
    expect(src).toMatch(/'approaching'/);
  });
});

describe('useKanbanBoard — schema sync', () => {
  const src = readText(HOOK);

  it.each(NEW_COLUMNS)('KanbanRowSchema parses %s', (col) => {
    expect(src).toMatch(new RegExp(`${col}\\s*:`, 'i'));
  });

  it('fetches the board via the typed RPC (no direct table access)', () => {
    expect(src).toMatch(/aisha\.rpc\(\s*["']kanban_stories_view["']/);
    expect(src).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/\.select\(\s*["']\*["']\s*\)/);
  });
});

describe('KanbanCard — surfaces cost without direct table access', () => {
  const src = readText(CARD);
  it('reads cost/budget from the story prop, not a query', () => {
    expect(src).toMatch(/cost_to_date/);
    expect(src).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/\.select\(\s*["']\*["']\s*\)/);
  });
});

describe('finish_ai_run — canonical cost contract repaired', () => {
  const src = readText(FINISH);
  it('emits total (not the legacy clobber)', () => {
    expect(src).toMatch(/'total'/);
    expect(src).toMatch(/'tokens_input'/);
    expect(src).toMatch(/'tokens_output'/);
  });
});
