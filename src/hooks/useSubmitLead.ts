/**
 * useSubmitLead — public contact/quote lead intake.
 *
 * Persists a web-form submission via the anon-callable `capture_lead` RPC
 * (SECURITY DEFINER → one row in the RLS-locked `lead_submissions` table). Used
 * by the marketing contact section (CTASection) and the `contact-form` runtime
 * block embedded in seeded web templates. Replaces the prior UI-only fake
 * submit (a `setTimeout` that persisted nothing).
 *
 * @module
 */
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { aisha } from "@/integrations/db/client";
import { safeError } from "@/lib/security/safeLogger";
import { getI18nPrimaryLocale } from "@/lib/i18n/locale";

/** Caller-supplied fields for a single lead submission. */
export interface SubmitLeadInput {
  /** Submitter name. */
  name: string;
  /** Free-form contact handle — email or phone, as the visitor entered it. */
  contact: string;
  /** Message body. */
  message: string;
  /** Originating page/template id (e.g. "electrician-trade"). Defaults server-side to "website". */
  source?: string;
  /** Optional reason/category (e.g. the platform form's collaboration|urgent|…). */
  subject?: string | null;
}

/**
 * react-query mutation that writes a lead. Returns the new lead id on success;
 * throws on RPC error so callers can surface a failure toast.
 */
export function useSubmitLead() {
  const { i18n } = useTranslation();
  return useMutation<string, Error, SubmitLeadInput>({
    mutationFn: async ({ name, contact, message, source, subject }) => {
      const { data, error } = await aisha.rpc("capture_lead", {
        p_contact: contact,
        p_locale: getI18nPrimaryLocale(i18n.language),
        p_message: message,
        p_name: name,
        p_source: source ?? "website",
        p_subject: subject ?? undefined,
      });
      if (error) {
        safeError("submitLead.failed", error);
        throw error instanceof Error ? error : new Error(String(error));
      }
      return data as string;
    },
  });
}
