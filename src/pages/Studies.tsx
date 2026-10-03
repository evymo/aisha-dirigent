import { useState } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useExtendedStudies } from "@/hooks/useStudyFunding";
import { useSession } from "@/hooks/useSession";
import { useRIIMembership } from "@/hooks/useRIIMembership";
import { StudiesHeroSection } from "@/components/studies/StudiesHeroSection";
import { TimelinePreviewSection } from "@/components/studies/TimelinePreviewSection";
import { DocumentPreviewSection } from "@/components/studies/DocumentPreviewSection";
import { ProvenanceSection } from "@/components/studies/ProvenanceSection";
import { WhitepaperSection } from "@/components/studies/WhitepaperSection";
import {
  FlaskConical,
  Users,
  Calendar,
  TrendingUp,
  Star,
  Clock,
  Wallet,
  ArrowRight,
  Shield,
  Sparkles,
} from "lucide-react";

export default function Studies() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const isAuthenticated = !!user;
  const { isRIIMember, isPendingRII } = useRIIMembership();
  const { data: studies = [], isLoading } = useExtendedStudies();
  const [selectedTab, setSelectedTab] = useState("all");

  // Translations are resolved server-side in get_extended_studies(p_locale).
  // study.name / study.description already contain locale-aware values.

  const dateLocale = getDateFnsLocale(i18n.language);

  const fundingStudies = studies.filter(s => s.funding_status === "funding");
  const activeStudies = studies.filter(s => s.funding_status === "active" || s.funding_status === "funded");
  const completedStudies = studies.filter(s => s.funding_status === "completed");

  // Separate umbrella study from others
  const umbrellaStudy = studies.find(s => s.is_umbrella);
  const nonUmbrellaStudies = studies.filter(s => !s.is_umbrella);

  const getStudiesByTab = () => {
    const studiesToFilter = nonUmbrellaStudies;
    switch (selectedTab) {
      case "funding":
        return studiesToFilter.filter(s => s.funding_status === "funding");
      case "active":
        return studiesToFilter.filter(s => s.funding_status === "active" || s.funding_status === "funded");
      case "completed":
        return studiesToFilter.filter(s => s.funding_status === "completed");
      default:
        return studiesToFilter;
    }
  };

  const getFundingPercentage = (study: typeof studies[0]) => {
    if (!study.funding_goal || study.funding_goal === 0) return 100;
    const contributed = study.total_contributed || study.current_funding || 0;
    return Math.min(100, (contributed / study.funding_goal) * 100);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      draft: { variant: "secondary" as const, label: t("studies.status.draft") },
      funding: { variant: "default" as const, label: t("studies.status.funding") },
      funded: { variant: "default" as const, label: t("studies.status.funded") },
      active: { variant: "default" as const, label: t("studies.status.active") },
      completed: { variant: "secondary" as const, label: t("studies.status.completed") },
      cancelled: { variant: "destructive" as const, label: t("studies.status.cancelled") },
    };
    return statusConfig[status as keyof typeof statusConfig] || statusConfig.draft;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero with archive context */}
      <StudiesHeroSection />

      {/* Stats */}
      <section className="py-8 border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{studies.length}</p>
              <p className="text-sm text-muted-foreground">{t("studies.stats.total")}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-primary">{fundingStudies.length}</p>
              <p className="text-sm text-muted-foreground">{t("studies.stats.funding")}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{activeStudies.length}</p>
              <p className="text-sm text-muted-foreground">{t("studies.stats.active")}</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-foreground">{completedStudies.length}</p>
              <p className="text-sm text-muted-foreground">{t("studies.stats.completed")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Umbrella Study - Entry Point */}
      {umbrellaStudy && (
        <section className="py-12 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium uppercase tracking-wider text-primary">
                  {t("studies.umbrella.label")}
                </span>
              </div>
              
              <Card className="border-2 border-primary/30 shadow-lg hover:shadow-xl transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {isPendingRII ? (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                            <Clock className="h-3 w-3 mr-1" />
                            {t("studies.umbrella.pendingApproval")}
                          </Badge>
                        ) : (
                          <Badge variant="default" className="bg-primary">
                            <Sparkles className="h-3 w-3 mr-1" />
                            {t("studies.umbrella.entryPoint")}
                          </Badge>
                        )}
                        <Badge variant="outline">{umbrellaStudy.code}</Badge>
                      </div>
                      <CardTitle className="text-2xl">
                        {umbrellaStudy.name}
                      </CardTitle>
                      <CardDescription className="text-base mt-2">
                        {umbrellaStudy.description}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-4 mb-6">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span className="text-sm">
                        {umbrellaStudy.current_registration} {t("studies.participants")}
                      </span>
                    </div>
                    <Badge variant="secondary">{t(`studies.types.${umbrellaStudy.study_type}`)}</Badge>
                    <Badge variant="outline">{t(`studies.status.${umbrellaStudy.funding_status}`)}</Badge>
                  </div>
                  
                  <div className="p-4 bg-muted/50 rounded-lg mb-6">
                    <p className="text-sm text-muted-foreground">
                      {isPendingRII 
                        ? t("studies.umbrella.pendingDescription")
                        : t("studies.umbrella.description")
                      }
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    {isPendingRII ? (
                      <Button variant="secondary" size="lg" disabled>
                        <Clock className="mr-2 h-4 w-4" />
                        {t("studies.umbrella.awaitingApproval")}
                      </Button>
                    ) : isRIIMember ? null : (
                      <Button asChild size="lg">
                        <Link to={`/studies/${umbrellaStudy.id}`}>
                          <Shield className="mr-2 h-4 w-4" />
                          {t("studies.umbrella.joinCTA")}
                        </Link>
                      </Button>
                    )}
                    <Button asChild variant="outline" size="lg">
                      <Link to={`/studies/${umbrellaStudy.id}`}>
                        {t("studies.viewDetails")}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      )}

      {/* Other Studies List */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="font-serif text-2xl font-bold text-foreground mb-2">
              {t("studies.specificPrograms.title")}
            </h2>
            <p className="text-muted-foreground">
              {t("studies.specificPrograms.subtitle")}
            </p>
          </div>
          
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-8">
            <TabsList className="grid w-full max-w-md grid-cols-4">
              <TabsTrigger value="all">{t("studies.tabs.all")}</TabsTrigger>
              <TabsTrigger value="funding">
                {t("studies.tabs.funding")}
                {fundingStudies.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5">{fundingStudies.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="active">{t("studies.tabs.active")}</TabsTrigger>
              <TabsTrigger value="completed">{t("studies.tabs.completed")}</TabsTrigger>
            </TabsList>

            <TabsContent value={selectedTab} className="space-y-6">
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {[1, 2, 3].map(i => (
                    <Card key={i} className="animate-pulse">
                      <CardHeader>
                        <div className="h-6 bg-muted rounded w-3/4" />
                        <div className="h-4 bg-muted rounded w-1/2 mt-2" />
                      </CardHeader>
                      <CardContent>
                        <div className="h-20 bg-muted rounded" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : getStudiesByTab().length === 0 ? (
                <div className="text-center py-16">
                  <FlaskConical className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    {t("studies.noStudies")}
                  </h3>
                  <p className="text-muted-foreground">
                    {t("studies.noStudiesDescription")}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {getStudiesByTab().map(study => {
                    const fundingPercent = getFundingPercentage(study);
                    const statusBadge = getStatusBadge(study.funding_status);

                    return (
                      <Card key={study.id} className="hover:shadow-lg transition-shadow flex flex-col">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg line-clamp-2">
                                {study.name}
                              </CardTitle>
                              <CardDescription className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">{study.code}</Badge>
                                <Badge variant={statusBadge.variant} className="text-xs">
                                  {statusBadge.label}
                                </Badge>
                              </CardDescription>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="flex-1 flex flex-col">
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                            {study.description}
                          </p>

                          {/* Funding Progress */}
                          {study.funding_status === "funding" && study.funding_goal > 0 && (
                            <div className="space-y-2 mb-4">
                              <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">{t("studies.funding.raised")}</span>
                                <span className="font-medium">
                                  {(study.total_contributed || study.current_funding || 0).toLocaleString()} {t("common.separatorSlash")} {study.funding_goal.toLocaleString()} {t("common.currencyCzk")}
                                </span>
                              </div>
                              <Progress value={fundingPercent} className="h-2" />
                              {study.funding_deadline && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {t("studies.funding.deadline")}: {format(new Date(study.funding_deadline), "d. MMMM yyyy", { locale: dateLocale })}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Study Info */}
                          <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Users className="h-4 w-4" />
                              <span>
                                {study.current_registration}/{study.target_registration || "∞"} {t("studies.participants")}
                              </span>
                            </div>
                            {study.consultant_count !== undefined && study.consultant_count > 0 && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Star className="h-4 w-4" />
                                <span>{study.consultant_count} {t("studies.professionals")}</span>
                              </div>
                            )}
                            {study.contribution_count !== undefined && study.contribution_count > 0 && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Wallet className="h-4 w-4" />
                                <span>{study.contribution_count} {t("studies.contributors")}</span>
                              </div>
                            )}
                            {study.total_contributed !== undefined && study.total_contributed > 0 && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <TrendingUp className="h-4 w-4" />
                                <span>{study.total_contributed.toLocaleString()} {t("common.currencyCzk")}</span>
                              </div>
                            )}
                            {study.duration_weeks && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Calendar className="h-4 w-4" />
                                <span>{study.duration_weeks} {t("studies.weeks")}</span>
                              </div>
                            )}
                          </div>

                          {/* Tags */}
                          <div className="flex flex-wrap gap-1 mb-4">
                            <Badge variant="outline" className="text-xs">
                              {t(`studies.types.${study.study_type}`)}
                            </Badge>
                            {study.target_condition && (
                              <Badge variant="outline" className="text-xs">
                                {study.target_condition}
                              </Badge>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="mt-auto pt-4 flex flex-col sm:flex-row gap-2">
                            <Button asChild className="flex-1" variant="outline">
                              <Link to={`/studies/${study.id}`}>
                                {t("studies.viewDetails")}
                                <ArrowRight className="ml-2 h-4 w-4" />
                              </Link>
                            </Button>
                            {study.funding_status === "funding" && (
                              <Button asChild>
                                <Link to={`/studies/${study.id}?contribute=true`}>
                                  <Wallet className="mr-2 h-4 w-4" />
                                  {t("studies.contribute")}
                                </Link>
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-muted/50 border-y border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <h2 className="font-serif text-3xl font-bold text-foreground mb-4">
              {t("studies.howItWorks.title")}
            </h2>
            <p className="text-muted-foreground">
              {t("studies.howItWorks.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Wallet className="h-8 w-8 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                {t("studies.howItWorks.step1.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("studies.howItWorks.step1.description")}
              </p>
            </div>
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <Users className="h-8 w-8 text-secondary-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                {t("studies.howItWorks.step2.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("studies.howItWorks.step2.description")}
              </p>
            </div>
            <div className="text-center">
              <div className="h-16 w-16 rounded-full bg-accent/50 flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="h-8 w-8 text-accent-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                {t("studies.howItWorks.step3.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("studies.howItWorks.step3.description")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      {!isAuthenticated && (
        <section className="py-16 bg-primary text-primary-foreground">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="font-serif text-3xl font-bold mb-4">
              {t("studies.cta.title")}
            </h2>
            <p className="text-lg opacity-90 mb-8 max-w-2xl mx-auto">
              {t("studies.cta.subtitle")}
            </p>
            <Button variant="secondary" size="lg" asChild>
              <Link to="/auth">{t("studies.cta.button")}</Link>
            </Button>
          </div>
        </section>
      )}

      {/* Archive Sections - Moved from Homepage */}
      <TimelinePreviewSection />
      <DocumentPreviewSection />
      <ProvenanceSection />
      <WhitepaperSection />

      <Footer />
    </div>
  );
}
