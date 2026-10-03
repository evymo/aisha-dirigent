import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, Eye, Download, FileCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ProvenancePoint {
  icon: LucideIcon;
  key: string;
}

const provenancePoints: ProvenancePoint[] = [
  { icon: Eye, key: "openAccess" },
  { icon: Shield, key: "provenanceVerified" },
  { icon: FileCheck, key: "editorialTransparency" },
  { icon: Download, key: "downloadPacks" },
];

export function ProvenanceSection() {
  const { t } = useTranslation();

  return (
    <section className="py-20 bg-primary text-primary-foreground">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Content */}
          <div>
            <p className="text-sm font-medium uppercase tracking-wide opacity-80 mb-3">
              {t('provenance.sectionLabel')}
            </p>
            <h2 className="font-serif text-3xl md:text-4xl font-semibold mb-6">
              {t('provenance.title')}
            </h2>
            <p className="text-lg opacity-90 mb-8 leading-relaxed">
              {t('provenance.subtitle')}
            </p>
            
            {/* Quote */}
            <div className="p-5 bg-primary-foreground/10 rounded-xl mb-8">
              <p className="italic mb-2">
                "{t('provenance.disclaimer')}"
              </p>
              <p className="text-sm text-primary-foreground/80">
                {t('provenance.disclaimerAttribution')}
              </p>
            </div>
            
            <Button variant="secondary" size="lg" asChild className="rounded-full">
              <Link to="/archive/methods">
                {t('provenance.curationMethods')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Points Grid */}
          <div className="grid grid-cols-2 gap-4">
            {provenancePoints.map((point) => {
              const IconComponent = point.icon;
              return (
                <div
                  key={point.key}
                  className="p-5 bg-primary-foreground/10 rounded-xl"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary-foreground/15 flex items-center justify-center mb-4">
                    <IconComponent className="h-5 w-5" />
                  </div>
                  <h3 className="font-medium mb-1">
                    {t(`provenance.points.${point.key}.title`)}
                  </h3>
                  <p className="text-sm">
                    {t(`provenance.points.${point.key}.description`)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
