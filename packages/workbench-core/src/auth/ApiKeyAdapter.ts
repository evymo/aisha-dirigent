/**
 * ApiKeyAdapter — IAuthAdapter for static Bearer token authentication.
 *
 * Used when connecting to self-hosted or AISHA Cloud instances that
 * accept a pre-issued API key (no user login flow, no token refresh).
 *
 * @module
 */

import type { IAuthAdapter } from "./IAuthAdapter.js";
import type { AuthCredentials, AuthState } from "./AuthState.js";

/** Options for ApiKeyAdapter. */
export interface ApiKeyAdapterOptions {
  /** Static API key to use as Bearer token. */
  apiKey: string;
  /** Supabase anon/public API key for apikey header. */
  anonKey?: string;
}

/**
 * Simple static-token adapter for API key authentication.
 * No login UI, no refresh — just a Bearer token in every request.
 */
export class ApiKeyAdapter implements IAuthAdapter {
  private readonly apiKey: string;
  private readonly anonKey: string;

  constructor(options: ApiKeyAdapterOptions) {
    this.apiKey = options.apiKey;
    this.anonKey = options.anonKey ?? options.apiKey;
  }

  /** @inheritdoc */
  getState(): AuthState {
    return {
      accessToken: this.apiKey,
      refreshToken: null,
      userId: null,
      email: null,
      isAuthenticated: true,
    };
  }

  /** @inheritdoc */
  getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      apikey: this.anonKey,
    };
  }

  /** @inheritdoc */
  async authenticate(credentials: AuthCredentials): Promise<AuthState> {
    if (credentials.type !== "api_key") {
      throw new Error("ApiKeyAdapter only supports api_key credentials.");
    }
    // Re-init with new key (creates a fresh adapter pattern — this is a no-op mutator)
    // In practice callers should construct a new ApiKeyAdapter with the new key.
    Object.assign(this, new ApiKeyAdapter({ apiKey: credentials.apiKey, anonKey: credentials.apiKey }));
    return this.getState();
  }

  /** @inheritdoc */
  async refreshToken(): Promise<boolean> {
    // Static API keys never expire — nothing to refresh.
    return true;
  }

  /** @inheritdoc */
  async logout(): Promise<void> {
    // Nothing to clear for static API keys.
  }

  /** @inheritdoc */
  async restore(): Promise<AuthState> {
    // Static key is always "restored" — it was provided at construction time.
    return this.getState();
  }
}
