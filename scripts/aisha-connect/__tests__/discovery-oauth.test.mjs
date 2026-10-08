import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertProfileName, discoverInstance, profileNameFromUrl, safeUrl } from "../lib/discovery.mjs";
import {
  accessTokenProblems,
  ensureFreshCredential,
  LoginRequiredError,
  OAuthError,
  pollDeviceToken,
  startDeviceAuthorization,
  toCredential,
} from "../lib/oauth.mjs";
import { configDir, createStore } from "../lib/store.mjs";
import { fakeJwt, startFakeInstance } from "./fake-instance.mjs";

let instance;
afterEach(async () => {
  await instance?.close();
  instance = undefined;
});

describe("safeUrl — where tokens may go", () => {
  test("https anywhere, http only on loopback", () => {
    expect(safeUrl("https://api.example.org/", "x")).toBe("https://api.example.org");
    expect(safeUrl("http://localhost:3001", "x")).toBe("http://localhost:3001");
    expect(safeUrl("http://127.0.0.1:8180/realms/aisha", "x")).toBe("http://127.0.0.1:8180/realms/aisha");
    expect(() => safeUrl("http://api.example.org", "x")).toThrow(/only allowed for localhost/);
    expect(() => safeUrl("https://user:pw@api.example.org", "x")).toThrow(/credentials/);
    expect(() => safeUrl("file:///etc/passwd", "x")).toThrow(/unsupported protocol/);
    expect(() => safeUrl("", "x")).toThrow(/missing/);
  });

  test("profile names derive from the API host and stay shell-safe", () => {
    expect(profileNameFromUrl("https://api.example.org")).toBe("example.org");
    expect(profileNameFromUrl("https://aisha.example.org")).toBe("aisha.example.org");
    expect(profileNameFromUrl("http://localhost:3001")).toBe("local");
    expect(() => assertProfileName("bad name; rm -rf")).toThrow(/invalid profile name/);
    expect(assertProfileName("example.org")).toBe("example.org");
  });
});

describe("discoverInstance", () => {
  test("reads app-config, then the realm it names", async () => {
    instance = await startFakeInstance();
    const p = await discoverInstance(instance.base);
    expect(p.apiBase).toBe(instance.base);
    expect(p.appConfig.mcp_url).toBe(`${instance.base}/functions/v1/mcp-knowledge-server`);
    expect(p.oidc.issuer).toBe(instance.realm);
    expect(p.oidc.device_authorization_endpoint).toMatch(/\/auth\/device$/);
    expect(p.protectedResource.authorization_servers).toEqual([instance.realm]);
  });

  test("refuses a realm that answers as a different issuer (mix-up)", async () => {
    instance = await startFakeInstance({ issuerOverride: "http://127.0.0.1:1/realms/other" });
    await expect(discoverInstance(instance.base)).rejects.toThrow(/issuer mismatch/);
  });

  test("refuses a token endpoint outside the issuer origin", async () => {
    instance = await startFakeInstance({ tokenEndpointOverride: "https://evil.example.org/token" });
    await expect(discoverInstance(instance.base)).rejects.toThrow(/not on the issuer origin/);
  });

  test("an HTML answer points at the web host instead of the API base", async () => {
    instance = await startFakeInstance({ appConfigHtml: true });
    await expect(discoverInstance(instance.base)).rejects.toThrow(/web app host/);
  });
});

