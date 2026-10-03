import type { ReactNode, CSSProperties } from 'react';

export interface ThemeProps {
  /** Which theme to apply. Carbon is the dark brand signature; Daylight is the light working surface for documents, reports and contracts. */
  name?: 'carbon' | 'daylight';
  /** Paint the themed background (a standalone surface). Turn off to nest one theme inside another with a transparent background. */
  surface?: boolean;
  /** Add comfortable page padding around the content. */
  padded?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Theme — the RDL surface wrapper. Sets `data-theme` so every descendant reads
 * the right token values, and (by default) paints the themed background. Wrap a
 * screen or a panel in this; Carbon is the brand/dashboard default.
 */
export const Theme = ({ name = 'carbon', surface = true, padded = false, children, className, style }: ThemeProps) => {
  const cls = ['rdl-theme', !surface && 'rdl-theme--bare', padded && 'rdl-theme--pad', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div data-theme={name} className={cls} style={style}>
      {children}
    </div>
  );
};
