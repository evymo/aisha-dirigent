/**
 * Minimal vscode mock for extension unit tests.
 * Covers: config, auth, compute-tier, tree-view, session-manager, resource-tracker.
 */

// ── Config store for tests ──────────────────────────────────────────
const mockConfigStore: Record<string, unknown> = {};

/** Set a mocked configuration value. Call from tests. */
export function __setMockConfig(key: string, value: unknown): void {
  mockConfigStore[key] = value;
}

/** Clear all mocked configuration values. */
export function __clearMockConfig(): void {
  for (const k of Object.keys(mockConfigStore)) delete mockConfigStore[k];
}

export const workspace = {
  workspaceFolders: null as { uri: { fsPath: string } }[] | null,
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: unknown) => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in mockConfigStore ? mockConfigStore[fullKey] : (defaultValue ?? "");
    },
  }),
  createFileSystemWatcher: () => ({
    onDidChange: () => ({ dispose: () => {} }),
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  fs: {
    // Default: throw "file not found" so callers' try/catch around readFile
    // can take the "file doesn't exist" branch. Tests that need to simulate
    // an EXISTING file with specific content should override this per-test
    // via vi.spyOn or direct property assignment. Returning empty Uint8Array
    // instead is a foot-gun: code paths that read+check-for-marker (e.g.
    // safeWrite's refuse-user-owned guard) see "" content and treat the
    // file as user-owned, refusing to write the canonical content.
    readFile: async () => { throw new Error("ENOENT: mock file not found"); },
    writeFile: async () => {},
    createDirectory: async () => {},
    stat: async () => { throw new Error("not found"); },
  },
};

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
  };
  fire(data: T) {
    for (const l of this.listeners) l(data);
  }
  dispose() {
    this.listeners = [];
  }
}

export const window = {
  showInputBox: async () => undefined as string | undefined,
  showQuickPick: async () => undefined,
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  registerTreeDataProvider: () => ({ dispose: () => {} }),
  createOutputChannel: (name: string) => ({
    appendLine: () => {},
    dispose: () => {},
    name,
  }),
  withProgress: async <T>(
    _options: unknown,
    task: (
      progress: { report: (value: { increment?: number; message?: string }) => void },
      token: { isCancellationRequested: boolean; onCancellationRequested: (cb: () => void) => { dispose: () => void } },
    ) => Promise<T>,
  ): Promise<T> => {
    const progress = { report: () => {} };
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    };
    return task(progress, token);
  },
};

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => {},
};

export const chat = {
  createChatParticipant: () => ({
    iconPath: undefined,
    followupProvider: undefined,
  }),
};

export class Disposable {
  constructor(private fn: () => void) {}
  dispose() { this.fn(); }
  static from(...disposables: { dispose: () => void }[]): Disposable {
    return new Disposable(() => { for (const d of disposables) d.dispose(); });
  }
}

export const Uri = {
  joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
    fsPath: [base.fsPath, ...parts].join("/"),
  }),
  file: (p: string) => ({ fsPath: p }),
  parse: (value: string) => ({ fsPath: value, toString: () => value }),
};

// VS Code's UIKind enum — distinguishes Desktop vs Web embedding.
// auth.ts uses `vscode.env.uiKind === vscode.UIKind.Desktop` to pick
// the right OAuth callback URI strategy. Mock the enum so tests don't
// crash on the property access; tests default to Desktop (most common
// dev environment).
export enum UIKind {
  Desktop = 1,
  Web = 2,
}

export const env = {
  openExternal: async () => true,
  uriScheme: "vscode",
  uiKind: UIKind.Desktop,
  asExternalUri: async (uri: { fsPath: string; toString?: () => string }) => uri,
};

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

// VS Code's FileType enum — used by workspace.fs.readDirectory consumers
// (e.g. file-safety.ts::rotateBackups filters readDirectory entries by
// `type === vscode.FileType.File`). Mirror the real values.
export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

// ── Tree view support ─────────────────────────────────────────────

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  label: string;
  collapsibleState: TreeItemCollapsibleState;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  command?: unknown;
  contextValue?: string;

  constructor(label: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None;
  }
}

export class ThemeIcon {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export enum SecretStorageNS {}

export const l10n = {
  t: (message: string, ...args: unknown[]) => {
    // Simple passthrough — replaces {0}, {1}, etc. with args
    let result = message;
    for (let i = 0; i < args.length; i++) {
      result = result.replace(`{${i}}`, String(args[i]));
    }
    return result;
  },
};
