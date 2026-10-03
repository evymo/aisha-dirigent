import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/react/dont-cleanup-after-each';
import '@testing-library/jest-dom/vitest';
import {
  DEV_FALLBACK_DB_ANON_KEY,
  DEV_FALLBACK_DB_URL,
} from '@/config/devFallbackDb';

// Global mock for safeLogger — prevents "missing export" errors when
// modules like oidc-config.ts import safeWarn/safeInfo transitively.
// Individual tests can override with their own vi.mock() which takes precedence.
vi.mock('@/lib/security/safeLogger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/safeLogger')>();
  return {
    ...actual,
    safeLog: vi.fn(),
    safeError: vi.fn(),
    safeWarn: vi.fn(),
    safeInfo: vi.fn(),
  };
});

// Ensure Vite-style env vars exist during tests.
// We intentionally do NOT rely on a local `.env` file (secrets hygiene).
const setDefaultViteEnv = (key: string, value: string) => {
  if (!process.env[key]) process.env[key] = value;

  const meta = import.meta as unknown as { env?: Record<string, unknown> };
  if (!meta.env) meta.env = {};
  if (!meta.env[key]) meta.env[key] = value;
};

setDefaultViteEnv('VITE_AISHA_GATEWAY_URL', DEV_FALLBACK_DB_URL);
// Primary key name used by the app.
setDefaultViteEnv('VITE_AISHA_GATEWAY_KEY', DEV_FALLBACK_DB_ANON_KEY);


// Fail-fast guard: tests must not perform real outbound network requests.
// If a test truly needs network, opt-in via `VITEST_ALLOW_NETWORK=1`.
const SHOULD_BLOCK_NETWORK =
  process.env.VITEST_ALLOW_NETWORK !== '1' && process.env.TEST_ALLOW_NETWORK !== '1';

const originalFetch =
  typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : undefined;

const describeFetchTarget = (input: Parameters<typeof fetch>[0]): string => {
  try {
    if (typeof input === 'string') {
      const url = new URL(input, 'http://localhost');
      return `${url.origin}${url.pathname}`;
    }
    if (input instanceof URL) {
      return `${input.origin}${input.pathname}`;
    }
    if (typeof input === 'object' && input && 'url' in input) {
      const maybeUrl = (input as { url?: unknown }).url;
      if (typeof maybeUrl === 'string') {
        const url = new URL(maybeUrl, 'http://localhost');
        return `${url.origin}${url.pathname}`;
      }
    }
  } catch {
    // ignore
  }
  return '<unknown>';
};

if (SHOULD_BLOCK_NETWORK && originalFetch) {
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const target = describeFetchTarget(args[0]);
    throw new Error(
      `Unexpected network request in tests via fetch() to ${target}. Mock fetch/Supabase calls, or set VITEST_ALLOW_NETWORK=1 for an explicit opt-in.`
    );
  }) as typeof fetch;
}

type ConsoleCall = { method: 'log' | 'info' | 'debug' | 'warn' | 'error'; args: unknown[] };

const SHOULD_FILTER_CONSOLE =
  process.env.VITEST_SHOW_LOGS !== '1' && process.env.TEST_DEBUG !== '1' && process.env.DEBUG !== '1';

const SUPPRESSED_CONSOLE_PATTERNS: RegExp[] = [
  /^Error fetching (cart|membership|user roles|check-ins|lab results|token transactions|products|product|product reviews|notifications):/i,
  /^Error fetching packages:/i,
  /^Error submitting test:/i,
  /^Error adding to cart:/i,
  /^Error requesting subscription:/i,
  /^Error fetching archive documents:/i,
  /^Error fetching document:/i,
  /^Error fetching aggregate health data:/i,
  /^Session timeout due to inactivity$/i,
  /invalid input syntax for type uuid: "user-1"/i,
  /^Warning: An update to .* inside a test was not wrapped in act\(/i,
  // React Suspense boundary warnings in tests - safe to suppress when mocking async data
  /^Warning: A suspended resource finished loading inside a test/i,
  /React Router Future Flag Warning:/i,
  /React Router will begin wrapping state updates in `React\.startTransition` in v7/i,
  /React Router will begin resolving relative routes within Splat routes relative to the route path/i,
  /react-i18next:: useTranslation: You will need to pass in an i18next instance by using initReactI18next/i,
  /i18next is maintained with support from Locize/i,
  /^Warning: Missing `Description` or `aria-describedby=\{undefined\}` for \{DialogContent\}\./i,
];

const getFirstArgText = (args: unknown[]): string | null => {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first instanceof Error) return first.message;
  return null;
};

