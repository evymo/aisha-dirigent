import type { ReactNode } from 'react';

export interface TopBarProps {
  /** Brand/wordmark slot (left). REQUIRED: the wordmark is instance identity
   *  and a generic package must not ship anyone's — pass it from the shell,
   *  which reads it from the instance overlay (i18n/config). */
  brand: ReactNode;
  /** Right-aligned content (global search, environment/sector switcher, user menu, theme toggle). */
  children?: ReactNode;
  /** Stick the bar to the top of its scroll container. */
  sticky?: boolean;
}

/**
 * TopBar — the cockpit shell top bar (56px): wordmark left, the ask-data search
 * and switchers right. Carbon by default in the cockpit.
 */
export const TopBar = ({ brand, children, sticky = false }: TopBarProps) => (
  <header
    className="rdl-topbar"
    style={sticky ? { position: 'sticky', top: 0, zIndex: 30 } : undefined}
  >
    <div className="rdl-topbar__in">
      {brand}
      <span className="rdl-spacer" />
      {children}
    </div>
  </header>
);
