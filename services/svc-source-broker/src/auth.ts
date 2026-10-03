/**
 * svc-source-broker — JWT lifecycle (source-api service-level auth)
 *
 * Mirrors source-web auth flow but with a machine user (env-var credentials):
 *   1. POST sourceJwt mutation with email + password + authHandshake
 *   2. Cache JWT in memory; refresh on 401 or before cache expiry
 *   3. Validate inbound authHandshake on webhook from source-api
 *
 * The flow is intentionally identical to source-web (Login.vue + auth.store.js)
 * so we get one mental model for all source-api clients.
 */

import { GraphQLClient, gql } from 'graphql-request';
import type { SourceBrokerConfig } from './config.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

interface CachedToken {
  token: string;
  refreshToken: string;
  fetchedAt: number; // ms epoch
}

const SOURCE_JWT_MUTATION = gql`
  mutation sourceJwt($authHandshake: String!, $email: String!, $password: String!) {
    sourceJwt(authHandshake: $authHandshake, email: $email, password: $password) {
      token
      refreshToken
      authHandshake
    }
  }
`;

const SOURCE_REFRESH_MUTATION = gql`
  mutation refreshToken($authHandshake: String!, $refreshToken: String!) {
    refreshToken(authHandshake: $authHandshake, refreshToken: $refreshToken) {
      token
      refreshToken
      authHandshake
    }
  }
`;

export class SourceAuthManager {
  private config: SourceBrokerConfig;
  private client: GraphQLClient;
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(config: SourceBrokerConfig) {
    this.config = config;
    this.client = new GraphQLClient(`${config.sourceApiUrl}/graphql/`);
  }

  /**
   * Get a valid source-api JWT, refreshing if expired or absent.
   * Coalesces concurrent callers via inflight promise.
   */
  async getToken(): Promise<string> {
    if (this.cached && this.isCacheValid()) {
      return this.cached.token;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.refreshOrLogin().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /**
   * Build Authorization header for source-api requests.
   * Source-api uses `JWT <token>` per source-web base.js line 145.
   */
  async authHeader(): Promise<string> {
    const token = await this.getToken();
    return `JWT ${token}`;
  }

  /**
   * Verify HMAC signature on inbound webhook from source-api.
   * Constant-time compare to prevent timing oracle.
   */
  verifyWebhookSignature(rawBody: string, signatureHex: string): boolean {
    const computed = createHmac('sha256', this.config.webhookHmacSecret)
      .update(rawBody)
      .digest('hex');
    if (computed.length !== signatureHex.length) return false;
    try {
      return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Verify authHandshake in webhook payload (per CLAUDE.md convention).
   */
  verifyAuthHandshake(payloadAuthHandshake: string | undefined): boolean {
    return payloadAuthHandshake === this.config.sourceAuthHandshakeIncoming;
  }

  /**
   * Invalidate cached token. Call on 401 from source-api.
   */
  invalidate(): void {
    this.cached = null;
  }

  // ------- private -------

  private isCacheValid(): boolean {
    if (!this.cached) return false;
    const age = Date.now() - this.cached.fetchedAt;
    return age < this.config.jwtCacheTtlMs;
  }

  private async refreshOrLogin(): Promise<string> {
    // Try refresh if we have a refresh token; fall back to fresh login
    if (this.cached?.refreshToken) {
      try {
        const data = await this.client.request<{
          refreshToken: { token: string; refreshToken: string; authHandshake: string };
        }>(SOURCE_REFRESH_MUTATION, {
          authHandshake: this.config.sourceAuthHandshakeOutgoing,
          refreshToken: this.cached.refreshToken,
        });
        this.cached = {
          token: data.refreshToken.token,
          refreshToken: data.refreshToken.refreshToken,
          fetchedAt: Date.now(),
        };
        return this.cached.token;
      } catch {
        // Fall through to fresh login
      }
    }

    const data = await this.client.request<{
      sourceJwt: { token: string; refreshToken: string; authHandshake: string };
    }>(SOURCE_JWT_MUTATION, {
      authHandshake: this.config.sourceAuthHandshakeOutgoing,
      email: this.config.sourceServiceEmail,
      password: this.config.sourceServicePassword,
    });

    // Validate server's reply authHandshake (per CLAUDE.md)
    if (data.sourceJwt.authHandshake !== this.config.sourceAuthHandshakeIncoming) {
      // Očekávaná hodnota je sdílené tajemství — do zprávy (a tím do logu) nepatří.
      throw new Error('AuthHandshake mismatch on login');
    }

    this.cached = {
      token: data.sourceJwt.token,
      refreshToken: data.sourceJwt.refreshToken,
      fetchedAt: Date.now(),
    };
    return this.cached.token;
  }
}
