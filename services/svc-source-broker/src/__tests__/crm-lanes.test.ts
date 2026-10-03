import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client as PgClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { LiBundle } from '../clients/li-driver.js';
import { openRelationsFromLinks, recordTouchesAsEvents } from '../clients/crm-lanes.js';

// ⛔ NAMĚŘENO 2026-09-06: driver přehrával registr, vazby i profily entit, ale
// nic neudělalo z vazby řádek twin_relations ani z komunikace řádek twin_events.
// Balík z CRM (246 osob, 103 organizací, 1 066 doteků) by vyrobil dvojčata bez
// hran a bez časové osy. Tyhle testy tvrdí obě chybějící půlky a hlavně doktrínu:
// dvojče se hledá JEN přes POTVRZENOU primary_id referenci, nepotvrzené se
// odkládá, opakovaný běh nic nezdvojí.

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function bundleWith(files: Record<string, Record<string, unknown>[]>, sourceSlug = 'crm-test'): LiBundle {
  const dir = mkdtempSync(path.join(tmpdir(), 'crm-lanes-'));
  dirs.push(dir);
  for (const [name, rows] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  }
  return {
    dir,
    manifest: { export_id: 'exp-crm-1', created_at: '2026-01-01T00:00:00+00:00', source_slug: sourceSlug, files: [] },
  } as LiBundle;
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;

/** Fake pg: confirmed refs index + a recorder for the RPC calls. */
function fakePg(refs: Record<string, string>, opts: { relationRaises?: string; secondOwners?: Record<string, string> } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM public\.twin_external_refs/.test(sql)) {
      const wanted = new Set(params[1] as string[]);
      // secondOwners = týž klíč potvrzený u dvojčete JINÉHO druhu (od 2026-09-27 to index dovoluje).
      return { rows: [...Object.entries(refs), ...Object.entries(opts.secondOwners ?? {})]
        .filter(([k]) => wanted.has(k)).map(([source_key, twin_id]) => ({ source_key, twin_id })) };
    }
    if (/twin_relation_open_admin/.test(sql)) {
      if (opts.relationRaises && String(params[2]) === opts.relationRaises) {
        throw new Error('twin_relation_open_admin: hrana a —works_for→ b už v tom období platí — souběh téže hrany je duplicitní pravda');
      }
      return { rows: [{}] };
    }
    if (/twin_record_events_audited/.test(sql)) return { rows: [{ result: { total: 1 } }] };
    return { rows: [] };
  });
  return { pg: { query } as unknown as PgClient, calls };
}

