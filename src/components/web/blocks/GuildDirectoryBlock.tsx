import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Award,
  ChevronLeft,
  ChevronRight,
  Crown,
  Loader2,
  Search,
  Shield,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useExpertiseAreas } from "@/hooks";
import { useMarketplaceMembers } from "@/hooks/useMarketplace";
import { useCurrency } from "@/hooks/useCurrency";

import type { RuntimeBlockProps } from "@/lib/builder/runtimeBlockRegistry";

const PAGE_SIZE = 12;

const TIER_ICONS: Record<string, typeof Shield> = {
  grandmaster: Crown,
  master: Award,
  journeyman: Shield,
  apprentice: Sparkles,
};

const AVAILABILITY_COLORS: Record<string, string> = {
  available: "bg-green-500",
  limited: "bg-amber-500",
  busy: "bg-red-500",
  unavailable: "bg-gray-400",
};

const SORT_OPTIONS = [
  "relevance",
  "price_asc",
  "price_desc",
  "rating",
  "activity",
] as const;

const AVAILABILITY_OPTIONS = ["available", "limited", "busy"] as const;

/**
 * Runtime block: guild directory / specialist marketplace.
 * Full filter set (search, expertise, sort, availability, instant booking),
 * server-side pagination, and specialist cards with avatar, tier, rating, price.
 */
export default function GuildDirectoryBlock({ config: _config }: RuntimeBlockProps) {
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();

  // Filter state
  const [searchQuery, setSearch] = useState("");
  const [expertiseSlug, setExpertise] = useState("");
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]>("relevance");
  const [availability, setAvailability] = useState("");
  const [instantBooking, setInstantBooking] = useState(false);
  const [page, setPage] = useState(0);

  // Data
  const { data: areas } = useExpertiseAreas();
  const { members, total, isLoading } = useMarketplaceMembers({
    availability: (availability as "available" | "busy" | "away" | "offline") || undefined,
    expertiseSlug: expertiseSlug || undefined,
    instantBooking: instantBooking || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    search: searchQuery || undefined,
    sortBy,
  });

  const totalPages = Math.ceil((total ?? 0) / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Expertise area pills */}
      {areas?.length ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={!expertiseSlug ? "default" : "outline"}
            size="sm"
            onClick={() => { setExpertise(""); setPage(0); }}
          >
            {t("guild.allExpertise")}
          </Button>
          {areas.map((area) => (
            <Button
              key={area.id}
              variant={expertiseSlug === area.slug ? "default" : "outline"}
              size="sm"
              onClick={() => { setExpertise(area.slug); setPage(0); }}
            >
              {t(area.name_key, area.slug)}
              {area.member_count > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs">
                  {area.member_count}
                </Badge>
              )}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("guild.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <Select value={sortBy} onValueChange={(v) => { setSortBy(v as typeof sortBy); setPage(0); }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`guild.sort.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={availability || "all"}
          onValueChange={(v) => { setAvailability(v === "all" ? "" : v); setPage(0); }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("guild.allAvailability")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("guild.allAvailability")}</SelectItem>
            {AVAILABILITY_OPTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`guild.availability.${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id="instant-booking"
            checked={instantBooking}
            onCheckedChange={(v) => { setInstantBooking(v); setPage(0); }}
          />
          <Label htmlFor="instant-booking" className="text-sm whitespace-nowrap">
            <Zap className="inline h-3.5 w-3.5 mr-1 text-amber-500" />
            {t("guild.instantBooking")}
          </Label>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !members?.length ? (
        <div className="text-center py-12 text-muted-foreground">
          {t("guild.emptyState")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {members.map((member) => {
            const TierIcon = TIER_ICONS[member.guild_tier ?? ""] ?? Shield;
            const availDot = AVAILABILITY_COLORS[member.availability_status ?? ""] ?? "bg-gray-400";

            return (
              <Card key={member.id} className="group hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  {/* Header: avatar + name + tier */}
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={member.avatar_url ?? undefined} />
                        <AvatarFallback>
                          {(member.display_name ?? "?").slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-background ${availDot}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                        {member.display_name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <TierIcon className="h-3.5 w-3.5" />
                        <span className="capitalize">{member.guild_tier ?? "—"}</span>
                        {member.avg_rating != null && (
                          <>
                            <span className="mx-1">·</span>
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            <span>{member.avg_rating.toFixed(1)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {member.instant_booking_enabled && (
                      <Badge variant="outline" className="flex-shrink-0">
                        <Zap className="h-3 w-3 mr-1 text-amber-500" />
                        {t("guild.instant")}
                      </Badge>
                    )}
                  </div>

                  {/* Bio */}
                  {member.bio && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {member.bio}
                    </p>
                  )}

                  {/* Expertise tags */}
                  {member.expertise?.length ? (
                    <div className="flex flex-wrap gap-1">
                      {member.expertise.slice(0, 4).map((exp) => (
                        <Badge key={exp.slug} variant="outline" className="text-xs">
                          {exp.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {/* Price + CTA */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="text-sm">
                      {member.hourly_rate != null ? (
                        <span className="font-medium">
                          {formatPrice(member.hourly_rate)}
                          <span className="text-muted-foreground font-normal">
                            {" "}/ {t("guild.hour")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("guild.priceOnRequest")}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Link to={`/guild/${member.id}`}>
                        <Button variant="outline" size="sm">
                          {t("guild.viewProfile")}
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
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
            onClick={() => setPage((p) => p + 1)}
          >
            {t("common.next")}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
