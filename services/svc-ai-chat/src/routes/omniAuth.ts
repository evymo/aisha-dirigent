/**
 * Omni /v1 authentication + fail-closed story binding (§8, §8.5, §16).
 *
 * The Omni ingress is PAT-authenticated: `Authorization: Bearer mcp_<token>`.
 * The token is validated via `validate_mcp_token` (BASE-1: returns
 * {valid, user_id, story_id, scoped_to_story_id, rate_limit_rpm}) and the story
 * is bound FAIL-CLOSED:
 *   - scoped PAT + body story ≠ scope → 403 story_mismatch (body NEVER overrides)
 *   - unscoped PAT + no body story     → 403 unscoped_token (no inference)
 * The resolved story comes from the TOKEN scope (never authoritatively from body);
 * the user comes from the PAT (`req.user.sub` = user_id), never from body (§16).
 *
 * @module
 */
import { createHash } from "node:crypto";
import { rpcService } from "../postgrest.js";

export type AuthClass = "pat" | "legacy-pat" | "passthrough" | "jwt" | "none";

/** Classify an Authorization header into the lane it belongs to (§2, §8). */
export function classifyAuth(header: string | undefined): { kind: AuthClass; token: string } {
  if (!header) return { kind: "none", token: "" };
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return { kind: "none", token: "" };
  const tok = m[1];
  if (tok.startsWith("mcp_")) return { kind: "pat", token: tok };
  if (tok.startsWith("sk-aisha-")) return { kind: "legacy-pat", token: tok };
  // A raw provider key (sk-…) is llm-passthrough (dev-only governance-bypass),
  // NOT an Omni PAT — it must never enter the PAT validation path.
  if (tok.startsWith("sk-")) return { kind: "passthrough", token: tok };
  if (tok.split(".").length === 3) return { kind: "jwt", token: tok };
  return { kind: "none", token: tok };
}

/** Body-supplied story: OpenAI `body.story_id` OR Anthropic `body.metadata.story_id`. */
export function extractBodyStory(body: Record<string, unknown> | null | undefined): string | null {
  if (!body) return null;
  const direct = typeof body.story_id === "string" ? body.story_id : null;
  const metaObj = body.metadata && typeof body.metadata === "object"
    ? (body.metadata as Record<string, unknown>)
    : null;
  const meta = metaObj && typeof metaObj.story_id === "string" ? metaObj.story_id : null;
  return direct ?? meta;
}

export interface OmniAuthOk {
  ok: true;
  /** PAT owner — req.user.sub for chargeback/audit (§16). */
  userId: string | null;
  /** The bound story (token scope wins; body only when token is unscoped). */
  storyId: string | null;
  /** The token's bind-at-issuance scope (null = unscoped/legacy). */
  scopedToStory: string | null;
  rateLimitRpm: number;
}
export interface OmniAuthErr {
  ok: false;
  http: number;
  body: { error: string; reason?: string };
}
export type OmniAuthResult = OmniAuthOk | OmniAuthErr;

/** PAT identity WITHOUT body story-binding — the user + the token's own scope. */
export interface OmniIdentityOk {
  ok: true;
  /** PAT owner — req.user.sub for chargeback/audit + resource authorization (§16). */
  userId: string | null;
  /** The token's bind-at-issuance scope (null = unscoped/legacy). */
  scopedToStory: string | null;
  rateLimitRpm: number;
}
export type OmniIdentityResult = OmniIdentityOk | OmniAuthErr;

/**
 * Validate the PAT and return the caller's IDENTITY (user + the token's own scope),
 * WITHOUT the §8.5 body story-binding. Use this on surfaces that authorize against a
 * RESOURCE (e.g. the reflection-poll endpoint authorizes against the loaded run's
 * story via fn_user_can_read_run) rather than against a request body — so a scoped,
 * unscoped, OR legacy PAT can act on a resource it owns. The body-binding lane
 * (authenticateOmni) is built on top of this and is unchanged for /v1 turns.
 */
export async function authenticateOmniIdentity(
  authHeader: string | undefined,
  toolName?: string,
): Promise<OmniIdentityResult> {
  const { kind, token } = classifyAuth(authHeader);
  if (kind !== "pat" && kind !== "legacy-pat") {
    // passthrough / jwt / none are not the Omni PAT lane.
    return { ok: false, http: 401, body: { error: "Unauthorized" } };
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  let result: {
    valid?: boolean;
    reason?: string;
    user_id?: string | null;
    story_id?: string | null;
    scoped_to_story_id?: string | null;
    rate_limit_rpm?: number;
  } | null = null;
  try {
    result = await rpcService("validate_mcp_token", {
      p_project_id: null,
      p_token_hash: tokenHash,
      p_tool_name: toolName ?? null,
    });
  } catch {
    // rpcService throws on a non-2xx PostgREST response — a token we cannot
    // validate is fail-closed UNAUTHORIZED, never a 500 (no info leak, no hang).
    return { ok: false, http: 401, body: { error: "Unauthorized" } };
  }

  if (!result || result.valid !== true) {
    return { ok: false, http: 401, body: { error: "Unauthorized" } };
  }

  return {
    ok: true,
    userId: result.user_id ?? null,
    scopedToStory: result.scoped_to_story_id ?? null,
    rateLimitRpm: result.rate_limit_rpm ?? 60,
  };
}

/**
 * Authenticate an Omni /v1 request via PAT and enforce fail-closed story binding.
 * Returns the resolved identity/story or a precise HTTP error to send. Behaviour is
 * unchanged — it delegates PAT validation to {@link authenticateOmniIdentity} and
 * layers the §8.5 body story-binding on top.
 */
export async function authenticateOmni(
  authHeader: string | undefined,
  body: Record<string, unknown> | null | undefined,
  toolName?: string,
): Promise<OmniAuthResult> {
  const identity = await authenticateOmniIdentity(authHeader, toolName);
  if (!identity.ok) return identity;

  const scoped = identity.scopedToStory;
  const bodyStory = extractBodyStory(body);

  // §8.5 fail-closed story binding — the body NEVER overrides the token scope.
  if (scoped) {
    if (bodyStory && bodyStory !== scoped) {
      return { ok: false, http: 403, body: { error: "story_mismatch" } };
    }
  } else if (!bodyStory) {
    // unscoped PAT + no body story → cannot infer a story → hard fail-closed.
    return { ok: false, http: 403, body: { error: "unscoped_token" } };
  }

  return {
    ok: true,
    userId: identity.userId,
    storyId: scoped ?? bodyStory ?? null, // token scope wins; body only when unscoped
    scopedToStory: scoped,
    rateLimitRpm: identity.rateLimitRpm,
  };
}
