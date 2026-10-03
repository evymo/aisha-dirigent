import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Users, Star, Zap, ArrowRight, Clock } from "lucide-react";
import {
  CONDUCTOR_DAY_RATE,
  SPECIALIST_BLOCK_HOURS,
} from "@/lib/pricing-config";

const SpecialistGuildSection = () => {
  const { t, i18n } = useTranslation();

  const formatCZK = (n: number) =>
    new Intl.NumberFormat(i18n.language).format(n) + " Kč";

  const features = [
    {
      icon: <Users size={20} />,
      titleKey: "web.guild.feat.browse.title",
      descKey: "web.guild.feat.browse.desc",
    },
    {
      icon: <Star size={20} />,
      titleKey: "web.guild.feat.rated.title",
      descKey: "web.guild.feat.rated.desc",
    },
    {
      icon: <Zap size={20} />,
      titleKey: "web.guild.feat.instant.title",
      descKey: "web.guild.feat.instant.desc",
    },
    {
      icon: <Clock size={20} />,
      titleKey: "web.guild.feat.block.title",
      descKey: "web.guild.feat.block.desc",
    },
  ];

  return (
    <section className="py-28 bg-background relative overflow-hidden">
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gold/5 blur-[120px] rounded-full pointer-events-none opacity-30 -translate-x-1/4 -translate-y-1/4" />

      <div className="container mx-auto px-6 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 border border-gold/15 bg-gold/5 rounded-full mb-6">
            <Users className="text-gold/80" size={14} />
            <span className="text-gold/80 text-[10px] font-sans font-bold tracking-[0.2em] uppercase">
              {t("web.guild.badge")}
            </span>
          </div>
          <h2 className="font-serif text-3xl md:text-[2.75rem] font-bold text-foreground mb-6 leading-tight">
            {t("web.guild.title")}
          </h2>
          <p className="font-sans text-[15px] text-muted-foreground leading-relaxed">
            {t("web.guild.subtitle")}
          </p>
        </motion.div>

        {/* Feature cards */}
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {features.map((feat, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="rounded-2xl bg-card/60 backdrop-blur-sm border border-border/60 p-6 hover:border-gold/30 hover:-translate-y-0.5 transition-all duration-300 group"
            >
              <div className="w-10 h-10 rounded-full bg-gold/10 flex items-center justify-center mb-4 text-gold group-hover:bg-gold/20 transition-colors">
                {feat.icon}
              </div>
              <h3 className="font-sans text-[15px] font-bold text-foreground mb-2">
                {t(feat.titleKey)}
              </h3>
              <p className="font-sans text-[13px] text-muted-foreground leading-relaxed">
                {t(feat.descKey)}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Optional expert layer */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto"
        >
          <div className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/5 via-card/80 to-card/40 backdrop-blur-md p-8 text-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-t from-gold/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <div className="relative z-10">
              <p className="font-sans text-[13px] text-muted-foreground mb-2">
                {t("web.guild.from")}
              </p>
              <p className="font-serif text-[36px] font-bold text-gold tracking-tight">
                {formatCZK(CONDUCTOR_DAY_RATE)}
              </p>
              <p className="font-sans text-[14px] text-muted-foreground mt-1">
                {t("web.guild.perBlock", { hours: SPECIALIST_BLOCK_HOURS })}
              </p>

              <p className="font-sans text-[13px] text-muted-foreground leading-relaxed max-w-xl mx-auto mt-6 mb-8">
                {t("web.guild.optionalLayer")}
              </p>

              <Link
                to="/guild"
                className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-gold to-gold-light text-navy font-sans text-[14px] font-bold tracking-wide rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
              >
                {t("web.guild.cta")}
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default SpecialistGuildSection;
