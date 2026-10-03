/**
 * Gate (remediation S2 — intranet token-exchange isolation):
 * services/gateway/src/routes/intranet.ts exposes POST /intranet/token-exchange
 * (plus /rpc/:fn_name and /mcp), which mint / act under a short-lived PostgREST
 * *user* JWT (role: authenticated, sub = user id) for whatever email arrives in
 * a trusted identity header (X-Auth-Request-Email / X-Appsmith-User-Email).
 *
 * DEFECT (KNOWN-RED at authoring, branch feat/service-build-fixes): the ONLY
 * gate in front of that mint is a shared bearer secret — validateApiKey()
 * comparing X-Intranet-Api-Key to a static env value. The endpoint is
 * registered on the gateway's PUBLIC listener (0.0.0.0:3001; oauth2-proxy
 * fronts the Appsmith APP, not the gateway). So anyone who can reach the
 * listener and learn (or leak) the one shared key can set X-Auth-Request-Email
 * to ANY user's address and receive a valid user JWT for that user — full
 * account impersonation. /rpc and /mcp share the same getUserEmail() path (same
 * hole). The "cannot be spoofed from the browser" comment only holds if an
 * OAuth2-Proxy is the SOLE possible source of the header, which a shared key on
 * a public listener does NOT guarantee.
 *
 * APPROVED FIX (verify-OIDC primary; shared key = defense-in-depth):
 *   R1. On /token-exchange AND /rpc AND /mcp: require + VERIFY a Keycloak access
 *       token (Authorization: Bearer, else oauth2-proxy's
 *       x-auth-request-access-token). Identity (sub/email) comes ONLY from the
 *       VERIFIED token — never from x-auth-request-email / x-appsmith-user-email.
 *   R3. Revocation-aware: the token's jti is checked (isTokenRevoked / isRevoked
 *       — verifyKeycloakClaims omits this, so it MUST be added on top).
 *   R4. sub = DB user.id via lookupUserByEmail(VERIFIED email) — never the raw
 *       KC subject. Unknown user → 401. The fail-open fallback (the
 *       get_user_id_by_email path that synthesises a user) is DELETED.
 *   R5/R6. validateApiKey() stays as a coarse pre-filter but is never
 *       sufficient alone; fail-loud 401 on missing/invalid/revoked token,
 *       unknown client, or unknown user. NO fallback to the header, ever.
 *
 * CONTRACT this gate enforces over intranet.ts (non-comment source):
 *   C1. A Keycloak-token VERIFICATION is actually INVOKED — verifyKeycloakClaims(
 *       (or the createPostgrestJwtTranslator / translateAuthorizationForPostgrest
 *       translator). A cosmetic `import { verifyKeycloakClaims }` with no call
 *       must NOT satisfy this.
 *   C2. Revocation is wired — isTokenRevoked / isRevoked is referenced.
 *   C3. The trusted identity header (getUserEmail / x-auth-request-email /
 *       x-appsmith-user-email) is NOT the value that feeds lookupUserByEmail or
 *       mintUserJwt. It may survive for logging only.
 *   C4. The minted sub derives from the DB user lookup (lookupUserByEmail) — no
 *       mintUserJwt(...) call takes a raw KC subject (claims.sub / payload.sub)
 *       as its identity argument.
 *   C5. The fail-open fallback is gone — no get_user_id_by_email escape hatch.
 *   C6. For EACH of /token-exchange, /rpc, /mcp a verification signal appears
 *       BEFORE the mint / identity-forward in that handler.
 *
 * The mint helper (mintUserJwt) and the trusted-header reader (getUserEmail)
 * are file-local, so the fix necessarily edits this file; scanning the whole
 * file (comments stripped) is a sound signal.
 *
 * Do NOT weaken this gate to make it pass — wire real verification. Relaxing
 * any assertion below to accommodate the buggy header-trust design is a
 * regression of the S2 remediation, not a test fix.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const INTRANET_ROUTE = "services/gateway/src/routes/intranet.ts";

/** Strip block + line comments so a descriptive comment cannot pass the gate. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Split the (comment-stripped) source into per-handler segments keyed by route
 * path. Each segment runs from its `app.post(...` registration up to the next
 * one (or EOF), so ordering checks stay scoped to a single handler.
 */
