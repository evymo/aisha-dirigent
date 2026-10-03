/** Cell state machine for spreadsheet cells */
export type CellState = 'default' | 'focused' | 'editing';

/** Supported cell data types */
export type CellType = 'text' | 'number' | 'price' | 'combo' | 'toggle';

/** Column definition for spreadsheet editor */
export interface SpreadsheetColumn<TData = Record<string, unknown>> {
  /** Unique column key matching the data property */
  key: string;
  /** Display label (already translated) */
  label: string;
  /** Cell type determines the editor component */
  type: CellType;
  /** Whether column is editable (default: true) */
  editable?: boolean;
  /** Minimum column width in px */
  minWidth?: number;
  /** Combo box options — required when type is 'combo' */
  options?: { label: string; value: string }[];
  /** Custom value formatter for display mode */
  format?: (value: unknown, row: TData) => string;
  /** Validation function — return error message or undefined */
  validate?: (value: unknown, row: TData) => string | undefined;
}

/** Event emitted when a cell value changes */
export interface CellChangeEvent<TData = Record<string, unknown>> {
  /** Column key */
  columnKey: string;
  /** New value */
  value: unknown;
  /** Previous value */
  previousValue: unknown;
  /** Row data (before change) */
  row: TData;
  /** Row index */
  rowIndex: number;
}

/** Active cell position */
export interface CellPosition {
  col: number;
  row: number;
}