describe('openRelationsFromLinks — vazby jen mezi POTVRZENÝMI identitami', () => {
  it('opens edges for confirmed twins, defers the rest, treats exclusion as idempotent', async () => {
    const bundle = bundleWith({
      'links_artifact.jsonl': [
        { relation: 'works_for', rule_id: 'crm:works_for', twin_from: { source_key: '2001' }, twin_to: { source_key: '1001' }, attrs: {} },
        { relation: 'role_in', rule_id: 'crm:role_in', twin_from: { source_key: '2001' }, twin_to: { source_key: '1001' }, attrs: { role: 'Blue Gakyil' } },
        { relation: 'works_for', rule_id: 'crm:works_for', twin_from: { source_key: '2999' }, twin_to: { source_key: '1001' }, attrs: {} }, // 2999 not confirmed
        { relation: 'touch:account', twin_to: { source_key: '1001' }, from: { source_slug: 'act-1' } },                                    // touch ≠ relation
      ],
    });
    const { pg, calls } = fakePg({ '2001': 'twin-p1', '1001': 'twin-o1' }, { relationRaises: 'works_for' });
    const counts = await openRelationsFromLinks(pg, bundle, logger);
    expect(counts).toEqual({ opened: 1, already: 1, deferred: 1, ambiguous: 0 });
    const opened = calls.filter((c) => /twin_relation_open_admin/.test(c.sql));
    expect(opened).toHaveLength(2);
    const roleCall = opened.find((c) => c.params[2] === 'role_in')!;
    expect(roleCall.params[0]).toBe('twin-p1');
    expect(roleCall.params[1]).toBe('twin-o1');
    expect(JSON.parse(String(roleCall.params[3]))).toMatchObject({ role: 'Blue Gakyil', export_id: 'exp-crm-1', source: 'crm-test' });
    // The lookup is scoped to the bundle's source — never a hardcoded slug.
    const lookup = calls.find((c) => /FROM public\.twin_external_refs/.test(c.sql))!;
    expect(lookup.params[0]).toBe('crm-test');
  });

  it('a key confirmed for twins of two entity types is NOT guessed — skipped as ambiguous, loudly', async () => {
    // ⛔ 2026-09-27: vazba je jedinečná v rámci DRUHU entity. CRM čísluje účty
    // a kontakty zvlášť — účet 1001 i osoba 1001 můžou být potvrzené oba. Konec
    // vazby v balíku druh nenese; Map.set by tiše nechal poslední řádek.
    const bundle = bundleWith({
      'links_artifact.jsonl': [
        { relation: 'works_for', rule_id: 'crm:works_for', twin_from: { source_key: '2001' }, twin_to: { source_key: '1001' }, attrs: {} },
        { relation: 'works_for', rule_id: 'crm:works_for', twin_from: { source_key: '2002' }, twin_to: { source_key: '1002' }, attrs: {} },
      ],
    });
    const { pg, calls } = fakePg(
      { '2001': 'twin-p1', '1001': 'twin-o1', '2002': 'twin-p2', '1002': 'twin-o2' },
      { secondOwners: { '1001': 'twin-osoba-1001' } }
    );
    const warn = vi.mocked(logger.warn);
    warn.mockClear();
    expect(await openRelationsFromLinks(pg, bundle, logger)).toEqual({ opened: 1, already: 0, deferred: 0, ambiguous: 1 });
    const opened = calls.filter((c) => /twin_relation_open_admin/.test(c.sql));
    expect(opened.map((c) => [c.params[0], c.params[1]])).toEqual([['twin-p2', 'twin-o2']]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ ambiguous: 1 }), expect.stringMatching(/more than one entity type/));
  });

  it('is a no-op on a bundle without twin-bearing links', async () => {
    const bundle = bundleWith({ 'links_artifact.jsonl': [{ relation: 'supersedes', from: {}, to: {} }] });
    const { pg, calls } = fakePg({});
    expect(await openRelationsFromLinks(pg, bundle, logger)).toEqual({ opened: 0, already: 0, deferred: 0, ambiguous: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe('recordTouchesAsEvents — komunikace se stane událostí dvojčete, bez těla zprávy', () => {
  it('records one event per confirmed participant with provenance and no body', async () => {
    const bundle = bundleWith({
      'registry_artifact.jsonl': [
        { doc_type: 'communication', source_slug: 'act-1', story_id: 'story-x',
          fields: { event_type: { value: 'email' }, created: { value: '2026-06-27T12:00:00+00:00' },
                    subject: { value: 'Re: program' }, description: { value: 'TAJNÝ TEXT E-MAILU' } } },
        { doc_type: 'communication', source_slug: 'act-2', story_id: 'story-x',
          fields: { event_type: { value: 'task' }, created: { value: '2026-06-28T12:00:00+00:00' } } },
        { doc_type: 'person', source_slug: 'person-x', fields: {} },
      ],
      'links_artifact.jsonl': [
        { relation: 'touch:account', from: { source_slug: 'act-1' }, twin_to: { source_key: '1001' } },
        { relation: 'touch:contact', from: { source_slug: 'act-1' }, twin_to: { source_key: '2001' } },
        { relation: 'touch:contact', from: { source_slug: 'act-2' }, twin_to: { source_key: '2999' } }, // unresolved → orphaned
      ],
    });
    const { pg, calls } = fakePg({ '1001': 'twin-o1', '2001': 'twin-p1' });
    const counts = await recordTouchesAsEvents(pg, bundle, logger);
    expect(counts).toEqual({ events: 2, orphaned: 1, ambiguous: 0 });
    const write = calls.find((c) => /twin_record_events_audited/.test(c.sql))!;
    const events = JSON.parse(String(write.params[0])) as Record<string, unknown>[];
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e).toMatchObject({ event_type: 'email', source: 'crm-test', story_id: 'story-x',
                                occurred_at: '2026-06-27T12:00:00+00:00' });
      // ref = doklad + dvojče: dedup RPC (source, event_type, source_ref) nesmí
      // sloučit dva účastníky téhož dokladu do jedné události.
      expect(e.source_ref).toBe(`act-1#${e.twin_id}`);
      expect(JSON.stringify(e)).not.toContain('TAJNÝ TEXT'); // body stays in the registry row
    }
    expect(events.map((e) => e.twin_id).sort()).toEqual(['twin-o1', 'twin-p1']);
    expect(events.find((e) => e.twin_id === 'twin-p1')!.related_twin_id).toBe('twin-o1');
  });

  it('a participant key confirmed for two entity types is skipped, not guessed', async () => {
    const bundle = bundleWith({
      'registry_artifact.jsonl': [
        { doc_type: 'communication', source_slug: 'act-1', story_id: 'story-x',
          fields: { event_type: { value: 'email' }, created: { value: '2026-06-27T12:00:00+00:00' } } },
      ],
      'links_artifact.jsonl': [
        { relation: 'touch:account', from: { source_slug: 'act-1' }, twin_to: { source_key: '1001' } }, // účet 1001 i osoba 1001
        { relation: 'touch:contact', from: { source_slug: 'act-1' }, twin_to: { source_key: '2001' } },
      ],
    });
    const { pg, calls } = fakePg({ '1001': 'twin-o1', '2001': 'twin-p1' }, { secondOwners: { '1001': 'twin-osoba-1001' } });
    const warn = vi.mocked(logger.warn);
    warn.mockClear();
    expect(await recordTouchesAsEvents(pg, bundle, logger)).toEqual({ events: 1, orphaned: 0, ambiguous: 1 });
    const write = calls.find((c) => /twin_record_events_audited/.test(c.sql))!;
    const events = JSON.parse(String(write.params[0])) as Record<string, unknown>[];
    expect(events.map((e) => e.twin_id)).toEqual(['twin-p1']);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ ambiguous: 1 }), expect.stringMatching(/more than one entity type/));
  });

  it('writes nothing when the bundle has no communication documents', async () => {
    const bundle = bundleWith({ 'registry_artifact.jsonl': [{ doc_type: 'person', source_slug: 'p' }], 'links_artifact.jsonl': [] });
    const { pg, calls } = fakePg({});
    expect(await recordTouchesAsEvents(pg, bundle, logger)).toEqual({ events: 0, orphaned: 0, ambiguous: 0 });
    expect(calls).toHaveLength(0);
  });
});
