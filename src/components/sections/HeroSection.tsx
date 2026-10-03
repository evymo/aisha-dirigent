import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ArrowRight, ChevronDown } from "lucide-react";

const ease = [0.16, 1, 0.3, 1] as const;

const HeroSection = () => {
  const { t } = useTranslation();

  const scrollTo = (id: string) => {
    document.querySelector(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="hero" className="relative min-h-screen flex items-center justify-center bg-primary overflow-hidden">
      {/* Subtle grid */}
      <div className="absolute inset-0 opacity-[0.035]">
        <div className="absolute inset-0" style={{
          backgroundImage: `linear-gradient(hsl(var(--primary-foreground) / 0.2) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary-foreground) / 0.2) 1px, transparent 1px)`,
          backgroundSize: "100px 100px",
        }} />
      </div>

      {/* Single centered glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-accent/[0.06] rounded-full blur-[120px]" />

      <div className="container mx-auto px-6 pt-28 pb-20 relative z-10">
        <div className="max-w-3xl mx-auto text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, ease }}
          >
            <span className="inline-block px-4 py-1.5 border border-primary-foreground/15 rounded-full text-primary-foreground/80 text-[11px] font-sans font-medium tracking-[0.15em] uppercase mb-10">
              {t("web.hero.badge")}
            </span>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.1, ease }}
            className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-[4.25rem] font-bold text-primary-foreground leading-[1.08] tracking-tight mb-7"
          >
            {t("web.hero.title")}
          </motion.h1>

          {/* Divider line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.35, ease }}
            className="w-16 h-px bg-primary-foreground/40 mx-auto mb-7 origin-center"
          />

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.4, ease }}
            className="text-accent font-serif text-xl sm:text-2xl md:text-[1.7rem] font-medium italic leading-snug mb-6"
          >
            {t("web.hero.subtitle")}
          </motion.p>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.55, ease }}
            className="text-primary-foreground/45 font-sans text-[15px] sm:text-base max-w-xl mx-auto mb-12 leading-relaxed"
          >
            {t("web.hero.description")}
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7, ease }}
            className="flex flex-col sm:flex-row items-center justify-center gap-5 mt-14"
          >
            <button
              onClick={() => scrollTo("#contact")}
              className="group relative inline-flex items-center justify-center gap-3 bg-accent hover:bg-accent/90 text-accent-foreground px-9 py-4 rounded-full font-sans font-bold text-[13px] tracking-[0.1em] uppercase transition-all duration-500 shadow-lg hover:shadow-xl hover:-translate-y-0.5 overflow-hidden w-full sm:w-auto"
            >
              <span className="relative z-10 flex items-center gap-2">
                {t("web.hero.cta.contact")}
                <ArrowRight size={17} strokeWidth={2.5} className="group-hover:translate-x-1 transition-transform duration-300" />
              </span>
              <div className="absolute inset-0 bg-primary-foreground/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out z-0" />
            </button>
            <button
              onClick={() => scrollTo("#solution")}
              className="group inline-flex justify-center items-center border border-primary-foreground/20 hover:border-accent/40 text-primary-foreground/70 hover:text-accent bg-primary-foreground/5 hover:bg-primary-foreground/10 backdrop-blur-sm px-9 py-4 rounded-full font-sans font-bold text-[13px] tracking-[0.1em] uppercase transition-all duration-500 w-full sm:w-auto"
            >
              <span className="group-hover:scale-105 transition-transform duration-300">
                {t("web.hero.cta.more")}
              </span>
            </button>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
          >
            <ChevronDown className="text-accent/30" size={24} />
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;
