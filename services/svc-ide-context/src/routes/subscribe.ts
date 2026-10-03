/**
 * WS /subscribe/:workspaceId? — Phase 13 WP 13.4
 *
 * On connect:
 *   1. Verify the JWT from `Authorization` header OR `?token=` query
 *      (some IDE WebSocket clients can't set headers reliably — the
 *      query-string fallback is gated by HTTPS + tight rate limit on
 *      the upgrade endpoint).
 *   2. Send the initial workspace envelope (so the IDE bridge has
 *      a synchronous starting state without waiting for the first
 *      db_changes notification).
 *   3. Register an `onChange` callback with the singleton
 *      RealtimeSubscriber. The callback re-fetches the envelope via
 *      RLS-enforced RPC + emits `context_changed` on diff.
 *   4. On socket close, unregister.
 *
 * Wire protocol (server → client, JSON-framed):
 *   { "type": "ready", "envelope": <WorkspaceContextEnvelope> }
 *     — sent once on connect after JWT verification succeeded
 *   { "type": "context_changed", "envelope": <WorkspaceContextEnvelope> }
 *     — sent when any watched table change affects the user's view
 *   { "type": "pong" }
 *     — sent in reply to a client {"type":"ping"} keepalive
 *
 * Wire protocol (client → server, JSON-framed):
 *   { "type": "ping" }
 *     — keepalive; server responds with pong. Anything else closes
 *     the connection with code 1003 (unsupported data).
 *
 * Reconnect strategy is OWNED BY THE CLIENT (aisha-ide-bridge package
 * — WP 13.3). Server-side: explicit close code on auth failure (4001)
 * so the client knows whether to retry.
 *
 * NO PII in any message — envelope schema enforces.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { RawData } from "ws";
import websocket from "@fastify/websocket";
import { z } from "zod";
import type { JWTPayload } from "jose";
import { verifyToken, AuthError } from "../auth.js";
import { rpcUserClaims } from "../postgrest.js";
import {
  WorkspaceContextEnvelopeSchema,
  type WorkspaceContextEnvelope,
} from "../lib/envelope.js";
import {
  getRealtimeSubscriber,
  type ConnectedClient,
  type DbChangePayload,
  buildContextChangedMessage,
} from "../lib/subscriber.js";

const ParamsSchema = z.object({
  workspaceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
});

const QuerySchema = z.object({
  token: z.string().min(1).max(8192).optional(),
});

const ClientMessageSchema = z.object({
  type: z.literal("ping"),
});

/**
 * Refresh a client's envelope view via RLS-enforced RPC; send a
 * `context_changed` event only when the body has changed (idempotency).
 * Returns the new envelope JSON for the caller to cache as
 * `lastEnvelopeJson`.
 */
async function refreshAndMaybeSend(args: {
  claims: JWTPayload;
  workspaceId: string | null;
  lastJson: string | null;
  send: (data: string) => void;
}): Promise<string | null> {
  try {
    const raw = await rpcUserClaims<unknown>(
      "get_workspace_context",
      { p_workspace_id: args.workspaceId },
      args.claims,
    );
    const validated = WorkspaceContextEnvelopeSchema.safeParse(raw);
    if (!validated.success) return args.lastJson; // schema regression — don't push
    const envelope = validated.data;
    const nextJson = JSON.stringify(envelope);
    if (nextJson === args.lastJson) return args.lastJson; // no diff, skip
    args.send(buildContextChangedMessage(envelope));
    return nextJson;
  } catch {
    return args.lastJson; // transient RPC failure — try again next notification
  }
}

export async function subscribeRoutes(app: FastifyInstance): Promise<void> {
  // Register the websocket plugin lazily — idempotent in Fastify v5 (no-op
  // if already registered upstream). server.ts may or may not have
  // registered it; doing it here keeps this route self-contained.
  if (!app.hasReplyDecorator("websocket")) {
    await app.register(websocket);
  }

  app.get<{
    Params: { workspaceId?: string };
    Querystring: { token?: string };
  }>(
    "/subscribe/:workspaceId?",
    { websocket: true },
    async (socket, req) => {
      // 1. Extract JWT (header OR ?token=)
      const queryParse = QuerySchema.safeParse(req.query);
      const tokenFromQuery = queryParse.success ? queryParse.data.token : undefined;
      const authHeader =
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : tokenFromQuery
            ? `Bearer ${tokenFromQuery}`
            : undefined;

      let user;
      try {
        user = await verifyToken(authHeader);
      } catch (err) {
        const code = err instanceof AuthError && err.statusCode === 401 ? 4001 : 4003;
        socket.close(code, "Unauthorized");
        return;
      }

      // 2. Validate path param
      const paramsParse = ParamsSchema.safeParse(req.params);
      if (!paramsParse.success) {
        socket.close(4400, "Invalid workspaceId");
        return;
      }
      const workspaceId = paramsParse.data.workspaceId ?? null;

      // 3. Fetch initial envelope so the IDE bridge has a starting state
      let envelope: WorkspaceContextEnvelope;
      try {
        const raw = await rpcUserClaims<unknown>(
          "get_workspace_context",
          { p_workspace_id: workspaceId },
          user.claims,
        );
        const validated = WorkspaceContextEnvelopeSchema.safeParse(raw);
        if (!validated.success) {
          socket.close(4502, "Upstream envelope malformed");
          return;
        }
        envelope = validated.data;
      } catch {
        socket.close(4502, "Workspace context unavailable");
        return;
      }

      const send = (data: string): void => {
        if (socket.readyState === socket.OPEN) {
          socket.send(data);
        }
      };

      // 4. Register with subscriber. Capture lastEnvelopeJson in closure so
      //    each onChange invocation sees the previously-sent envelope and
      //    skips identical re-renders.
      let lastEnvelopeJson = JSON.stringify(envelope);
      const client: ConnectedClient = {
        id: randomUUID(),
        onChange: async (_payload: DbChangePayload) => {
          lastEnvelopeJson = (await refreshAndMaybeSend({
            claims: user.claims,
            workspaceId,
            lastJson: lastEnvelopeJson,
            send,
          })) ?? lastEnvelopeJson;
        },
      };
      const unregister = getRealtimeSubscriber().register(client);

      // 5. Send initial ready event
      try {
        send(JSON.stringify({ type: "ready", envelope }));
      } catch {
        unregister();
        return;
      }

      // 6. Wire up keepalive + cleanup
      socket.on("message", (raw: RawData) => {
        let parsed;
        try {
          parsed = ClientMessageSchema.safeParse(JSON.parse(String(raw)));
        } catch {
          socket.close(1003, "Unsupported data");
          return;
        }
        if (!parsed.success) {
          socket.close(1003, "Unsupported data");
          return;
        }
        if (parsed.data.type === "ping") {
          send(JSON.stringify({ type: "pong" }));
        }
      });

      socket.on("close", () => {
        unregister();
      });

      socket.on("error", () => {
        unregister();
      });
    },
  );
}
