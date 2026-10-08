/**
 * An in-process stand-in for an AISHA instance — gateway app-config, Keycloak
 * realm (discovery, device flow, refresh, userinfo, revoke) and the MCP
 * endpoint — so aisha-connect is tested without any network.
 */

import { createServer } from "node:http";

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

export function fakeJwt(claims) {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.sig`;
}

/**
 * @param {{ deviceSequence?: string[], mcpEnforcesAuth?: boolean, mcpSse?: boolean,
 *           issuerOverride?: string, tokenEndpointOverride?: string, refreshFails?: boolean,
 *           tools?: string[], appConfigHtml?: boolean }} [opts]
 */
export async function startFakeInstance(opts = {}) {
  const state = {
    deviceSequence: [...(opts.deviceSequence ?? ["success"])],
    tokenRequests: [],
    revoked: [],
    issued: new Set(),
    mcpCalls: [],
  };
  let base = "";
  const realm = () => `${base}/realms/aisha`;
  const tools = opts.tools ?? ["search_knowledge", "get_story_context"];

  function issueTokens(scope = "openid profile email") {
    const access = fakeJwt({
      iss: opts.tokenIssuerOverride ?? realm(),
      azp: "aisha-dirigent-device",
      sub: "user-1",
      email: "dev@example.com",
      preferred_username: "dev",
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: `t-${state.issued.size + 1}`,
    });
    state.issued.add(access);
    return { access_token: access, refresh_token: `rt-${state.issued.size}`, expires_in: 300, refresh_expires_in: 1800, token_type: "Bearer", scope };
  }

  const bearer = (req) => (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  }

  const send = (res, status, payload, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(payload === undefined ? "" : JSON.stringify(payload));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const p = url.pathname;
    const raw = await body(req);

    if (p === "/.well-known/app-config.json") {
      if (opts.appConfigHtml) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<!doctype html><html></html>");
      }
      return send(res, 200, {
        version: 3,
        aisha_url: base,
        mcp_url: `${base}/functions/v1/mcp-knowledge-server`,
        keycloak_url: realm(),
        anon_key: "anon-test",
        web_url: `${base}/web`,
        n8n_trigger_url: `${base}/admin/n8n-trigger`,
      });
    }
    if (p === "/.well-known/oauth-protected-resource") {
      return send(res, 200, { resource: base, authorization_servers: [realm()] });
    }
    if (p === "/health") return send(res, 200, { status: "ok" });
    if (p === "/realms/aisha/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: opts.issuerOverride ?? realm(),
        authorization_endpoint: `${realm()}/protocol/openid-connect/auth`,
        device_authorization_endpoint: `${realm()}/protocol/openid-connect/auth/device`,
        token_endpoint: opts.tokenEndpointOverride ?? `${realm()}/protocol/openid-connect/token`,
        userinfo_endpoint: `${realm()}/protocol/openid-connect/userinfo`,
        revocation_endpoint: `${realm()}/protocol/openid-connect/revoke`,
        grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      });
    }
    if (p === "/realms/aisha/protocol/openid-connect/auth/device") {
      return send(res, 200, {
        device_code: "dc-1",
        user_code: "ABCD-EFGH",
        verification_uri: `${realm()}/device`,
        verification_uri_complete: `${realm()}/device?user_code=ABCD-EFGH`,
        expires_in: 600,
        interval: 1,
      });
    }
    if (p === "/realms/aisha/protocol/openid-connect/token") {
      const form = Object.fromEntries(new URLSearchParams(raw));
      state.tokenRequests.push(form);
      if (form.grant_type === "refresh_token") {
        if (opts.refreshFails) return send(res, 400, { error: "invalid_grant", error_description: "Session not active" });
        return send(res, 200, issueTokens());
      }
      const next = state.deviceSequence.shift() ?? "success";
      if (next === "success") return send(res, 200, issueTokens(form.scope));
      return send(res, 400, { error: next });
    }
    if (p === "/realms/aisha/protocol/openid-connect/userinfo") {
      if (!state.issued.has(bearer(req))) return send(res, 401, { error: "invalid_token" });
      return send(res, 200, { sub: "user-1", email: "dev@example.com" });
    }
    if (p === "/realms/aisha/protocol/openid-connect/revoke") {
      state.revoked.push(Object.fromEntries(new URLSearchParams(raw)));
      return send(res, 200);
    }
    if (p === "/realms/aisha/protocol/openid-connect/auth") {
      const ok = url.searchParams.get("client_id") === "aisha-mcp-client";
      res.writeHead(ok ? 200 : 400, { "content-type": "text/html" });
      return res.end("<html></html>");
    }
    if (p === "/functions/v1/mcp-knowledge-server") {
      const msg = JSON.parse(raw || "{}");
      state.mcpCalls.push({ method: msg.method, authorized: Boolean(bearer(req)) });
      if (opts.mcpEnforcesAuth !== false && !state.issued.has(bearer(req))) {
        return send(res, 401, { jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32000, message: "Missing Authorization header" } });
      }
      if (msg.id === undefined) return send(res, 202);
      const result =
        msg.method === "initialize"
          ? { protocolVersion: "2025-06-18", serverInfo: { name: "fake-mcp", version: "1.0.0" }, capabilities: { tools: {} } }
          : msg.method === "tools/list"
            ? { tools: tools.map((name) => ({ name })) }
            : {};
      const reply = { jsonrpc: "2.0", id: msg.id, result };
      if (opts.mcpSse) {
        res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "s-1" });
        return res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      }
      return send(res, 200, reply, { "mcp-session-id": "s-1" });
    }
    send(res, 404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    realm: realm(),
    state,
    issueTokens,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
