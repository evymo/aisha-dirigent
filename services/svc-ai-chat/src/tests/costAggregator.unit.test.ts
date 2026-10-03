/**
 * Unit tests for the cost aggregator's prompt-cache accrual (odysseus G1c).
 *
 * Focus: cache-READ tokens are billed at the discounted `cachedInputPer1M` rate
 * (registry cached_input_price_per_m, ~−90 %), cache-WRITE at `cacheWritePer1M`,
 * and — critically — the pre-cache behaviour is unchanged when no cache tokens are
 * passed (backward compatibility for every existing caller of record/estimateCost).
 */

import { describe, test, expect } from 'vitest';
import {
  createCostAggregator,
  estimateCostUsd,
  loadPricingFromEnv,
  pricingTableFromRegistry,
  type ModelPricing,
  type RegistryModelPrice,
} from '../lib/costAggregator';

const PRICING: Record<string, ModelPricing> = {
  // $3 / $15 input/output per 1M; cached read at $0.30 (−90 %); cache write at $3.75 (+25 %).
  'claude-*': { inputPer1M: 3.0, outputPer1M: 15.0, cachedInputPer1M: 0.3, cacheWritePer1M: 3.75 },
  // A model WITHOUT explicit cache rates — cache reads must fall back to input rate.
  'plain-*': { inputPer1M: 2.0, outputPer1M: 8.0 },
};

describe('costAggregator — prompt-cache accrual (G1c)', () => {
  test('no cache arg → identical to legacy input·in + output·out billing', () => {
    const agg = createCostAggregator({ pricingTable: PRICING });
    agg.record('claude-sonnet', 'main', 1_000_000, 1_000_000);
    const s = agg.getSummary();
    // 1e6 input × $3/1e6 + 1e6 output × $15/1e6 = 3 + 15 = 18
    expect(s.totalCostUsd).toBeCloseTo(18, 6);
    expect(s.totalCacheReadTokens).toBe(0);
    expect(s.totalCacheCreationTokens).toBe(0);
  });

  test('cache-READ tokens are billed at the cached rate (~−90 % vs full input)', () => {
    const cached = createCostAggregator({ pricingTable: PRICING });
    cached.record('claude-sonnet', 'main', 0, 0, { read: 1_000_000 });
    // 1e6 cache-read × $0.30/1e6 = 0.30
    expect(cached.getSummary().totalCostUsd).toBeCloseTo(0.3, 6);

    // Contrast: if those same tokens were billed as full input they'd cost $3.00.
    const asFullInput = createCostAggregator({ pricingTable: PRICING });
    asFullInput.record('claude-sonnet', 'main', 1_000_000, 0);
    const full = asFullInput.getSummary().totalCostUsd;
    expect(full).toBeCloseTo(3.0, 6);
    // −90 %: cached read is one tenth of the full-input cost.
    expect(0.3 / full).toBeCloseTo(0.1, 6);
  });

  test('cache-WRITE tokens are billed at the write rate', () => {
    const agg = createCostAggregator({ pricingTable: PRICING });
    agg.record('claude-sonnet', 'main', 0, 0, { write: 1_000_000 });
    // 1e6 cache-write × $3.75/1e6 = 3.75
    expect(agg.getSummary().totalCostUsd).toBeCloseTo(3.75, 6);
  });

  test('all three token classes are additive (Anthropic input excludes cache tokens)', () => {
    const agg = createCostAggregator({ pricingTable: PRICING });
    agg.record('claude-sonnet', 'main', 100_000, 50_000, { read: 400_000, write: 20_000 });
    // 0.1e6·3 + 0.05e6·15 + 0.4e6·0.30 + 0.02e6·3.75, all /1e6
    // = 0.3 + 0.75 + 0.12 + 0.075 = 1.245
    expect(agg.getSummary().totalCostUsd).toBeCloseTo(1.245, 6);
  });

  test('no invented discount: cache read falls back to full input rate when no cached rate known', () => {
    const agg = createCostAggregator({ pricingTable: PRICING });
    agg.record('plain-model', 'main', 0, 0, { read: 1_000_000 });
    // plain-* has no cachedInputPer1M → cache read billed at inputPer1M ($2.00)
    expect(agg.getSummary().totalCostUsd).toBeCloseTo(2.0, 6);
  });

  test('summary aggregates cache token counts by model', () => {
    const agg = createCostAggregator({ pricingTable: PRICING });
    agg.record('claude-sonnet', 'main', 10, 5, { read: 4000, write: 100 });
    agg.record('claude-sonnet', 'critic', 20, 10, { read: 1000 });
    const s = agg.getSummary();
    expect(s.totalCacheReadTokens).toBe(5000);
    expect(s.totalCacheCreationTokens).toBe(100);
    const claude = s.byModel.find((m) => m.model === 'claude-sonnet');
    expect(claude?.cacheReadTokens).toBe(5000);
    expect(claude?.callCount).toBe(2);
  });

  test('estimateCostUsd threads cache tokens (backs appendCost / ai_runs.total_usd)', () => {
    // Uses the shared env-resolved estimator; without env pricing it falls to
    // DEFAULT_PRICING (input $3). Cache read has no cached rate there → billed at $3.
    const withCache = estimateCostUsd('unknown-model', 0, 0, { read: 1_000_000 });
    expect(withCache).toBeCloseTo(3.0, 6);
    // Pure zero usage still returns 0.
    expect(estimateCostUsd('unknown-model', 0, 0)).toBe(0);
  });

  test('loadPricingFromEnv parses optional cache rates and ignores non-numbers', () => {
    const prev = process.env.AISHA_MODEL_PRICING;
    process.env.AISHA_MODEL_PRICING = JSON.stringify({
      'x-*': { inputPer1M: 1, outputPer1M: 2, cachedInputPer1M: 0.1, cacheWritePer1M: 1.25 },
      'y-*': { inputPer1M: 1, outputPer1M: 2, cachedInputPer1M: 'nope' },
    });
    try {
      const table = loadPricingFromEnv();
      expect(table['x-*'].cachedInputPer1M).toBe(0.1);
      expect(table['x-*'].cacheWritePer1M).toBe(1.25);
      expect(table['y-*'].cachedInputPer1M).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.AISHA_MODEL_PRICING;
      else process.env.AISHA_MODEL_PRICING = prev;
    }
  });
});

