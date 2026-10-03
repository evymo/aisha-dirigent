import type { ReactNode } from 'react';
import { StatusChip } from '../data/StatusChip';

export interface PendingPanelProps {
  /** What this surface WILL show once it has a source. */
  title: ReactNode;
  /** Short status word, e.g. "waiting for a source". */
  statusLabel: ReactNode;
  /** Why it is not live yet — one honest sentence. */
  reason?: ReactNode;
  /** What happens next, and what it waits for. One step per item. */
  steps?: ReadonlyArray<ReactNode>;
  /** Heading above the steps. */
  stepsLabel?: ReactNode;
}

/**
 * PendingPanel — a declared-but-not-yet-connected surface.
 *
 * The third state, next to "has data" and "does not exist". Hiding such a
 * section would tell the customer the product cannot do it; leaving it active
 * and empty looks broken. So it stays VISIBLE, muted, and says out loud what it
 * will show, why it is dark, and what it is waiting for — the roadmap is part of
 * the product, not a secret.
 *
 * Deliberately never renders a figure: a placeholder number here would be the
 * one thing worse than an empty panel, because it would be believed.
 */
export const PendingPanel = ({
  title,
  statusLabel,
  reason,
  steps = [],
  stepsLabel,
}: PendingPanelProps) => (
  <section className="rdl-pending">
    <header className="rdl-pending__head">
      <h3 className="rdl-pending__title">{title}</h3>
      <StatusChip status="plan">{statusLabel}</StatusChip>
    </header>
    {reason ? <p className="rdl-pending__reason">{reason}</p> : null}
    {steps.length ? (
      <div className="rdl-pending__next">
        {stepsLabel ? <div className="rdl-overline">{stepsLabel}</div> : null}
        <ol className="rdl-pending__steps">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
    ) : null}
  </section>
);
