export interface SparklineProps {
  /** Y values; scaled to fit the viewport. */
  points: number[];
  /** Stroke colour (defaults to the Ignition primary series). */
  color?: string;
  /** Intrinsic width of the SVG viewport. */
  width?: number;
  /** Intrinsic height of the SVG viewport. */
  height?: number;
}

/**
 * Sparkline — a thin telemetry-style trend line for KPI tiles and inline
 * trends. Primary series in Ignition; reads like a timing/telemetry screen.
 */
export const Sparkline = ({ points, color = 'var(--primary)', width = 240, height = 34 }: SparklineProps) => {
  if (!points.length) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const path = points
    .map((p, i) => `${(i * step).toFixed(1)},${(height - ((p - min) / span) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      className="rdl-spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      aria-hidden="true"
    >
      <polyline fill="none" stroke={color} strokeWidth={2} points={path} />
    </svg>
  );
};
