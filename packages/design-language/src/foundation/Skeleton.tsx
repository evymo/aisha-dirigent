export interface SkeletonProps {
  /** How many placeholder cards to draw. */
  count?: number;
  /** Draw a leading row of KPI-sized tiles (the cockpit's usual first row). */
  kpis?: number;
  /** Accessible label announced while content loads. */
  label?: string;
}

/**
 * Skeleton — what a surface shows while its data is in flight.
 *
 * The point is that the PAGE DOES NOT MOVE: the placeholders occupy the same
 * grid the real blocks will, so content arrives into a shape the eye already
 * settled on. A bare spinner (or a lone "…") reads as breakage — the product
 * looks unrendered rather than loading, which is exactly the impression a
 * cockpit must never give.
 *
 * `aria-busy` + a polite live label keep the announcement honest for a screen
 * reader; the shimmer itself is decorative and hidden from the tree.
 */
export const Skeleton = ({ count = 3, kpis = 0, label = 'Loading…' }: SkeletonProps) => (
  <div className="rdl-skel" aria-busy="true" aria-live="polite" aria-label={label}>
    {kpis > 0 ? (
      <div className="rdl-skel__kpis" aria-hidden="true">
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="rdl-skel__kpi">
            <span className="rdl-skel__line rdl-skel__line--cap" />
            <span className="rdl-skel__line rdl-skel__line--num" />
          </div>
        ))}
      </div>
    ) : null}
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="rdl-skel__card" aria-hidden="true">
        <span className="rdl-skel__line rdl-skel__line--title" />
        <span className="rdl-skel__line" />
        <span className="rdl-skel__line rdl-skel__line--short" />
      </div>
    ))}
  </div>
);
