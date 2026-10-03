/**
 * Thin wrapper around the global `fetch` to enable reliable mocking in
 * vitest + jsdom where `globalThis.fetch` overrides do not propagate
 * into the module scope.
 *
 * @module
 */
export const httpFetch: typeof fetch = (...args: Parameters<typeof fetch>) =>
  fetch(...args);
