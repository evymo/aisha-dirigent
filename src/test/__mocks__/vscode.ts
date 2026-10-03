/**
 * Minimal vscode mock for vitest extension tests.
 *
 * Provides stub implementations of workspace.getConfiguration and
 * window message functions so extension code can be imported directly.
 *
 * Tests override behavior via vi.mocked() on the exported fns.
 *
 * @module
 */
import { vi } from "vitest";

export const workspace = {
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(""),
  }),
};

export const window = {
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
};

export const l10n = {
  t: vi.fn((message: string, ...args: unknown[]) =>
    message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? `{${i}}`)),
  ),
};

export const Uri = {
  parse: vi.fn((s: string) => ({ toString: () => s })),
  file: vi.fn((s: string) => ({ toString: () => s })),
};

/** Minimal EventEmitter mock matching vscode.EventEmitter API. */
export class EventEmitter<T = void> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners = [];
  }
}
