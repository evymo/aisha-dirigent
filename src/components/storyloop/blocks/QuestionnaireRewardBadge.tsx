/**
 * Questionnaire Reward Badge
 * 
 * Displays token reward for completing a questionnaire.
 */

import { useTranslation } from 'react-i18next';
import { Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface QuestionnaireRewardBadgeProps {
  tokenReward: number | null | undefined;
  className?: string;
  showTooltip?: boolean;
}

export function QuestionnaireRewardBadge({ 
  tokenReward, 
  className,
  showTooltip = true,
}: QuestionnaireRewardBadgeProps) {
  const { t } = useTranslation();

  if (!tokenReward || tokenReward <= 0) {
    return null;
  }

  const badge = (
    <Badge 
      variant="secondary" 
      className={cn(
        'gap-1 bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
        className
      )}
    >
      <Coins className="h-3 w-3" />
      +{tokenReward}
    </Badge>
  );

  if (!showTooltip) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {badge}
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('storyloop.tokenRewardTooltip', { amount: tokenReward })}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
