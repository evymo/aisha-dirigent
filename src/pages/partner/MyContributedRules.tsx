/**
 * MyContributedRules — partner dashboard showing contributed expert rules.
 *
 * @module pages/partner/MyContributedRules
 */

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyContributedRules, usePublishExpertRule } from "@/hooks/useExpertRules";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import {
  Plus,
  BookOpen,
  Star,
  Users,
  Edit,
  Send,
  Tag,
  Clock,
  Eye,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  review: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  archived: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

export default function MyContributedRules() {
  const { t } = useTranslation();
  const { data: rules, isLoading } = useMyContributedRules();
  const publishMutation = usePublishExpertRule();

  const handlePublish = async (ruleId: string) => {
    try {
      await publishMutation.mutateAsync(ruleId);
      toast.success(t("guild.contribute.publishSuccess"));
    } catch (error) {
      safeError("Error publishing rule", error);
      toast.error(t("guild.contribute.publishError"));
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
                {t("guild.myRules.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("guild.myRules.subtitle")}
              </p>
            </div>
            <Button asChild>
              <Link to="/partner/rules/new">
                <Plus className="h-4 w-4 mr-2" />
                {t("guild.myRules.create")}
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
          {!isLoading && (!rules || rules.length === 0) && (
            <Card className="text-center py-12">
              <CardContent>
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-lg font-medium mb-2">
                  {t("guild.myRules.empty")}
                </h2>
                <p className="text-muted-foreground mb-6">
                  {t("guild.myRules.emptyDesc")}
                </p>
                <Button asChild>
                  <Link to="/partner/rules/new">
                    <Plus className="h-4 w-4 mr-2" />
                    {t("guild.myRules.createFirst")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* List */}
          {rules && rules.length > 0 && (
            <div className="space-y-4">
              {rules.map((rule) => (
                <Card key={rule.id} className="hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {rule.title}
                          <Badge
                            className={STATUS_COLORS[rule.status] ?? STATUS_COLORS.draft}
                          >
                            {t(`guild.status.${rule.status}`)}
                          </Badge>
                        </CardTitle>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="outline">
                            <Tag className="h-3 w-3 mr-1" />
                            {t(`guild.category.${rule.category}`)}
                          </Badge>
                          <Badge variant="outline">
                            <Eye className="h-3 w-3 mr-1" />
                            {t(`guild.visibility.${rule.visibility}`)}
                          </Badge>
                          <Badge variant="outline">{`v${rule.version}`}</Badge>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {(rule.status === "draft" || rule.status === "review") && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => void handlePublish(rule.id)}
                            disabled={publishMutation.isPending}
                          >
                            <Send className="h-4 w-4 mr-1" />
                            {t("guild.contribute.publish")}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/partner/rules/${rule.slug}/edit`}>
                            <Edit className="h-4 w-4 mr-1" />
                            {t("common.edit")}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {rule.summary && (
                      <p className="text-sm text-muted-foreground mb-3">
                        {rule.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {rule.subscriber_count} {t("guild.subscribers")}
                      </span>
                      {rule.rating_avg != null && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 fill-current text-yellow-500" />
                          {rule.rating_avg.toFixed(1)} ({rule.rating_count})
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(rule.updated_at).toLocaleDateString()}
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
