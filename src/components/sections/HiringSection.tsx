import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Code2, Music, Wifi, Clock, Globe, ArrowRight, Briefcase } from "lucide-react";

const HiringSection = () => {
  const { t } = useTranslation();

  const roles = [
    {
      key: "fullstack",
      icon: Code2,
      titleKey: "web.hiring.role.fullstack.title",
      descKey: "web.hiring.role.fullstack.desc",
    },
    {
      key: "conductor",
      icon: Music,
      titleKey: "web.hiring.role.conductor.title",
      descKey: "web.hiring.role.conductor.desc",
    },
    {
      key: "expert",
      icon: Briefcase,
      titleKey: "web.hiring.role.expert.title",
      descKey: "web.hiring.role.expert.desc",
    },
  ];

  const perks = [
    { icon: Globe, key: "web.hiring.perk.remote" },
    { icon: Clock, key: "web.hiring.perk.flexible" },
    { icon: Wifi, key: "web.hiring.perk.internet" },
  ];

  const handleCTA = () => {
    document.querySelector("#contact")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="hiring" className="py-28 bg-background relative overflow-hidden">
      <div className="container mx-auto px-6 relative">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16"
        >
          <span className="inline-block border border-gold/15 text-gold/70 px-4 py-1.5 rounded-full text-[11px] font-sans font-medium tracking-[0.15em] uppercase mb-8">
            {t("web.hiring.badge")}
          </span>
          <h2 className="font-serif text-3xl md:text-[2.5rem] font-bold text-foreground mb-4 leading-tight">
            {t("web.hiring.title")}
          </h2>
          <p className="font-sans text-muted-foreground max-w-xl mx-auto text-[15px]">
            {t("web.hiring.subtitle")}
          </p>
        </motion.div>

        {/* Role cards — glassmorphism with dynamic hover effects */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-16 relative">
          <div className="hidden md:block absolute top-[40%] left-10 right-10 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent -z-10" />

          {roles.map((role, i) => (
            <motion.div
              key={role.key}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="group relative bg-card/40 backdrop-blur-sm border border-border/60 rounded-2xl p-8 hover:border-gold/30 hover:bg-card/80 hover:-translate-y-1.5 hover:shadow-soft-lg transition-all duration-700 card-accent-top"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none rounded-2xl" />

              <span className="absolute top-5 right-6 text-[10px] font-sans font-semibold text-muted-foreground/30 tracking-[0.2em] group-hover:text-gold/40 transition-colors duration-500">
                0{i + 1}
              </span>

              <div className="mx-auto md:mx-0 w-14 h-14 rounded-full bg-muted/40 flex items-center justify-center mb-6 group-hover:bg-gold/10 transition-colors duration-500 group-hover:scale-110">
                <role.icon className="text-muted-foreground group-hover:text-gold transition-colors duration-500" size={24} strokeWidth={1.5} />
              </div>

              <h3 className="font-serif text-[19px] font-bold text-foreground mb-4 text-center md:text-left">
                {t(role.titleKey)}
              </h3>
              <p className="font-sans text-[13px] text-muted-foreground leading-relaxed text-center md:text-left">
                {t(role.descKey)}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Perks */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="flex flex-wrap justify-center gap-4 mb-12"
        >
          {perks.map((perk) => (
            <div
              key={perk.key}
              className="flex items-center gap-2 border border-border/60 rounded-full px-4 py-2"
            >
              <perk.icon className="text-gold/60" size={14} strokeWidth={1.5} />
              <span className="font-sans text-[13px] font-medium text-foreground/70">
                {t(perk.key)}
              </span>
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center"
        >
          <button
            onClick={handleCTA}
            className="inline-flex items-center gap-2 bg-gold hover:bg-gold-dark text-navy px-8 py-3.5 rounded-full font-sans font-semibold text-sm tracking-wide transition-all duration-300 shadow-gold-md hover:shadow-gold-lg"
          >
            {t("web.hiring.cta")}
            <ArrowRight size={15} />
          </button>
        </motion.div>
      </div>
    </section>
  );
};

export default HiringSection;
