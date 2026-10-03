import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual role. `primary` is the one Ignition action per view; `danger` is destructive only; `ghost` is a tertiary text link. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  children?: ReactNode;
}

/**
 * Button — the action control. One primary (Ignition) action per view; ghost
 * for tertiary links like "Zobrazit detail →". Sharp radius, visible focus ring.
 */
export const Button = ({ variant = 'primary', className, children, type = 'button', ...rest }: ButtonProps) => (
  <button
    type={type}
    className={['rdl-btn', `rdl-btn--${variant}`, className].filter(Boolean).join(' ')}
    {...rest}
  >
    {children}
  </button>
);
