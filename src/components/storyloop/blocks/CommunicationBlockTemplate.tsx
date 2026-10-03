/**
 * Shared StoryLoop block template for communication events.
 *
 * Keeps event blocks consistent while allowing each event to provide
 * its own body details and action handlers.
 */

import type { ReactNode } from 'react';
import type { ButtonProps } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface CommunicationBlockStatus {
  label: string;
  className?: string;
  icon?: ReactNode;
}

export interface CommunicationBlockAction {
  id: string;
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  disabled?: boolean;
}

interface CommunicationBlockTemplateProps {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  cardClassName?: string;
  status?: CommunicationBlockStatus;
  headerAside?: ReactNode;
  body?: ReactNode;
  actions?: CommunicationBlockAction[];
  actionContainerClassName?: string;
}

/**
 * Canonical layout used by StoryLoop event blocks.
 */
export function CommunicationBlockTemplate({
  icon,
  title,
  subtitle,
  cardClassName,
  status,
  headerAside,
  body,
  actions = [],
  actionContainerClassName,
}: CommunicationBlockTemplateProps) {
  return (
    <Card className={cn('border', cardClassName)}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-md bg-background p-1.5">{icon}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{title}</p>
              {subtitle ? (
                <div className="text-xs text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {headerAside}
            {status ? (
              <Badge variant="outline" className={cn('text-xs', status.className)}>
                {status.icon ? <span className="mr-1 inline-flex">{status.icon}</span> : null}
                {status.label}
              </Badge>
            ) : null}
          </div>
        </div>

        {body ? <div className="mt-3 space-y-3">{body}</div> : null}

        {actions.length > 0 ? (
          <div className={cn('mt-3 flex flex-wrap items-center gap-2', actionContainerClassName)}>
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant={action.variant ?? 'outline'}
                size={action.size ?? 'sm'}
                className={action.className}
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.icon ? <span className="mr-1 inline-flex">{action.icon}</span> : null}
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
