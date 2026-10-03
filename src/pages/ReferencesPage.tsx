import { useDocumentTitle } from "@/hooks/use-document-title";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ShieldCheck, Car, Server, Gift, FlaskConical, Scale, CheckCircle2, Lightbulb } from "lucide-react";

const references = [
  { key: "1", icon: ShieldCheck },
  { key: "2", icon: Car },
  { key: "3", icon: Server },
  { key: "4", icon: Gift },
  { key: "5", icon: FlaskConical },
  { key: "6", icon: Scale },
];

const ReferencesPage = () => {
  const { t } = useTranslation();
  useDocumentTitle(t("web.references.title"));

  const differentPoints = [
    "web.references.different.point1",
    "web.references.different.point2",
    "web.references.different.point3",
    "web.references.different.point4",
  ];

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-18">
        <section className="py-24 bg-primary text-center">
          <div className="container mx-auto px-6 max-w-3xl">
            <motion.div initial={{ opacity: 0, y: 25 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-primary-foreground mb-6">{t("web.references.title")}</h1>
              <p className="font-sans text-primary-foreground/60 text-lg leading-relaxed">{t("web.references.subtitle")}</p>
            </motion.div>
          </div>
        </section>

        {/* Expertise cards */}
        <section className="py-20 bg-background">
          <div className="container mx-auto px-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              {references.map((ref, i) => (
                <motion.div
                  key={ref.key}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 * i }}
                  className="border border-border rounded-xl p-6 hover:border-gold/30 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                      <ref.icon className="text-gold" size={20} />
                    </div>
                    <span className="font-sans text-xs font-medium text-gold uppercase tracking-widest">
                      {t(`web.ref.${ref.key}.industry`)}
                    </span>
                  </div>
                  <h3 className="font-serif text-xl font-bold text-foreground mb-3">{t(`web.ref.${ref.key}.title`)}</h3>
                  <p className="font-sans text-muted-foreground text-sm leading-relaxed mb-4">{t(`web.ref.${ref.key}.desc`)}</p>
                  
                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {t(`web.ref.${ref.key}.tags`).split(", ").map((tag, j) => (
                      <span key={j} className="px-2 py-0.5 bg-secondary rounded text-xs font-sans text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="border-t border-border/50 pt-3">
                    <p className="font-sans text-sm text-gold/80 italic">{t(`web.ref.${ref.key}.impact`)}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* How we help do things differently */}
        <section className="py-20 bg-secondary">
          <div className="container mx-auto px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center max-w-3xl mx-auto mb-14">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-gold/10 border border-gold/20 rounded-full mb-6">
                <Lightbulb className="text-gold" size={16} />
                <span className="text-gold text-xs font-sans font-medium tracking-widest uppercase">{t("web.references.different.badge")}</span>
              </div>
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">{t("web.references.different.title")}</h2>
              <p className="font-sans text-muted-foreground leading-relaxed">{t("web.references.different.subtitle")}</p>
            </motion.div>

            <div className="max-w-2xl mx-auto space-y-4">
              {differentPoints.map((key, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-start gap-3 py-3 px-5 rounded-xl bg-card border border-border"
                >
                  <CheckCircle2 className="text-gold shrink-0 mt-0.5" size={18} />
                  <p className="font-sans text-foreground text-sm font-medium leading-relaxed">{t(key)}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ReferencesPage;
