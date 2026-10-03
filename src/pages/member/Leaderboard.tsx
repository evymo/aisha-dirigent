import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trophy, Medal, Award, ArrowLeft, Settings } from "lucide-react";
import { useLeaderboard, useMyLeaderboardPosition, type TokenTypeFilter } from "@/hooks/useLeaderboard";
import { getInitials } from "@/lib/utils/nameFormatting";
import { cn } from "@/lib/utils";

const rankIcons = {
  1: Trophy,
  2: Medal,
  3: Award,
};

const rankColors = {
  1: "text-amber-500 bg-amber-500/10",
  2: "text-slate-400 bg-slate-400/10",
  3: "text-amber-700 bg-amber-700/10",
};

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const [tokenType, setTokenType] = useState<TokenTypeFilter>("all");
  const { data: entries, isLoading } = useLeaderboard(tokenType, 50);
  const { data: myPosition } = useMyLeaderboardPosition(tokenType);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      
      <main className="flex-1 py-12 pt-24">
        <div className="container max-w-3xl mx-auto px-4">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/member">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
                <Trophy className="w-6 h-6 text-amber-500" />
                {t("gamification.leaderboard.title")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t("gamification.leaderboard.subtitle")}
              </p>
            </div>
          </div>

          {/* My Position Card */}
          {myPosition && (
            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("gamification.leaderboard.yourRank")}
                    </p>
                    <p className="text-3xl font-bold">
                      {myPosition.isInLeaderboard ? (
                        <>#{myPosition.leaderboardRank}</>
                      ) : (
                        <span className="text-muted-foreground text-lg">
                          {t("gamification.leaderboard.notRanked")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {t("gamification.leaderboard.allTokens")}
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">
                      {myPosition.totalTokens.toLocaleString()}
                    </p>
                  </div>
                </div>
                
                {!myPosition.isInLeaderboard && (
                  <Alert className="mt-4">
                    <AlertDescription className="flex items-center justify-between">
                      <span>{t("gamification.leaderboard.enableInSettings")}</span>
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/member/profile">
                          <Settings className="w-4 h-4 mr-1" />
                          {t("common.settings")}
                        </Link>
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {/* Token Type Filter */}
          <Tabs
            value={tokenType}
            onValueChange={(v) => setTokenType(v as TokenTypeFilter)}
            className="mb-6"
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">{t("gamification.leaderboard.filter.all")}</TabsTrigger>
              <TabsTrigger value="governance">{t("gamification.leaderboard.filter.governance")}</TabsTrigger>
              <TabsTrigger value="impact">{t("gamification.leaderboard.filter.impact")}</TabsTrigger>
              <TabsTrigger value="data">{t("gamification.leaderboard.filter.data")}</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Leaderboard */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {t("gamification.leaderboard.subtitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 p-3">
                      <Skeleton className="w-8 h-8 rounded-full" />
                      <Skeleton className="w-10 h-10 rounded-full" />
                      <Skeleton className="flex-1 h-5" />
                      <Skeleton className="w-16 h-5" />
                    </div>
                  ))}
                </div>
              ) : entries && entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map((entry) => {
                    const RankIcon = rankIcons[entry.rank as keyof typeof rankIcons];
                    const rankStyle = rankColors[entry.rank as keyof typeof rankColors];
                    
                    return (
                      <div
                        key={entry.rank}
                        className={cn(
                          "flex items-center gap-4 p-3 rounded-lg transition-colors",
                          entry.isCurrentUser && "bg-primary/10 border border-primary/20",
                          entry.rank <= 3 && !entry.isCurrentUser && "bg-muted/50"
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 flex items-center justify-center rounded-full",
                          rankStyle
                        )}>
                          {RankIcon ? (
                            <RankIcon className="w-5 h-5" />
                          ) : (
                            <span className="text-sm font-bold">
                              {entry.rank}
                            </span>
                          )}
                        </div>
                        
                        <Avatar className="w-10 h-10">
                          <AvatarImage src={entry.avatarUrl || undefined} />
                          <AvatarFallback>
                            {getInitials(entry.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            "font-medium truncate",
                            entry.isCurrentUser && "text-primary"
                          )}>
                            {entry.displayName}
                            {entry.isCurrentUser && (
                              <Badge variant="secondary" className="ml-2 text-xs">
                                {t("common.you")}
                              </Badge>
                            )}
                          </p>
                          <div className="flex gap-3 text-xs text-muted-foreground">
                            <span>
                              {t("gamification.tokens.governanceShortWithValue", { value: entry.governanceTokens })}
                            </span>
                            <span>
                              {t("gamification.tokens.impactShortWithValue", { value: entry.impactTokens })}
                            </span>
                            <span>
                              {t("gamification.tokens.dataShortWithValue", { value: entry.dataTokens })}
                            </span>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <p className="font-bold tabular-nums">
                            {entry.totalTokens.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("gamification.tokens.total")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  {t("gamification.leaderboard.empty")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
      
      <Footer />
    </div>
  );
}
