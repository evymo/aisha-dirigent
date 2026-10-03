import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useMemberSubscriptionsAdmin,
  useUpdateMemberSubscriptionStatus,
  type MemberSubscription,
} from "@/hooks/useAdminMemberSubscriptions";
import { useCurrency } from "@/hooks/useCurrency";
import { CreditCard, Clock, CheckCircle, XCircle, Loader2, Banknote } from "lucide-react";
import { toast } from "sonner";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { useSubscriptionColumns } from "./member-subscriptions-columns";

const SUBSCRIPTION_STATUSES = [
  { value: "pending", labelKey: "admin.memberSubscriptions.status.pending", icon: Clock },
  { value: "approved", labelKey: "admin.memberSubscriptions.status.approved", icon: CheckCircle },
  { value: "paid", labelKey: "admin.memberSubscriptions.status.paid", icon: Banknote },
  { value: "active", labelKey: "admin.memberSubscriptions.status.active", icon: CheckCircle },
  { value: "cancelled", labelKey: "admin.memberSubscriptions.status.cancelled", icon: XCircle },
  { value: "expired", labelKey: "admin.memberSubscriptions.status.expired", icon: XCircle },
];

export default function AdminMemberSubscriptions() {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();
  const [selectedSub, setSelectedSub] = useState<MemberSubscription | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: subscriptions = [], isLoading: loading } = useMemberSubscriptionsAdmin();
  const updateStatusMutation = useUpdateMemberSubscriptionStatus();
  const updating = updateStatusMutation.isPending ? updateStatusMutation.variables?.subscriptionId : null;

  const handleStatusChange = async (subId: string, newStatus: string) => {
    try {
      await updateStatusMutation.mutateAsync({ subscriptionId: subId, status: newStatus });
      toast.success(t("admin.memberSubscriptions.statusUpdated"));
    } catch {
      toast.error(t("admin.memberSubscriptions.updateError"));
    }
  };

  const getStatusBadgeVariant = (status: string): "default" | "secondary" | "outline" | "destructive" => {
    switch (status) {
      case "approved":
        return "default";
      case "paid":
      case "active":
        return "secondary";
      case "cancelled":
      case "expired":
        return "destructive";
      default:
        return "outline";
    }
  };

  const stats = {
    total: subscriptions.length,
    pending: subscriptions.filter((s) => s.status === "pending").length,
    approved: subscriptions.filter((s) => s.status === "approved").length,
    active: subscriptions.filter((s) => ["paid", "active"].includes(s.status)).length,
    cancelled: subscriptions.filter((s) => ["cancelled", "expired"].includes(s.status)).length,
  };

  // Use hook instead of function to properly handle React hooks
  const columns = useSubscriptionColumns(
    handleStatusChange,
    (sub) => {
      setSelectedSub(sub);
      setDetailOpen(true);
    },
    updating
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.memberSubscriptions.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("admin.memberSubscriptions.subtitle")}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("admin.memberSubscriptions.stats.total")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">{t("admin.memberSubscriptions.stats.pending")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">{t("admin.memberSubscriptions.stats.approved")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.approved}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Banknote className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">{t("admin.memberSubscriptions.stats.active")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-destructive" />
              <span className="text-sm text-muted-foreground">{t("admin.memberSubscriptions.stats.cancelled")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.cancelled}</p>
          </CardContent>
        </Card>
      </div>

      {/* Subscriptions Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t("admin.memberSubscriptions.listTitle")}</CardTitle>
          <CardDescription>{t("admin.memberSubscriptions.listSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={subscriptions}
            searchKey="id"
          />
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("admin.memberSubscriptions.detail.title")} #{selectedSub?.id.slice(0, 8).toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {selectedSub && new Date(selectedSub.created_at).toLocaleString("cs-CZ")}
            </DialogDescription>
          </DialogHeader>

          {selectedSub && (
            <div className="space-y-6">
              {/* Member Info */}
              <div>
                <h4 className="font-medium mb-2">{t("admin.memberSubscriptions.detail.member")}</h4>
                <div className="bg-muted/50 p-4 rounded-lg space-y-1">
                  <p>{selectedSub.profile?.display_name || t("admin.memberSubscriptions.unknownMember")}</p>
                  {selectedSub.profile?.email && (
                    <p className="text-sm text-muted-foreground">{selectedSub.profile.email}</p>
                  )}
                  {selectedSub.profile?.phone && (
                    <p className="text-sm text-muted-foreground">{selectedSub.profile.phone}</p>
                  )}
                </div>
              </div>

              {/* Package Info */}
              <div>
                <h4 className="font-medium mb-2">{t("admin.memberSubscriptions.detail.package")}</h4>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="font-medium">{selectedSub.package?.name || t("common.placeholderHyphen")}</p>
                  <p className="text-sm text-muted-foreground capitalize">
                    {selectedSub.package?.tier} / {selectedSub.package?.period}
                  </p>
                </div>
              </div>

              {/* Period */}
              <div>
                <h4 className="font-medium mb-2">{t("admin.memberSubscriptions.detail.period")}</h4>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-sm">
                    <span className="inline-flex items-center gap-2">
                      <span>{new Date(selectedSub.period_start).toLocaleDateString("cs-CZ")}</span>
                      <span>{t("common.placeholderHyphen")}</span>
                      <span>{new Date(selectedSub.period_end).toLocaleDateString("cs-CZ")}</span>
                    </span>
                  </p>
                </div>
              </div>

              {/* Amount */}
              <div className="flex justify-between items-center pt-4 border-t">
                <span className="font-medium">{t("admin.memberSubscriptions.detail.amount")}</span>
                <span className="text-xl font-bold">
                  <span className="inline-flex items-baseline gap-1">
                    {formatCurrency(selectedSub.amount_paid, selectedSub.currency)}
                  </span>
                </span>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between pt-4 border-t">
                <span className="font-medium">{t("admin.memberSubscriptions.detail.status")}</span>
                <Select
                  value={selectedSub.status}
                  onValueChange={(value) => {
                    handleStatusChange(selectedSub.id, value);
                    setSelectedSub({ ...selectedSub, status: value });
                  }}
                >
                  <SelectTrigger className="w-[160px]">
                    <Badge variant={getStatusBadgeVariant(selectedSub.status)}>
                      {t(`admin.memberSubscriptions.status.${selectedSub.status}`)}
                    </Badge>
                  </SelectTrigger>
                  <SelectContent>
                    {SUBSCRIPTION_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        <div className="flex items-center gap-2">
                          <status.icon className="w-4 h-4" />
                          {t(status.labelKey)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
