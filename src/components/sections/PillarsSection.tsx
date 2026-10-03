import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bot, GitBranch, Shield } from "lucide-react";

const PillarsSection = () => {
  const { t } = useTranslation();

  const pillars = [
    { icon: Bot, titleKey: "web.pillars.1.title", descKey: "web.pillars.1.desc" },
    { icon: GitBranch, titleKey: "web.pillars.2.title", descKey: "web.pillars.2.desc" },
    { icon: Shield, titleKey: "web.pillars.3.title", descKey: "web.pillars.3.desc" },
  ];

  return (
    <section id="solution" className="py-32 bg-secondary relative overflow-hidden">
      {/* Subtle ambient glow */}
      <div className="absolute top-1/2 left-0 w-[600px] h-[600px] bg-gold/5 blur-[120px] rounded-[100%] pointer-events-none opacity-40 -translate-y-1/2 -translate-x-1/2" />
      <div className="absolute top-1/2 right-0 w-[600px] h-[600px] bg-gold/5 blur-[120px] rounded-[100%] pointer-events-none opacity-40 -translate-y-1/2 translate-x-1/2" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="font-serif text-3xl md:text-[2.75rem] font-bold text-foreground text-center mb-24 leading-[1.15]"
        >
          {t("web.pillars.title")}
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto relative">
          {/* Subtle connecting lines behind cards for desktop */}
          <div className="hidden md:block absolute top-[40%] left-10 right-10 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent -z-10" />

          {pillars.map((pillar, i) => (
            <motion.div
              key={pillar.titleKey}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="relative bg-card/40 backdrop-blur-sm rounded-2xl p-8 pt-10 border border-border/60 hover:border-gold/30 hover:bg-card/80 hover:-translate-y-1.5 hover:shadow-soft-lg transition-all duration-700 group card-accent-top"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none rounded-2xl" />

              {/* Editorial number */}
              <span className="absolute top-5 right-6 text-[10px] font-sans font-semibold text-muted-foreground/30 tracking-[0.2em] group-hover:text-gold/40 transition-colors duration-500">
                0{i + 1}
              </span>

              <div className="w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mb-6 group-hover:bg-gold/10 transition-colors duration-500 group-hover:scale-110">
                <pillar.icon className="text-muted-foreground group-hover:text-gold transition-colors duration-500" size={24} strokeWidth={1.5} />
              </div>

              <h3 className="font-serif text-[19px] font-bold text-foreground mb-4">
                {t(pillar.titleKey)}
              </h3>
              <p className="font-sans text-[13px] text-muted-foreground leading-relaxed">
                {t(pillar.descKey)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PillarsSection;
