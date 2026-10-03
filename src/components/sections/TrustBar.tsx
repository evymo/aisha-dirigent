import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ShieldCheck, Car, Server, FlaskConical, Package, Scale } from "lucide-react";

const domains = [
  { icon: ShieldCheck, key: "web.trust.domain.audit" },
  { icon: Car, key: "web.trust.domain.automotive" },
  { icon: Server, key: "web.trust.domain.hosting" },
  { icon: FlaskConical, key: "web.trust.domain.biotech" },
  { icon: Package, key: "web.trust.domain.distribution" },
  { icon: Scale, key: "web.trust.domain.legal" },
];

const TrustBar = () => {
  const { t } = useTranslation();

  return (
    <section className="py-20 bg-background relative z-10">
      {/* Soft gradient border top and bottom */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/10 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/10 to-transparent" />

      <div className="container mx-auto px-6">
        <p className="text-center text-[10px] font-sans font-bold text-muted-foreground/60 tracking-[0.25em] uppercase mb-12 flex items-center justify-center gap-4">
          <span className="w-6 h-px bg-gold/20" />
          {t("web.trust.title")}
          <span className="w-6 h-px bg-gold/20" />
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-x-6 gap-y-10 max-w-5xl mx-auto">
          {domains.map((domain, i) => (
            <motion.div
              key={domain.key}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center gap-3.5 group cursor-default"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-gold/20 blur-md rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <domain.icon className="text-muted-foreground/40 group-hover:text-gold/80 transition-colors duration-500 relative z-10" size={20} strokeWidth={1.5} />
              </div>
              <span className="text-[11px] font-sans font-medium text-muted-foreground/60 group-hover:text-foreground/90 transition-colors duration-500 text-center leading-tight">
                {t(domain.key)}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TrustBar;
