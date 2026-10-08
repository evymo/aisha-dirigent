/**
 * KeycloakOidcAdapter — compatibility class backed by Keycloak OIDC.
 *
 * Handles Keycloak email/password login, refresh token rotation, and token persistence
 * via an injected ITokenStorage (platform-agnostic).
 *
 * Platform-specific UI (prompts, notifications) lives in the calling layer
 * (VS Code extension auth.ts, Warmup Flow webview). This adapter is pure HTTP.
 *
 * @module
 */

import type { IAuthAdapter } from "./IAuthAdapter.js";
import type { ITokenStorage } from "./ITokenStorage.js";
import type { AuthCredentials, AuthState } from "./AuthState.js";

const KEY_ACCESS = "aisha.auth.accessToken";
const KEY_REFRESH = "aisha.auth.refreshToken";
const KEY_USER_ID = "aisha.auth.userId";
const KEY_EMAIL = "aisha.auth.email";

/** Keycloak token response shape. */
interface KeycloakTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** Keycloak userinfo response shape. */
interface KeycloakUserInfo {
  sub: string;
  email?: string;
  preferred_username?: string;
}

/** Options for KeycloakOidcAdapter compatibility class. */
export interface KeycloakOidcAdapterOptions {
  /** AISHA gateway URL, e.g. http://localhost:3001 (local-warmup) or https://api.<your-domain> */
  gatewayUrl: string;
  /** Backward-compatible public API key, passed through when present. */
  anonKey: string;
  /** Keycloak realm URL, e.g. https://kc.<your-domain>/realms/aisha. Derived for the local stack when omitted. */
  keycloakUrl?: string;
  /** Keycloak public client ID. Default: aisha-dirigent-device. */
  clientId?: string;
  /** Optional client secret for confidential clients. */
  clientSecret?: string;
  /** Token storage implementation (VS Code SecretStorage, Electron safeStorage, …). */
  storage: ITokenStorage;
  /** Timeout for auth requests in ms. Default: 15 000. */
  timeoutMs?: number;
  /** Called when auth state changes (login/logout/refresh). */
  onChange?: (state: AuthState) => void;
}

/**
 * Platform-agnostic Keycloak authentication adapter.
 *
 * The class name is kept for API compatibility with older Workbench builds.
 * Inject a platform SecretStorage via `options.storage`.
 */
export class KeycloakOidcAdapter implements IAuthAdapter {
  private readonly opts: Required<Omit<KeycloakOidcAdapterOptions, "onChange">> & {
    onChange?: (state: AuthState) => void;
  };

  private state: AuthState = {
    accessToken: null,
    refreshToken: null,
    userId: null,
    email: null,
    isAuthenticated: false,
  };

  constructor(options: KeycloakOidcAdapterOptions) {
    this.opts = {
      timeoutMs: 15_000,
      keycloakUrl: deriveKeycloakUrl(options.gatewayUrl),
      clientId: "aisha-dirigent-device",
      clientSecret: "",
      ...options,
    };
  }

  // ── IAuthAdapter ────────────────────────────────────────────────────────────

  /** @inheritdoc */
  getState(): AuthState {
    return { ...this.state };
  }

  /** @inheritdoc */
  getAuthHeaders(): Record<string, string> {
    if (!this.state.accessToken) return {};
    return {
      Authorization: `Bearer ${this.state.accessToken}`,
      apikey: this.opts.anonKey,
    };
  }

  /** @inheritdoc */
  async authenticate(credentials: AuthCredentials): Promise<AuthState> {
    if (credentials.type === "tokens") {
      await this._store(
        credentials.accessToken,
        credentials.refreshToken,
        credentials.userId,
        credentials.email,
      );
      return this.getState();
    }

    if (credentials.type === "email_password") {
      const data = await this._keycloakTokenRequest({
        grant_type: "password",
        username: credentials.email,
        password: credentials.password,
        scope: "openid email profile",
      });
      await this._storeTokenResponse(data);
      return this.getState();
    }

    if (credentials.type === "api_key") {
      throw new Error("Keycloak token adapter does not support api_key credentials. Use ApiKeyAdapter instead.");
    }

    throw new Error("Unsupported credential type");
  }

