import type { ReactNode } from 'react';
import { Card } from '../foundation/Card';
import { LiveIndicator } from '../foundation/LiveIndicator';
import { Delta } from './Delta';
import { Sparkline } from './Sparkline';

export interface KpiTileProps {
  /** Small uppercase caption — the metric name (e.g. "Provozní efektivita (OEE)"). */
  caption: ReactNode;
  /** The big tabular value, already formatted (e.g. "82,4 %", "4,0 mld."). */
  value: ReactNode;
  /** Optional signed delta, already formatted (e.g. "+6,2 %"). */
  delta?: string;
  /** Direction of the delta — `up` = gain, `down` = loss. */
  deltaDirection?: 'up' | 'down';
  /** Trailing note next to the delta (e.g. "r/r", "t/t"). */
  deltaNote?: string;
  /** Optional sparkline trend values. */
  sparkline?: number[];
  /** Show a live (pulsing) indicator above the caption. */
  live?: boolean;
}

/**
 * KpiTile — the signature "timing-tower" KPI: caption → big tabular numeral →
 * signed delta → optional sparkline. Live tiles carry a pulsing Ignition dot.
 */
export const KpiTile = ({
  caption,
  value,
  delta,
  deltaDirection = 'up',
  deltaNote,
  sparkline,
  live = false,
}: KpiTileProps) => (
  <Card>
    {live ? <LiveIndicator /> : null}
    <div className="rdl-overline rdl-kpi__cap" style={live ? { marginTop: 8 } : undefined}>
      {caption}
    </div>
    <div className="rdl-kpi__val">{value}</div>
    {delta ? (
      <div className="rdl-kpi__delta">
        <Delta value={delta} direction={deltaDirection} note={deltaNote} />
      </div>
    ) : null}
    {sparkline && sparkline.length ? <Sparkline points={sparkline} /> : null}
  </Card>
);
