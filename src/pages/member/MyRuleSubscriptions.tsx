/**
 * MyRuleSubscriptions — member dashboard showing borrowed expert rules.
 *
 * @module pages/member/MyRuleSubscriptions
 */

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyRuleSubscriptions, useUnsubscribeFromRule } from "@/hooks/useExpertRules";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  BookOpen,
  Star,
  ExternalLink,
  Minus,
  Tag,
  Clock,
} from "lucide-react";

export default function MyRuleSubscriptions() {
  const { t } = useTranslation();
  const { data: subscriptions, isLoading } = useMyRuleSubscriptions();
  const unsubscribeMutation = useUnsubscribeFromRule();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="mb-8">
            <h1 className="text-3xl font-serif font-bold text-foreground">
              {t("guild.subscriptions.title")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("guild.subscriptions.subtitle")}
            </p>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Empty */}
          {!isLoading && (!subscriptions || subscriptions.length === 0) && (
            <Card className="text-center py-12">
              <CardContent>
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-lg font-medium mb-2">
                  {t("guild.subscriptions.empty")}
                </h2>
                <p className="text-muted-foreground mb-6">
                  {t("guild.subscriptions.emptyDesc")}
                </p>
                <Button asChild>
                  <Link to="/rules">{t("guild.subscriptions.browseRules")}</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* List */}
          {subscriptions && subscriptions.length > 0 && (
            <div className="space-y-4">
              {subscriptions.map((sub) => (
                <Card key={sub.id} className="hover:border-primary/30 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg">
                          <Link
                            to={`/rules/${sub.rule_slug}`}
                            className="hover:underline flex items-center gap-2"
                          >
                            {sub.rule_title}
                            <ExternalLink className="h-4 w-4 shrink-0" />
                          </Link>
                        </CardTitle>
                        <div className="flex flex-wrap gap-2 mt-2">
                          <Badge variant="outline">
                            <Tag className="h-3 w-3 mr-1" />
                            {t(`guild.category.${sub.rule_category}`)}
                          </Badge>
                          <Badge variant="secondary">
                            {sub.author_display_name}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => unsubscribeMutation.mutate(sub.expert_rule_id)}
                        disabled={unsubscribeMutation.isPending}
                      >
                        <Minus className="h-4 w-4 mr-1" />
                        {t("guild.rules.unsubscribe")}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {sub.rule_summary && (
                      <p className="text-sm text-muted-foreground mb-3">
                        {sub.rule_summary}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {t("guild.subscriptions.subscribedAt")}:{" "}
                        {new Date(sub.subscribed_at).toLocaleDateString()}
                      </span>
                      {sub.rating_avg != null && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 fill-current text-yellow-500" />
                          {sub.rating_avg.toFixed(1)}
                        </span>
                      )}
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
