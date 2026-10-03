/**
 * Guild Member Profile page — detailed view of a guild expert with booking.
 *
 * @module pages/GuildMemberProfile
 */

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useGuildMemberDetail } from "@/hooks/useGuild";
import { BookingDialog } from "@/components/marketplace/BookingDialog";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Star,
  BookOpen,
  Globe,
  MapPin,
  Shield,
  Award,
  Crown,
  Sparkles,
  Users,
  ExternalLink,
  Calendar,
} from "lucide-react";

/** Proficiency level labels */
const proficiencyKeys = [
  "guild.proficiency.beginner",
  "guild.proficiency.intermediate",
  "guild.proficiency.advanced",
  "guild.proficiency.expert",
  "guild.proficiency.authority",
];

export default function GuildMemberProfile() {
  const { t } = useTranslation();
  const { memberId } = useParams<{ memberId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: member, isLoading } = useGuildMemberDetail(memberId);
  const [bookingOpen, setBookingOpen] = useState(false);

  // Auto-open booking dialog when ?book=true
  useEffect(() => {
    if (searchParams.get("book") === "true" && member) {
      setBookingOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [member, searchParams, setSearchParams]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
          <Skeleton className="h-8 w-32 mb-8" />
          <div className="flex items-center gap-6 mb-8">
            <Skeleton className="h-24 w-24 rounded-full" />
            <div className="space-y-3 flex-1">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-5 w-1/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
        <Footer />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-medium mb-2">{t("guild.memberNotFound")}</h2>
          <Button variant="outline" asChild>
            <Link to="/guild">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {t("guild.backToDirectory")}
            </Link>
          </Button>
        </div>
        <Footer />
      </div>
    );
  }

  const TierIcon =
    member.guild_tier === "grandmaster"
      ? Crown
      : member.guild_tier === "master"
        ? Award
        : member.guild_tier === "journeyman"
          ? Shield
          : Sparkles;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <div className="pt-32 pb-16 container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
        {/* Back */}
        <Button variant="ghost" size="sm" asChild className="mb-8">
          <Link to="/guild">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("guild.backToDirectory")}
          </Link>
        </Button>

        {/* Member Header */}
        <div className="flex flex-col sm:flex-row items-start gap-6 mb-10">
          <Avatar className="h-24 w-24">
            <AvatarImage src={member.avatar_url ?? undefined} alt={member.display_name ?? ""} />
            <AvatarFallback className="text-2xl">
              {(member.display_name ?? "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {member.display_name}
              </h1>
              {member.guild_tier && (
                <Badge variant="default" className="gap-1 text-sm">
                  <TierIcon className="h-4 w-4" />
                  {t(`guild.tier.${member.guild_tier}`)}
                </Badge>
              )}
            </div>
            {member.business_name && (
              <p className="text-lg text-muted-foreground mb-1">{member.business_name}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {member.city && member.country && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {member.city}, {member.country}
                </span>
              )}
              {member.website && (
                <a
                  href={member.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-primary hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {t("guild.website")}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {/* Book CTA */}
            <Button
              size="lg"
              onClick={() => setBookingOpen(true)}
              className="mt-4 gap-2"
            >
              <Calendar className="h-4 w-4" />
              {t("guild.marketplace.card.bookNow")}
            </Button>
          </div>
        </div>

        {/* Guild Bio */}
        {member.guild_bio && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>{t("guild.about")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground whitespace-pre-line">{member.guild_bio}</p>
            </CardContent>
          </Card>
        )}

        {/* Expertise Areas */}
        {member.expertise_areas.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                {t("guild.expertiseAreasTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {member.expertise_areas.map((ea) => (
                  <div
                    key={ea.id}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border"
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{t(ea.name_key)}</span>
                        {ea.is_primary && (
                          <Badge variant="default" className="text-xs">
                            {t("guild.primary")}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {t(proficiencyKeys[ea.proficiency_level - 1] ?? proficiencyKeys[0])}
                        {ea.years_experience != null && ` — ${t("guild.yearsExp", { count: ea.years_experience })}`}
                      </span>
                      {ea.description && (
                        <p className="text-sm text-muted-foreground mt-1">{ea.description}</p>
                      )}
                    </div>
                    {/* Proficiency dots */}
                    <div className="flex gap-0.5 pt-1">
                      {[1, 2, 3, 4, 5].map((level) => (
                        <div
                          key={level}
                          className={`h-2 w-2 rounded-full ${
                            level <= ea.proficiency_level ? "bg-primary" : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Published Rules */}
        {member.published_rules.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                {t("guild.publishedRules")} ({member.published_rules.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {member.published_rules.map((rule) => (
                  <Link
                    key={rule.id}
                    to={`/rules/${rule.slug}`}
                    className="block p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-foreground">{rule.title}</h3>
                      <Badge variant="outline" className="text-xs ml-2 shrink-0">
                        {t(`guild.category.${rule.category}`)}
                      </Badge>
                    </div>
                    {rule.summary && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
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
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Booking Dialog */}
      {member && (
        <BookingDialog
          specialistId={member.id}
          specialistName={member.display_name ?? t("guild.anonymous")}
          hourlyRate={null}
          minBlockHours={null}
          instantBooking={false}
          open={bookingOpen}
          onOpenChange={setBookingOpen}
        />
      )}

      <Footer />
    </div>
  );
}
