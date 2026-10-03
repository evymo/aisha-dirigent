import { useState, useCallback, useRef, useEffect } from 'react';

import type { CellChangeEvent, CellPosition, CellState, SpreadsheetColumn } from './types';

interface UseSpreadsheetOptions<TData> {
  columns: SpreadsheetColumn<TData>[];
  data: TData[];
  onChange?: (event: CellChangeEvent<TData>) => void;
  onRowDelete?: (row: TData, rowIndex: number) => void;
  readonly?: boolean;
}

interface UseSpreadsheetReturn<TData> {
  activeCell: CellPosition | null;
  cellState: CellState;
  editValue: string;
  handleCellClick: (position: CellPosition) => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  setEditValue: (value: string) => void;
  startEditing: () => void;
  cancelEditing: () => void;
  confirmEditing: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Core state management hook for the spreadsheet editor.
 * Manages cell focus, editing state, keyboard navigation.
 */
export function useSpreadsheet<TData extends Record<string, unknown>>({
  columns,
  data,
  onChange,
  onRowDelete,
  readonly = false,
}: UseSpreadsheetOptions<TData>): UseSpreadsheetReturn<TData> {
  const [activeCell, setActiveCell] = useState<CellPosition | null>(null);
  const [cellState, setCellState] = useState<CellState>('default');
  const [editValue, setEditValue] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const editableColumns = columns.filter((c) => c.editable !== false);

  const getEditableColIndex = useCallback(
    (col: number): number => {
      const colKey = columns[col]?.key;
      return editableColumns.findIndex((c) => c.key === colKey);
    },
    [columns, editableColumns],
  );

  const findNextEditableCol = useCallback(
    (fromCol: number, direction: 1 | -1): number | null => {
      let col = fromCol + direction;
      while (col >= 0 && col < columns.length) {
        if (columns[col]?.editable !== false) {
          return col;
        }
        col += direction;
      }
      return null;
    },
    [columns],
  );

  const getCellValue = useCallback(
    (position: CellPosition): string => {
      const row = data[position.row];
      const col = columns[position.col];
      if (!row || !col) return '';
      const raw = row[col.key];
      return raw == null ? '' : String(raw);
    },
    [columns, data],
  );

  const startEditing = useCallback(() => {
    if (readonly || !activeCell) return;
    const col = columns[activeCell.col];
    if (col?.editable === false) return;
    setEditValue(getCellValue(activeCell));
    setCellState('editing');
  }, [activeCell, columns, getCellValue, readonly]);

  const cancelEditing = useCallback(() => {
    setCellState('focused');
    setEditValue('');
  }, []);

  const confirmEditing = useCallback(() => {
    if (!activeCell || cellState !== 'editing') return;
    const col = columns[activeCell.col];
    const row = data[activeCell.row];
    if (!col || !row) return;

    const previousValue = row[col.key];
    let value: unknown = editValue;

    if (col.type === 'number' || col.type === 'price') {
      value = editValue === '' ? null : Number(editValue);
    }
    if (col.type === 'toggle') {
      value = editValue === 'true';
    }

    if (col.validate) {
      const error = col.validate(value, row as TData);
      if (error) {
        // Keep editing if validation fails
        return;
      }
    }

    if (onChange && value !== previousValue) {
      onChange({
        columnKey: col.key,
        previousValue,
        row: row as TData,
        rowIndex: activeCell.row,
        value,
      });
    }

    setCellState('focused');
    setEditValue('');
  }, [activeCell, cellState, columns, data, editValue, onChange]);

  const handleCellClick = useCallback(
    (position: CellPosition) => {
      if (cellState === 'editing') {
        confirmEditing();
      }
      setActiveCell(position);
      setCellState('focused');
    },
    [cellState, confirmEditing],
  );

  const moveTo = useCallback(
    (row: number, col: number) => {
      if (row < 0 || row >= data.length || col < 0 || col >= columns.length) return;
      if (cellState === 'editing') {
        confirmEditing();
      }
      setActiveCell({ col, row });
      setCellState('focused');
    },
    [cellState, columns.length, confirmEditing, data.length],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!activeCell) return;

      switch (event.key) {
        case 'F2':
          event.preventDefault();
          if (cellState === 'focused') {
            startEditing();
          }
          break;

        case 'Enter':
          event.preventDefault();
          if (cellState === 'editing') {
            confirmEditing();
            moveTo(activeCell.row + 1, activeCell.col);
          } else if (cellState === 'focused') {
            startEditing();
          }
          break;

        case 'Escape':
          event.preventDefault();
          if (cellState === 'editing') {
            cancelEditing();
          } else {
            setActiveCell(null);
            setCellState('default');
          }
          break;

        case 'Tab': {
          event.preventDefault();
          const nextCol = findNextEditableCol(activeCell.col, event.shiftKey ? -1 : 1);
          if (nextCol !== null) {
            moveTo(activeCell.row, nextCol);
          } else {
            // Wrap to next/prev row
            const nextRow = activeCell.row + (event.shiftKey ? -1 : 1);
            if (nextRow >= 0 && nextRow < data.length) {
              const firstEditable = event.shiftKey
                ? findNextEditableCol(columns.length, -1)
                : findNextEditableCol(-1, 1);
              if (firstEditable !== null) {
                moveTo(nextRow, firstEditable);
              }
            }
          }
          break;
        }

        case 'ArrowDown':
          if (cellState !== 'editing') {
            event.preventDefault();
            moveTo(activeCell.row + 1, activeCell.col);
          }
          break;

        case 'ArrowUp':
          if (cellState !== 'editing') {
            event.preventDefault();
            moveTo(activeCell.row - 1, activeCell.col);
          }
          break;

        case 'ArrowRight':
          if (cellState !== 'editing') {
            event.preventDefault();
            const next = findNextEditableCol(activeCell.col, 1);
            if (next !== null) moveTo(activeCell.row, next);
          }
          break;

        case 'ArrowLeft':
          if (cellState !== 'editing') {
            event.preventDefault();
            const prev = findNextEditableCol(activeCell.col, -1);
            if (prev !== null) moveTo(activeCell.row, prev);
          }
          break;

        case 'Delete':
          if (cellState === 'focused' && onRowDelete) {
            event.preventDefault();
            onRowDelete(data[activeCell.row] as TData, activeCell.row);
          }
          break;

        default:
          // Start typing to begin editing
          if (
            cellState === 'focused' &&
            !readonly &&
            event.key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            columns[activeCell.col]?.editable !== false
          ) {
            setEditValue('');
            setCellState('editing');
          }
          break;
      }
    },
    [
      activeCell,
      cancelEditing,
      cellState,
      columns,
      confirmEditing,
      data,
      findNextEditableCol,
      moveTo,
      onRowDelete,
      readonly,
      startEditing,
    ],
  );

  // Focus container when active cell changes
  useEffect(() => {
    if (activeCell && containerRef.current) {
      containerRef.current.focus();
    }
  }, [activeCell]);

  return {
    activeCell,
    cancelEditing,
    cellState,
    confirmEditing,
    containerRef,
    editValue,
    handleCellClick,
    handleKeyDown,
    setEditValue,
    startEditing,
  };
}
