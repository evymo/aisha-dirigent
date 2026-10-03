import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { FlaskConical, Calendar, FileText, Building2, Beaker, Users, ExternalLink, TestTube, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Research = () => {
  const { t } = useTranslation();

  const timeline = [
    {
      year: "1983",
      titleKey: "research.timeline.1983.title",
      descriptionKey: "research.timeline.1983.description",
      icon: FileText,
    },
    {
      year: "1994",
      titleKey: "research.timeline.1994.title",
      descriptionKey: "research.timeline.1994.description",
      icon: Beaker,
    },
    {
      year: "2009",
      titleKey: "research.timeline.2009.title",
      descriptionKey: "research.timeline.2009.description",
      icon: FlaskConical,
    },
    {
      year: "2019",
      titleKey: "research.timeline.2019.title",
      descriptionKey: "research.timeline.2019.description",
      icon: Building2,
    },
    {
      year: "2024",
      titleKey: "research.timeline.2024.title",
      descriptionKey: "research.timeline.2024.description",
      icon: Users,
    },
    {
      year: "2025",
      titleKey: "research.timeline.2025.title",
      descriptionKey: "research.timeline.2025.description",
      icon: Calendar,
    },
  ];

  const programs = [
    {
      id: "2024-2025",
      titleKey: "research.programs.2024.title",
      products: [
        {
          code: "RTN 122K",
          nameKey: "research.programs.2024.rtn122k.name",
          descriptionKey: "research.programs.2024.rtn122k.description",
        },
      ],
    },
    {
      id: "2022-2023",
      titleKey: "research.programs.2022.title",
      products: [
        {
          code: "RTN 33",
          nameKey: "research.programs.2022.rtn33.name",
          descriptionKey: "research.programs.2022.rtn33.description",
        },
        {
          code: "RTN 102",
          nameKey: "research.programs.2022.rtn102.name",
          descriptionKey: "research.programs.2022.rtn102.description",
        },
      ],
    },
    {
      id: "2020-2021",
      titleKey: "research.programs.2020.title",
      products: [
        {
          code: "RTN 118",
          nameKey: "research.programs.2020.rtn118.name",
          descriptionKey: "research.programs.2020.rtn118.description",
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto text-center">
              <Badge variant="outline" className="mb-6">
                {t("research.badge")}
              </Badge>
              <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
                {t("research.title")}
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {t("research.subtitle")}
              </p>
            </div>
          </div>
        </section>

        {/* Patent Timeline Section */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-3xl font-serif font-bold text-foreground mb-4 text-center">
                {t("research.patentTimeline.title")}
              </h2>
              <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
                {t("research.patentTimeline.subtitle")}
              </p>

              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-8 top-0 bottom-0 w-px bg-border hidden md:block" />

                <div className="space-y-8">
                  {timeline.map((item) => (
                    <div key={item.year} className="relative flex gap-6">
                      {/* Timeline dot */}
                      <div className="hidden md:flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 border-2 border-primary shrink-0 z-10">
                        <item.icon className="h-6 w-6 text-primary" />
                      </div>

                      <Card className="flex-1">
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-3">
                            <Badge variant="secondary" className="font-mono">
                              {item.year}
                            </Badge>
                            <CardTitle className="text-lg">
                              {t(item.titleKey)}
                            </CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-muted-foreground">
                            {t(item.descriptionKey)}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Separator />

        {/* Research Programs Section */}
        <section className="py-16 md:py-24 bg-muted/30">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto">
              <h2 className="text-3xl font-serif font-bold text-foreground mb-4 text-center">
                {t("research.programs.title")}
              </h2>
              <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
                {t("research.programs.subtitle")}
              </p>

              <div className="space-y-12">
                {programs.map((program) => (
                  <div key={program.id}>
                    <h3 className="text-xl font-semibold mb-6 flex items-center gap-3">
                      <Calendar className="h-5 w-5 text-primary" />
                      {t(program.titleKey)}
                    </h3>
                    
                    <div className="grid md:grid-cols-2 gap-6">
                      {program.products.map((product) => (
                        <Card key={product.code} className="border-l-4 border-l-primary">
                          <CardHeader>
                            <div className="flex items-center gap-3">
                              <Badge>{product.code}</Badge>
                              <CardTitle className="text-lg">
                                {t(product.nameKey)}
                              </CardTitle>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <p className="text-muted-foreground text-sm">
                              {t(product.descriptionKey)}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <Separator />

        {/* RTN Protocol CTA */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <Card className="max-w-4xl mx-auto bg-primary/5 border-primary/20">
              <CardContent className="p-8 md:p-12">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <div className="p-4 rounded-full bg-primary/10">
                    <TestTube className="h-10 w-10 text-primary" />
                  </div>
                  <div className="flex-1 text-center md:text-left">
                    <h3 className="text-2xl font-serif font-bold text-foreground mb-2">
                      {t("research.protocol.title")}
                    </h3>
                    <p className="text-muted-foreground">
                      {t("research.protocol.description")}
                    </p>
                  </div>
                  <Button asChild size="lg">
                    <Link to="/protocol">
                      {t("research.protocol.cta")}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <Separator />

        {/* Laboratory Samples CTA */}
        <section className="py-16 md:py-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <FlaskConical className="h-12 w-12 text-primary mx-auto mb-6" />
              <h2 className="text-2xl md:text-3xl font-serif font-bold text-foreground mb-4">
                {t("research.labSamples.title")}
              </h2>
              <p className="text-muted-foreground mb-8">
                {t("research.labSamples.description")}
              </p>
              <Button asChild size="lg">
                <Link to="/partners">
                  {t("research.labSamples.cta")}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Disclaimer */}
        <section className="py-8 bg-muted/50">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <p className="text-xs text-muted-foreground text-center max-w-3xl mx-auto">
              {t("research.disclaimer")}
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Research;
