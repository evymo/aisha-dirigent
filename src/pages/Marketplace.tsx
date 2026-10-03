/**
 * Marketplace page — browse specialists with pricing, ratings, and booking.
 *
 * @module pages/Marketplace
 */

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useExpertiseAreas } from "@/hooks/useGuild";
import { useMarketplaceMembers, type MarketplaceFilters } from "@/hooks/useMarketplace";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Search,
  Users,
  Star,
  Clock,
  Zap,
  Shield,
  Award,
  Crown,
  Sparkles,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Database } from "@/integrations/db/types";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

/** Map guild tier to icon config */
const tierConfig: Record<
  string,
  {
    icon: typeof Crown;
    labelKey: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  grandmaster: { icon: Crown, labelKey: "guild.tier.grandmaster", variant: "default" },
  master: { icon: Award, labelKey: "guild.tier.master", variant: "default" },
  journeyman: { icon: Shield, labelKey: "guild.tier.journeyman", variant: "secondary" },
  apprentice: { icon: Sparkles, labelKey: "guild.tier.apprentice", variant: "outline" },
};

const availabilityConfig: Record<string, { color: string; key: string }> = {
  available: { color: "bg-green-500", key: "guild.marketplace.card.available" },
  limited: { color: "bg-yellow-500", key: "guild.marketplace.card.limited" },
  busy: { color: "bg-orange-500", key: "guild.marketplace.card.busy" },
  unavailable: { color: "bg-red-500", key: "guild.marketplace.card.unavailable" },
};

const PAGE_SIZE = 12;

