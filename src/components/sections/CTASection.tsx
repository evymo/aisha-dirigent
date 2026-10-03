import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useSubmitLead } from "@/hooks/useSubmitLead";
import { getUserFacingDataErrorMessage } from "@/lib/security/userFacingErrors";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  type: z.string(),
  message: z.string().trim().min(1),
});

const CTASection = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const submitLead = useSubmitLead();
  const [form, setForm] = useState({ name: "", email: "", type: "collaboration", message: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = schema.safeParse(form);
    if (!result.success) {
      const errs: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        if (field === "name") errs.name = t("web.contact.error.name");
        if (field === "email") errs.email = t("web.contact.error.email");
        if (field === "message") errs.message = t("web.contact.error.message");
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    submitLead.mutate(
      { name: form.name, contact: form.email, message: form.message, subject: form.type, source: "website" },
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

  const inputClass = "w-full bg-transparent border border-border/60 rounded-lg px-4 py-3 text-[13px] font-sans text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-gold/40 focus:ring-1 focus:ring-gold/10 transition-all duration-200";

  return (
    <section id="contact" className="py-32 bg-secondary relative overflow-hidden">
      {/* Premium ambient glow background */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gold/5 blur-[120px] rounded-full pointer-events-none opacity-40 translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gold/5 blur-[120px] rounded-full pointer-events-none opacity-30 -translate-x-1/3 translate-y-1/3" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-xl mx-auto"
        >
          <div className="text-center mb-16 relative">
            <span className="inline-block px-4 py-1.5 border border-gold/15 bg-gold/5 rounded-full text-[10px] font-sans font-bold tracking-[0.2em] uppercase mb-6 text-gold/80">
              {t("web.cta.title")}
            </span>
            <h2 className="font-serif text-3xl md:text-[2.75rem] font-bold text-foreground mb-5 leading-tight">
              {t("web.cta.subtitle")}
            </h2>
          </div>

          <div className="bg-card/60 backdrop-blur-md rounded-2xl p-8 md:p-10 border border-border/60 shadow-soft-lg relative overflow-hidden group">
            {/* Animated gradient top border */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-gold/40 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-700" />

            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">{t("web.contact.name.label")}</label>
                  <input
                    className={inputClass}
                    placeholder={t("web.contact.name.placeholder")}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                  {errors.name && <p className="text-destructive text-[11px] mt-1.5 font-sans animate-in fade-in slide-in-from-top-1">{errors.name}</p>}
                </div>

                <div>
                  <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">{t("web.contact.email.label")}</label>
                  <input
                    type="email"
                    className={inputClass}
                    placeholder={t("web.contact.email.placeholder")}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                  {errors.email && <p className="text-destructive text-[11px] mt-1.5 font-sans animate-in fade-in slide-in-from-top-1">{errors.email}</p>}
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">{t("web.contact.type.label")}</label>
                <select
                  className={`${inputClass} appearance-none cursor-pointer bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20class%3D%22lucide%20lucide-chevron-down%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px_16px] bg-[right_16px_center] bg-no-repeat`}
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="collaboration">{t("web.contact.type.collaboration")}</option>
                  <option value="urgent">{t("web.contact.type.urgent")}</option>
                  <option value="partnership">{t("web.contact.type.partnership")}</option>
                  <option value="general">{t("web.contact.type.general")}</option>
                </select>
              </div>

              <div>
                <label className="block text-[12px] font-sans font-semibold tracking-wide text-foreground/80 mb-2.5 uppercase">{t("web.contact.message.label")}</label>
                <textarea
                  className={`${inputClass} min-h-[140px] resize-y`}
                  placeholder={t("web.contact.message.placeholder")}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
                {errors.message && <p className="text-destructive text-[11px] mt-1.5 font-sans animate-in fade-in slide-in-from-top-1">{errors.message}</p>}
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full inline-flex items-center justify-center gap-2 bg-gold hover:bg-gold-dark text-navy px-8 py-4 rounded-xl font-sans font-bold text-[13px] tracking-[0.1em] uppercase transition-all duration-300 shadow-gold-md hover:shadow-gold-lg disabled:opacity-50 disabled:hover:translate-y-0 hover:-translate-y-0.5"
                >
                  {sending ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-navy border-t-transparent animate-spin" />
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

          <p className="font-sans text-[11px] text-muted-foreground/60 mt-8 text-center tracking-[0.1em] flex items-center justify-center gap-3">
            <span className="w-8 h-px bg-border/60" />
            info@aisha.guru
            <span className="w-8 h-px bg-border/60" />
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default CTASection;
