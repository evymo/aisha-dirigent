export interface ThemeToggleProps {
  /** The active theme. */
  value?: 'carbon' | 'daylight';
  /** Called with the chosen theme when a segment is clicked. */
  onChange?: (theme: 'carbon' | 'daylight') => void;
  /** Accessible group label — pass the shell's translated string. */
  ariaLabel?: string;
}

/**
 * ThemeToggle — the Carbon/Daylight switch for the cockpit shell and styleguide.
 * Pair it with `Theme` to drive the rendered theme.
 */
export const ThemeToggle = ({ value = 'carbon', onChange, ariaLabel = 'Theme' }: ThemeToggleProps) => (
  <div className="rdl-theme-toggle" role="group" aria-label={ariaLabel}>
    {(['carbon', 'daylight'] as const).map((t) => (
      <button
        key={t}
        type="button"
        className={value === t ? 'rdl-theme-toggle__btn is-active' : 'rdl-theme-toggle__btn'}
        aria-pressed={value === t}
        onClick={() => onChange?.(t)}
      >
        {t === 'carbon' ? 'Carbon' : 'Daylight'}
      </button>
    ))}
  </div>
);
