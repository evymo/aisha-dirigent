import { useCallback, useEffect, useRef, useState } from 'react';

export interface TableKeyboardOptions {
  /** Whether keyboard navigation is active (default: true) */
  enabled?: boolean;
  /** Called when Enter is pressed on active row */
  onEnter?: (rowIndex: number) => void;
  /** Total number of visible rows */
  rowCount: number;
}

export interface TableKeyboardReturn {
  /** Currently focused row index (-1 = none) */
  activeRowIndex: number;
  /** Ref to attach to the table container for event delegation */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Clear active row */
  clearActiveRow: () => void;
  /** Set active row programmatically */
  setActiveRow: (index: number) => void;
}

/**
 * Arrow key row navigation for DataTable.
 * Attach containerRef to the table wrapper and use activeRowIndex to highlight rows.
 */
export function useTableKeyboard({
  enabled = true,
  onEnter,
  rowCount,
}: TableKeyboardOptions): TableKeyboardReturn {
  const [activeRowIndex, setActiveRowIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const clearActiveRow = useCallback(() => {
    setActiveRowIndex(-1);
  }, []);

  const setActiveRow = useCallback(
    (index: number) => {
      if (index >= 0 && index < rowCount) {
        setActiveRowIndex(index);
      }
    },
    [rowCount],
  );

  useEffect(() => {
    if (!enabled) return undefined;

    const container = containerRef.current;
    if (!container) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setActiveRowIndex((prev) => {
            const next = prev < rowCount - 1 ? prev + 1 : prev;
            return next;
          });
          break;

        case 'ArrowUp':
          event.preventDefault();
          setActiveRowIndex((prev) => {
            const next = prev > 0 ? prev - 1 : 0;
            return next;
          });
          break;

        case 'Enter':
          if (activeRowIndex >= 0 && onEnter) {
            event.preventDefault();
            onEnter(activeRowIndex);
          }
          break;

        case 'Escape':
          event.preventDefault();
          setActiveRowIndex(-1);
          break;

        default:
          break;
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeRowIndex, enabled, onEnter, rowCount]);

  // Reset active row when row count changes (e.g., filtering)
  useEffect(() => {
    if (activeRowIndex >= rowCount) {
      setActiveRowIndex(Math.max(0, rowCount - 1));
    }
  }, [activeRowIndex, rowCount]);

  // Scroll active row into view
  useEffect(() => {
    if (activeRowIndex < 0 || !containerRef.current) return;
    const rows = containerRef.current.querySelectorAll('tbody tr');
    const activeRow = rows[activeRowIndex];
    if (activeRow) {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeRowIndex]);

  return {
    activeRowIndex,
    clearActiveRow,
    containerRef,
    setActiveRow,
  };
}
