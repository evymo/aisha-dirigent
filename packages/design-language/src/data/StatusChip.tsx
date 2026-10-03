import type { ReactNode } from 'react';

export interface StatusChipProps {
  /** Operational state. Each maps to a finance-safe functional colour. */
  status: 'run' | 'idle' | 'fault' | 'plan' | 'unknown';
  /** The label text — pass the shell's translated string. */
  children?: ReactNode;
}

/** Last-resort labels. The shell passes translated text as `children`; these
 *  exist only so a label-less chip still says something rather than nothing.
 *  Neutral English on purpose — a generic package ships no locale. */
const STATUS_LABEL: Record<StatusChipProps['status'], string> = {
  run: 'Running',
  idle: 'Idle',
  fault: 'Fault',
  plan: 'Planned',
  unknown: 'Unknown',
};

/**
 * StatusChip — an operational status pill with a leading dot. Always dot + word,
 * never colour alone: running (gain), idle (warning), fault (loss),
 * planned (info), unknown (neutral). Pass translated text as `children`.
 */
export const StatusChip = ({ status, children }: StatusChipProps) => (
  <span className={`rdl-chip rdl-chip--${status}`}>
    <span className="rdl-chip__d" />
    {children ?? STATUS_LABEL[status]}
  </span>
);
