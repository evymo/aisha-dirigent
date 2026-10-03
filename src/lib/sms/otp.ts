/**
 * SMS OTP Service Module
 *
 * This module provides utilities for sending OTP codes via SMS
 * using third-party providers (Twilio, MessageBird, etc.)
 *
 * Auth flow: AISHA uses Keycloak OIDC for primary auth; this module is
 * for custom SMS sending outside the OIDC flow (e.g. step-up auth,
 * custom flows where SMS OTP is wrapped around Keycloak authentication).
 *
 * @module sms/otp
 */

import { aisha } from "@/integrations/db/client";

/**
 * SMS Provider configuration type
 */
export type SmsProvider = "twilio" | "messagebird" | "vonage" | "custom";

/**
 * SMS send result
 */
export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/** Payload shape returned by the `send-sms-otp` Edge Function. */
interface SendSmsOtpResponse {
  messageId?: string;
}

/** Payload shape returned by the `verify-sms-otp` Edge Function. */
interface VerifySmsOtpResponse {
  valid?: boolean;
}

/**
 * OTP generation options
 */
export interface OtpOptions {
  /** Length of OTP code (default: 6) */
  length?: number;
  /** Expiry in seconds (default: 300 = 5 minutes) */
  expirySeconds?: number;
  /** Custom template with {code} placeholder */
  template?: string;
}

/**
 * Generate a random numeric OTP code
 *
 * @param length - Length of the OTP (default: 6)
 * @returns Numeric OTP string
 */
export function generateOtpCode(length: number = 6): string {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

/**
 * Send OTP via Supabase Edge Function
 *
 * This calls the `send-sms-otp` Edge Function which handles
 * provider selection and actual SMS sending.
 *
 * @param phone - Phone number in E.164 format (+420123456789)
 * @param options - OTP generation options
 * @returns Promise with send result
 *
 * @example
 * ```typescript
 * const result = await sendOtpSms("+420123456789", {
 *   length: 6,
 *   expirySeconds: 300,
 * });
 *
 * if (result.success) {
 *   console.log("OTP sent:", result.messageId);
 * }
 * ```
 */
export async function sendOtpSms(
  phone: string,
  options: OtpOptions = {}
): Promise<SmsSendResult> {
  const { length = 6, expirySeconds = 300, template } = options;

  try {
    const { data, error } = await aisha.functions.invoke("send-sms-otp", {
      body: {
        phone,
        otpLength: length,
        expirySeconds,
        template,
      },
    });

    if (error) {
      return {
        success: false,
        error: error.message || "Failed to send SMS",
      };
    }

    return {
      success: true,
      messageId: (data as SendSmsOtpResponse | undefined)?.messageId,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Verify OTP code via Supabase Edge Function
 *
 * @param phone - Phone number in E.164 format
 * @param code - OTP code to verify
 * @returns Promise with verification result
 */
export async function verifyOtpCode(
  phone: string,
  code: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const { data, error } = await aisha.functions.invoke("verify-sms-otp", {
      body: { phone, code },
    });

    if (error) {
      return {
        valid: false,
        error: error.message || "Verification failed",
      };
    }

    return {
      valid: (data as VerifySmsOtpResponse | undefined)?.valid === true,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Format phone number to E.164 format
 *
 * @param phone - Raw phone number
 * @param defaultCountryCode - Default country code if not provided (e.g., "420" for CZ)
 * @returns Phone in E.164 format or null if invalid
 *
 * @example
 * ```typescript
 * formatPhoneE164("123456789", "420") // "+420123456789"
 * formatPhoneE164("+420 123 456 789") // "+420123456789"
 * ```
 */
export function formatPhoneE164(
  phone: string,
  defaultCountryCode?: string
): string | null {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, "");

  // If no + and we have default country code, add it
  if (!cleaned.startsWith("+") && defaultCountryCode) {
    cleaned = `+${defaultCountryCode}${cleaned}`;
  }

  // Validate: must start with + and have 10-15 digits
  if (!/^\+\d{10,15}$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Check if phone number is valid E.164 format
 */
export function isValidE164(phone: string): boolean {
  return /^\+\d{10,15}$/.test(phone);
}
