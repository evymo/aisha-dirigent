import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, MapPin, Phone, Sparkles } from "lucide-react";
import { BuildSignature } from "@/components/debug/BuildSignature";
import { useBrand } from "@/components/branding/useBrand";

export function Footer() {
  const { t } = useTranslation();
  // Same pattern as Header: read resolved brand from context, fall back
  // to the build-time evymo labels when no tenant brand is in effect.
  const brand = useBrand();
  const brandName = brand?.operator_name ?? "AISHA";
  // Bez literálu: branding_profiles.operator_name má v DB neutrální default
  // ('Platform'). Fallback na dárcovskou značku sem propisoval cizí
  // copyright pokaždé, když instance neměla branding naplněný.
  const copyrightOwner = brand?.operator_name ?? "";

  // The tel: href must dial the SAME number the user sees — build it from the
  // i18n value (whitespace stripped) instead of hardcoding a second copy.
  const phoneHref = `tel:${t('footer.phone').replace(/\s+/g, '')}`;

  const footerLinks = {
    services: [
      { name: t('web.nav.solution'), href: "/solution" },
      { name: t('web.nav.guild'), href: "/guild" },
      { name: t('web.nav.references'), href: "/references" },
      { name: t('web.nav.about'), href: "/story" },
      { name: t('web.nav.partnerProgram'), href: "/partners" },
      { name: t('footer.news'), href: "/news" },
      { name: t('footer.faq'), href: "/faq" },
      { name: t('footer.gettingStarted'), href: "/getting-started" },
    ],
    legal: [
      { name: t('footer.privacyPolicy'), href: "/privacy" },
      { name: t('footer.termsOfService'), href: "/terms" },
      { name: t('footer.disclaimer'), href: "/legal-disclaimer" },
    ],
  };

  return (
    <footer className="bg-primary text-primary-foreground relative overflow-hidden">
      {/* Organic background shapes */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-foreground/5 blob-shape blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-primary-foreground/5 blob-shape blur-3xl" />
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-14">
          {/* Brand Column */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="h-6 w-6 opacity-80" />
              <div className="flex flex-col">
                <span className="font-serif text-2xl font-bold tracking-tight text-background">
                  {brandName}
                </span>
                {/* Suppress the "Dirigent by Evymo" tagline once a tenant
                    brand has resolved (matches Header). Re-introduce as a
                    data-driven `brand_tagline` field if ever desired. */}
                {!brand && (
                  <span className="text-[10px] uppercase tracking-[0.2em] text-background -mt-1">
                    Dirigent by Evymo
                  </span>
                )}
              </div>
            </div>
            <p className="text-base text-background max-w-sm mb-6 leading-relaxed">
              {t('footer.brandDescription')}
            </p>
            <div className="text-xs text-background/60 space-y-1">
              <p>{t('web.footer.company')}</p>
              <p>{t('web.footer.part_of')}</p>
              <p>{t('web.footer.ico')} · {t('web.footer.dic')}</p>
              <p>{t('web.footer.court')}</p>
            </div>
          </div>

          {/* Services Links */}
          <div>
            <p className="font-semibold text-sm uppercase tracking-widest mb-6 text-background" role="heading" aria-level={3}>{t('footer.services')}</p>
            <ul className="space-y-4">
              {footerLinks.services.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-background hover:underline transition-colors link-underline"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="font-semibold text-sm uppercase tracking-widest mb-6 text-background" role="heading" aria-level={3}>{t('footer.contacts')}</p>
            <ul className="space-y-5">
              <li>
                <a href="mailto:info@aisha.guru" className="flex items-start gap-3 text-sm text-background hover:underline transition-colors group">
                  <div className="w-9 h-9 rounded-lg bg-background/15 flex items-center justify-center shrink-0 group-hover:bg-background/25 transition-colors">
                    <Mail className="h-4 w-4 text-background" />
                  </div>
                  <div className="flex flex-col gap-0.5 pt-1.5">
                    <span>info@aisha.guru</span>
                  </div>
                </a>
              </li>
              <li>
                <a href={phoneHref} className="flex items-start gap-3 text-sm text-background hover:underline transition-colors group">
                  <div className="w-9 h-9 rounded-lg bg-background/15 flex items-center justify-center shrink-0 group-hover:bg-background/25 transition-colors">
                    <Phone className="h-4 w-4 text-background" />
                  </div>
                  <div className="flex flex-col gap-0.5 pt-1.5">
                    <span>{t('footer.phone')}</span>
                  </div>
                </a>
              </li>
              <li>
                <div className="flex items-start gap-3 text-sm text-background">
                  <div className="w-9 h-9 rounded-lg bg-background/15 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-background" />
                  </div>
                  <div className="flex flex-col gap-0.5 pt-1.5">
                    <span>{t('footer.location')}</span>
                  </div>
                </div>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="font-semibold text-sm uppercase tracking-widest mb-6 text-background" role="heading" aria-level={3}>{t('footer.legal')}</p>
            <ul className="space-y-4">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="text-sm text-background hover:underline transition-colors link-underline"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-20 pt-10 border-t border-primary-foreground/15">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-sm text-background flex items-center gap-1.5">
              © {new Date().getFullYear()} {copyrightOwner}. {t('footer.allRightsReserved')}
            </p>
            <p className="text-xs text-background text-center md:text-right max-w-lg leading-relaxed">
              {t('footer.disclaimerText')}
            </p>
          </div>

          <div className="mt-6">
            <BuildSignature />
          </div>
        </div>
      </div>
    </footer>
  );
}
