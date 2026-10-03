/**
 * Tests for user-facing error message mapping.
 * Verifies error patterns correctly map to i18n keys.
 */
import { getUserFacingErrorMessage } from "@/lib/security/userFacingErrors";

describe("getUserFacingErrorMessage", () => {
  it("maps network errors to errors.network", () => {
    expect(getUserFacingErrorMessage(new TypeError("Network request failed"))).toBe(
      "errors.network"
    );
    expect(getUserFacingErrorMessage(new Error("fetch failed"))).toBe("errors.network");
    expect(getUserFacingErrorMessage(new Error("timeout"))).toBe("errors.network");
    expect(getUserFacingErrorMessage(new Error("ECONNREFUSED"))).toBe("errors.network");
  });

  it("maps JWT/session errors to errors.session_expired", () => {
    expect(getUserFacingErrorMessage(new Error("PGRST301"))).toBe(
      "errors.session_expired"
    );
    expect(getUserFacingErrorMessage(new Error("JWT expired"))).toBe(
      "errors.session_expired"
    );
  });

  it("maps permission errors to errors.permission_denied", () => {
    expect(getUserFacingErrorMessage(new Error("permission denied"))).toBe(
      "errors.permission_denied"
    );
    expect(getUserFacingErrorMessage(new Error("insufficient_privilege"))).toBe(
      "errors.permission_denied"
    );
  });

  it("maps not found errors to errors.not_found", () => {
    expect(getUserFacingErrorMessage(new Error("404 Not Found"))).toBe(
      "errors.not_found"
    );
  });

  it("maps rate limit errors to errors.rate_limit", () => {
    expect(getUserFacingErrorMessage(new Error("429 rate limit exceeded"))).toBe(
      "errors.rate_limit"
    );
  });

  it("maps validation errors to errors.validation", () => {
    expect(getUserFacingErrorMessage(new Error("invalid email format"))).toBe(
      "errors.validation"
    );
    expect(
      getUserFacingErrorMessage(new Error("Invalid login credentials"))
    ).toBe("errors.validation");
  });

  it("returns errors.generic for unknown errors", () => {
    expect(getUserFacingErrorMessage(new Error("something weird"))).toBe(
      "errors.generic"
    );
  });

  it("handles string errors", () => {
    expect(getUserFacingErrorMessage("Network request failed")).toBe(
      "errors.network"
    );
  });

  it("handles object errors with message property", () => {
    expect(
      getUserFacingErrorMessage({ message: "Network error", code: 0 })
    ).toBe("errors.network");
  });

  it("returns errors.generic for null/undefined", () => {
    expect(getUserFacingErrorMessage(null)).toBe("errors.generic");
    expect(getUserFacingErrorMessage(undefined)).toBe("errors.generic");
  });
});
