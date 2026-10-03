import type { ReactNode } from 'react';
import { ProvenanceBadge } from '../data/ProvenanceBadge';

export interface ChartCardProps {
  /** Chart title. */
  title: ReactNode;
  /** The range eyebrow (e.g. "OEE · posledních 14 dní"). */
  range?: ReactNode;
  /** Provenance source for the header badge. */
  source?: string;
  /** Source freshness for the header badge. */
  freshness?: string;
  /** The chart itself — a telemetry-style SVG/canvas (thin lines, gridded, tabular labels). */
  children?: ReactNode;
}

/**
 * ChartCard — a telemetry chart container: header (title + range eyebrow +
 * provenance badge) over the chart. Border, no shadow; primary series Ignition.
 */
export const ChartCard = ({ title, range, source, freshness, children }: ChartCardProps) => (
  <div className="rdl-chartcard">
    <div className="rdl-chartcard__head">
      <div>
        <h3 className="rdl-h3">{title}</h3>
        {range ? (
          <div className="rdl-overline" style={{ marginTop: 4 }}>
            {range}
          </div>
        ) : null}
      </div>
      {source ? <ProvenanceBadge source={source} freshness={freshness} /> : null}
    </div>
    {children}
  </div>
);
