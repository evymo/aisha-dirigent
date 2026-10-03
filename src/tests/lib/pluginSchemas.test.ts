import { describe, expect, it } from "vitest";

import {
  effectivePluginConfigSchema,
  pluginCatalogSchema,
  pluginHealthSummarySchema,
  pluginManifestSchema,
  pluginSandboxPolicySchema,
  pluginVersionSchema,
  sandboxApiRequestSchema,
} from "@/lib/schemas/pluginSchemas";

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PARTNER_ID = "33333333-3333-4333-8333-333333333333";

describe("pluginSchemas", () => {
  it("validates manifests with default lifecycle and sandbox policy values", () => {
    const manifest = pluginManifestSchema.parse({
      id: "partner-automation",
      version: "1.2.3",
      kind: "automation_node",
      trust_tier: "partner",
      capabilities: ["workflow.partner_sync.run"],
      lifecycle: {},
      sandbox: {},
    });

    expect(manifest.lifecycle.load_strategy).toBe("hot");
    expect(manifest.sandbox?.timeout_ms).toBe(5000);
    expect(manifest.sandbox?.max_memory_mb).toBe(64);
  });

  it("rejects invalid manifests and unsafe sandbox policies", () => {
    expect(() =>
      pluginManifestSchema.parse({
        id: "Invalid Plugin",
        version: "latest",
        kind: "automation_node",
        trust_tier: "partner",
        capabilities: ["bad"],
        lifecycle: {},
      }),
    ).toThrow();

    expect(() =>
      pluginSandboxPolicySchema.parse({
        timeout_ms: 99,
        max_memory_mb: 512,
      }),
    ).toThrow();
  });

  it("validates catalog, version, effective config and health rows", () => {
    expect(
      pluginCatalogSchema.parse({
        id: PLUGIN_ID,
        slug: "partner-automation",
        kind: "automation_node",
        trust_tier: "partner",
        status: "approved",
        capabilities: ["workflow.partner_sync.run"],
        config_schema: { enabled: { type: "boolean" } },
        sandbox_policy: { timeout_ms: 1000, network_allowlist: [], max_memory_mb: 32 },
        author_partner_id: PARTNER_ID,
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-04-02T00:00:00.000Z",
      }).status,
    ).toBe("approved");

    expect(
      pluginVersionSchema.parse({
        id: VERSION_ID,
        plugin_id: PLUGIN_ID,
        version: "1.2.3",
        artifact_sha256: "abc123",
        artifact_url: "https://plugins.example.test/partner-automation.tgz",
        changelog: null,
        resolved_deps: null,
        submitted_by: PARTNER_ID,
        reviewed_by: null,
        reviewed_at: null,
        created_at: "2026-04-01T00:00:00.000Z",
      }).plugin_id,
    ).toBe(PLUGIN_ID);

    expect(
      effectivePluginConfigSchema.parse({
        plugin_id: PLUGIN_ID,
        slug: "partner-automation",
        kind: "automation_node",
        trust_tier: "partner",
        status: "canary",
        capabilities: ["workflow.partner_sync.run"],
        config: { enabled: true },
        sandbox: { timeout_ms: 5000, network_allowlist: [], max_memory_mb: 64 },
        load_strategy: "cold",
        artifact_url: "https://plugins.example.test/partner-automation.tgz",
        artifact_sha256: "abc123",
        version: "1.2.3",
      }).load_strategy,
    ).toBe("cold");

    expect(
      pluginHealthSummarySchema.parse({
        plugin_id: PLUGIN_ID,
        total_invocations: 100,
        error_count: 2,
        error_rate: 0.02,
        p95_latency_ms: 120,
        last_error: null,
        period_hours: 24,
      }).error_rate,
    ).toBe(0.02);
  });

  it("validates sandbox host API request variants", () => {
    const requests = [
      {
        type: "rpc",
        function_name: "get_partner_profile",
        params: { partner_id: PARTNER_ID },
      },
      {
        type: "kv",
        op: "set",
        key: "partner:last-sync",
        value: "2026-04-01T00:00:00.000Z",
      },
      {
        type: "storage",
        op: "put",
        key: "exports/report.json",
        content_type: "application/json",
      },
      {
        type: "llm",
        op: "chat",
        messages: [{ role: "user", content: "Summarize this report" }],
        options: { model: "gpt-5.4", max_tokens: 1000, temperature: 0.2 },
      },
      {
        type: "event",
        op: "publish",
        topic: "partner.sync.completed",
        payload: { partner_id: PARTNER_ID },
      },
      {
        type: "notify",
        user_id: PARTNER_ID,
        channel: "in_app",
        title: "Sync complete",
        body: "Partner automation completed.",
      },
      {
        type: "fetch",
        url: "https://api.example.test/status",
        method: "POST",
        body: "{}",
      },
    ];

    for (const request of requests) {
      expect(sandboxApiRequestSchema.parse(request)).toMatchObject({
        type: request.type,
      });
    }
  });

  it("rejects malformed sandbox API requests", () => {
    expect(() =>
      sandboxApiRequestSchema.parse({
        type: "rpc",
        function_name: "DROP TABLE users",
        params: {},
      }),
    ).toThrow();

    expect(() =>
      sandboxApiRequestSchema.parse({
        type: "event",
        op: "publish",
        topic: ".bad-topic",
      }),
    ).toThrow();

    expect(() =>
      sandboxApiRequestSchema.parse({
        type: "fetch",
        url: "not a url",
      }),
    ).toThrow();
  });
});
