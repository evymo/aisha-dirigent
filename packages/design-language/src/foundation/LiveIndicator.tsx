export interface LiveIndicatorProps {
  /** Label beside the dot. */
  label?: string;
  /** Animate the dot with the Ignition pulse (honors `prefers-reduced-motion`). */
  pulse?: boolean;
}

/**
 * LiveIndicator — a pulsing Ignition dot + label ("ŽIVÁ DATA") that marks a
 * live, updating value.
 */
export const LiveIndicator = ({ label = 'Live data', pulse = true }: LiveIndicatorProps) => (
  <span className="rdl-live">
    <span className={pulse ? 'rdl-dot rdl-dot--pulse' : 'rdl-dot'} />
    {label}
  </span>
);