const shouldSuppressConsoleCall = (method: ConsoleCall['method'], args: unknown[]): boolean => {
  if (!SHOULD_FILTER_CONSOLE) return false;

  const text = getFirstArgText(args);
  if (!text) return false;
  return SUPPRESSED_CONSOLE_PATTERNS.some((re) => re.test(text));
};

const suppressedConsoleCallsByTest = new Map<string, ConsoleCall[]>();

let activeTestKey: string | null = null;

beforeEach((ctx) => {
  // node-environment test files (`// @vitest-environment node`) have no window.
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }

  activeTestKey = (ctx?.task as unknown as { id?: string; name?: string } | undefined)?.id
    ?? ctx?.task?.name
    ?? '__unknown_test__';
});

// Cleanup after each test
afterEach(async (ctx) => {
  const debugTeardown = process.env.VITEST_DEBUG_TEARDOWN === '1';
  const testName = ctx?.task?.name ?? '__unknown_test__';
  const startedAt = debugTeardown ? Date.now() : 0;
  if (debugTeardown) originalWarn(`[debug] global afterEach start: ${testName}`);

  cleanup();
  vi.clearAllMocks();

  // Fail-safe: tests must not leak fake timers into global teardown.
  // In practice, awaiting setTimeout(0) here can deadlock if fake timers
  // are still enabled (e.g. a test forgets to restore them).
  if (typeof vi.isFakeTimers === 'function' && vi.isFakeTimers()) {
    // Execute any queued callbacks so Promises waiting on timers can resolve.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  } else {
    vi.useRealTimers();
  }

  // Flush a couple of microtask turns. Avoid wrapping in React.act(): in jsdom
  // it can deadlock when a test leaks async work/timers.
  await Promise.resolve();
  await Promise.resolve();

  if (SHOULD_FILTER_CONSOLE) {
    const key = (ctx?.task as unknown as { id?: string; name?: string } | undefined)?.id
      ?? ctx?.task?.name
      ?? '__unknown_test__';

    const state = (ctx?.task as unknown as { result?: { state?: string } } | undefined)?.result?.state;
    if (state === 'fail') {
      const suppressed = suppressedConsoleCallsByTest.get(key) ?? [];
      if (suppressed.length) {
        originalError(`[debug] Replaying ${suppressed.length} suppressed console calls:`);
        for (const call of suppressed) {
          const original =
            call.method === 'log'
              ? originalLog
              : call.method === 'info'
                ? originalInfo
                : call.method === 'debug'
                  ? originalDebug
                  : call.method === 'warn'
                    ? originalWarn
                    : originalError;
          original(...call.args);
        }
      }
    }

    suppressedConsoleCallsByTest.delete(key);
  }

  if (process.env.VITEST_DEBUG_HANDLES === '1') {
    try {
      const proc = process as unknown as {
        _getActiveHandles?: () => unknown[];
        _getActiveRequests?: () => unknown[];
      };

      const handles = proc._getActiveHandles?.() ?? [];
      const requests = proc._getActiveRequests?.() ?? [];

      const counts = new Map<string, number>();
      for (const h of handles) {
        const name =
          (h as { constructor?: { name?: string } } | null)?.constructor?.name
          ?? typeof h;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }

      const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');

      originalWarn(
        `[debug] active handles=${handles.length} requests=${requests.length}${top ? ` (${top})` : ''}`
      );
    } catch {
      // ignore
    }
  }

  if (debugTeardown) {
    originalWarn(`[debug] global afterEach end: ${testName} (${Date.now() - startedAt}ms)`);
  }

  activeTestKey = null;
});