function handlerSegments(code: string): Map<string, string> {
  const out = new Map<string, string>();
  const starts: number[] = [];
  const re = /app\.post\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : code.length;
    const seg = code.slice(start, end);
    // Route path is the first quoted string on the registration.
    const pathMatch = seg.match(/app\.post\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/);
    if (pathMatch) out.set(pathMatch[1], seg);
  }
  return out;
}

/**
 * A verification signal = evidence that identity is derived from a VERIFIED
 * token before we act on it. Accepts the direct verifier, the translator
 * helpers, or a resolver whose name reveals verification intent (so a DRY
 * helper-based fix is not penalised). File-level C1 separately guarantees a
 * REAL verifyKeycloakClaims( / translator invocation exists, so this looser
 * per-handler predicate cannot be satisfied by a hollow name alone.
 */
const VERIFY_SIGNAL =
  /verifyKeycloakClaims\s*\(|createPostgrestJwtTranslator\s*\(|translateAuthorizationForPostgrest\s*\(|isTokenRevoked\b|isRevoked\b|\bverified\w*\b|\bclaims\b|authenticateIntranet|requireVerified|resolveVerifiedIdentity/i;

/** Earliest index at which the handler mints/forwards identity, or -1. */
function mintOrForwardIndex(seg: string): number {
  const markers = ["mintUserJwt(", "mintServiceJwt(", "X-Intranet-User-Email"];
  const indices = markers.map((mk) => seg.indexOf(mk)).filter((i) => i >= 0);
  return indices.length ? Math.min(...indices) : -1;
}

describe("intranet identity isolation (S2 contract)", () => {
  const raw = existsSync(join(ROOT, INTRANET_ROUTE))
    ? readFileSync(join(ROOT, INTRANET_ROUTE), "utf-8")
    : "";
  const code = stripComments(raw);

  test("route file exists", () => {
    expect(
      existsSync(join(ROOT, INTRANET_ROUTE)),
      `expected ${INTRANET_ROUTE} to exist`,
    ).toBe(true);
  });

  test("sanity: registers /token-exchange, /rpc, /mcp and mints a user JWT", () => {
    for (const path of ["/token-exchange", "/rpc/:fn_name", "/mcp"]) {
      expect(
        code.includes(`'${path}'`) || code.includes(`"${path}"`) || code.includes(`\`${path}\``),
        `expected a ${path} route registration in intranet.ts`,
      ).toBe(true);
    }
    expect(
      /mintUserJwt|role:\s*['"`]authenticated['"`]/.test(code),
      "expected intranet.ts to mint a user JWT (mintUserJwt / role: authenticated)",
    ).toBe(true);
  });

  test("C1: a Keycloak token verification is actually INVOKED (cosmetic import does NOT satisfy)", () => {
    // `import { verifyKeycloakClaims }` has `verifyKeycloakClaims }` / `,` — it
    // never matches the `(` call form, so only a real invocation passes.
    const invoked =
      /verifyKeycloakClaims\s*\(/.test(code) ||
      /createPostgrestJwtTranslator\s*\(/.test(code) ||
      /translateAuthorizationForPostgrest\s*\(/.test(code);
    expect(
      invoked,
      "intranet.ts must VERIFY a Keycloak access token before deriving identity " +
        "— call verifyKeycloakClaims(authorization) (or route through the " +
        "createPostgrestJwtTranslator / translateAuthorizationForPostgrest translator). " +
        "A bare import with no call site is cosmetic and does NOT satisfy S2.",
    ).toBe(true);
  });

  test("C2: token revocation is wired (isTokenRevoked / isRevoked)", () => {
    expect(
      /\bisTokenRevoked\b|\bisRevoked\b/.test(code),
      "intranet.ts must be revocation-aware (R3): verifyKeycloakClaims does NOT " +
        "check revocation, so add the isTokenRevoked(jti) / isRevoked step (or " +
        "route through the translator wired with isRevoked). A revoked token must " +
        "not mint a fresh user JWT.",
    ).toBe(true);
  });

  test("C3: the trusted identity header is NOT the source that feeds lookup/mint", () => {
    // Variables assigned from the trusted-header reader (getUserEmail(...) or a
    // direct x-auth-request-email / x-appsmith-user-email header read).
    const tainted = new Set<string>();
    const assignRe =
      /(?:const|let|var)\s+(\w+)\s*=\s*(?:getUserEmail\s*\(|req\.headers\[\s*['"`]x-(?:auth-request|appsmith-user)-email['"`]\s*\])/g;
    let a: RegExpExecArray | null;
    while ((a = assignRe.exec(code)) !== null) tainted.add(a[1]);

    // The header value must never flow into identity — neither directly nor via
    // a tainted variable.
    const leaks: string[] = [];
    for (const sink of ["lookupUserByEmail", "mintUserJwt"]) {
      // Direct: lookupUserByEmail(getUserEmail(...)) / mintUserJwt(getUserEmail(...))
      const directRe = new RegExp(
        sink +
          "\\s*\\(\\s*(?:await\\s+)?(?:getUserEmail\\s*\\(|req\\.headers\\[\\s*['\"`]x-(?:auth-request|appsmith-user)-email)",
      );
      if (directRe.test(code)) leaks.push(`${sink}(<trusted-header>)`);

      // Indirect: any tainted variable passed as an argument to the sink.
      for (const v of tainted) {
        const argRe = new RegExp(sink + "\\s*\\([^)]*\\b" + v + "\\b");
        if (argRe.test(code)) leaks.push(`${sink}(... ${v} ...) where ${v} = trusted header`);
      }
    }

    expect(
      leaks,
      "intranet.ts still derives identity from the SPOOFABLE trusted header. " +
        "The email/sub that feeds lookupUserByEmail and mintUserJwt must come " +
        "from the VERIFIED Keycloak token, not getUserEmail() / " +
        "x-auth-request-email / x-appsmith-user-email (which may survive for " +
        `logging only). Leaks: ${JSON.stringify(leaks)}`,
    ).toEqual([]);
  });

  test("C4: minted sub derives from the DB user lookup, not the raw KC subject", () => {
    expect(
      /\blookupUserByEmail\s*\(/.test(code),
      "expected lookupUserByEmail(...) to resolve identity to a DB user id (R4).",
    ).toBe(true);

    // No mintUserJwt(...) call may take a raw KC subject as its first (identity)
    // argument — KC sub != auth.users.id would break RLS.
    const mintCalls = [...code.matchAll(/mintUserJwt\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    const kcSubArgs = mintCalls.filter((arg) => /\bsub\b/i.test(arg));
    expect(
      kcSubArgs,
      "mintUserJwt(...) must mint with the DB user id (e.g. user.id from " +
        "lookupUserByEmail), NOT a KC subject (claims.sub / payload.sub). " +
        `Offending first args: ${JSON.stringify(kcSubArgs)}`,
    ).toEqual([]);
  });

  test("C5: the fail-open lookup fallback is removed", () => {
    expect(
      code.includes("get_user_id_by_email"),
      "the fail-open fallback (get_user_id_by_email path that synthesises a user " +
        "on lookup failure) must be DELETED (R4/R6): unknown user → 401 fail-loud.",
    ).toBe(false);
  });

  test("C6: verification precedes the mint/forward in EACH handler (/token-exchange, /rpc, /mcp)", () => {
    const segments = handlerSegments(code);
    const routes = ["/token-exchange", "/rpc/:fn_name", "/mcp"];
    const failures: string[] = [];

    for (const route of routes) {
      const seg = segments.get(route);
      if (!seg) {
        failures.push(`${route}: handler segment not found`);
        continue;
      }
      const verifyMatch = seg.search(VERIFY_SIGNAL);
      const mintIdx = mintOrForwardIndex(seg);
      if (mintIdx < 0) {
        // A handler that neither mints nor forwards identity is out of scope.
        continue;
      }
      if (verifyMatch < 0) {
        failures.push(`${route}: no verification signal before minting/forwarding identity`);
      } else if (verifyMatch >= mintIdx) {
        failures.push(`${route}: verification (idx ${verifyMatch}) does not precede mint/forward (idx ${mintIdx})`);
      }
    }

    expect(
      failures,
      "Each of /token-exchange, /rpc, /mcp must VERIFY the caller's token before " +
        "minting a user JWT or forwarding an identity to an upstream. " +
        `Failures: ${JSON.stringify(failures)}`,
    ).toEqual([]);
  });
});
