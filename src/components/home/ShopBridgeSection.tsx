import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText, Shield, Leaf } from "lucide-react";

export function ShopBridgeSection() {
  const { t } = useTranslation();

  const principles = [
    { key: 'noMedicalClaims', icon: Shield },
    { key: 'qualitySources', icon: Leaf },
    { key: 'fullTransparency', icon: FileText },
  ];

  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Header */}
          <p className="text-sm font-medium text-primary uppercase tracking-wide mb-3">
            {t('shopBridge.sectionLabel')}
          </p>
          <h2 className="font-serif text-3xl md:text-4xl font-semibold text-foreground mb-4">
            {t('shopBridge.title')}
          </h2>
          <p className="text-lg text-muted-foreground mb-12 max-w-2xl mx-auto">
            {t('shopBridge.subtitle')}
          </p>

          {/* Principles */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            {principles.map((principle) => (
              <div key={principle.key} className="p-6 bg-card rounded-2xl border border-border/50">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <principle.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-medium text-foreground mb-2">
                  {t(`shopBridge.principles.${principle.key}.title`)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t(`shopBridge.principles.${principle.key}.description`)}
                </p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <Button variant="outline" size="lg" asChild className="rounded-full">
            <Link to="/shop">
              {t('shopBridge.viewProducts')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
