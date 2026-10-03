import { getDateFnsLocale } from "@/lib/i18n/locale";
import {
  Bell,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle,
  ClipboardList,
  Award,
  FileSignature,
  FlaskConical,
  Mail,
  MessageSquare,
  Pill,
  Rocket,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { LucideIcon } from 'lucide-react';

const NOTIFICATION_ICON_MAP: Record<string, { icon: LucideIcon; className: string }> = {
  registration_approved: { icon: CheckCircle, className: 'text-green-500' },
  consultant_approved: { icon: CheckCircle, className: 'text-green-500' },
  registration_rejected: { icon: XCircle, className: 'text-red-500' },
  consultant_rejected: { icon: XCircle, className: 'text-red-500' },
  registration_activated: { icon: Rocket, className: 'text-blue-500' },
  registration_completed: { icon: Award, className: 'text-amber-500' },
  questionnaire_request: { icon: ClipboardList, className: 'text-indigo-500' },
  meeting_request: { icon: Calendar, className: 'text-blue-500' },
  consent_request: { icon: FileSignature, className: 'text-emerald-500' },
  lab_order: { icon: FlaskConical, className: 'text-violet-500' },
  distribution_adjustment: { icon: Pill, className: 'text-amber-500' },
  message: { icon: MessageSquare, className: 'text-primary' },
};

const DEFAULT_NOTIFICATION_ICON = { icon: Mail, className: 'text-muted-foreground' };

function NotificationIcon({ type }: { type: string }) {
  const { icon: Icon, className } = NOTIFICATION_ICON_MAP[type] ?? DEFAULT_NOTIFICATION_ICON;
  return <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', className)} />;
}

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: (notification: Notification) => void;
}

const NotificationItem = ({ notification, onMarkAsRead, onDelete, onClick }: NotificationItemProps) => {
  const { i18n } = useTranslation();
  const locale = getDateFnsLocale(i18n.language);

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer',
        !notification.is_read && 'bg-primary/5'
      )}
      onClick={() => onClick(notification)}
    >
      <NotificationIcon type={notification.type} />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', !notification.is_read && 'text-foreground')}>
          {notification.title}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
          {notification.message}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale })}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        {!notification.is_read && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead(notification.id);
            }}
          >
            <Check className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification.id);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};

export const NotificationCenter = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, deleteNotification } = useNotifications();

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h4 className="font-semibold text-sm">{t('notifications.title')}</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={markAllAsRead}
            >
              <CheckCheck className="h-3 w-3" />
              {t('notifications.markAllRead')}
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {t('notifications.empty')}
            </div>
          ) : (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
                onDelete={deleteNotification}
                onClick={handleNotificationClick}
              />
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};
