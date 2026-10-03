import type { ReactNode, CSSProperties } from 'react';

export interface CardProps {
  children?: ReactNode;
  /** Lift with a soft shadow on hover (otherwise separation is a 1px border — edges over shadows). */
  hoverable?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Card — the base surface: 1px border, sharp radius, no shadow by default. The
 * building block for KPI tiles, sector cards, panels and data containers.
 */
export const Card = ({ children, hoverable = false, className, style }: CardProps) => (
  <div
    className={['rdl-card', hoverable && 'rdl-card--hoverable', className].filter(Boolean).join(' ')}
    style={style}
  >
    {children}
  </div>
);
