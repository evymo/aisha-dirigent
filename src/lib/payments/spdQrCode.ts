import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Data required to generate a Czech SPD (Short Payment Descriptor) QR code.
 */
export interface BankTransferQrData {
  /** Amount in the smallest currency unit (e.g. CZK = whole crowns) */
  amount: number;
  /** BIC (SWIFT) code of the recipient bank */
  bic?: string | null;
  /** ISO 4217 currency code (default: CZK) */
  currency?: string | null;
  /** IBAN of the recipient */
  iban: string;
  /** Optional message for the recipient */
  message?: string | null;
  /** Variable symbol (up to 10 digits) */
  variableSymbol?: string | null;
}

// ---------------------------------------------------------------------------
// SPD Generator
// ---------------------------------------------------------------------------

/**
 * Generate a Czech SPD (Short Payment Descriptor) string.
 *
 * Format specification: https://qr-platba.cz/pro-vyvojare/specifikace-formatu/
 *
 * Structure: `SPD*1.0*ACC:{IBAN}+{BIC}*AM:{amount}*CC:{currency}*X-VS:{vs}*MSG:{msg}`
 *
 * @param data - Payment data
 * @returns SPD string for QR code encoding
 */
export function generateSpdString(data: BankTransferQrData): string {
  const parts: string[] = ["SPD*1.0"];

  // ACC: account — IBAN optionally followed by +BIC
  const iban = data.iban.replace(/\s/g, "").toUpperCase();
  if (data.bic) {
    parts.push(`ACC:${iban}+${data.bic.replace(/\s/g, "").toUpperCase()}`);
  } else {
    parts.push(`ACC:${iban}`);
  }

  // AM: amount — decimal with dot separator, max 2 decimal places
  parts.push(`AM:${data.amount.toFixed(2)}`);

  // CC: currency code
  const currency = (data.currency ?? BASE_CURRENCY_FALLBACK).toUpperCase();
  parts.push(`CC:${currency}`);

  // X-VS: variable symbol (optional, up to 10 digits)
  if (data.variableSymbol) {
    const vs = data.variableSymbol.replace(/\D/g, "").slice(0, 10);
    if (vs.length > 0) {
      parts.push(`X-VS:${vs}`);
    }
  }

  // MSG: message (optional, max 60 chars, no special chars)
  if (data.message) {
    const msg = data.message
      .replace(/[*]/g, "")
      .slice(0, 60);
    parts.push(`MSG:${msg}`);
  }

  return parts.join("*");
}
