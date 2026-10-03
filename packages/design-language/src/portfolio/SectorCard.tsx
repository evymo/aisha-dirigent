import type { ReactNode } from 'react';
import { Card } from '../foundation/Card';
import { Button } from '../actions/Button';

export interface SectorCardProps {
  /** Which portfolio sector — drives the quiet wayfinding mark colour. */
  sector: 'stone' | 'automotive' | 'energy' | 'realestate' | 'coop';
  /** The sector label (e.g. "Kámen & těžba"). */
  label: ReactNode;
  /** The entity / heading (e.g. "Lomy & kamenictví"). */
  title: ReactNode;
  /** Up to ~3 key figures (mono, tabular). */
  figures?: ReadonlyArray<{ value: ReactNode; label: ReactNode }>;
  /** Detail link target (renders an anchor). */
  href?: string;
  /** Detail click handler (used when `href` is absent). */
  onDetail?: () => void;
}

// `color` tints the faint sector mark (a quiet reinforcement). `label` tints the
// overline; it's omitted for automotive because its graphite line colour is too
// dark to read as small text on the Carbon surface — there the label stays the
// default muted colour (matching the live styleguide's automotive card).
const SECTOR: Record<SectorCardProps['sector'], { color: string; glyph: string; label?: string }> = {
  stone: { color: '#6E6A62', glyph: '▰', label: '#6E6A62' },
  automotive: { color: '#3C4450', glyph: '◆' },
  energy: { color: '#9A7B17', glyph: '⏚', label: '#9A7B17' },
  realestate: { color: '#46606E', glyph: '▢', label: '#46606E' },
  coop: { color: '#5E5570', glyph: '⬡', label: '#5E5570' },
};

/**
 * SectorCard — a portfolio card: sector mark + label → entity name → 2–3 key
 * figures → ghost "Detail →". Hover lifts a 2px Ignition top-edge.
 */
export const SectorCard = ({ sector, label, title, figures = [], href, onDetail }: SectorCardProps) => {
  const s = SECTOR[sector];
  return (
    <Card hoverable className="rdl-sector-card">
      <div className="rdl-sector-mark" style={{ color: s.color }} aria-hidden="true">
        {s.glyph}
      </div>
      <div className="rdl-overline" style={s.label ? { color: s.label } : undefined}>
        {label}
      </div>
      <h3 className="rdl-h3" style={{ marginTop: 4 }}>
        {title}
      </h3>
      {figures.length ? (
        <div className="rdl-sector-figs">
          {figures.map((f, i) => (
            <div key={i}>
              <div className="rdl-sector-figs__n">{f.value}</div>
              <div className="rdl-sector-figs__l">{f.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      {href ? (
        <a className="rdl-btn rdl-btn--ghost" href={href}>
          Detail →
        </a>
      ) : (
        <Button variant="ghost" onClick={onDetail}>
          Detail →
        </Button>
      )}
    </Card>
  );
};
