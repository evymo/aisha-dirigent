#!/usr/bin/env node

import { createRequestEnvelope, withEnvelope } from "./request-envelope.mjs";

async function readJsonResponse(response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export async function callMcp(method, args, config) {
  if (!config.mcpUrl) {
    throw new Error("MCP URL is not configured.");
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (!config.accessToken) {
    throw new Error("AISHA access token is required for MCP calls. Set AISHA_ACCESS_TOKEN or sign in via the extension.");
  }
  headers.Authorization = `Bearer ${config.accessToken}`;

  const response = await fetch(config.mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params: args ?? {},
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await readJsonResponse(response);
  return {
    ok: response.ok && !body.error,
    status: response.status,
    body,
  };
}

export async function listMcpTools(config) {
  return callMcp("tools/list", {}, config);
}

export async function callN8nWorkflow(workflow, payload, config, envelopeOverrides = {}) {
  if (!config.n8nTriggerUrl) {
    throw new Error("n8n trigger URL is not configured.");
  }

  const envelope = createRequestEnvelope(workflow, payload, config, envelopeOverrides);
  const headers = {
    "Content-Type": "application/json",
  };

  if (!config.accessToken) {
    throw new Error("AISHA access token is required for n8n workflow calls. Set AISHA_ACCESS_TOKEN or sign in via the extension.");
  }
  headers.Authorization = `Bearer ${config.accessToken}`;

  const response = await fetch(config.n8nTriggerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workflow,
      payload: withEnvelope(payload, envelope),
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const body = await readJsonResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    body,
    envelope,
  };
}

export function extractAgentText(body) {
  if (typeof body === "string") {
    return body;
  }

  if (!body || typeof body !== "object") {
    return "";
  }

  if (typeof body.response === "string") {
    return body.response;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  if (Array.isArray(body.data)) {
    return body.data.map((item) => JSON.stringify(item)).join("\n");
  }

  if (body.result?.content) {
    return body.result.content
      .map((item) => (item.type === "text" ? item.text : JSON.stringify(item)))
      .join("\n");
  }

  return JSON.stringify(body, null, 2);
}
