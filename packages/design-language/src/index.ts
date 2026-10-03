// AISHA surface design language — public entry.
// Every PascalCase value export here is a component the design system ships.
// (The `rdl-` class prefix is the language's historical short name; it names
// the design language, not any instance — instances brand via tokens only.)

// Foundation
export { Theme } from './foundation/Theme';
export type { ThemeProps } from './foundation/Theme';
export { Overline } from './foundation/Overline';
export type { OverlineProps } from './foundation/Overline';
export { Stat } from './foundation/Stat';
export type { StatProps } from './foundation/Stat';
export { LiveIndicator } from './foundation/LiveIndicator';
export type { LiveIndicatorProps } from './foundation/LiveIndicator';
export { Card } from './foundation/Card';
export { Skeleton } from './foundation/Skeleton';
export { PendingPanel } from './foundation/PendingPanel';
export type { PendingPanelProps } from './foundation/PendingPanel';
export type { SkeletonProps } from './foundation/Skeleton';
export type { CardProps } from './foundation/Card';

// Actions
export { Button } from './actions/Button';
export type { ButtonProps } from './actions/Button';

// Forms
export { TextField } from './forms/TextField';
export type { TextFieldProps } from './forms/TextField';
export { Segmented } from './forms/Segmented';
export type { SegmentedProps, SegmentedOption } from './forms/Segmented';

// Data
export { KpiTile } from './data/KpiTile';
export type { KpiTileProps } from './data/KpiTile';
export { Delta } from './data/Delta';
export type { DeltaProps } from './data/Delta';
export { Sparkline } from './data/Sparkline';
export type { SparklineProps } from './data/Sparkline';
export { StatusChip } from './data/StatusChip';
export type { StatusChipProps } from './data/StatusChip';
export { ProvenanceBadge } from './data/ProvenanceBadge';
export type { ProvenanceBadgeProps } from './data/ProvenanceBadge';
export { DataTable } from './data/DataTable';
export type { DataTableProps, DataTableColumn } from './data/DataTable';
export { Circuit } from './data/Circuit';
export type { CircuitProps, CircuitMarker } from './data/Circuit';

// Portfolio
export { SectorCard } from './portfolio/SectorCard';
export type { SectorCardProps } from './portfolio/SectorCard';

// AI
export { AskPanel } from './ai/AskPanel';
export type { AskPanelProps } from './ai/AskPanel';

// Charts
export { ChartCard } from './charts/ChartCard';
export type { ChartCardProps } from './charts/ChartCard';

// Layout
export { TopBar } from './layout/TopBar';
export type { TopBarProps } from './layout/TopBar';
export { Footer } from './layout/Footer';
export type { FooterProps } from './layout/Footer';
export { ThemeToggle } from './layout/ThemeToggle';
export type { ThemeToggleProps } from './layout/ThemeToggle';
