/**
 * Guild Directory page — browse guild experts with marketplace features.
 *
 * Combines guild expertise browsing with marketplace pricing, ratings,
 * availability status, and booking CTAs.
 *
 * @module pages/GuildDirectory
 */

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
  BookOpen,
  Shield,
  Award,
  Crown,
  Sparkles,
  ArrowRight,
  Clock,
  Zap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Database } from "@/integrations/db/types";

type AvailabilityStatus = Database["public"]["Enums"]["availability_status"];

/** Map guild tier to icon + label */
const tierConfig: Record<string, { icon: typeof Crown; labelKey: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
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

export default function GuildDirectory() {
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExpertise, setSelectedExpertise] = useState<string>("all");
  const [sortBy, setSortBy] = useState<MarketplaceFilters["sortBy"]>("relevance");
  const [instantBookingOnly, setInstantBookingOnly] = useState(false);
  const [availability, setAvailability] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: expertiseAreas, isLoading: areasLoading } = useExpertiseAreas();

  const filters: MarketplaceFilters = {
    expertiseSlug: selectedExpertise === "all" ? undefined : selectedExpertise,
    search: searchQuery || undefined,
    sortBy,
    instantBooking: instantBookingOnly || undefined,
    availability: availability === "all" ? undefined : (availability as AvailabilityStatus),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const { members, total, isLoading: membersLoading } = useMarketplaceMembers(filters);
  const isLoading = areasLoading || membersLoading;
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
              {t("guild.directory.title")}
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              {t("guild.directory.subtitle")}
            </p>
          </div>
        </div>
      </section>

      {/* Expertise Areas Chips */}
      {!areasLoading && expertiseAreas && expertiseAreas.length > 0 && (
        <section className="py-8 border-b border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap gap-3">
              {expertiseAreas.map((area) => (
                <button
                  key={area.id}
                  onClick={() => setSelectedExpertise(area.slug === selectedExpertise ? "all" : area.slug)}
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

      {/* Filters + Member Grid */}
      <section className="py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Search + Filters */}
          <div className="flex flex-col gap-4 mb-8">
            {/* Row 1: Search + Expertise */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t("guild.directory.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                  className="pl-10"
                />
              </div>
              <Select value={selectedExpertise} onValueChange={(v) => { setSelectedExpertise(v); setPage(0); }}>
                <SelectTrigger className="w-full sm:w-[240px]">
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
            {/* Row 2: Sort + Availability + Instant Booking */}
            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <Select value={sortBy ?? "relevance"} onValueChange={(v) => setSortBy(v as MarketplaceFilters["sortBy"])}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder={t("guild.marketplace.filters.sortBy")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">{t("guild.marketplace.filters.sortRelevance")}</SelectItem>
                  <SelectItem value="price_asc">{t("guild.marketplace.filters.sortPriceAsc")}</SelectItem>
                  <SelectItem value="price_desc">{t("guild.marketplace.filters.sortPriceDesc")}</SelectItem>
                  <SelectItem value="rating">{t("guild.marketplace.filters.sortRating")}</SelectItem>
                  <SelectItem value="activity">{t("guild.marketplace.filters.sortActivity")}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={availability} onValueChange={(v) => { setAvailability(v); setPage(0); }}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder={t("guild.marketplace.filters.availability")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("guild.marketplace.filters.allAvailability")}</SelectItem>
                  <SelectItem value="available">{t("guild.marketplace.card.available")}</SelectItem>
                  <SelectItem value="limited">{t("guild.marketplace.card.limited")}</SelectItem>
                  <SelectItem value="busy">{t("guild.marketplace.card.busy")}</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Switch
                  id="instant-booking"
                  checked={instantBookingOnly}
                  onCheckedChange={(v) => { setInstantBookingOnly(v); setPage(0); }}
                />
                <Label htmlFor="instant-booking" className="text-sm whitespace-nowrap flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 text-yellow-500" />
                  {t("guild.marketplace.filters.instantBooking")}
                </Label>
              </div>
            </div>
          </div>

          {/* Loading */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map((i) => (
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
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !members || members.length === 0 ? (
            /* Empty State */
            <div className="text-center py-16">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {t("guild.directory.noMembers")}
              </h3>
              <p className="text-muted-foreground">
                {t("guild.directory.noMembersDescription")}
              </p>
            </div>
          ) : (
            <>
              {/* Member Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {members.map((member) => {
                  const tier = member.guild_tier ? tierConfig[member.guild_tier] : null;
                  const TierIcon = tier?.icon ?? Users;
                  const avail = member.availability_status
                    ? availabilityConfig[member.availability_status]
                    : null;

                  return (
                    <Card key={member.id} className="hover:shadow-lg transition-shadow">
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <Link
                            to={`/guild/${member.id}`}
                            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                          >
                            <div className="relative">
                              <Avatar className="h-12 w-12">
                                <AvatarImage src={member.avatar_url ?? undefined} alt={member.display_name ?? ""} />
                                <AvatarFallback>
                                  {(member.display_name ?? "?").charAt(0).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              {/* Availability dot */}
                              {avail && (
                                <span
                                  className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background ${avail.color}`}
                                  title={t(avail.key)}
                                />
                              )}
                            </div>
                            <div>
                              <CardTitle className="text-lg">{member.display_name ?? t("guild.anonymous")}</CardTitle>
                              {/* Rating */}
                              {member.avg_rating != null && member.total_ratings_count != null && member.total_ratings_count > 0 && (
                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                                  <span>{member.avg_rating.toFixed(1)}</span>
                                  <span className="text-xs">({member.total_ratings_count})</span>
                                </div>
                              )}
                            </div>
                          </Link>
                          <div className="flex flex-col items-end gap-1">
                            {tier && (
                              <Badge variant={tier.variant} className="gap-1">
                                <TierIcon className="h-3 w-3" />
                                {t(tier.labelKey)}
                              </Badge>
                            )}
                            {member.instant_booking_enabled && (
                              <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-300">
                                <Zap className="h-3 w-3" />
                                {t("guild.marketplace.card.instantBooking")}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Bio snippet */}
                        {member.bio && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {member.bio}
                          </p>
                        )}

                        {/* Expertise tags */}
                        {member.expertise.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {member.expertise.slice(0, 4).map((ea) => (
                              <Badge key={ea.slug} variant="outline" className="text-xs">
                                {ea.name}
                              </Badge>
                            ))}
                            {member.expertise.length > 4 && (
                              <Badge variant="outline" className="text-xs">
                                +{member.expertise.length - 4}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Pricing + Stats row */}
                        <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                          {member.hourly_rate != null ? (
                            <span className="font-semibold text-foreground">
                              {formatPrice(member.hourly_rate)}{" / "}{t("guild.marketplace.card.hour")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">
                              {t("guild.marketplace.card.priceOnRequest")}
                            </span>
                          )}
                          {member.min_block_hours != null && member.min_block_hours > 1 && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {t("guild.marketplace.card.minBlock", { hours: member.min_block_hours })}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" asChild>
                            <Link to={`/guild/${member.id}`}>
                              {t("guild.viewProfile")}
                              <ArrowRight className="h-4 w-4 ml-2" />
                            </Link>
                          </Button>
                          <Button size="sm" className="flex-1" asChild>
                            <Link to={`/guild/${member.id}?book=true`}>
                              {t("guild.marketplace.card.bookNow")}
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
                <div className="flex items-center justify-center gap-4 mt-8">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    {t("common.next")}
                    <ChevronRight className="h-4 w-4 ml-1" />
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
