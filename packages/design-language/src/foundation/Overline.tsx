import type { ReactNode, CSSProperties } from 'react';

export interface OverlineProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Overline — the uppercase eyebrow/label workhorse: KPI captions, section
 * labels, telemetry tags (e.g. "PROVOZ MOST · ŽIVÁ DATA").
 */
export const Overline = ({ children, className, style }: OverlineProps) => (
  <div className={['rdl-overline', className].filter(Boolean).join(' ')} style={style}>
    {children}
  </div>
);
