import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Loader2, Users, Landmark, FlaskConical, Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useExtendedStudies } from "@/hooks";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

type TabValue = "all" | "funding" | "active" | "completed";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  funding: "bg-amber-100 text-amber-700",
  funded: "bg-blue-100 text-blue-700",
  active: "bg-green-100 text-green-700",
  completed: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
};

/**
 * Runtime block: studies browser with tab-based filtering.
 * Shows study cards with funding progress, participant stats, and links to detail.
 */
export default function StudiesBrowserBlock({ config: _config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabValue>("all");
  const { data: studies, isLoading } = useExtendedStudies();

  const filtered = useMemo(() => {
    if (!studies) return [];
    switch (tab) {
      case "funding":
        return studies.filter((s) => s.funding_status === "funding");
      case "active":
        return studies.filter((s) => s.is_active);
      case "completed":
        return studies.filter((s) => s.funding_status === "completed");
      default:
        return studies;
    }
  }, [studies, tab]);

  const umbrella = filtered.find((s) => s.is_umbrella);
  const regular = filtered.filter((s) => !s.is_umbrella);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const fundingPercent = (study: NonNullable<typeof studies>[number]) =>
    study.funding_goal > 0
      ? Math.min(100, Math.round((study.current_funding / study.funding_goal) * 100))
      : 0;

  const renderStudyCard = (study: NonNullable<typeof studies>[number]) => (
    <Link
      key={study.id}
      to={`/studies/${study.id}`}
      className="group block"
    >
      <Card className={`h-full hover:shadow-md transition-shadow ${study.is_umbrella ? "border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-background" : ""}`}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs font-mono">
              {study.code}
            </Badge>
            <Badge className={`text-xs ${STATUS_COLORS[study.funding_status] ?? ""}`}>
              {t(`studies.status.${study.funding_status}`)}
            </Badge>
          </div>
          <CardTitle className="text-lg group-hover:text-primary transition-colors line-clamp-2">
            {study.name}
          </CardTitle>
          {study.description && (
            <CardDescription className="line-clamp-2">
              {study.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Funding progress */}
          {study.funding_goal > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("studies.funding")}</span>
                <span>{fundingPercent(study)}%</span>
              </div>
              <Progress value={fundingPercent(study)} className="h-2" />
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span>
                {study.current_registration}/{study.target_registration ?? "∞"}
              </span>
            </div>
            {study.consultant_count != null && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Star className="h-3.5 w-3.5" />
                <span>{study.consultant_count}</span>
              </div>
            )}
          </div>

          {/* Type + condition badges */}
          <div className="flex flex-wrap gap-1">
            {study.study_type && (
              <Badge variant="outline" className="text-xs">
                <FlaskConical className="h-3 w-3 mr-1" />
                {t(`studies.type.${study.study_type}`)}
              </Badge>
            )}
            {study.target_condition && (
              <Badge variant="outline" className="text-xs">
                {study.target_condition}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="all">{t("studies.tabs.all")}</TabsTrigger>
          <TabsTrigger value="funding">{t("studies.tabs.funding")}</TabsTrigger>
          <TabsTrigger value="active">{t("studies.tabs.active")}</TabsTrigger>
          <TabsTrigger value="completed">{t("studies.tabs.completed")}</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-6">
          {!filtered.length ? (
            <div className="text-center py-12 text-muted-foreground">
              {t("studies.emptyState")}
            </div>
          ) : (
            <div className="space-y-6">
              {umbrella && renderStudyCard(umbrella)}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {regular.map(renderStudyCard)}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
