import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Package, Wrench, Shield, Server, Cloud, Globe, HardDrive } from "lucide-react";

const MaintenanceSection = () => {
  const { t } = useTranslation();

  const models = [
    { icon: Package, titleKey: "web.maintenance.self.title", descKey: "web.maintenance.self.desc", priceKey: "web.maintenance.self.price", accent: false },
    { icon: Wrench, titleKey: "web.maintenance.flat.title", descKey: "web.maintenance.flat.desc", priceKey: "web.maintenance.flat.price", accent: true },
    { icon: Shield, titleKey: "web.maintenance.managed.title", descKey: "web.maintenance.managed.desc", priceKey: "web.maintenance.managed.price", accent: false },
  ];

  const hostingOptions = [
    { icon: Server, titleKey: "web.maintenance.hosting.own", descKey: "web.maintenance.hosting.own.desc" },
    { icon: Cloud, titleKey: "web.maintenance.hosting.cloud", descKey: "web.maintenance.hosting.cloud.desc" },
    { icon: Globe, titleKey: "web.maintenance.hosting.aisha", descKey: "web.maintenance.hosting.aisha.desc" },
    { icon: HardDrive, titleKey: "web.maintenance.hosting.vps", descKey: "web.maintenance.hosting.vps.desc" },
  ];

  return (
    <section className="py-32 bg-background relative overflow-hidden">
      {/* Premium ambient background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gold/5 blur-[120px] rounded-[100%] pointer-events-none opacity-60" />

      <div className="container mx-auto px-6 relative z-10">
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="text-center max-w-2xl mx-auto mb-20">
          <h2 className="font-serif text-3xl md:text-[2.75rem] font-bold text-foreground mb-5 leading-[1.15]">{t("web.maintenance.title")}</h2>
          <p className="font-sans text-muted-foreground text-[15px] leading-relaxed">{t("web.maintenance.subtitle")}</p>
        </motion.div>

        {/* Three models */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-24 relative">
          {/* Subtle connecting lines behind cards for desktop */}
          <div className="hidden md:block absolute top-[45%] left-10 right-10 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent -z-10" />

          {models.map((model, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className={`group relative rounded-2xl p-8 text-center border transition-all duration-700 hover:-translate-y-1.5 ${
                model.accent 
                  ? "border-gold/30 bg-card/80 shadow-gold-md hover:shadow-gold-lg backdrop-blur-md z-10" 
                  : "border-border/60 bg-card/40 hover:border-gold/20 hover:bg-card/80 hover:shadow-soft-lg backdrop-blur-sm"
              } card-accent-top`}
            >
              {model.accent && (
                <>
                  <div className="absolute inset-0 bg-gold/5 blur-2xl rounded-2xl -z-10" />
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-gold text-navy text-[10px] font-sans font-bold tracking-[0.16em] uppercase rounded-full shadow-gold-sm">
                    {t("web.maintenance.flat.title")}
                  </span>
                </>
              )}
              <div className={`mx-auto mb-6 w-12 h-12 flex items-center justify-center rounded-full transition-transform duration-500 group-hover:scale-110 ${
                model.accent ? "bg-gold/10 text-gold" : "bg-muted/30 text-muted-foreground/60 group-hover:text-gold/70"
              }`}>
                <model.icon size={22} strokeWidth={1.5} />
              </div>
              <h3 className="font-serif text-[19px] font-bold text-foreground mb-3">{t(model.titleKey)}</h3>
              <p className="font-sans text-[13px] text-muted-foreground leading-relaxed mb-6">{t(model.descKey)}</p>
              <div className="pt-5 border-t border-border/40 transition-colors duration-500 group-hover:border-gold/20">
                <span className={`inline-block text-[13px] font-sans font-semibold tracking-wide ${
                  model.accent ? "text-gold" : "text-foreground/70 group-hover:text-foreground"
                }`}>
                  {t(model.priceKey)}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Hosting options */}
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="max-w-4xl mx-auto mt-10">
          <div className="text-center mb-10">
            <h3 className="font-serif text-[22px] font-bold text-foreground mb-3">{t("web.maintenance.hosting.title")}</h3>
            <p className="font-sans text-[13px] text-muted-foreground">{t("web.maintenance.hosting.subtitle")}</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {hostingOptions.map((opt, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="group relative overflow-hidden rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-6 text-center hover:border-gold/30 hover:bg-card/70 hover:-translate-y-1 hover:shadow-soft-lg transition-all duration-500"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <opt.icon className="text-muted-foreground/30 mx-auto mb-4 group-hover:text-gold/80 transition-colors duration-500 relative z-10" size={20} strokeWidth={1.5} />
                <h4 className="font-sans text-[13px] font-semibold text-foreground mb-1.5 relative z-10">{t(opt.titleKey)}</h4>
                <p className="font-sans text-[11px] text-muted-foreground/80 leading-relaxed relative z-10">{t(opt.descKey)}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default MaintenanceSection;
