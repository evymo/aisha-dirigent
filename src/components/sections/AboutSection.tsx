import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Lightbulb, Shield, Handshake } from "lucide-react";

const AboutSection = () => {
  const { t } = useTranslation();

  const values = [
    { icon: Lightbulb, titleKey: "web.about.value1.title", descKey: "web.about.value1.desc" },
    { icon: Shield, titleKey: "web.about.value2.title", descKey: "web.about.value2.desc" },
    { icon: Handshake, titleKey: "web.about.value3.title", descKey: "web.about.value3.desc" },
  ];

  return (
    <section id="about" className="py-28 bg-primary relative">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl mx-auto text-center mb-20"
        >
          <h2 className="font-serif text-3xl md:text-[2.5rem] font-bold text-primary-foreground mb-6 leading-tight">
            {t("web.about.title")}
          </h2>
          <p className="font-sans text-primary-foreground/55 text-[15px] leading-relaxed mb-4">
            {t("web.about.intro")}
          </p>
          <p className="font-sans text-primary-foreground/35 text-[15px] leading-relaxed">
            {t("web.about.story")}
          </p>
        </motion.div>

        {/* Values */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="relative mt-24"
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-16 bg-gradient-to-b from-transparent to-accent/30 -mt-16" />
          <h3 className="font-serif text-[22px] font-bold text-primary-foreground text-center mb-16 relative">
            <span className="relative z-10">{t("web.about.values.title")}</span>
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-12 h-px bg-accent/40" />
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {values.map((v, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.08 * i, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="group relative bg-primary-foreground/5 backdrop-blur-md rounded-2xl p-8 border border-primary-foreground/5 hover:border-accent/20 hover:bg-primary-foreground/10 transition-all duration-700 hover:-translate-y-1.5"
              >
                <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-2xl pointer-events-none blur-xl" />
                <div className="w-12 h-12 rounded-full bg-primary-foreground/5 flex items-center justify-center mb-6 group-hover:bg-accent/10 transition-colors duration-500 group-hover:scale-110">
                  <v.icon className="text-primary-foreground/60 group-hover:text-accent transition-colors duration-500" size={20} strokeWidth={1.5} />
                </div>
                <h4 className="font-serif text-[18px] font-semibold text-primary-foreground mb-3">
                  {t(v.titleKey)}
                </h4>
                <p className="font-sans text-primary-foreground/50 text-[13px] leading-relaxed group-hover:text-primary-foreground/70 transition-colors duration-500">
                  {t(v.descKey)}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Structure */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="text-center text-primary-foreground/20 text-[12px] font-sans mt-16 tracking-wide"
        >
          {t("web.about.structure")}
        </motion.p>
      </div>
    </section>
  );
};

export default AboutSection;
