/**
 * StoryKnowledgeContext — collapsible widget showing relevant expert rules
 * for the current story. Integrates into StoryLoop sidebar / detail view.
 *
 * Fetches rules matching the story's context tags + user's subscriptions
 * using the `get_story_knowledge_context` RPC.
 *
 * @module components/storyloop/StoryKnowledgeContext
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  BookOpen,
  ChevronDown,
  Star,
  ExternalLink,
  Bot,
  Tag,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStoryKnowledgeContext } from "@/hooks/useExpertRules";

interface StoryKnowledgeContextProps {
  /** Current story UUID */
  storyId: string;
  /** Optional tags derived from the story for matching rules */
  contextTags?: string[];
  /** When true, the widget starts expanded */
  defaultOpen?: boolean;
}

/**
 * Renders relevant expert rules for a story context.
 *
 * @example
 * <StoryKnowledgeContext storyId={storyId} contextTags={["react", "testing"]} />
 */
export function StoryKnowledgeContext({
  storyId,
  contextTags,
  defaultOpen = false,
}: StoryKnowledgeContextProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const { data: rules, isLoading } = useStoryKnowledgeContext(storyId, contextTags);

  const ruleCount = rules?.length ?? 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-muted/50 transition-colors border-b border-border">
          <span className="flex items-center gap-2 font-medium text-foreground">
            <BookOpen className="h-4 w-4 text-primary" />
            {t("guild.storyContext.title")}
            {ruleCount > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {ruleCount}
              </Badge>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 py-3 bg-muted/20 border-b border-border">
          {/* Loading */}
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded" />
              <Skeleton className="h-16 w-full rounded" />
            </div>
          )}

          {/* Empty */}
          {!isLoading && ruleCount === 0 && (
            <div className="text-center py-4 text-xs text-muted-foreground">
              <Sparkles className="h-5 w-5 mx-auto mb-1.5 opacity-50" />
              <p>{t("guild.storyContext.noRules")}</p>
              <Button variant="link" size="sm" asChild className="mt-1 text-xs">
                <Link to="/rules">{t("guild.storyContext.browseRules")}</Link>
              </Button>
            </div>
          )}

          {/* Rule cards */}
          {rules && rules.length > 0 && (
            <div className="space-y-2">
              {rules.map((rule) => (
                <Card
                  key={rule.id}
                  className="bg-background/80 border-border/50"
                >
                  <CardHeader className="p-3 pb-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm font-medium leading-tight">
                        <Link
                          to={`/rules/${rule.slug}`}
                          className="hover:underline flex items-center gap-1.5"
                        >
                          {rule.title}
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                        </Link>
                      </CardTitle>
                      {rule.relevance_score != null && rule.relevance_score >= 80 && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge
                              variant="default"
                              className="text-[10px] px-1 py-0 shrink-0"
                            >
                              <Star className="h-2.5 w-2.5 mr-0.5" />
                              {t("guild.storyContext.highRelevance")}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("guild.storyContext.relevanceTooltip", {
                              score: rule.relevance_score,
                            })}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    {rule.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                        {rule.summary}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        <Tag className="h-2.5 w-2.5 mr-0.5" />
                        {t(`guild.category.${rule.category}`)}
                      </Badge>
                      {rule.has_ai_instructions && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5"
                            >
                              <Bot className="h-2.5 w-2.5 mr-0.5" />
                              AI
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("guild.storyContext.hasAiInstructions")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {rule.author_display_name && (
                        <span className="text-[10px] text-muted-foreground">
                          {rule.author_display_name}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Link to browse more */}
              <div className="text-center pt-1">
                <Button variant="link" size="sm" asChild className="text-xs">
                  <Link to="/rules">{t("guild.storyContext.seeAll")}</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