const originalLog = console.log.bind(console);
const originalInfo = console.info.bind(console);
const originalDebug = console.debug.bind(console);
const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

if (SHOULD_FILTER_CONSOLE) {
  const wrap = (method: ConsoleCall['method'], original: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      if (shouldSuppressConsoleCall(method, args)) {
        const key = activeTestKey ?? '__unknown_test__';
        const bucket = suppressedConsoleCallsByTest.get(key) ?? [];
        bucket.push({ method, args });
        suppressedConsoleCallsByTest.set(key, bucket);
        return;
      }
      original(...args);
    };
  };

  console.log = wrap('log', originalLog) as typeof console.log;
  console.info = wrap('info', originalInfo) as typeof console.info;
  console.debug = wrap('debug', originalDebug) as typeof console.debug;
  console.warn = wrap('warn', originalWarn) as typeof console.warn;
  console.error = wrap('error', originalError) as typeof console.error;
}

// Browser/DOM mocks below require a DOM environment. Node-env test files
// (`// @vitest-environment node`, e.g. RPC/integration suites) have no
// window / navigator / HTMLCanvasElement and would crash at collection when
// this shared setup runs. Guard the whole block — only jsdom-env tests need it.
if (typeof window !== 'undefined') {
// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() { }
  disconnect() { }
  observe() { }
  takeRecords() {
    return [];
  }
  unobserve() { }
} as unknown as typeof IntersectionObserver;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() { }
  disconnect() { }
  observe() { }
  unobserve() { }
} as unknown as typeof ResizeObserver;

// Mock window.scrollTo
window.scrollTo = vi.fn();

const storageState = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => storageState.get(String(key)) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageState.set(String(key), String(value));
  }),
  removeItem: vi.fn((key: string) => {
    storageState.delete(String(key));
  }),
  clear: vi.fn(() => {
    storageState.clear();
  }),
  get length() {
    return storageState.size;
  },
  key: vi.fn((index: number) => Array.from(storageState.keys())[index] ?? null),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', { value: localStorageMock });

// Mock navigator.language
Object.defineProperty(navigator, 'language', { value: 'cs-CZ', writable: true });

// Mock URL.createObjectURL
URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

// Mock canvas context for SignatureCanvas
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({ data: [] })),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  arc: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  clip: vi.fn(),
  rect: vi.fn(),
  quadraticCurveTo: vi.fn(),
  bezierCurveTo: vi.fn(),
})) as unknown as typeof HTMLCanvasElement.prototype.getContext;

HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,mock');
HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => callback(new Blob()));
} // end DOM-environment guard (typeof window !== 'undefined')

// Global mock for usePermissions hook
// This provides a default mock that returns no permissions and no loading state
// Individual tests can override this with vi.mocked(usePermissions).mockReturnValue(...)
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({
    permissions: [],
    isLoading: false,
    error: null,
    hasPermission: () => false,
    hasAllPermissions: () => false,
    hasAnyPermission: () => false,
  })),
  useAllPermissions: vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useRolePermissions: vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useHasPermission: vi.fn(() => ({
    data: false,
    isLoading: false,
  })),
  usePermissionManagement: vi.fn(() => ({
    allPermissions: [],
    rolePermissions: [],
    isLoading: false,
    roleHasPermission: () => false,
    getPermissionsForRole: () => [],
    togglePermission: vi.fn().mockResolvedValue({}),
  })),
}));

// Global mock for useRoleDefinitions hook
vi.mock('@/hooks/useRoleDefinitions', () => ({
  useRoleDefinitions: vi.fn(() => ({
    roles: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    updateRole: vi.fn().mockResolvedValue({}),
    isUpdating: false,
    getRoleByName: () => undefined,
    isSystemRole: () => false,
    isAdminRole: () => false,
    adminRoles: [],
    systemRoles: [],
  })),
  useUserRoleCapabilities: vi.fn(() => ({
    isAdmin: false,
    canManageUsers: false,
    canManageRoles: false,
    canViewPhi: false,
    canExportPhi: false,
    canBreakGlass: false,
  })),
}));
