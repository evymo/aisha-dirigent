/**
 * ContactFormBlock — Runtime block for the interactive contact form.
 *
 * Extracts the form logic from CTASection into a standalone, theme-driven runtime
 * block that can be placed in any seeded page. Submits for real via useSubmitLead
 * (→ capture_lead RPC). Styled with shadcn theme tokens (primary / card / border /
 * foreground / muted-foreground) so it adopts the host template's palette rather
 * than a hardcoded house colour.
 *
 * Editor placeholder: `<div data-runtime-block="contact-form"></div>`
 * Config (data-block-config): { source?: string, subject?: boolean,
 *   contactMode?: "email" | "emailOrPhone" }. Operator templates pass
 *   subject:false (hide the platform reason dropdown) and contactMode:"emailOrPhone"
 *   (a trades / quote form should accept a phone too).
 *
 * @module
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useSubmitLead } from "@/hooks/useSubmitLead";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

/**
 * Runtime block that renders an interactive contact form with Zod validation.
 */
export default function ContactFormBlock({ config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const submitLead = useSubmitLead();
  const [form, setForm] = useState({ name: "", email: "", type: "collaboration", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Originating page/template id, for the operator inbox (defaults to "website").
  const source = typeof config?.source === "string" ? config.source : "website";
  // Hide the platform reason dropdown unless explicitly kept (AISHA's own site).
  const showSubject = config?.subject !== false;
  // Accept a phone number as well as an email (trades / quote forms).
  const emailOrPhone = config?.contactMode === "emailOrPhone";

  const schema = z.object({
    name: z.string().trim().min(1),
    email: emailOrPhone ? z.string().trim().min(1) : z.string().trim().email(),
    message: z.string().trim().min(1),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = schema.safeParse(form);
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        if (field === "name") errs.name = t("web.contact.error.name");
        if (field === "email") errs.email = t(emailOrPhone ? "web.contact.error.contact" : "web.contact.error.email");
        if (field === "message") errs.message = t("web.contact.error.message");
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    submitLead.mutate(
      { name: form.name, contact: form.email, message: form.message, subject: showSubject ? form.type : undefined, source },
      {
        onSuccess: () => {
          toast({ title: t("web.contact.success") });
          setForm({ name: "", email: "", type: "collaboration", message: "" });
        },
        onError: (error) => {
          toast({ title: getUserFacingDataErrorMessage(error), variant: "destructive" });
        },
      },
    );
  };

  const sending = submitLead.isPending;

  const inputClass =
    "w-full bg-transparent border border-border/60 rounded-lg px-4 py-3 text-[13px] font-sans text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/10 transition-all duration-200";

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-card/60 backdrop-blur-md rounded-2xl p-8 md:p-10 border border-border/60 shadow-soft-lg relative overflow-hidden group">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />

        <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">
                {t("web.contact.name.label")}
              </label>
              <input
                className={inputClass}
                placeholder={t("web.contact.name.placeholder")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              {errors.name && (
                <p className="text-destructive text-[11px] mt-1.5 font-sans animate-in fade-in slide-in-from-top-1">
                  {errors.name}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">
                {t(emailOrPhone ? "web.contact.contact.label" : "web.contact.email.label")}
              </label>
              <input
                type={emailOrPhone ? "text" : "email"}
                className={inputClass}
                placeholder={t(emailOrPhone ? "web.contact.contact.placeholder" : "web.contact.email.placeholder")}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {errors.email && (
                <p className="text-destructive text-[11px] mt-1.5 font-sans animate-in fade-in slide-in-from-top-1">
                  {errors.email}
                </p>
              )}
            </div>
          </div>

          {showSubject && (
            <div>
              <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">
                {t("web.contact.type.label")}
              </label>
              <select
                className={`${inputClass} appearance-none cursor-pointer`}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="collaboration">{t("web.contact.type.collaboration")}</option>
                <option value="urgent">{t("web.contact.type.urgent")}</option>
                <option value="partnership">{t("web.contact.type.partnership")}</option>
                <option value="general">{t("web.contact.type.general")}</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">
              {t("web.contact.message.label")}
            </label>
            <textarea
              className={`${inputClass} min-h-[140px] resize-y`}
              placeholder={t("web.contact.message.placeholder")}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
            {errors.message && (
              <p className="text-destructive text-[11px] mt-1.5 font-sans animate-in fade-in slide-in-from-top-1">
                {errors.message}
              </p>
            )}
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={sending}
              className="w-full inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-4 rounded-xl font-sans font-bold text-[13px] tracking-[0.1em] uppercase transition-all duration-300 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:hover:translate-y-0 hover:-translate-y-0.5"
            >
              {sending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                </span>
              ) : (
                <>
                  {t("web.cta.button")}
                  <ArrowRight size={16} strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
