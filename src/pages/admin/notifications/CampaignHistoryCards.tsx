import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface RunEntry {
  id: string;
  run_at: string;
  status: string;
  recipients_count: number;
  push_sent: number;
  inapp_sent: number;
  errors: unknown;
}

interface DeliveryEntry {
  id: string;
  created_at: string;
  is_read: boolean;
  profile_display_name: string | null;
  profile_email: string | null;
  schedule_id: string | null;
  title: string;
  user_id: string;
}

interface CampaignHistoryCardsProps {
  deliveries: DeliveryEntry[];
  deliveriesLoading: boolean;
  runs: RunEntry[];
  runsLoading: boolean;
}

const getStatusVariant = (
  status: string
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "failed":
      return "destructive";
    case "paused":
    case "partial":
      return "secondary";
    case "running":
    case "sent":
      return "default";
    default:
      return "outline";
  }
};

const formatRunErrors = (errors: unknown) => {
  if (!errors) return "-";
  if (Array.isArray(errors)) {
    const joined = errors.join(", ");
    return joined.length > 80 ? `${joined.slice(0, 77)}...` : joined;
  }
  if (typeof errors === "string") return errors;
  const json = JSON.stringify(errors);
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
};

const formatDeliveryRecipient = (delivery: {
  profile_display_name: string | null;
  profile_email: string | null;
  user_id: string;
}) => {
  return (
    delivery.profile_display_name ||
    delivery.profile_email ||
    delivery.user_id
  );
};

export function CampaignHistoryCards({
  deliveries,
  deliveriesLoading,
  runs,
  runsLoading,
}: CampaignHistoryCardsProps) {
  const { t } = useTranslation();

  const getRunStatusLabel = (status: string) => {
    switch (status) {
      case "sent":
        return t("admin.notifications.runs.status.sent");
      case "partial":
        return t("admin.notifications.runs.status.partial");
      case "failed":
        return t("admin.notifications.runs.status.failed");
      default:
        return status;
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.notifications.runs.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {runsLoading && (
            <p className="text-sm text-muted-foreground">
              {t("admin.notifications.runs.loading")}
            </p>
          )}
          {!runsLoading && runs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("admin.notifications.runs.empty")}
            </p>
          )}
          {runs.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("admin.notifications.runs.columns.runAt")}
                  </TableHead>
                  <TableHead>
                    {t("admin.notifications.runs.columns.status")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.notifications.runs.columns.recipients")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.notifications.runs.columns.push")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("admin.notifications.runs.columns.inapp")}
                  </TableHead>
                  <TableHead>
                    {t("admin.notifications.runs.columns.errors")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(run.run_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(run.status)}>
                        {getRunStatusLabel(run.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {run.recipients_count}
                    </TableCell>
                    <TableCell className="text-right">
                      {run.push_sent}
                    </TableCell>
                    <TableCell className="text-right">
                      {run.inapp_sent}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatRunErrors(run.errors)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.notifications.deliveries.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {deliveriesLoading && (
            <p className="text-sm text-muted-foreground">
              {t("admin.notifications.deliveries.loading")}
            </p>
          )}
          {!deliveriesLoading && deliveries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("admin.notifications.deliveries.empty")}
            </p>
          )}
          {deliveries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t("admin.notifications.deliveries.columns.sentAt")}
                  </TableHead>
                  <TableHead>
                    {t("admin.notifications.deliveries.columns.recipient")}
                  </TableHead>
                  <TableHead>
                    {t("admin.notifications.deliveries.columns.schedule")}
                  </TableHead>
                  <TableHead>
                    {t("admin.notifications.deliveries.columns.read")}
                  </TableHead>
                  <TableHead>
                    {t("admin.notifications.deliveries.columns.title")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(delivery.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDeliveryRecipient(delivery)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {delivery.schedule_id ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={delivery.is_read ? "secondary" : "outline"}
                      >
                        {delivery.is_read
                          ? t(
                              "admin.notifications.deliveries.readStates.read"
                            )
                          : t(
                              "admin.notifications.deliveries.readStates.unread"
                            )}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {delivery.title}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
