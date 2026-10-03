/**
 * Shared budget/cost formatting helpers for the Mission Control kanban.
 * Kept separate from the component file so fast-refresh stays component-only.
 */

export type BudgetState = "ok" | "approaching" | "stopped";

/** Compact USD formatter for cost + budget chips. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