  /** @inheritdoc */
  async refreshToken(): Promise<boolean> {
    if (!this.state.refreshToken) return false;

    try {
      const data = await this._keycloakTokenRequest(
        {
          grant_type: "refresh_token",
          refresh_token: this.state.refreshToken,
        },
        10_000,
      );
      await this._storeTokenResponse(data);
      return true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      // Only clear tokens on definitive auth rejection (4xx)
      if (status !== undefined && status >= 400 && status < 500) {
        await this.logout();
      }
      return false;
    }
  }

  /** @inheritdoc */
  async logout(): Promise<void> {
    const { storage } = this.opts;
    await Promise.all([
      storage.delete(KEY_ACCESS),
      storage.delete(KEY_REFRESH),
      storage.delete(KEY_USER_ID),
      storage.delete(KEY_EMAIL),
    ]);
    this._setState({
      accessToken: null,
      refreshToken: null,
      userId: null,
      email: null,
      isAuthenticated: false,
    });
  }

  /** @inheritdoc */
  async restore(): Promise<AuthState> {
    const { storage } = this.opts;
    const [accessToken, refreshToken, userId, email] = await Promise.all([
      storage.get(KEY_ACCESS),
      storage.get(KEY_REFRESH),
      storage.get(KEY_USER_ID),
      storage.get(KEY_EMAIL),
    ]);

    this._setState({
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
      userId: userId ?? null,
      email: email ?? null,
      isAuthenticated: !!accessToken && !!userId,
    });

    if (this.state.refreshToken) {
      await this.refreshToken();
    }

    return this.getState();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async _keycloakTokenRequest(
    body: Record<string, string>,
    timeoutMs?: number,
  ): Promise<KeycloakTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.opts.clientId,
      ...body,
    });
    if (this.opts.clientSecret) {
      params.set("client_secret", this.opts.clientSecret);
    }

    const response = await fetch(`${this.opts.keycloakUrl}/protocol/openid-connect/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(timeoutMs ?? this.opts.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`Keycloak token error ${response.status}: ${text.substring(0, 200)}`) as Error & { status: number };
      error.status = response.status;
      throw error;
    }

    return response.json() as Promise<KeycloakTokenResponse>;
  }

  private async _fetchUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
    const response = await fetch(`${this.opts.keycloakUrl}/protocol/openid-connect/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const error = new Error(`Keycloak userinfo error ${response.status}: ${text.substring(0, 200)}`) as Error & { status: number };
      error.status = response.status;
      throw error;
    }

    return response.json() as Promise<KeycloakUserInfo>;
  }

  private async _storeTokenResponse(data: KeycloakTokenResponse): Promise<void> {
    const user = await this._fetchUserInfo(data.access_token);
    await this._store(
      data.access_token,
      data.refresh_token ?? this.state.refreshToken ?? "",
      user.sub,
      user.email ?? user.preferred_username ?? user.sub,
    );
  }

  private async _store(
    accessToken: string,
    refreshToken: string,
    userId: string,
    email: string,
  ): Promise<void> {
    const { storage } = this.opts;
    await Promise.all([
      storage.store(KEY_ACCESS, accessToken),
      storage.store(KEY_REFRESH, refreshToken),
      storage.store(KEY_USER_ID, userId),
      storage.store(KEY_EMAIL, email),
    ]);
    this._setState({ accessToken, refreshToken, userId, email, isAuthenticated: true });
  }

  private _setState(next: AuthState): void {
    this.state = next;
    this.opts.onChange?.(next);
  }
}

function deriveKeycloakUrl(gatewayUrl: string): string {
  // Brand-default realm 'aisha'; operator override via env (server-side)
  // or VITE_KC_REALM (client-side build).
  const realm =
    (typeof process !== "undefined" && process.env?.KEYCLOAK_REALM) ||
    "aisha";
  try {
    const url = new URL(gatewayUrl);
    // Local stack (scripts/local-warmup.sh publishes Keycloak on 8180). A
    // deployed instance passes keycloakUrl explicitly — no hosted default.
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return `http://localhost:8180/realms/${realm}`;
    }
  } catch {
    // Keep explicit configuration required for invalid gateway URLs.
  }
  return "";
}
