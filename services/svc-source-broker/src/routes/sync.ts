/**
 * Sync route: scheduled aggregation pull from source-api → user_engagement_metrics
 *
 * Pulls aggregated engagement metrics via the source_crm_readonly contract
 * (SECURITY DEFINER functions in source-api postgres), then upserts into the
 * aisha user_engagement_metrics table via PostgREST RPC.
 *
 * Triggered by:
 *   - HTTP POST /sync/run (manual, admin-only)
 *   - Cron worker calling this route every syncIntervalMs (default 24h)
 *
 * INVARIANT: connector NEVER receives raw event rows. Source-api functions
 * return pre-aggregated per-user snapshots only.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { errMessage } from '../errors.js';
import { Client as PgClient } from 'pg';
import { SourcePgClient } from '../clients/pg-readonly-driver.js';
import type { SourceBrokerConfig } from '../config.js';
import { createAuthGuard } from '../auth-guard.js';

interface SyncBody {
  /** Optional: restrict sync to specific users (e.g., for testing) */
  user_ids?: string[];
  /** Optional ISO timestamp; defaults to 24h ago */
  since?: string;
}

interface SyncStats {
  recentActiveFetched: number;
  upserted: number;
  errors: number;
  durationMs: number;
}

export function registerSyncRoutes(
  app: FastifyInstance,
  source: SourcePgClient,
  config: SourceBrokerConfig
): void {
  const guard = createAuthGuard(config);

  app.post<{ Body: SyncBody }>('/sync/run', { preHandler: guard.requireAdminOrService }, async (
    req: FastifyRequest<{ Body: SyncBody }>,
    reply: FastifyReply
  ) => {
    // Authorization is enforced by guard.requireAdminOrService (preHandler):
    // a verified admin/staff Keycloak JWT, or the gateway/cron shared service
    // token — NEVER a spoofable identity header. Dev/CI: devAllowUnauthedSync.
    // The in-process scheduler bypasses this route (calls runOnce() directly).
    const start = Date.now();
    const body = req.body ?? ({} as SyncBody);
    const since = body.since ? new Date(body.since) : new Date(Date.now() - 86_400_000);
    const restrictedUserIds = body.user_ids;

    const stats: SyncStats = { recentActiveFetched: 0, upserted: 0, errors: 0, durationMs: 0 };
    const aishaPg = new PgClient({ connectionString: config.postgresUrl });

    try {
      await source.connect();
      await aishaPg.connect();

      // 0. ACL drift canary — same guard as the scheduler. Even a manual admin
      // trigger must not write zeros over good aisha data if the source schema
      // drifted. Hard drift → 409, don't sync. (?force=true bypasses for ops.)
      const drift = await source.verifyContract(new Date().toISOString());
      const force = (req.query as { force?: string } | undefined)?.force === 'true';
      if (drift.hardDrift && !force) {
        req.log.error({ drift: drift.issues }, 'sync: refused — source contract hard drift');
        return reply.code(409).send({
          error: 'source_contract_drift',
          message: 'source schema drifted; refusing to sync (would write zeros). ' +
                   'Resolve the drift or retry with ?force=true to override.',
          issues: drift.issues,
        });
      }

      // 1. Fetch active user IDs from source
      const activeUsers = await source.getRecentActiveUserIds(since, 1000);
      stats.recentActiveFetched = activeUsers.length;
      req.log.info({ since, count: activeUsers.length }, 'source sync: fetched active users');

      // 2. For each, fetch engagement aggregate + upsert to aisha
      for (const u of activeUsers) {
        if (restrictedUserIds && !restrictedUserIds.includes(u.userId)) continue;

        try {
          const engagement = await source.getEngagementForUser(u.userId);
          if (!engagement) {
            req.log.warn({ userId: u.userId }, 'source returned no engagement for active user');
            continue;
          }

          await aishaPg.query(
            `SELECT public.audience_upsert_user_engagement($1::uuid, $2::jsonb, $3::text)`,
            [
              u.userId,
              // snake_case is the mirror-upsert contract (see lib/engagement-snapshot.ts,
              // the canonical mapper the live /source path uses). This batch path maps a
              // source-api-specific shape inline; keep the key names in lockstep.
              JSON.stringify({
                app_accesses_30d: engagement.appAccesses30d,
                app_accesses_90d: engagement.appAccesses90d,
                last_active_at: engagement.lastActivityAt,
                events_created_30d: engagement.eventsCreated30d,
                events_created_90d: engagement.eventsCreated90d,
                posts_created_30d: 0, // source-api doesn't expose post count yet
                audience_size: engagement.audienceSize,
                audience_growth_30d: engagement.audienceSize > 0
                  ? engagement.uniqueFollowers30d / engagement.audienceSize
                  : 0,
                unique_attendees_30d: engagement.uniqueFollowers30d,
                total_attendance_30d: engagement.totalAttendance30d,
                emails_opened_90d: 0,  // not tracked yet
                emails_sent_90d: 0, // not tracked by source-api crm readonly
              }),
              'source-api',
            ]
          );
          stats.upserted += 1;
        } catch (err) {
          stats.errors += 1;
          req.log.error({ err, userId: u.userId }, 'per-user sync failure');
        }
      }

      stats.durationMs = Date.now() - start;
      return reply.send({ status: 'ok', since: since.toISOString(), stats });
    } catch (err) {
      stats.durationMs = Date.now() - start;
      req.log.error({ err, stats }, 'source sync top-level failure');
      return reply.code(500).send({
        error: 'sync_failure',
        message: errMessage(err),
        stats,
      });
    } finally {
      await aishaPg.end().catch(() => undefined);
    }
  });

  /** Manual probe — verify broker can reach source-api postgres + functions.
   *  Admin/service-gated: it hits source-api + returns a community KPI snapshot
   *  (aggregate data), so it must not be world-readable on the broker port. */
  app.get('/sync/probe', { preHandler: guard.requireAdminOrService }, async (req, reply) => {
    try {
      const probe = await source.probe();
      const kpi = probe.ok ? await source.getCommunityKpiSnapshot() : null;
      return reply.send({ probe, kpi });
    } catch (err) {
      return reply.code(500).send({ error: errMessage(err) });
    }
  });
}
