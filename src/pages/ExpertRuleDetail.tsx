/**
 * Expert Rule Detail page — full rule view with documents, subscribe, rate.
 *
 * @module pages/ExpertRuleDetail
 */

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useExpertRuleDetail,
  useSubscribeToRule,
  useUnsubscribeFromRule,
} from "@/hooks/useExpertRules";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Star,
  Users,
  FileText,
  CheckCircle,
  Download,
  ExternalLink,
  Plus,
  Minus,
  Bot,
  Tag,
  Clock,
  Eye,
  Copy,
} from "lucide-react";

export default function ExpertRuleDetail() {
  const { t } = useTranslation();
  const { ruleSlug } = useParams<{ ruleSlug: string }>();
  const { data: rule, isLoading } = useExpertRuleDetail(ruleSlug);
  const subscribeMutation = useSubscribeToRule();
  const unsubscribeMutation = useUnsubscribeFromRule();

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

  if (!rule) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-medium mb-2">{t("guild.rules.notFound")}</h2>
          <Button variant="outline" asChild>
            <Link to="/rules">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("guild.rules.backToRules")}
            </Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  const handleToggleSubscription = () => {
    if (rule.is_subscribed) {
      unsubscribeMutation.mutate(rule.id);
    } else {
      subscribeMutation.mutate(rule.id);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
        {/* Back */}
        <Button variant="ghost" size="sm" asChild className="mb-8">
          <Link to="/rules">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("guild.rules.backToRules")}
          </Link>
        </Button>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
                {rule.title}
                {rule.is_verified && (
                  <CheckCircle className="h-6 w-6 text-green-500 shrink-0" />
                )}
              </h1>
            </div>
            <Button
              variant={rule.is_subscribed ? "outline" : "default"}
              onClick={handleToggleSubscription}
              disabled={subscribeMutation.isPending || unsubscribeMutation.isPending}
            >
              {rule.is_subscribed ? (
                <>
                  <Minus className="h-4 w-4 mr-2" />
                  {t("guild.rules.unsubscribe")}
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("guild.rules.subscribe")}
                </>
              )}
            </Button>
          </div>

          {/* Meta badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge variant="outline">
              <Tag className="h-3 w-3 mr-1" />
              {t(`guild.category.${rule.category}`)}
            </Badge>
            {rule.expertise_area_name_key && (
              <Badge variant="secondary">{t(rule.expertise_area_name_key)}</Badge>
            )}
            <Badge variant="outline">
              <Eye className="h-3 w-3 mr-1" />
              {t(`guild.visibility.${rule.visibility}`)}
            </Badge>
            <Badge variant="outline">
              {`v${rule.version}`}
            </Badge>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-6 text-sm text-muted-foreground mb-6">
            <span className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {rule.subscriber_count} {t("guild.subscribers")}
            </span>
            {rule.rating_avg != null && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-current text-yellow-500" />
                {rule.rating_avg.toFixed(1)} ({rule.rating_count})
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {rule.published_at
                ? new Date(rule.published_at).toLocaleDateString()
                : t("guild.rules.draft")}
            </span>
          </div>

          {/* Author card */}
          <Link
            to={`/guild/${rule.author_partner_id}`}
            className="inline-flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
          >
            <Avatar className="h-10 w-10">
              <AvatarImage src={rule.author_avatar_url ?? undefined} />
              <AvatarFallback>
                {(rule.author_display_name ?? "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-foreground">{rule.author_display_name}</p>
              {rule.author_guild_tier && (
                <p className="text-xs text-muted-foreground">
                  {t(`guild.tier.${rule.author_guild_tier}`)}
                </p>
              )}
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground ml-2" />
          </Link>
        </div>

        {/* Summary */}
        {rule.summary && (
          <Card className="mb-8">
            <CardContent className="pt-6">
              <p className="text-muted-foreground italic">{rule.summary}</p>
            </CardContent>
          </Card>
        )}

        {/* Tabs: Body | Documents | AI */}
        <Tabs defaultValue="body" className="mb-8">
          <TabsList>
            <TabsTrigger value="body">
              <BookOpen className="h-4 w-4 mr-2" />
              {t("guild.rules.content")}
            </TabsTrigger>
            <TabsTrigger value="documents">
              <FileText className="h-4 w-4 mr-2" />
              {t("guild.rules.documents")} ({rule.documents.length})
            </TabsTrigger>
            <TabsTrigger value="ai">
              <Bot className="h-4 w-4 mr-2" />
              {t("guild.rules.aiContext")}
            </TabsTrigger>
          </TabsList>

          {/* Rule Body */}
          <TabsContent value="body">
            <Card>
              <CardContent className="pt-6">
                {rule.body_markdown ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                    {rule.body_markdown}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
                    {t("guild.rules.noContent")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents */}
          <TabsContent value="documents">
            {rule.documents.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-center py-8">
                  <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground">{t("guild.rules.noDocuments")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {rule.documents.map((doc) => (
                  <Card key={doc.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{doc.title}</CardTitle>
                          {doc.description && (
                            <CardDescription>{doc.description}</CardDescription>
                          )}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {t(`guild.docType.${doc.document_type}`)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {doc.content_markdown && (
                        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap bg-muted/50 rounded-lg p-4 text-sm">
                          {doc.content_markdown}
                        </div>
                      )}
                      {doc.file_path && (
                        <Button variant="outline" size="sm" className="mt-3">
                          <Download className="h-4 w-4 mr-2" />
                          {doc.file_name ?? t("guild.rules.downloadFile")}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* AI Context */}
          <TabsContent value="ai">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  {t("guild.rules.aiInstructions")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {rule.ai_instructions ? (
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">
                        {t("guild.rules.systemInstructions")}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(rule.ai_instructions ?? "");
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono">
                      {rule.ai_instructions}
                    </pre>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">
                    {t("guild.rules.noAiInstructions")}
                  </p>
                )}

                {/* Context tags */}
                {rule.ai_context_tags && rule.ai_context_tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-2">
                      {t("guild.rules.contextTags")}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {rule.ai_context_tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-mono text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Footer />
    </div>
  );
}
