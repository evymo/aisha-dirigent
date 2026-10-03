import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Heart,
  Bone,
  TestTube,
  Dna,
  Clock,
  Target,
  Users,
  Microscope,
  Beaker,
  Shield,
  Zap,
} from "lucide-react";

const panelTypes = [
  {
    id: "annual",
    icon: Clock,
    titleKey: "rtnProtocol.panels.annual.title",
    descKey: "rtnProtocol.panels.annual.description",
    targetKey: "rtnProtocol.panels.annual.target",
    frequencyKey: "rtnProtocol.panels.annual.frequency",
    tests: ["CBC", "CRP", "ESR", "AST", "ALT", "ALP", "GGT", "Ferritin", "Lipoprotein Electrophoresis", "Vitamin D3", "Homocysteine"],
    color: "bg-blue-500",
  },
  {
    id: "baseline",
    icon: Target,
    titleKey: "rtnProtocol.panels.baseline.title",
    descKey: "rtnProtocol.panels.baseline.description",
    targetKey: "rtnProtocol.panels.baseline.target",
    frequencyKey: "rtnProtocol.panels.baseline.frequency",
    tests: ["HbA1c", "Cystatin C", "Vitamin A", "B1", "B2", "B6", "Folate", "TSH", "f-T3", "f-T4", "a-TPO", "a-TG", "Iodine", "Omega-3 Index", "NADH", "Homocysteine"],
    color: "bg-emerald-500",
  },
  {
    id: "specialized",
    icon: Microscope,
    titleKey: "rtnProtocol.panels.specialized.title",
    descKey: "rtnProtocol.panels.specialized.description",
    targetKey: "rtnProtocol.panels.specialized.target",
    frequencyKey: "rtnProtocol.panels.specialized.frequency",
    tests: [],
    color: "bg-amber-500",
  },
  {
    id: "strategic",
    icon: Dna,
    titleKey: "rtnProtocol.panels.strategic.title",
    descKey: "rtnProtocol.panels.strategic.description",
    targetKey: "rtnProtocol.panels.strategic.target",
    frequencyKey: "rtnProtocol.panels.strategic.frequency",
    tests: ["WES", "Epigenetic Age", "Telomere Length", "ATP Profile", "NAD/NADH Ratio", "Microbiome PCR"],
    color: "bg-purple-500",
  },
];

const productMappings = [
  {
    id: "retisin",
    name: "Retisin",
    icon: Zap,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
    borderColor: "border-amber-200 dark:border-amber-800",
    conditions: [
      {
        titleKey: "rtnProtocol.products.retisin.oncology.title",
        descKey: "rtnProtocol.products.retisin.oncology.description",
        diagnostics: ["Tumor markers (CEA, PSA, CA125, AFP)", "PET Scan", "CTC", "ctDNA", "ATP Profile", "NAD/NADH", "NK Cells", "CD4/CD8"],
      },
      {
        titleKey: "rtnProtocol.products.retisin.metabolic.title",
        descKey: "rtnProtocol.products.retisin.metabolic.description",
        diagnostics: ["HbA1c", "Insulin", "C-peptide", "OGTT", "Cystatin C"],
      },
    ],
    mechanismKey: "rtnProtocol.products.retisin.mechanism",
  },
  {
    id: "lyastin",
    name: "Lyastin",
    icon: Heart,
    color: "text-rose-600 dark:text-rose-400",
    bgColor: "bg-rose-100 dark:bg-rose-900/30",
    borderColor: "border-rose-200 dark:border-rose-800",
    conditions: [
      {
        titleKey: "rtnProtocol.products.lyastin.cardiovascular.title",
        descKey: "rtnProtocol.products.lyastin.cardiovascular.description",
        diagnostics: ["Advanced Lipid Profile (ELFO)", "ApoB", "Lipoprotein(a)", "NADH", "Omega-3 Index", "Homocysteine", "HS-CRP"],
      },
    ],
    mechanismKey: "rtnProtocol.products.lyastin.mechanism",
  },
  {
    id: "floristen",
    name: "Floristen",
    icon: Shield,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-100 dark:bg-emerald-900/30",
    borderColor: "border-emerald-200 dark:border-emerald-800",
    conditions: [
      {
        titleKey: "rtnProtocol.products.floristen.immunity.title",
        descKey: "rtnProtocol.products.floristen.immunity.description",
        diagnostics: ["CBC", "CD3/CD4/CD8", "NK Cells", "Cytokine Panel", "Treg Cells", "ANA", "Food Intolerance", "ESR", "HS-CRP", "Homocysteine", "Microbiome PCR"],
      },
    ],
    mechanismKey: "rtnProtocol.products.floristen.mechanism",
  },
  {
    id: "silexil",
    name: "Silexil",
    icon: Bone,
    color: "text-sky-600 dark:text-sky-400",
    bgColor: "bg-sky-100 dark:bg-sky-900/30",
    borderColor: "border-sky-200 dark:border-sky-800",
    conditions: [
      {
        titleKey: "rtnProtocol.products.silexil.joints.title",
        descKey: "rtnProtocol.products.silexil.joints.description",
        diagnostics: ["CRP", "ESR", "Vitamin D3", "Ca", "Mg", "P", "CTX-II", "Osteocalcin", "Homocysteine"],
      },
    ],
    mechanismKey: "rtnProtocol.products.silexil.mechanism",
  },
];

