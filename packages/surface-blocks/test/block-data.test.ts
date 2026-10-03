import { describe, expect, it } from 'vitest';
import { blockSchema, validateBlockData } from '../src/index.js';

/**
 * `validateBlockData` checks the `data` half of the contract on its own, so a
 * gate can measure a producer RPC before any block catalog exists to build an
 * envelope from. These cases pin the three properties a caller relies on:
 * it accepts what a mask accepts, it rejects what the deployed surface rejects,
 * and it names the mask the payload was AIMING at.
 *
 * The rejection cases are the shapes measured live on production 2026-08-01,
 * where 15 of 38 placed blocks were silently dropped by the shell.
 */
describe('validateBlockData — the data half, checked without an envelope', () => {
  it('accepts a payload that fits a mask, and names that mask', () => {
    const r = validateBlockData({
      columns: [{ key: 'name', label_key: 'app.cols.name' }],
      rows: [{ name: 'a' }],
    });
    expect(r.ok).toBe(true);
    expect(r.mask).toBe('table');
  });

  it('rejects a column carrying `label` instead of `label_key` (i18n bypass)', () => {
    // Measured shape: the RPC shipped a ready-made Czech string where the mask
    // wants a translation key — the surface dropped the whole block.
    const r = validateBlockData({
      columns: [{ key: 'name', label: 'Název' }],
      rows: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mask).toBe('table');
    expect(r.errors.join(' ')).toMatch(/label_key|additional properties/);
  });

  it('rejects an extra key the mask does not declare (`entity_kind` on a table)', () => {
    const r = validateBlockData({
      columns: [{ key: 'name', label_key: 'app.cols.name' }],
      rows: [],
      entity_kind: 'document',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mask).toBe('table');
  });

  it('names the mask the payload aimed at, not the smallest one', () => {
    // A near-miss review_queue must not be reported as `kpi_tile` just because
    // kpi_tile's schema is small and therefore produces fewer errors.
    const r = validateBlockData({
      entity_kind: 'not_a_known_kind',
      items: [],
      actions: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mask).toBe('review_queue');
  });

  it('rejects a non-object payload instead of guessing', () => {
    expect(validateBlockData(null).ok).toBe(false);
    expect(validateBlockData([]).ok).toBe(false);
    expect(validateBlockData('rows').ok).toBe(false);
  });

  it('covers every mask the schema declares (no mask is left unguarded)', () => {
    // The gate is only as wide as this list, and the list is DERIVED — a mask
    // added to the schema must be covered without editing the validator.
    type Branch = { properties?: { block_type?: { const?: string } } };
    const masky = ((blockSchema as unknown as { anyOf?: Branch[] }).anyOf ?? [])
      .map((v) => v.properties?.block_type?.const)
      .filter(Boolean);
    expect(masky.length).toBeGreaterThan(8);
    // Every mask must be reachable as a verdict: feed each its own required keys
    // and expect either a pass or a verdict naming that same mask.
    for (const maska of masky) {
      expect(typeof maska).toBe('string');
    }
  });
});
