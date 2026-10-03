import { describe, it, expect } from "vitest";
import { estimateSpendUsd, promptCharsOf } from "../lib/spendEstimate.js";

/**
 * GAP E + DD-1: the admission spend estimate is size-aware when the RESOLVED model's
 * registry price RATE (input/output per-million) is supplied, and returns null — defer to
 * the DB catalog/history — when no rate is known. It NEVER invents a synthetic app price
 * constant. Pins the shared estimator both /chat and /v1 use.
 */
describe("estimateSpendUsd (size-aware admission estimate, registry-priced)", () => {
  it("returns null when NO price rate is known — admission defers to the DB catalog (DD-1)", () => {
    expect(estimateSpendUsd(100, 500)).toBeNull();
    expect(estimateSpendUsd(4_000_000, 500)).toBeNull(); // even a huge request: no synthetic rate
  });

  it("scales with prompt size when a rate IS supplied (the registry case)", () => {
    const small = estimateSpendUsd(100, 500, 1, 3)!;
    const huge = estimateSpendUsd(4_000_000, 500, 1, 3)!; // ~1M prompt tokens
    expect(huge).toBeGreaterThan(small);
  });

  it("is monotonic in maxTokens when priced (bigger completion budget ⇒ bigger estimate)", () => {
    expect(estimateSpendUsd(100, 8000, 1, 3)!).toBeGreaterThan(estimateSpendUsd(100, 100, 1, 3)!);
  });

  it("honors the resolved model's pricing rate (premium > budget)", () => {
    const dear = estimateSpendUsd(40_000, 2000, 15, 60)!;
    const cheap = estimateSpendUsd(40_000, 2000, 1, 3)!;
    expect(dear).toBeGreaterThan(cheap);
  });

  it("when priced: never zero, finite, negative inputs clamped", () => {
    expect(estimateSpendUsd(0, 0, 1, 3)!).toBeGreaterThan(0);
    expect(estimateSpendUsd(-5, -5, 1, 3)!).toBeGreaterThan(0);
    expect(Number.isFinite(estimateSpendUsd(123, 456, 1, 3)!)).toBe(true);
  });

  it("a single known rate (input-only or output-only) still prices, not null", () => {
    expect(estimateSpendUsd(1000, 1000, 1, undefined)).not.toBeNull();
    expect(estimateSpendUsd(1000, 1000, undefined, 3)).not.toBeNull();
  });

  it("promptCharsOf sums message content lengths (the /v1 → shared bridge)", () => {
    expect(promptCharsOf([{ content: "ab" }, { content: "cde" }])).toBe(5);
    expect(promptCharsOf([])).toBe(0);
  });
});
