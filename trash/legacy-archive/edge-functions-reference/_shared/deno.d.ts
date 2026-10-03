/**
 * Minimal Deno type declarations for VS Code IDE support.
 *
 * Edge Functions run in the Supabase Deno runtime which provides
 * the full Deno namespace. This file suppresses "Deno not found"
 * errors in VS Code's TypeScript language server.
 */
declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  }
  const env: Env;
}
