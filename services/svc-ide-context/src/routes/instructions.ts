/**
 * GET /instructions/:ide?workspace=<id> — rendered IDE-specific instructions
 *
 * Pipeline: verifyToken → get_workspace_context() RPC → renderInstructions(ide).
 * Output is plain text/markdown/JSON depending on IDE format. Bridge client
 * (WP 13.3) consumes this endpoint with `safeWrite()` semantics — never
 * trample user content outside `<!-- USER-CUSTOM-* -->` delimiters.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyToken, AuthError } from "../auth.js";
import { rpcUserClaims } from "../postgrest.js";
import {
  WorkspaceContextEnvelopeSchema,
  type WorkspaceContextEnvelope,
} from "../lib/envelope.js";
import {
  SUPPORTED_IDES,
  renderInstructions,
  type SupportedIde,
} from "../lib/templateEngine.js";

const ParamsSchema = z.object({
  ide: z.enum(["claude-code", "cursor", "copilot", "jetbrains"]),
});

const QuerySchema = z.object({
  workspace: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
});

export async function instructionsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { ide: string };
    Querystring: { workspace?: string };
  }>("/instructions/:ide", async (req, reply) => {
    // 1. Verify JWT
    let user;
    try {
      user = await verifyToken(req.headers.authorization);
    } catch (err) {
      const status = err instanceof AuthError ? err.statusCode : 401;
      return reply.code(status).send({ error: "Unauthorized" });
    }

    // 2. Validate path + query
    const paramsResult = ParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return reply.code(400).send({
        error: "Invalid IDE",
        supported: SUPPORTED_IDES,
      });
    }
    const queryResult = QuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: "Invalid query" });
    }

    const ide = paramsResult.data.ide as SupportedIde;
    const workspaceId = queryResult.data.workspace ?? null;

    // 3. Fetch envelope from RPC
    let envelope: WorkspaceContextEnvelope;
    try {
      const raw = await rpcUserClaims<unknown>(
        "get_workspace_context",
        { p_workspace_id: workspaceId },
        user.claims,
      );
      const validated = WorkspaceContextEnvelopeSchema.safeParse(raw);
      if (!validated.success) {
        req.log.error(
          { errors: validated.error.issues },
          "Envelope shape invalid",
        );
        return reply.code(502).send({ error: "Upstream envelope malformed" });
      }
      envelope = validated.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      req.log.error({ msg }, "get_workspace_context RPC failed");
      return reply.code(502).send({ error: "Workspace context unavailable" });
    }

    // 4. Render IDE-specific instructions
    const rendered = renderInstructions(ide, envelope);

    reply.header("Cache-Control", "private, max-age=10, must-revalidate");
    reply.header("Content-Type", rendered.contentType);
    // Embed sync metadata so bridge can dedupe + diff cheaply
    reply.header("X-Aisha-Generated-At", envelope.generated_at);
    reply.header("X-Aisha-User-Id", envelope.user_id);
    reply.header("X-Aisha-Ide", ide);
    return reply.send(rendered.body);
  });
}