describe('costAggregator — registry pricing table (get_model_pricing → −90% flow)', () => {
  test('maps get_model_pricing() rows to a pricing table carrying cached rate', () => {
    const rows: Record<string, RegistryModelPrice> = {
      'claude-3-5-sonnet-20241022': {
        input_per_m: 3.0,
        output_per_m: 15.0,
        cached_input_per_m: 0.3,
        provider: 'anthropic',
      },
      'gpt-4o': { input_per_m: 2.5, output_per_m: 10.0, cached_input_per_m: 1.25, provider: 'openai' },
    };
    const table = pricingTableFromRegistry(rows);
    expect(table['claude-3-5-sonnet-20241022'].cachedInputPer1M).toBe(0.3);

    // End-to-end: a cache-read on the registry-priced model bills at the −90% rate.
    const agg = createCostAggregator({ pricingTable: table });
    agg.record('claude-3-5-sonnet-20241022', 'main', 0, 0, { read: 1_000_000 });
    expect(agg.getSummary().totalCostUsd).toBeCloseTo(0.3, 6);
  });

  test('skips rows without usable input/output prices; tolerates null/undefined', () => {
    const rows: Record<string, RegistryModelPrice> = {
      good: { input_per_m: 1, output_per_m: 2, cached_input_per_m: 0.1 },
      // @ts-expect-error deliberately malformed row from the DB
      bad: { input_per_m: null, output_per_m: null, cached_input_per_m: null },
    };
    const table = pricingTableFromRegistry(rows);
    expect(table.good).toBeDefined();
    expect(table.bad).toBeUndefined();
    expect(pricingTableFromRegistry(null)).toEqual({});
  });

  test('a registry row without a cached rate leaves cache reads at full input (no invented discount)', () => {
    const table = pricingTableFromRegistry({
      m: { input_per_m: 2.0, output_per_m: 8.0, cached_input_per_m: null },
    });
    expect(table.m.cachedInputPer1M).toBeUndefined();
    const agg = createCostAggregator({ pricingTable: table });
    agg.record('m', 'main', 0, 0, { read: 1_000_000 });
    expect(agg.getSummary().totalCostUsd).toBeCloseTo(2.0, 6);
  });
});
