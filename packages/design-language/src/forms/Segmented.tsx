export interface SegmentedOption {
  label: string;
  value: string;
}

export interface SegmentedProps {
  /** The segments. A bare string is shorthand for `{ label, value }` with value = label. */
  options: ReadonlyArray<{ label: string; value: string } | string>;
  /** The selected value. */
  value?: string;
  /** Called with the new value when a segment is clicked. */
  onChange?: (value: string) => void;
  /** Accessible label for the group. */
  ariaLabel?: string;
}

/**
 * Segmented — a compact single-select control for ranges and filters
 * (24 h · 7 dní · 30 dní · Kvartál). Shares the input radius and focus treatment.
 */
export const Segmented = ({ options, value, onChange, ariaLabel }: SegmentedProps) => (
  <div className="rdl-segmented" role="group" aria-label={ariaLabel}>
    {options.map((o) => {
      const opt = typeof o === 'string' ? { label: o, value: o } : o;
      const on = opt.value === value;
      return (
        <button
          key={opt.value}
          type="button"
          className={on ? 'rdl-segmented__btn is-on' : 'rdl-segmented__btn'}
          aria-pressed={on}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);