export default function Marketplace() {
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExpertise, setSelectedExpertise] = useState<string>("all");
  const [sortBy, setSortBy] = useState<MarketplaceFilters["sortBy"]>("relevance");
  const [instantBookingOnly, setInstantBookingOnly] = useState(false);
  const [availability, setAvailability] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: expertiseAreas } = useExpertiseAreas();

  const filters: MarketplaceFilters = {
    expertiseSlug: selectedExpertise === "all" ? undefined : selectedExpertise,
    search: searchQuery || undefined,
    sortBy,
    instantBooking: instantBookingOnly || undefined,
    availability: availability === "all" ? undefined : (availability as AvailabilityStatus),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { members, total, isLoading } = useMarketplaceMembers(filters);
  const totalPages = Math.ceil(total / PAGE_SIZE);

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
              {t("guild.marketplace.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("guild.marketplace.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Expertise Area Chips */}
      {expertiseAreas && expertiseAreas.length > 0 && (
        <section className="py-6 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => {
                  setSelectedExpertise("all");
                  setPage(0);
                }}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  selectedExpertise === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t("guild.directory.allExpertise")}
              </button>
              {expertiseAreas.map((area) => (
                <button
                  key={area.id}
                  onClick={() => {
                    setSelectedExpertise(
                      area.slug === selectedExpertise ? "all" : area.slug
                    );
                    setPage(0);
                  }}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    selectedExpertise === area.slug
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <span>{t(area.name_key)}</span>
                  <Badge variant="outline" className="h-5 text-xs">
                    {area.member_count}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Filters + Grid */}
      <section className="py-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Filter Row */}
          <div className="flex flex-col lg:flex-row gap-4 mb-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("guild.directory.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                className="pl-10"
              />
            </div>

            <Select
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v as MarketplaceFilters["sortBy"]);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full lg:w-[200px]">
                <SelectValue placeholder={t("guild.marketplace.filters.sortBy")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="relevance">
                  {t("guild.marketplace.filters.sortRelevance")}
                </SelectItem>
                <SelectItem value="price_asc">
                  {t("guild.marketplace.filters.sortPriceAsc")}
                </SelectItem>
                <SelectItem value="price_desc">
                  {t("guild.marketplace.filters.sortPriceDesc")}
                </SelectItem>
                <SelectItem value="rating">
                  {t("guild.marketplace.filters.sortRating")}
                </SelectItem>
                <SelectItem value="activity">
                  {t("guild.marketplace.filters.sortActivity")}
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={availability}
              onValueChange={(v) => {
                setAvailability(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-full lg:w-[200px]">
                <SelectValue placeholder={t("guild.marketplace.filters.availability")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("guild.directory.allExpertise")}
                </SelectItem>
                <SelectItem value="available">
                  {t("guild.marketplace.card.available")}
                </SelectItem>
                <SelectItem value="limited">
                  {t("guild.marketplace.card.limited")}
                </SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Switch
                id="instant-booking"
                checked={instantBookingOnly}
                onCheckedChange={(v) => {
                  setInstantBookingOnly(v);
                  setPage(0);
                }}
              />
              <Label htmlFor="instant-booking" className="text-sm whitespace-nowrap">
                <Zap className="inline h-3.5 w-3.5 mr-1 text-yellow-500" />
                {t("guild.marketplace.filters.instantBooking")}
              </Label>
            </div>
          </div>

          {/* Loading */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-16">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t("guild.marketplace.noResults")}
              </h3>
              <p className="text-muted-foreground">
                {t("guild.marketplace.noResultsDescription")}
              </p>
            </div>
          ) : (
            <>
              {/* Results count */}
              <p className="text-sm text-muted-foreground mb-6">
                {total} {t("guild.marketplace.card.completedProjects", { count: total }).split(" ").slice(-1)}
              </p>

              {/* Member Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {members.map((member) => {
                  const tier = member.guild_tier
                    ? tierConfig[member.guild_tier]
                    : null;
                  const TierIcon = tier?.icon ?? Users;
                  const avail = member.availability_status
                    ? availabilityConfig[member.availability_status]
                    : null;

                  return (
                    <Card
                      key={member.id}
                      className="hover:shadow-lg transition-shadow flex flex-col"
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <Link
                            to={`/guild/${member.id}`}
                            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                          >
                            <Avatar className="h-12 w-12">
                              <AvatarImage
                                src={member.avatar_url ?? undefined}
                                alt={member.display_name}
                              />
                              <AvatarFallback>
                                {member.display_name.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <CardTitle className="text-lg">
                                {member.display_name}
                              </CardTitle>
                              {avail && (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span
                                    className={`h-2 w-2 rounded-full ${avail.color}`}
                                  />
                                  <span className="text-xs text-muted-foreground">
                                    {t(avail.key)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </Link>
                          {tier && (
                            <Badge variant={tier.variant} className="gap-1">
                              <TierIcon className="h-3 w-3" />
                              {t(tier.labelKey)}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="flex-1 space-y-4">
                        {/* Bio snippet */}
                        {member.bio && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {member.bio}
                          </p>
                        )}

                        {/* Pricing + Stats row */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-3">
                            {member.hourly_rate != null && (
                              <span className="font-semibold text-foreground">
                                {formatPrice(member.hourly_rate)}/{t("guild.marketplace.card.hour")}
                              </span>
                            )}
                            {member.min_block_hours != null && (
                              <span className="text-muted-foreground">
                                {t("guild.marketplace.card.minBlock", {
                                  hours: member.min_block_hours,
                                })}
                              </span>
                            )}
                          </div>
                          {member.instant_booking_enabled && (
                            <Badge variant="outline" className="gap-1">
                              <Zap className="h-3 w-3 text-yellow-500" />
                              {t("guild.marketplace.card.instantBooking")}
                            </Badge>
                          )}
                        </div>

                        {/* Rating + Projects */}
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {member.avg_rating != null && member.avg_rating > 0 ? (
                            <div className="flex items-center gap-1">
                              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                              <span className="font-medium text-foreground">
                                {member.avg_rating.toFixed(1)}
                              </span>
                              <span>({member.total_ratings_count})</span>
                            </div>
                          ) : (
                            <span className="text-xs italic">
                              {t("guild.marketplace.card.noRating")}
                            </span>
                          )}
                          {member.completed_projects_count != null &&
                            member.completed_projects_count > 0 && (
                              <div className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {t("guild.marketplace.card.completedProjects", {
                                  count: member.completed_projects_count,
                                })}
                              </div>
                            )}
                        </div>

                        {/* Expertise tags */}
                        {member.expertise.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {member.expertise.slice(0, 4).map((exp) => (
                              <Badge key={exp.slug} variant="secondary" className="text-xs">
                                {exp.name}
                              </Badge>
                            ))}
                            {member.expertise.length > 4 && (
                              <Badge variant="outline" className="text-xs">
                                +{member.expertise.length - 4}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-2">
                          <Button asChild variant="default" size="sm" className="flex-1">
                            <Link to={`/guild/${member.id}?book=true`}>
                              {t("guild.marketplace.card.bookNow")}
                              <ArrowRight className="h-4 w-4 ml-1" />
                            </Link>
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <Link to={`/guild/${member.id}`}>
                              {t("guild.marketplace.card.viewProfile")}
                            </Link>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-10">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