export default function RTNProtocol() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="py-16 bg-gradient-to-b from-primary/5 to-background">
          <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8">
              <Badge variant="outline" className="mb-4">
                {t("rtnProtocol.badge")}
              </Badge>
              <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-4">
                {t("rtnProtocol.title")}
              </h1>
              <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
                {t("rtnProtocol.subtitle")}
              </p>
            </div>
          </div>
        </section>

        {/* Diagnostic Panels */}
        <section className="py-12">
          <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-serif font-bold text-foreground mb-6">
              {t("rtnProtocol.panelsTitle")}
            </h2>
            
            <div className="grid md:grid-cols-2 gap-6 mb-12">
              {panelTypes.map((panel) => {
                const Icon = panel.icon;
                return (
                  <Card key={panel.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${panel.color} text-white`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-lg">
                            {t(panel.titleKey)}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {t(panel.descKey)}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="text-muted-foreground">
                          <Users className="w-3 h-3 inline mr-1" />
                          {t(panel.targetKey)}
                        </span>
                        <span className="text-muted-foreground">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {t(panel.frequencyKey)}
                        </span>
                      </div>
                      {panel.tests.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {panel.tests.map((test) => (
                            <Badge key={test} variant="secondary" className="text-xs">
                              {test}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Separator className="my-12" />

            {/* Product-Diagnostic Mapping */}
            <h2 className="text-2xl font-serif font-bold text-foreground mb-6">
              {t("rtnProtocol.mappingTitle")}
            </h2>
            <p className="text-muted-foreground mb-8">
              {t("rtnProtocol.mappingSubtitle")}
            </p>

            <Tabs defaultValue="retisin" className="space-y-6">
              <TabsList className="flex flex-wrap h-auto gap-2 bg-transparent p-0">
                {productMappings.map((product) => {
                  const Icon = product.icon;
                  return (
                    <TabsTrigger
                      key={product.id}
                      value={product.id}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${product.borderColor} data-[state=active]:${product.bgColor}`}
                    >
                      <Icon className={`w-4 h-4 ${product.color}`} />
                      {product.name}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {productMappings.map((product) => {
                const Icon = product.icon;
                return (
                  <TabsContent key={product.id} value={product.id}>
                    <Card className={`border-2 ${product.borderColor}`}>
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className={`p-3 rounded-xl ${product.bgColor}`}>
                            <Icon className={`w-6 h-6 ${product.color}`} />
                          </div>
                          <div>
                            <CardTitle className="text-xl">{product.name}</CardTitle>
                            <CardDescription>
                              {t(product.mechanismKey)}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {product.conditions.map((condition, idx) => (
                          <div key={idx} className="space-y-3">
                            <div>
                              <h4 className="font-semibold text-foreground">
                                {t(condition.titleKey)}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                {t(condition.descKey)}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">
                                {t("rtnProtocol.recommendedDiagnostics")}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {condition.diagnostics.map((diag) => (
                                  <Badge key={diag} variant="outline" className="text-xs">
                                    <TestTube className="w-3 h-3 mr-1" />
                                    {diag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            {idx < product.conditions.length - 1 && <Separator />}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </TabsContent>
                );
              })}
            </Tabs>

            <Separator className="my-12" />

            {/* Why RTN Section */}
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Beaker className="w-5 h-5 text-primary" />
                  {t("rtnProtocol.whyTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {t("rtnProtocol.whyDescription")}
                </p>
                <p className="mt-4 text-sm font-medium text-primary italic">
                  {t("rtnProtocol.tagline")}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