describe("device flow (RFC 8628)", () => {
  const device = { device_code: "dc-1", user_code: "X", expires_in: 600, interval: 1 };

  test("waits through authorization_pending and slow_down, then returns tokens", async () => {
    instance = await startFakeInstance({ deviceSequence: ["authorization_pending", "slow_down", "success"] });
    const p = await discoverInstance(instance.base);
    const started = await startDeviceAuthorization({ endpoint: p.oidc.device_authorization_endpoint, clientId: "aisha-dirigent-device", scope: "openid" });
    expect(started.user_code).toBe("ABCD-EFGH");
    const waits = [];
    const tokens = await pollDeviceToken({ tokenEndpoint: p.oidc.token_endpoint, clientId: "aisha-dirigent-device", device, sleep: async (ms) => waits.push(ms) });
    expect(tokens.access_token).toBeTruthy();
    expect(waits).toEqual([1000, 1000, 6000]); // slow_down adds 5 s
    expect(instance.state.tokenRequests.every((r) => r.grant_type === "urn:ietf:params:oauth:grant-type:device_code")).toBe(true);
  });

  test("a denied login is an error, not an endless wait", async () => {
    instance = await startFakeInstance({ deviceSequence: ["access_denied"] });
    const p = await discoverInstance(instance.base);
    await expect(
      pollDeviceToken({ tokenEndpoint: p.oidc.token_endpoint, clientId: "c", device, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test("gives up when the code expires", async () => {
    instance = await startFakeInstance({ deviceSequence: Array(50).fill("authorization_pending") });
    const p = await discoverInstance(instance.base);
    let t = 0;
    await expect(
      pollDeviceToken({
        tokenEndpoint: p.oidc.token_endpoint,
        clientId: "c",
        device: { ...device, expires_in: 3 },
        sleep: async (ms) => {
          t += ms;
        },
        now: () => t,
      }),
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe("credentials", () => {
  const issuer = "http://127.0.0.1:9/realms/aisha";

  test("toCredential takes expiry from the token and treats refresh_expires_in 0 as offline", () => {
    const exp = 2_000_000_000;
    const c = toCredential({ access_token: fakeJwt({ exp, sub: "s", email: "e@x" }), refresh_token: "r", refresh_expires_in: 0 }, { issuer, clientId: "c", now: () => 1 });
    expect(c.expires_at).toBe(exp * 1000);
    expect(c.refresh_expires_at).toBeNull();
    expect(c.email).toBe("e@x");
  });

  test("accessTokenProblems checks iss, azp and expiry", () => {
    const now = () => 1_000_000;
    const good = fakeJwt({ iss: issuer, azp: "c", exp: 2000 });
    expect(accessTokenProblems(good, { issuer, clientId: "c", now })).toEqual([]);
    const bad = fakeJwt({ iss: "https://other", azp: "x", exp: 1 });
    expect(accessTokenProblems(bad, { issuer, clientId: "c", now })).toHaveLength(3);
    expect(accessTokenProblems("opaque", { issuer, clientId: "c", now })).toEqual(["access token is not a JWT"]);
  });

  test("ensureFreshCredential refreshes an expiring token and persists it", async () => {
    instance = await startFakeInstance();
    const profile = await discoverInstance(instance.base);
    const stale = { ...toCredential(instance.issueTokens(), { issuer: profile.oidc.issuer, clientId: "aisha-dirigent-device" }), expires_at: Date.now() - 1 };
    let persisted = null;
    const fresh = await ensureFreshCredential({ profile, credential: stale, persist: (c) => (persisted = c) });
    expect(fresh.access_token).not.toBe(stale.access_token);
    expect(persisted).toBe(fresh);
    expect(instance.state.tokenRequests.at(-1)).toMatchObject({ grant_type: "refresh_token", client_id: "aisha-dirigent-device" });

    // still valid → no network
    const before = instance.state.tokenRequests.length;
    await ensureFreshCredential({ profile, credential: fresh, persist: () => {} });
    expect(instance.state.tokenRequests.length).toBe(before);
  });

  test("an ended session asks for login — unless another process already refreshed", async () => {
    instance = await startFakeInstance({ refreshFails: true });
    const profile = await discoverInstance(instance.base);
    const stale = { ...toCredential(instance.issueTokens(), { issuer: profile.oidc.issuer, clientId: "c" }), expires_at: 0 };
    await expect(ensureFreshCredential({ profile, credential: stale, persist: () => {} })).rejects.toBeInstanceOf(LoginRequiredError);
    const other = toCredential(instance.issueTokens(), { issuer: profile.oidc.issuer, clientId: "c" });
    const got = await ensureFreshCredential({ profile, credential: stale, persist: () => {}, reload: () => other });
    expect(got).toBe(other);
  });

  test("a login for another realm is not reused", async () => {
    instance = await startFakeInstance();
    const profile = await discoverInstance(instance.base);
    const foreign = { ...toCredential(instance.issueTokens(), { issuer: "https://other/realms/x", clientId: "c" }) };
    await expect(ensureFreshCredential({ profile, credential: foreign, persist: () => {} })).rejects.toThrow(/belongs to/);
  });
});

describe("store", () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  test("credentials are written 0600, profiles round-trip", () => {
    dir = mkdtempSync(join(tmpdir(), "aisha-connect-"));
    const store = createStore(join(dir, "cfg"));
    store.saveProfile("p", { apiBase: "x", oidc: { issuer: "i" } });
    store.saveCredential("p", { access_token: "t" });
    expect(store.getProfile("p").apiBase).toBe("x");
    expect(store.readProfiles().defaultProfile).toBe("p");
    expect(store.getCredential("p").access_token).toBe("t");
    if (process.platform !== "win32") expect(statSync(store.credentialsFile).mode & 0o777).toBe(0o600);
    expect(store.deleteCredential("p")).toBe(true);
    expect(store.getCredential("p")).toBeNull();
  });

  test("config dir: explicit env, XDG, Windows APPDATA", () => {
    expect(configDir({ AISHA_CONFIG_DIR: "/x" }, "linux", "/h")).toBe("/x");
    expect(configDir({ XDG_CONFIG_HOME: "/xdg" }, "linux", "/h")).toBe(join("/xdg", "aisha"));
    expect(configDir({}, "linux", "/h")).toBe(join("/h", ".config", "aisha"));
    expect(configDir({ APPDATA: "C:/AppData" }, "win32", "/h")).toBe(join("C:/AppData", "aisha"));
  });
});
