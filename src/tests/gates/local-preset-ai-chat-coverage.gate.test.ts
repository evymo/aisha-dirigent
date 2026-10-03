import { describe, expect, test } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

import { devEnvDefaults, presets, stackDependencies } from "../../../config/local-presets.mjs";

const AI_RUNTIME_PRESETS = ["optimum", "optimum-llm", "full-light", "full"] as const;

describe("local presets — ai-chat coverage", () => {
  test.each(AI_RUNTIME_PRESETS)("preset=%s includes the gateway AI upstream", (name) => {
    const apps = presets[name].apps;

    expect(apps).toContain("core");
    expect(apps).toContain("ai-chat");
  });

  test("custom --apps ai-chat pulls in the core data plane", () => {
    expect(stackDependencies["ai-chat"]).toContain("core");
  });

  test("local ai-chat compose can receive the deterministic LLM mock flag", () => {
    const compose = readFileSync("docker-compose.coolify-ai-chat.yml", "utf8");
    const generator = readFileSync("scripts/local-compose-gen.mjs", "utf8");

    expect(devEnvDefaults).toHaveProperty("AISHA_LLM_MOCK");
    expect(compose).toMatch(/AISHA_LLM_MOCK:\s*\$\{AISHA_LLM_MOCK:-\}/);
    expect(generator).toContain('"AISHA_LLM_MOCK"');
  });

  test("local PostgREST service token is a signed service_role JWT", () => {
    const token = devEnvDefaults.POSTGREST_SERVICE_TOKEN;
    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    const [header, payload, signature] = parts;
    const expectedSignature = createHmac("sha256", devEnvDefaults.JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest("base64url");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    expect(signature).toBe(expectedSignature);
    expect(claims.role).toBe("service_role");
    expect(devEnvDefaults.SERVICE_ROLE_KEY).toBe(token);
    expect(devEnvDefaults.AISHA_SERVICE_KEY).toBe(token);
  });
});
