/**
 * Typed source-api GraphQL client.
 *
 * Wraps graphql-request with source-broker JWT manager. Handles:
 *   - Auto-attaching Authorization: JWT <token> header
 *   - Refresh-on-401 retry
 *   - AuthHandshake validation in critical mutations
 *
 * Used by routes/proxy.ts (passthrough) and routes/sync.ts (aggregation pulls).
 */

import { GraphQLClient, gql } from 'graphql-request';
import { errMessage, asGraphqlError } from '../errors.js';
import type { SourceAuthManager } from '../auth.js';
import type { SourceBrokerConfig } from '../config.js';

export interface SourceProfileSummary {
  id: string;
  email: string;
  displayName: string | null;
  country: string | null;
  language: string | null;
  lastActiveAt: string | null;
}

export interface SourceEngagementMetrics {
  userId: string;
  appAccesses30d: number;
  appAccesses90d: number;
  eventsCreated30d: number;
  eventsCreated90d: number;
  postsCreated30d: number;
  audienceSize: number;
  audienceGrowth30d: number;
  uniqueAttendees30d: number;
  totalAttendance30d: number;
  lastActiveAt: string | null;
}

const GET_PROFILES_MODIFIED_SINCE = gql`
  query GetProfilesModifiedSince($since: DateTime!, $limit: Int!) {
    profiles(modifiedSince: $since, limit: $limit) {
      id
      email
      displayName
      country
      language
      lastActiveAt
    }
  }
`;

const GET_USER_ENGAGEMENT = gql`
  query GetUserEngagement($userId: ID!) {
    userEngagement(userId: $userId) {
      userId
      appAccesses30d
      appAccesses90d
      eventsCreated30d
      eventsCreated90d
      postsCreated30d
      audienceSize
      audienceGrowth30d
      uniqueAttendees30d
      totalAttendance30d
      lastActiveAt
    }
  }
`;

export class SourceApiClient {
  private auth: SourceAuthManager;
  private config: SourceBrokerConfig;

  constructor(auth: SourceAuthManager, config: SourceBrokerConfig) {
    this.auth = auth;
    this.config = config;
  }

  private async client(): Promise<GraphQLClient> {
    const header = await this.auth.authHeader();
    return new GraphQLClient(`${this.config.sourceApiUrl}/graphql/`, {
      headers: { Authorization: header },
    });
  }

  /**
   * Pull profile summaries modified since a given timestamp (batch sync).
   */
  async fetchProfilesSince(since: Date, limit = 500): Promise<SourceProfileSummary[]> {
    return this.withRefresh(async () => {
      const c = await this.client();
      const data = await c.request<{ profiles: SourceProfileSummary[] }>(
        GET_PROFILES_MODIFIED_SINCE,
        { since: since.toISOString(), limit }
      );
      return data.profiles;
    });
  }

  /**
   * Live query of engagement metrics for a single user (detail view).
   */
  async fetchEngagement(userId: string): Promise<SourceEngagementMetrics | null> {
    return this.withRefresh(async () => {
      const c = await this.client();
      const data = await c.request<{ userEngagement: SourceEngagementMetrics }>(
        GET_USER_ENGAGEMENT,
        { userId }
      );
      return data.userEngagement ?? null;
    });
  }

  /**
   * Generic passthrough: aisha-CRM frontend can proxy any GraphQL query
   * through this broker (with rate limiting + caching applied in routes/proxy.ts).
   */
  async passthrough<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this.withRefresh(async () => {
      const c = await this.client();
      return c.request<T>(query, variables ?? {});
    });
  }

  // ------- private -------

  private async withRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const message = String(asGraphqlError(err).response?.errors?.[0]?.message ?? errMessage(err) ?? '');
      const isAuthError = asGraphqlError(err).response?.status === 401 || message.includes('Unauthorized') || message.includes('Invalid token');
      if (isAuthError) {
        this.auth.invalidate();
        return fn();
      }
      throw err;
    }
  }
}
