/**
 * Expert Rules browser page — browse, filter, search published rules.
 *
 * @module pages/ExpertRules
 */

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useExpertRules } from "@/hooks/useExpertRules";
import { useExpertiseAreas } from "@/hooks/useGuild";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Search,
  BookOpen,
  Star,
  Users,
  FileText,
  Shield,
  Tag,
  ArrowRight,
  CheckCircle,
} from "lucide-react";

/** All rule category keys for the filter dropdown */
const CATEGORY_KEYS = [
  "coding_standard",
  "architecture_pattern",
  "testing_strategy",
  "devops_pipeline",
  "ux_guideline",
  "api_design",
  "data_modeling",
  "security_practice",
  "performance_optimization",
  "documentation_standard",
  "project_management",
  "ai_prompt_engineering",
  "domain_knowledge",
  "integration_pattern",
  "other",
] as const;

export default function ExpertRules() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedExpertise, setSelectedExpertise] = useState<string>("all");

  const { data: expertiseAreas } = useExpertiseAreas();
  const { data: rules, isLoading } = useExpertRules({
    category: selectedCategory === "all" ? undefined : selectedCategory,
    expertiseSlug: selectedExpertise === "all" ? undefined : selectedExpertise,
    search: searchQuery || undefined,
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero */}
      <section className="pt-32 pb-16 bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <span className="text-sm font-medium uppercase tracking-wider text-accent mb-4 block">
              {t("guild.sectionLabel")}
            </span>
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
              {t("guild.rules.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("guild.rules.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Filters + Rules */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("guild.rules.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <Tag className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t("guild.rules.allCategories")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("guild.rules.allCategories")}</SelectItem>
                {CATEGORY_KEYS.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {t(`guild.category.${cat}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedExpertise} onValueChange={setSelectedExpertise}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder={t("guild.directory.allExpertise")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("guild.directory.allExpertise")}</SelectItem>
                {expertiseAreas?.map((area) => (
                  <SelectItem key={area.id} value={area.slug}>
                    {t(area.name_key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loading */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !rules || rules.length === 0 ? (
            /* Empty */
            <div className="text-center py-16">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t("guild.rules.noRules")}
              </h3>
              <p className="text-muted-foreground">
                {t("guild.rules.noRulesDescription")}
              </p>
            </div>
          ) : (
            /* Rule Cards */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {rules.map((rule) => (
                <Card key={rule.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/rules/${rule.slug}`}
                        className="hover:underline flex-1 min-w-0"
                      >
                        <CardTitle className="text-lg flex items-center gap-2">
                          {rule.title}
                          {rule.is_verified && (
                            <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          )}
                        </CardTitle>
                      </Link>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {t(`guild.category.${rule.category}`)}
                      </Badge>
                    </div>
                    {/* Expertise area */}
                    {rule.expertise_area_name_key && (
                      <Badge variant="secondary" className="text-xs w-fit">
                        {t(rule.expertise_area_name_key)}
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Summary */}
                    {rule.summary && (
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {rule.summary}
                      </p>
                    )}

                    {/* Author */}
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={rule.author_avatar_url ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {(rule.author_display_name ?? "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Link
                        to={`/guild/${rule.author_partner_id}`}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        {rule.author_display_name}
                      </Link>
                      {rule.author_guild_tier && (
                        <Badge variant="outline" className="text-xs">
                          {t(`guild.tier.${rule.author_guild_tier}`)}
                        </Badge>
                      )}
                    </div>

                    {/* Context tags */}
                    {rule.ai_context_tags && rule.ai_context_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {rule.ai_context_tags.slice(0, 5).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs font-mono">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-3 border-t border-border">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {rule.subscriber_count}
                      </span>
                      {rule.rating_avg != null && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 fill-current text-yellow-500" />
                          {rule.rating_avg.toFixed(1)} ({rule.rating_count})
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {rule.document_count} {t("guild.documents")}
                      </span>
                    </div>

                    {/* CTA */}
                    <Button variant="outline" size="sm" className="w-full" asChild>
                      <Link to={`/rules/${rule.slug}`}>
                        {t("guild.rules.viewRule")}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
