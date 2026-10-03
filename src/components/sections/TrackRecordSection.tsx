import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

const milestoneKeys = ["m1", "m2", "m3", "m4", "m5", "m6"];

const TrackRecordSection = () => {
  const { t } = useTranslation();

  return (
    <section id="references" className="py-32 bg-primary relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03]">
        <div className="absolute inset-0" style={{
          backgroundImage: "radial-gradient(circle at 50% 50%, hsl(var(--accent) / 0.5) 0%, transparent 60%)",
        }} />
      </div>

      <div className="container mx-auto px-6 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-24"
        >
          <span className="inline-block px-4 py-1 border border-accent/10 bg-accent/5 rounded-full text-[10px] font-sans font-bold tracking-[0.2em] uppercase mb-6 text-accent/80">
            {t("web.references.title")}
          </span>
          <h2 className="font-serif text-3xl md:text-[2.75rem] font-bold text-primary-foreground mb-5 leading-[1.15]">
            {t("web.track.title")}
          </h2>
          <p className="font-sans text-primary-foreground/50 max-w-xl mx-auto text-[15px]">
            {t("web.track.subtitle")}
          </p>
        </motion.div>

        <div className="max-w-4xl mx-auto relative">
          {/* Vertical line */}
          <div className="absolute left-[20px] md:left-1/2 top-4 bottom-4 w-px bg-gradient-to-b from-transparent via-accent/20 to-transparent md:-translate-x-px" />

          {milestoneKeys.map((key, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 24, x: i % 2 === 0 ? -10 : 10 }}
              whileInView={{ opacity: 1, y: 0, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.7, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className={`relative flex items-start mb-16 last:mb-0 group ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                }`}
            >
              {/* Animated Dot */}
              <div className="absolute left-[20px] md:left-1/2 w-[9px] h-[9px] bg-accent rounded-full -translate-x-[4px] mt-2.5 z-10 shadow-[0_0_15px_hsl(var(--accent))] transition-transform duration-500 group-hover:scale-150" />
              <div className="absolute left-[20px] md:left-1/2 w-[25px] h-[25px] bg-accent/20 rounded-full -translate-x-[12px] mt-[2px] z-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm" />

              {/* Content Card */}
              <div className={`ml-14 md:ml-0 md:w-1/2 ${i % 2 === 0 ? "md:pr-16 md:text-right" : "md:pl-16"
                }`}>
                <div className="bg-primary-foreground/5 border border-primary-foreground/10 rounded-2xl p-7 backdrop-blur-sm group-hover:bg-primary-foreground/10 group-hover:border-accent/20 transition-all duration-500 hover:-translate-y-1">
                  <span className="text-accent/80 font-sans text-[11px] font-bold tracking-[0.2em] uppercase mb-2 block">
                    {t(`web.track.${key}.year`)}
                  </span>
                  <h3 className="font-serif text-[19px] font-semibold text-primary-foreground mt-2 mb-3">
                    {t(`web.track.${key}.title`)}
                  </h3>
                  <p className="font-sans text-[13px] text-primary-foreground/50 leading-relaxed group-hover:text-primary-foreground/70 transition-colors duration-500">
                    {t(`web.track.${key}.desc`)}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrackRecordSection;
