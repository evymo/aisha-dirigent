import { useEffect } from 'react';

export interface KeyboardShortcutsOptions {
  enabled?: boolean;
  onArrowDown?: () => void;
  onArrowUp?: () => void;
  onDelete?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onF2?: () => void;
  onF4?: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * Registers keyboard shortcuts for data-dense admin screens.
 * The hook ignores input-like elements to avoid intercepting normal typing.
 */
export function useKeyboardShortcuts({
  enabled = true,
  onArrowDown,
  onArrowUp,
  onDelete,
  onEnter,
  onEscape,
  onF2,
  onF4,
}: KeyboardShortcutsOptions): void {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const typingTarget = isTypingTarget(event.target);

      if (!typingTarget) {
        if (event.key === 'F2' && onF2) {
          event.preventDefault();
          onF2();
          return;
        }

        if (event.key === 'F4' && onF4) {
          event.preventDefault();
          onF4();
          return;
        }

        if (event.key === 'Delete' && onDelete) {
          event.preventDefault();
          onDelete();
          return;
        }

        if (event.key === 'ArrowDown' && onArrowDown) {
          event.preventDefault();
          onArrowDown();
          return;
        }

        if (event.key === 'ArrowUp' && onArrowUp) {
          event.preventDefault();
          onArrowUp();
          return;
        }
      }

      if (event.key === 'Enter' && onEnter && !typingTarget) {
        event.preventDefault();
        onEnter();
        return;
      }

      if (event.key === 'Escape' && onEscape) {
        event.preventDefault();
        onEscape();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, onArrowDown, onArrowUp, onDelete, onEnter, onEscape, onF2, onF4]);
}