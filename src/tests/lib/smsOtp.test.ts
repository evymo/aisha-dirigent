import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatPhoneE164,
  generateOtpCode,
  isValidE164,
  sendOtpSms,
  verifyOtpCode,
} from "@/lib/sms/otp";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/db/client", () => ({
  aisha: {
    functions: {
      invoke: invokeMock,
    },
  },
}));

describe("sms otp utilities", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("generates numeric OTP codes with requested length", () => {
    const otp = generateOtpCode(8);

    expect(otp).toMatch(/^\d{8}$/);
  });

  it("formats and validates E.164 phone numbers", () => {
    expect(formatPhoneE164("123 456 789", "420")).toBe("+420123456789");
    expect(formatPhoneE164("+420 123 456 789")).toBe("+420123456789");
    expect(formatPhoneE164("123")).toBeNull();
    expect(isValidE164("+420123456789")).toBe(true);
    expect(isValidE164("420123456789")).toBe(false);
  });

  it("sends OTP via the configured function bridge", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { messageId: "msg-1" },
      error: null,
    });

    await expect(sendOtpSms("+420123456789", {
      length: 4,
      expirySeconds: 120,
      template: "Code: {code}",
    })).resolves.toEqual({
      success: true,
      messageId: "msg-1",
    });

    expect(invokeMock).toHaveBeenCalledWith("send-sms-otp", {
      body: {
        phone: "+420123456789",
        otpLength: 4,
        expirySeconds: 120,
        template: "Code: {code}",
      },
    });
  });

  it("returns structured send failures", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Provider rejected request" },
    });

    await expect(sendOtpSms("+420123456789")).resolves.toEqual({
      success: false,
      error: "Provider rejected request",
    });

    invokeMock.mockRejectedValueOnce(new Error("Network unavailable"));

    await expect(sendOtpSms("+420123456789")).resolves.toEqual({
      success: false,
      error: "Network unavailable",
    });
  });

  it("verifies OTP codes via the configured function bridge", async () => {
    invokeMock.mockResolvedValueOnce({
      data: { valid: true },
      error: null,
    });

    await expect(verifyOtpCode("+420123456789", "123456")).resolves.toEqual({
      valid: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("verify-sms-otp", {
      body: {
        phone: "+420123456789",
        code: "123456",
      },
    });
  });

  it("returns structured verification failures", async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Expired code" },
    });

    await expect(verifyOtpCode("+420123456789", "123456")).resolves.toEqual({
      valid: false,
      error: "Expired code",
    });

    invokeMock.mockRejectedValueOnce("boom");

    await expect(verifyOtpCode("+420123456789", "123456")).resolves.toEqual({
      valid: false,
      error: "Unknown error",
    });
  });
});
