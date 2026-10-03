export interface DeltaProps {
  /** The change, already formatted (e.g. "+4,2 %", "−1,8"). The arrow and colour are added automatically. */
  value: string;
  /** `up` = gain (green), `down` = loss (red). Always paired with an arrow + sign — never colour alone. */
  direction: 'up' | 'down';
  /** Optional trailing note (e.g. "r/r", "t/t", "vs plán"). */
  note?: string;
}

/**
 * Delta — a signed, arrowed change in Gain/Loss colour. Finance-safe: red means
 * loss, green means gain, and the sign + arrow carry the meaning, never colour alone.
 */
export const Delta = ({ value, direction, note }: DeltaProps) => (
  <span className={`rdl-delta rdl-delta--${direction}`}>
    {direction === 'up' ? '▲' : '▼'} {value}
    {note ? <span className="rdl-delta__note">{note}</span> : null}
  </span>
);
