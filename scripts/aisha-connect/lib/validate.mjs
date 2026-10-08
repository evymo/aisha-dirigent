/**
 * `validate` — prove, step by step, that a developer machine can work against an
 * instance: the instance describes itself consistently, enforces auth, accepts
 * THIS user's login, and MCP answers with tools. Each check says what it saw.
 *
 * A failed prerequisite turns the checks that depend on it into "skip", so the
 * first red line is the one to fix.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { request, describeResponse } from "./http.mjs";
import { fetchAppConfig, fetchOidcConfig, fetchProtectedResource } from "./discovery.mjs";
import { accessTokenProblems, decodeJwt, ensureFreshCredential, LoginRequiredError } from "./oauth.mjs";
import { mcpCall, initializeParams, probeMcp } from "./mcp-client.mjs";
import { DIRIGENT_LOCAL, DEFAULT_MCP_OAUTH_CALLBACK_PORT, DEFAULT_MCP_OAUTH_CLIENT_ID } from "./repo-config.mjs";

const pass = (id, detail) => ({ id, status: "pass", detail });
const fail = (id, detail) => ({ id, status: "fail", detail });
const warn = (id, detail) => ({ id, status: "warn", detail });
const skip = (id, detail) => ({ id, status: "skip", detail });

async function guard(id, fn) {
  try {
    return await fn();
  } catch (err) {
    return fail(id, err.message);
  }
}

function checkRepoConfig(repoDir, profileName, profile) {
  const file = join(repoDir, DIRIGENT_LOCAL);
  if (!existsSync(file)) return warn("repo-config", `${DIRIGENT_LOCAL} missing — run: aisha-connect init --profile ${profileName}`);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return fail("repo-config", `${DIRIGENT_LOCAL} is not valid JSON (${err.message})`);
  }
  if (cfg.activeProfile !== profileName) {
    return warn("repo-config", `active profile is "${cfg.activeProfile}", not "${profileName}"`);
  }
  const p = cfg.profiles?.[profileName] ?? {};
  const drift = ["aishaUrl", "mcpUrl", "keycloakUrl"].filter((k) => {
    const want = { aishaUrl: profile.appConfig.aisha_url, mcpUrl: profile.appConfig.mcp_url, keycloakUrl: profile.appConfig.keycloak_url }[k];
    return p[k] !== want;
  });
  if (drift.length) return warn("repo-config", `${drift.join(", ")} differ from the instance — re-run init`);
  return pass("repo-config", `${DIRIGENT_LOCAL} → ${profileName}`);
}

/**
 * @param {{ profileName: string, profile: object, credential: object|null,
 *           persistCredential: (c: object) => void, reloadCredential?: () => object|null,
 *           repoDir?: string|null, checkMcpOAuth?: boolean, fetchImpl?: typeof fetch, now?: () => number }} ctx
 * @returns {Promise<Array<{ id: string, status: "pass"|"fail"|"warn"|"skip", detail: string }>>}
 */
