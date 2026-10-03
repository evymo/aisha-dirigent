/**
 * GET /context/:workspaceId — workspace envelope endpoint
 *
 * Reads via SECURITY DEFINER + RLS-mirror in `get_workspace_context()` RPC.
 * Output is the canonical JSON envelope consumed by:
 *   - GET /instructions/:ide (renders templates from same envelope)
 *   - aisha-ide-bridge client (caches locally + diffs)
 *   - workbench Diagnostics page (admin can inspect what an agent sees)
 *
 * Auth: any authenticated Keycloak user (visibility enforced at RPC level
 * via is_admin_or_staff() + is_story_participant() helpers from P7).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyToken, AuthError } from "../auth.js";
import { rpcUserClaims } from "../postgrest.js";
import {
  WorkspaceContextEnvelopeSchema,
  type WorkspaceContextEnvelope,
} from "../lib/envelope.js";

const ParamsSchema = z.object({
  workspaceId: z.string().min(1).max(128).regex(
    /^[a-zA-Z0-9_-]+$/,
    "workspaceId must be alphanumeric + dash + underscore only",
  ),
});

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { workspaceId: string } }>(
    "/context/:workspaceId",
    async (req, reply) => {
      // 1. Verify JWT
      let user;
      try {
        user = await verifyToken(req.headers.authorization);
      } catch (err) {
        const status = err instanceof AuthError ? err.statusCode : 401;
        return reply.code(status).send({ error: "Unauthorized" });
      }

      // 2. Validate path param (Zod — per CLAUDE.md -1.1.3)
      const parseResult = ParamsSchema.safeParse(req.params);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: "Invalid workspaceId",
          details: parseResult.error.issues.map((i) => i.message),
        });
      }

      // 3. Call RPC as the user (RLS + auth.uid() applied)
      let envelope: WorkspaceContextEnvelope;
      try {
        const raw = await rpcUserClaims<unknown>(
          "get_workspace_context",
          { p_workspace_id: parseResult.data.workspaceId },
          user.claims,
        );
        const validated = WorkspaceContextEnvelopeSchema.safeParse(raw);
        if (!validated.success) {
          req.log.error(
            { errors: validated.error.issues },
            "Envelope shape from get_workspace_context invalid",
          );
          return reply
            .code(502)
            .send({ error: "Upstream envelope malformed" });
        }
        envelope = validated.data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.error({ msg }, "get_workspace_context RPC failed");
        return reply.code(502).send({ error: "Workspace context unavailable" });
      }

      // 4. Cache headers — short TTL (envelope changes with realtime state)
      reply.header("Cache-Control", "private, max-age=10, must-revalidate");
      reply.header("Content-Type", "application/json; charset=utf-8");
      return reply.send(envelope);
    },
  );
}
