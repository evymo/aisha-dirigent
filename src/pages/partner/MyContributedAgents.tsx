/**
 * MyContributedAgents — partner dashboard listing the agents a certified guild
 * member has authored, in any lifecycle status (submitted / reviewing / canary /
 * ga / …), with publish + edit actions.
 *
 * The partner-publish counterpart of MyContributedRules: same layout and
 * lifecycle affordances, sourced from get_my_agents (useMyAgents) and driven by
 * submit_plugin / publish_agent. i18n under guild.myAgents.* and the shared
 * guild.agents.* (status / trust labels).
 *
 * @module pages/partner/MyContributedAgents
 */

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyAgents, usePublishAgent } from "@/hooks/usePartnerAgents";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { Plus, Bot, Edit, Send, ShieldCheck, Clock, Tag } from "lucide-react";

/** Status → badge classes. Keyed by plugin_status; falls back to the draft tone. */
const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  reviewing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  canary: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  ga: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  deprecated: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  disabled: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export default function MyContributedAgents() {
  const { t } = useTranslation();
  const { data: agents, isLoading } = useMyAgents();
  const publishMutation = usePublishAgent();

  const handlePublish = async (pluginId: string) => {
    try {
      await publishMutation.mutateAsync(pluginId);
      toast.success(t("guild.contributeAgent.publishSuccess"));
    } catch (error) {
      safeError("Error publishing agent", error);
      toast.error(t("guild.contributeAgent.publishError"));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-4xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("guild.myAgents.title")}
              </h1>
              <p className="text-muted-foreground mt-1">{t("guild.myAgents.subtitle")}</p>
            </div>
            <Button asChild>
              <Link to="/partner/agents/new">
                <Plus className="h-4 w-4 mr-2" />
                {t("guild.myAgents.create")}
              </Link>
            </Button>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Empty */}
          {!isLoading && (!agents || agents.length === 0) && (
            <Card className="text-center py-12">
              <CardContent>
                <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-lg font-medium mb-2">{t("guild.myAgents.empty")}</h2>
                <p className="text-muted-foreground mb-6">{t("guild.myAgents.emptyDesc")}</p>
                <Button asChild>
                  <Link to="/partner/agents/new">
                    <Plus className="h-4 w-4 mr-2" />
                    {t("guild.myAgents.createFirst")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* List */}
          {agents && agents.length > 0 && (
            <div className="space-y-4">
              {agents.map((agent) => (
                <Card key={agent.id} className="hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Bot className="h-4 w-4 text-primary shrink-0" />
                          <span className="truncate">{agent.name ?? agent.slug}</span>
                          <Badge className={STATUS_COLORS[agent.status] ?? STATUS_COLORS.submitted}>
                            {t(`guild.agents.status.${agent.status}`)}
                          </Badge>
                        </CardTitle>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="outline" className="gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            {t(`guild.agents.trust.${agent.trust_tier}`)}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-xs">
                            {agent.slug}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {agent.status === "submitted" && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => void handlePublish(agent.id)}
                            disabled={publishMutation.isPending}
                          >
                            <Send className="h-4 w-4 mr-1" />
                            {t("guild.contributeAgent.publish")}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/partner/agents/${agent.slug}/edit`}>
                            <Edit className="h-4 w-4 mr-1" />
                            {t("common.edit")}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {agent.description && (
                      <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                        {agent.description}
                      </p>
                    )}
                    <div className="flex items-center flex-wrap gap-4 text-xs text-muted-foreground">
                      {agent.capabilities.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Tag className="h-3 w-3" />
                          {agent.capabilities.slice(0, 3).join(", ")}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(agent.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
