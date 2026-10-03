/**
 * Agent Marketplace detail — a single published agent, with the run-as-story
 * install action. Listing fields only (name, description, capabilities, version,
 * trust_tier, status); the declarative agent_spec is review-only (service_role)
 * and intentionally not exposed to consumers here.
 *
 * Mirrors ExpertRuleDetail (Header / loading / not-found / detail / Footer).
 *
 * @module pages/AgentMarketplaceDetail
 */

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAvailableAgent, useInstallAgent } from "@/hooks/useAvailableAgents";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Bot, ShieldCheck, Sparkles, Tag, Loader2, Download } from "lucide-react";

export default function AgentMarketplaceDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agentSlug } = useParams<{ agentSlug: string }>();
  const { data: agent, isLoading } = useAvailableAgent(agentSlug);
  const installMutation = useInstallAgent();

  const handleInstall = async () => {
    if (!agent) return;
    try {
      const result = await installMutation.mutateAsync({ pluginId: agent.plugin_id });
      toast.success(t("guild.agents.installSuccess"));
      navigate(`/member/story/${result.story_id}`);
    } catch {
      toast.error(t("guild.agents.installError"));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
          <Skeleton className="h-8 w-32 mb-8" />
          <Skeleton className="h-10 w-2/3 mb-4" />
          <Skeleton className="h-6 w-1/3 mb-8" />
          <Skeleton className="h-64 w-full" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-medium mb-2">{t("guild.agents.notFound")}</h2>
          <Button variant="outline" asChild>
            <Link to="/agents">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("guild.agents.backToAgents")}
            </Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
        {/* Back */}
        <Link
          to="/agents"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("guild.agents.backToAgents")}
        </Link>

        {/* Title + badges */}
        <div className="flex items-start gap-3 mb-2">
          <Bot className="h-8 w-8 text-primary shrink-0 mt-1" />
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground">
            {agent.name ?? agent.slug}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <Badge variant="outline">{t(`guild.agents.status.${agent.status}`)}</Badge>
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="h-3 w-3" />
            {t(`guild.agents.trust.${agent.trust_tier}`)}
          </Badge>
          {agent.version && (
            <Badge variant="outline" className="gap-1 font-mono text-xs">
              <Tag className="h-3 w-3" />
              {agent.version}
            </Badge>
          )}
        </div>

        {/* About */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">{t("guild.agents.aboutThisAgent")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground whitespace-pre-line">
              {agent.description ?? t("guild.agents.noDescription")}
            </p>
          </CardContent>
        </Card>

        {/* Capabilities */}
        {agent.capabilities.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">{t("guild.agents.capabilities")}</CardTitle>
              <CardDescription>{t("guild.agents.capabilitiesDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {agent.capabilities.map((cap) => (
                  <Badge key={cap} variant="outline" className="font-mono text-xs">
                    {cap}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Install CTA (run-as-story) */}
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {t("guild.agents.runAsStory")}
            </CardTitle>
            <CardDescription>{t("guild.agents.runAsStoryDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleInstall} disabled={installMutation.isPending} className="w-full sm:w-auto">
              {installMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("guild.agents.installing")}
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  {t("guild.agents.install")}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Footer />
    </div>
  );
}
