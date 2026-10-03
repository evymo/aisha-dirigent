import { useCallback, useState } from 'react';

/** Modal state variants */
export type ModalMode = 'closed' | 'confirm' | 'create' | 'detail' | 'edit';

export interface UseModalReturn<TData = unknown> {
  /** Close the modal and reset state */
  close: () => void;
  /** Data context passed when opening (e.g., row being edited) */
  data: TData | null;
  /** Whether any modal is open */
  isOpen: boolean;
  /** Current modal mode */
  mode: ModalMode;
  /** Open modal in a specific mode, optionally with data context */
  open: (mode: ModalMode, data?: TData) => void;
}

/**
 * Programmatic modal control hook — eliminates duplicate open/close states.
 * Supports create, edit, detail, and confirm dialog patterns.
 */
export function useModal<TData = unknown>(): UseModalReturn<TData> {
  const [mode, setMode] = useState<ModalMode>('closed');
  const [data, setData] = useState<TData | null>(null);

  const open = useCallback((nextMode: ModalMode, nextData?: TData) => {
    setMode(nextMode);
    setData(nextData ?? null);
  }, []);

  const close = useCallback(() => {
    setMode('closed');
    setData(null);
  }, []);

  const isOpen = mode !== 'closed';

  return {
    close,
    data,
    isOpen,
    mode,
    open,
  };
}
