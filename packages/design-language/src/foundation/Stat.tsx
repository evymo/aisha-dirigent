import type { ReactNode } from 'react';

export interface StatProps {
  /** The headline figure, already formatted Czech-style (e.g. "4 mld. Kč", "1 000+"). Numerals are tabular. */
  value: ReactNode;
  /** Optional caption beneath the figure. */
  label?: ReactNode;
  /** Visual scale: `stat` (KPI numeral) or `display` (hero timing-tower). */
  size?: 'stat' | 'display';
}

/**
 * Stat — a large tabular "timing-tower" numeral for hero and KPI figures,
 * presented like a motorsport timing screen.
 */
export const Stat = ({ value, label, size = 'stat' }: StatProps) => (
  <div>
    <div className={size === 'display' ? 'rdl-display' : 'rdl-stat'}>{value}</div>
    {label ? (
      <div className="rdl-muted" style={{ marginTop: 6, fontSize: 13 }}>
        {label}
      </div>
    ) : null}
  </div>
);
