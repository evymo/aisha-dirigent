import type { RefObject } from 'react';

import { cn } from '@/lib/utils';

import { SpreadsheetCell } from './SpreadsheetCell';
import type { CellChangeEvent, CellPosition, SpreadsheetColumn } from './types';
import { useSpreadsheet } from './useSpreadsheet';

interface SpreadsheetEditorProps<TData extends Record<string, unknown>> {
  /** Column definitions */
  columns: SpreadsheetColumn<TData>[];
  /** Row data */
  data: TData[];
  /** Called when a cell value changes */
  onChange?: (event: CellChangeEvent<TData>) => void;
  /** Called when Delete is pressed on a focused row */
  onRowDelete?: (row: TData, rowIndex: number) => void;
  /** Prevent all edits */
  readonly?: boolean;
  /** Unique row key extractor (defaults to row index) */
  rowKey?: (row: TData, index: number) => string;
}

/**
 * Spreadsheet-style inline editor for data-dense admin screens.
 * Supports Tab/Enter/Arrow navigation, F2 to edit, Escape to cancel.
 */
export function SpreadsheetEditor<TData extends Record<string, unknown>>({
  columns,
  data,
  onChange,
  onRowDelete,
  readonly = false,
  rowKey,
}: SpreadsheetEditorProps<TData>) {
  const {
    activeCell,
    cellState,
    confirmEditing,
    containerRef,
    editValue,
    handleCellClick,
    handleKeyDown,
    setEditValue,
  } = useSpreadsheet({
    columns,
    data,
    onChange,
    onRowDelete,
    readonly,
  });

  const getRowKey = rowKey ?? ((_: TData, i: number) => String(i));

  const getCellDisplayValue = (row: TData, col: SpreadsheetColumn<TData>): string => {
    const raw = row[col.key];
    if (col.format) return col.format(raw, row);
    return raw == null ? '' : String(raw);
  };

  return (
    <div
      className="relative overflow-auto rounded-md border bg-card focus:outline-none"
      onKeyDown={handleKeyDown}
      ref={containerRef as RefObject<HTMLDivElement>}
      role="grid"
      tabIndex={0}
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/50">
            {columns.map((col) => (
              <th
                className={cn(
                  'px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground',
                )}
                key={col.key}
                style={col.minWidth ? { minWidth: col.minWidth } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr
              className={cn(
                'border-b transition-colors hover:bg-muted/30',
                activeCell?.row === rowIndex && 'bg-muted/20',
              )}
              key={getRowKey(row, rowIndex)}
            >
              {columns.map((col, colIndex) => {
                const isActive =
                  activeCell?.row === rowIndex && activeCell?.col === colIndex;
                return (
                  <SpreadsheetCell
                    active={isActive}
                    cellState={isActive ? cellState : 'default'}
                    columnKey={col.key}
                    displayValue={getCellDisplayValue(row, col)}
                    editValue={isActive ? editValue : ''}
                    key={col.key}
                    onCellClick={() => handleCellClick({ col: colIndex, row: rowIndex })}
                    onEditValueChange={setEditValue}
                    options={col.options}
                    readonly={readonly || col.editable === false}
                    type={col.type}
                  />
                );
              })}
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td
                className="py-8 text-center text-muted-foreground"
                colSpan={columns.length}
              >
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Keyboard hints bar */}
      <div className="flex items-center gap-4 border-t bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
        <span><kbd className="shortcut-hint">F2</kbd> Edit</span>
        <span><kbd className="shortcut-hint">Tab</kbd> Next</span>
        <span><kbd className="shortcut-hint">Enter</kbd> Confirm</span>
        <span><kbd className="shortcut-hint">Esc</kbd> Cancel</span>
        <span><kbd className="shortcut-hint">Del</kbd> Delete row</span>
      </div>
    </div>
  );
}