export async function runValidation(ctx) {
  const { profileName, profile, fetchImpl, now = Date.now } = ctx;
  const results = [];
  const push = (r) => {
    results.push(r);
    return r;
  };

  // 1. The instance still describes itself the way the profile remembers.
  let appConfig = null;
  push(
    await guard("app-config", async () => {
      appConfig = await fetchAppConfig(profile.apiBase, { fetchImpl });
      const changed = ["aisha_url", "mcp_url", "keycloak_url"].filter((k) => appConfig[k] !== profile.appConfig[k]);
      if (changed.length) return warn("app-config", `${changed.join(", ")} changed since discovery — run: aisha-connect discover --profile ${profileName}`);
      return pass("app-config", `${profile.apiBase} (version ${appConfig.version ?? "?"})`);
    }),
  );
  const instance = appConfig ?? profile.appConfig;

  // 2. The realm it names answers as that issuer and offers the device grant.
  let oidc = null;
  push(
    await guard("oidc-discovery", async () => {
      oidc = await fetchOidcConfig(instance.keycloak_url, { fetchImpl });
      if (!oidc.device_authorization_endpoint) return warn("oidc-discovery", `${oidc.issuer} — no device authorization endpoint (login needs it)`);
      return pass("oidc-discovery", oidc.issuer);
    }),
  );

  // 3. RFC 9728 — lets OAuth-aware MCP clients find the realm on their own.
  const prm = await fetchProtectedResource(profile.apiBase, { fetchImpl });
  push(
    !prm
      ? warn("protected-resource", "no /.well-known/oauth-protected-resource (MCP clients cannot auto-discover the realm)")
      : prm.authorization_servers.includes(instance.keycloak_url)
        ? pass("protected-resource", `authorization server ${instance.keycloak_url}`)
        : warn("protected-resource", `lists ${prm.authorization_servers.join(", ") || "nothing"}, not ${instance.keycloak_url}`),
  );

  // 4. Gateway is up.
  push(
    await guard("gateway-health", async () => {
      const res = await request(`${instance.aisha_url}/health`, { fetchImpl });
      return res.ok ? pass("gateway-health", `${instance.aisha_url}/health → ${res.status}`) : fail("gateway-health", describeResponse(res));
    }),
  );

  // 5. MCP must refuse an anonymous caller — otherwise the knowledge base is public.
  push(
    await guard("mcp-requires-auth", async () => {
      const anon = await mcpCall({ url: instance.mcp_url, method: "initialize", params: initializeParams(), id: 1, fetchImpl });
      if (anon.status === 401 || anon.status === 403) return pass("mcp-requires-auth", `anonymous initialize → ${anon.status}`);
      if (anon.status >= 200 && anon.status < 300) return fail("mcp-requires-auth", "MCP answered an anonymous initialize — auth is NOT enforced");
      return fail("mcp-requires-auth", `anonymous initialize → ${anon.error || anon.status}`);
    }),
  );

  // 6. This user's login (refreshed if needed).
  let credential = null;
  const loginProfile = oidc ? { ...profile, oidc: { ...profile.oidc, ...oidc } } : profile;
  push(
    await guard("login", async () => {
      try {
        credential = await ensureFreshCredential({
          profile: loginProfile,
          credential: ctx.credential,
          persist: ctx.persistCredential,
          reload: ctx.reloadCredential,
          fetchImpl,
          now,
        });
      } catch (err) {
        if (err instanceof LoginRequiredError) return fail("login", `${err.message} — run: aisha-connect login --profile ${profileName}`);
        throw err;
      }
      const left = Math.round((credential.expires_at - now()) / 1000);
      return pass("login", `${credential.email || credential.username || credential.subject} (access token valid ${left}s)`);
    }),
  );

  const token = credential?.access_token;
  const needLogin = (id) => skip(id, "needs a valid login");

  // 7. Token claims match the realm and client the instance trusts.
  push(
    !token
      ? needLogin("token-claims")
      : (() => {
          const problems = accessTokenProblems(token, { issuer: instance.keycloak_url, clientId: credential.clientId, now });
          const claims = decodeJwt(token) || {};
          const aud = [claims.aud ?? []].flat().join(",") || "-";
          return problems.length ? fail("token-claims", problems.join("; ")) : pass("token-claims", `iss ok, azp ${claims.azp ?? "-"}, aud ${aud}`);
        })(),
  );

  // 8. The realm itself accepts the token.
  const userinfoUrl = oidc?.userinfo_endpoint ?? profile.oidc.userinfo_endpoint;
  push(
    !token
      ? needLogin("userinfo")
      : !userinfoUrl
        ? skip("userinfo", "realm has no userinfo endpoint")
        : await guard("userinfo", async () => {
            const res = await request(userinfoUrl, { headers: { authorization: `Bearer ${token}` }, fetchImpl });
            if (!res.ok) return fail("userinfo", describeResponse(res));
            const sub = decodeJwt(token)?.sub;
            if (sub && res.body?.sub && res.body.sub !== sub) return fail("userinfo", `sub ${res.body.sub} ≠ token sub ${sub}`);
            return pass("userinfo", res.body?.email || res.body?.preferred_username || res.body?.sub || "ok");
          }),
  );

  // 9–10. MCP with the user's token: initialize + tools/list.
  if (!token) {
    push(needLogin("mcp-initialize"));
    push(needLogin("mcp-tools"));
  } else {
    const probe = await probeMcp({ url: instance.mcp_url, token, fetchImpl }).catch((err) => ({ ok: false, stage: "initialize", error: err.message }));
    if (probe.stage === "initialize") {
      push(fail("mcp-initialize", probe.error));
      push(skip("mcp-tools", "initialize failed"));
    } else {
      push(pass("mcp-initialize", `${probe.serverInfo?.name ?? "server"} ${probe.serverInfo?.version ?? ""} (protocol ${probe.protocolVersion || "?"})`.replace(/\s+/g, " ")));
      push(
        !probe.ok
          ? fail("mcp-tools", probe.error)
          : probe.tools.length
            ? pass("mcp-tools", `${probe.tools.length} tools`)
            : fail("mcp-tools", "tools/list returned no tools"),
      );
    }
  }

  // 11. Optional: the realm client Claude Code's native MCP OAuth would use.
  if (ctx.checkMcpOAuth) {
    const authz = oidc?.authorization_endpoint ?? profile.oidc.authorization_endpoint;
    push(
      !authz
        ? skip("mcp-oauth-client", "realm has no authorization endpoint")
        : await guard("mcp-oauth-client", async () => {
            const q = new URLSearchParams({
              client_id: DEFAULT_MCP_OAUTH_CLIENT_ID,
              redirect_uri: `http://localhost:${DEFAULT_MCP_OAUTH_CALLBACK_PORT}/callback`,
              response_type: "code",
              scope: "openid",
              code_challenge: "aisha-connect-probe-aisha-connect-probe-0123456",
              code_challenge_method: "S256",
            });
            const res = await request(`${authz}?${q}`, { headers: { accept: "text/html" }, fetchImpl });
            // Keycloak shows its login page (200) for a known client + allowed redirect, 400 otherwise.
            return res.status === 200
              ? pass("mcp-oauth-client", `${DEFAULT_MCP_OAUTH_CLIENT_ID} accepts http://localhost:${DEFAULT_MCP_OAUTH_CALLBACK_PORT}/callback`)
              : fail("mcp-oauth-client", `${DEFAULT_MCP_OAUTH_CLIENT_ID} → HTTP ${res.status} (unknown client or callback not allowed)`);
          }),
    );
  }

  // 12. Optional: the repository points at this profile.
  if (ctx.repoDir) push(checkRepoConfig(ctx.repoDir, profileName, { ...profile, appConfig: instance }));

  return results;
}

export function summarize(results) {
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  return { ok: failed === 0, failed, warned, total: results.length };
}
