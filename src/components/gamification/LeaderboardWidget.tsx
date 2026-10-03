import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal, Award, ChevronRight } from "lucide-react";
import { useLeaderboard, useMyLeaderboardPosition } from "@/hooks/useLeaderboard";
import { getInitials } from "@/lib/utils/nameFormatting";
import { cn } from "@/lib/utils";

interface LeaderboardWidgetProps {
  className?: string;
  limit?: number;
  showViewAll?: boolean;
}

const rankIcons = {
  1: Trophy,
  2: Medal,
  3: Award,
};

const rankColors = {
  1: "text-amber-500",
  2: "text-slate-400",
  3: "text-amber-700",
};

export function LeaderboardWidget({ 
  className, 
  limit = 5,
  showViewAll = true 
}: LeaderboardWidgetProps) {
  const { t } = useTranslation();
  const { data: entries, isLoading } = useLeaderboard("all", limit);
  const { data: myPosition } = useMyLeaderboardPosition();

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            {t("gamification.leaderboard.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-6 h-6 rounded-full" />
              <Skeleton className="w-8 h-8 rounded-full" />
              <Skeleton className="flex-1 h-4" />
              <Skeleton className="w-12 h-4" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            {t("gamification.leaderboard.title")}
          </CardTitle>
          {myPosition && myPosition.isInLeaderboard && (
            <Badge variant="secondary" className="text-xs">
              {t("gamification.leaderboard.yourRank")}: #{myPosition.leaderboardRank}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {entries && entries.length > 0 ? (
          <>
            {entries.map((entry) => {
              const RankIcon = rankIcons[entry.rank as keyof typeof rankIcons];
              const rankColor = rankColors[entry.rank as keyof typeof rankColors];
              
              return (
                <div
                  key={entry.rank}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg transition-colors",
                    entry.isCurrentUser && "bg-primary/10 border border-primary/20"
                  )}
                >
                  <div className="w-6 flex justify-center">
                    {RankIcon ? (
                      <RankIcon className={cn("w-5 h-5", rankColor)} />
                    ) : (
                      <span className="text-sm font-medium text-muted-foreground">
                        {entry.rank}
                      </span>
                    )}
                  </div>
                  
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={entry.avatarUrl || undefined} />
                    <AvatarFallback className="text-xs">
                      {getInitials(entry.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  
                  <span className={cn(
                    "flex-1 text-sm truncate",
                    entry.isCurrentUser && "font-medium"
                  )}>
                    {entry.displayName}
                    {entry.isCurrentUser && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({t("gamification.leaderboard.you")})
                      </span>
                    )}
                  </span>
                  
                  <span className="text-sm font-medium tabular-nums">
                    {entry.totalTokens.toLocaleString()}
                  </span>
                </div>
              );
            })}
            
            {showViewAll && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2"
                asChild
              >
                <Link to="/member/leaderboard">
                  {t("common.viewAll")}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            )}
          </>
        ) : (
          <div className="text-center py-4 text-muted-foreground text-sm">
            {t("gamification.leaderboard.empty")}
          </div>
        )}
        
        {myPosition && !myPosition.isInLeaderboard && (
          <div className="text-center pt-2 border-t text-xs text-muted-foreground">
            {t("gamification.leaderboard.notRanked")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
