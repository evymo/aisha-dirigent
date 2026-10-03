/**
 * Tests for matrix-client.ts — Matrix token exchange transport.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeMatrixToken } from "../src/matrix-client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("matrix-client.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "matrix-token",
        user_id: "@user:matrix.backend.id3a.cz",
        home_server: "matrix.backend.id3a.cz",
      }),
    });
  });

  it("uses gateway matrix-token-exchange URL directly", async () => {
    await exchangeMatrixToken("https://api.backend.id3a.cz/functions/v1/matrix-token-exchange", "jwt");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.backend.id3a.cz/functions/v1/matrix-token-exchange",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("appends /token-exchange for legacy svc-matrix base URLs", async () => {
    await exchangeMatrixToken("http://svc-matrix:3026", "jwt");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://svc-matrix:3026/token-exchange",
      expect.objectContaining({ method: "POST" }),
    );
  });
});