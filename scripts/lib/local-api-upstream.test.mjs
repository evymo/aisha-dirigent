import { describe, expect, test } from "vitest";
import { rewritePublicApiUrlForLocal, rewritePublicApiUrlsInEnv } from "./local-api-upstream.mjs";

const opts = { apiDomain: "api.local", apiUpstream: "http://api.mesh.local.internal:3001" };

describe("rewritePublicApiUrlForLocal", () => {
  test("veřejná tvář API → mesh jméno API, cesta zůstane", () => {
    expect(rewritePublicApiUrlForLocal("https://api.local", opts)).toBe("http://api.mesh.local.internal:3001");
    expect(rewritePublicApiUrlForLocal("https://api.local/mcp", opts)).toBe("http://api.mesh.local.internal:3001/mcp");
  });

  test("jiný hostitel, holá doména ani podobné jméno se nepřepisuje", () => {
    expect(rewritePublicApiUrlForLocal("api.local", opts)).toBe("api.local"); // holá doména (Keycloak API_DOMAIN)
    expect(rewritePublicApiUrlForLocal("https://api.localhost/x", opts)).toBe("https://api.localhost/x");
    expect(rewritePublicApiUrlForLocal("https://n8n.local", opts)).toBe("https://n8n.local");
    expect(rewritePublicApiUrlForLocal("http://localhost:3001", opts)).toBe("http://localhost:3001");
  });

  test("chybí-li vstup, nic se nedosazuje", () => {
    expect(rewritePublicApiUrlForLocal("https://api.local", { apiDomain: "api.local" })).toBe("https://api.local");
    expect(rewritePublicApiUrlForLocal("https://api.local", {})).toBe("https://api.local");
  });
});

describe("rewritePublicApiUrlsInEnv", () => {
  test("objekt i pole K=V", () => {
    expect(rewritePublicApiUrlsInEnv({ AISHA_API_URL: "https://api.local", X: 1 }, opts)).toEqual({
      AISHA_API_URL: "http://api.mesh.local.internal:3001",
      X: 1,
    });
    expect(rewritePublicApiUrlsInEnv(["AISHA_MCP_URL=https://api.local/mcp", "BEZ_HODNOTY"], opts)).toEqual([
      "AISHA_MCP_URL=http://api.mesh.local.internal:3001/mcp",
      "BEZ_HODNOTY",
    ]);
  });
});
