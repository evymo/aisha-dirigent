/**
 * Agent Marketplace browser — browse agents published by certified guild members
 * and open one to install as a consumer-owned story (run-as-story).
 *
 * Mirrors ExpertRules (the consumer rule browser): same Header/Hero/filters/grid
 * layout, the same React-Query hook pattern (useAvailableAgents), and i18n keys
 * under guild.agents.*. Listing comes from get_available_plugins(kind='agent').
 *
 * @module pages/AgentMarketplace
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
import { useAvailableAgents } from "@/hooks/useAvailableAgents";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Search, Bot, ArrowRight, ShieldCheck, Filter } from "lucide-react";

/** Statuses an installable marketplace agent can be in (get_available_plugins). */
const STATUS_KEYS = ["canary", "ga"] as const;

export default function AgentMarketplace() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const { data: agents, isLoading } = useAvailableAgents();

  // Plain derivation — the React Compiler auto-memoizes; manual useMemo is
  // ratcheted down by the wp-4-5 gate.
  const query = searchQuery.trim().toLowerCase();
  const filtered = (agents ?? []).filter((a) => {
    const matchesStatus = selectedStatus === "all" || a.status === selectedStatus;
    const haystack = `${a.name ?? ""} ${a.description ?? ""} ${a.slug}`.toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    return matchesStatus && matchesSearch;
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
              {t("guild.agents.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("guild.agents.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Filters + Agents */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("guild.agents.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                aria-label={t("guild.agents.searchPlaceholder")}
              />
            </div>
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t("guild.agents.allStatuses")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("guild.agents.allStatuses")}</SelectItem>
                {STATUS_KEYS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`guild.agents.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Loading */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
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
          ) : filtered.length === 0 ? (
            /* Empty */
            <div className="text-center py-16">
              <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t("guild.agents.noAgents")}
              </h3>
              <p className="text-muted-foreground">{t("guild.agents.noAgentsDescription")}</p>
            </div>
          ) : (
            /* Agent Cards */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filtered.map((agent) => (
                <Card
                  key={agent.plugin_id}
                  className="hover:shadow-lg transition-shadow flex flex-col"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/agents/${agent.slug}`} className="hover:underline flex-1 min-w-0">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Bot className="h-4 w-4 text-primary shrink-0" />
                          <span className="truncate">{agent.name ?? agent.slug}</span>
                        </CardTitle>
                      </Link>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {t(`guild.agents.status.${agent.status}`)}
                      </Badge>
                    </div>
                    <Badge variant="secondary" className="text-xs w-fit gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      {t(`guild.agents.trust.${agent.trust_tier}`)}
                    </Badge>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col space-y-4">
                    {agent.description && (
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        {agent.description}
                      </p>
                    )}

                    {/* Capabilities */}
                    {agent.capabilities.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {agent.capabilities.slice(0, 4).map((cap) => (
                          <Badge key={cap} variant="outline" className="text-xs font-mono">
                            {cap}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* CTA */}
                    <Button variant="outline" size="sm" className="w-full mt-auto" asChild>
                      <Link to={`/agents/${agent.slug}`}>
                        {t("guild.agents.viewAgent")}
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
