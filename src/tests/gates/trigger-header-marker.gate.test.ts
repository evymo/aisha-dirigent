/**
 * trigger-header-marker.gate.test.ts — every trigger SoT file with a CREATE
 * TRIGGER must carry a `-- Trigger:` header marker in its first 8 lines.
 *
 * WHY: generate-init-migration-from-sources.mjs only folds a trigger into the
 * generated baseline when it BOTH contains `create trigger` AND has the
 * `-- Trigger:` marker (hasHeaderMarker). A trigger file with a different header
 * (e.g. `-- Source of Truth:`) or no header is SILENTLY DROPPED from the baseline
 * — the trigger never exists in fresh/baseline-only DBs, and nothing errors. This
 * exact bug made trg_sync_reprice_proposal (the reprice canonical gate) + four
 * update_knowledge_*_updated_at triggers vanish, breaking pgTAP 14 and silently
 * skipping updated_at maintenance. This gate makes the omission loud.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRIGGERS_DIR = join(process.cwd(), 'aisha/db/sql/triggers');

describe('Trigger header marker gate', () => {
  it('every CREATE TRIGGER file has a `-- Trigger:` marker (else the baseline silently drops it)', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(TRIGGERS_DIR).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(TRIGGERS_DIR, file), 'utf8');
      const hasCreateTrigger = /create\s+trigger/i.test(sql);
      if (!hasCreateTrigger) continue;
      const hasMarker = sql.split('\n').slice(0, 8).some((l) => l.trim().startsWith('-- Trigger:'));
      if (!hasMarker) offenders.push(file);
    }
    expect(
      offenders,
      `Trigger file(s) without a '-- Trigger:' marker in the first 8 lines — the baseline generator ` +
        `will SILENTLY DROP them (the trg_sync_reprice_proposal bug class). Add '-- Trigger: <name>':\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
