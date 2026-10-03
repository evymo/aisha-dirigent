/**
 * AdminActivityCard
 *
 * Renders a single admin activity feed item as a card.
 * Each card shows member context (non-sensitive) and inline action buttons
 * relevant to the pending action type.
 */

import { BASE_CURRENCY_FALLBACK } from "@/lib/currency/constants";
import { useCallback } from "react";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  CreditCard,
  UserX,
  FlaskConical,
  DollarSign,
  UserCheck,
  AlertTriangle,
  Shield,
  ShoppingBag,
  CheckCircle,
  XCircle,
  Eye,
  Clock,
} from "lucide-react";
import type { ActivityFeedItem, ActivityFeedItemType } from "@/hooks/useAdminActivityFeed";
import { useAdminActivityActions } from "@/hooks/useAdminActivityFeed";
import { formatDistanceToNow } from "date-fns";
interface AdminActivityCardProps {
  item: ActivityFeedItem;
}

const TYPE_CONFIG: Record<
  ActivityFeedItemType,
  {
    colorClass: string;
    icon: React.ElementType;
    labelKey: string;
  }
> = {
  subscription_pending: {
    colorClass: "bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800",
    icon: CreditCard,
    labelKey: "activityFeed.types.subscription",
  },
  deletion_pending: {
    colorClass: "bg-red-500/10 text-red-700 border-red-200 dark:text-red-400 dark:border-red-800",
    icon: UserX,
    labelKey: "activityFeed.types.deletion",
  },
  registration_pending: {
    colorClass: "bg-green-500/10 text-green-700 border-green-200 dark:text-green-400 dark:border-green-800",
    icon: FlaskConical,
    labelKey: "activityFeed.types.registration",
  },
  contribution_pending: {
    colorClass: "bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800",
    icon: DollarSign,
    labelKey: "activityFeed.types.contribution",
  },
  consultant_pending: {
    colorClass: "bg-purple-500/10 text-purple-700 border-purple-200 dark:text-purple-400 dark:border-purple-800",
    icon: UserCheck,
    labelKey: "activityFeed.types.consultant",
  },
  escalation_pending: {
    colorClass: "bg-orange-500/10 text-orange-700 border-orange-200 dark:text-orange-400 dark:border-orange-800",
    icon: AlertTriangle,
    labelKey: "activityFeed.types.escalation",
  },
  moderation_pending: {
    colorClass: "bg-slate-500/10 text-slate-700 border-slate-200 dark:text-slate-400 dark:border-slate-800",
    icon: Shield,
    labelKey: "activityFeed.types.moderation",
  },
  order_pending: {
    colorClass: "bg-cyan-500/10 text-cyan-700 border-cyan-200 dark:text-cyan-400 dark:border-cyan-800",
    icon: ShoppingBag,
    labelKey: "activityFeed.types.order",
  },
};

function formatMeta(
  itemType: string,
  metadata: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (itemType) {
    case "subscription_pending":
      return `${metadata.package_name ?? ""} - ${metadata.amount_paid ?? 0} ${metadata.currency ?? BASE_CURRENCY_FALLBACK}`;
    case "deletion_pending": {
      const days = metadata.days_remaining as number | undefined;
      return days != null
        ? t("admin.activityFeed.meta.deletionDays", { count: days })
        : "";
    }
    case "registration_pending":
      return `${t("admin.activityFeed.meta.study")}: ${metadata.study_name ?? ""}`;
    case "contribution_pending":
      return `${metadata.study_name ?? ""} - ${metadata.amount ?? 0} ${metadata.currency ?? BASE_CURRENCY_FALLBACK}`;
    case "consultant_pending":
      return `${metadata.study_name ?? ""} (${metadata.role ?? ""})`;
    case "escalation_pending":
      return `${metadata.escalation_type ?? ""} - ${metadata.priority ?? ""}`;
    case "moderation_pending":
      return `${metadata.resource_type ?? ""} (${t("admin.activityFeed.meta.riskScore")}: ${metadata.risk_score ?? 0})`;
    case "order_pending":
      return `${metadata.order_status ?? ""} - ${metadata.total ?? 0} ${metadata.currency ?? BASE_CURRENCY_FALLBACK}`;
    default:
      return "";
  }
}

export function AdminActivityCard({ item }: AdminActivityCardProps) {
  const { t, i18n } = useTranslation();
  const { approveItem, rejectItem } = useAdminActivityActions();
  const dateLocale = getDateFnsLocale(i18n.language);

  const config = TYPE_CONFIG[item.item_type as ActivityFeedItemType] ?? {
    colorClass: "bg-muted",
    icon: Clock,
    labelKey: "activityFeed.types.unknown",
  };

  const Icon = config.icon;

  const handleApprove = useCallback(async () => {
    const result = await approveItem(item);
    if (result.success) {
      toast(t("admin.activityFeed.actions.approved"));
    } else {
      toast.error(t("common.error"), {
        description: t("common.somethingWentWrong"),
      });
    }
  }, [item, approveItem, t]);

  const handleReject = useCallback(async () => {
    const result = await rejectItem(item);
    if (result.success) {
      toast(t("admin.activityFeed.actions.rejected"));
    } else {
      toast.error(t("common.error"), {
        description: t("common.somethingWentWrong"),
      });
    }
  }, [item, rejectItem, t]);

  const hasApproveReject = [
    "subscription_pending",
    "registration_pending",
    "contribution_pending",
    "consultant_pending",
    "moderation_pending",
  ].includes(item.item_type);

  const hasViewOnly = [
    "deletion_pending",
    "escalation_pending",
    "order_pending",
  ].includes(item.item_type);

  const viewLink = (() => {
    switch (item.item_type) {
      case "deletion_pending":
        return "/admin/deletion-requests";
      case "escalation_pending":
        return undefined;
      case "order_pending":
        return "/admin/orders";
      default:
        return undefined;
    }
  })();

  const timeAgo = formatDistanceToNow(new Date(item.created_at), {
    addSuffix: true,
    locale: dateLocale,
  });

  return (
    <Card className={`border ${config.colorClass} transition-shadow hover:shadow-md`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="mt-0.5 flex-shrink-0">
            <Icon className="h-5 w-5" />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {t(config.labelKey)}
              </Badge>
              {item.membership_tier && (
                <Badge variant="secondary" className="text-xs capitalize">
                  {item.membership_tier}
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                {timeAgo}
              </span>
            </div>

            {/* Member name */}
            <p className="mt-1 font-medium text-sm truncate">
              {item.display_name ?? t("admin.activityFeed.unknownMember")}
            </p>

            {/* Meta description */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatMeta(item.item_type, item.metadata, t)}
            </p>

            {/* Action buttons */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {hasApproveReject && (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1"
                    onClick={handleApprove}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    {t("admin.activityFeed.actions.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={handleReject}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {t("admin.activityFeed.actions.reject")}
                  </Button>
                </>
              )}
              {hasViewOnly && viewLink && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  asChild
                >
                  <a href={viewLink}>
                    <Eye className="h-3.5 w-3.5" />
                    {t("common.viewDetails")}
                  </a>
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
