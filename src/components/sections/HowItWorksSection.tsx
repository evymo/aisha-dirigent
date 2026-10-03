import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Search, FileText, Cpu, Rocket } from "lucide-react";

const HowItWorksSection = () => {
  const { t } = useTranslation();

  const steps = [
    { icon: Search, titleKey: "web.how.step1.title", descKey: "web.how.step1.desc", num: "01" },
    { icon: FileText, titleKey: "web.how.step2.title", descKey: "web.how.step2.desc", num: "02" },
    { icon: Cpu, titleKey: "web.how.step3.title", descKey: "web.how.step3.desc", num: "03" },
    { icon: Rocket, titleKey: "web.how.step4.title", descKey: "web.how.step4.desc", num: "04" },
  ];

  return (
    <section className="py-32 bg-background relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gold/5 blur-[150px] rounded-full pointer-events-none opacity-50" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="font-serif text-3xl md:text-[2.75rem] font-bold text-foreground text-center mb-24 leading-[1.15]"
        >
          {t("web.how.title")}
        </motion.h2>

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 relative">
            {/* Connector line (desktop) — thinner with animated gradient flow */}
            <div className="hidden md:block absolute top-[40px] left-[12.5%] right-[12.5%] h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent opacity-60" />

            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="text-center relative group"
              >
                <div className="w-20 h-20 mx-auto mb-8 rounded-full bg-primary/80 backdrop-blur flex items-center justify-center relative z-10 border border-accent/15 group-hover:border-accent/40 group-hover:shadow-[0_0_30px_hsl(var(--accent)/0.15)] transition-all duration-500">
                  <step.icon className="text-gold/70 group-hover:text-gold transition-colors duration-500 group-hover:scale-110 transform" size={26} strokeWidth={1.5} />
                </div>
                <div className="absolute top-10 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-gold/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                <span className="text-gold/40 group-hover:text-gold/70 font-sans text-[11px] font-semibold tracking-[0.2em] transition-colors duration-500">{step.num}</span>
                <h3 className="font-serif text-[19px] font-bold text-foreground mt-3 mb-4">
                  {t(step.titleKey)}
                </h3>
                <p className="font-sans text-[13px] text-muted-foreground leading-relaxed max-w-[250px] mx-auto">
                  {t(step.descKey)}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
