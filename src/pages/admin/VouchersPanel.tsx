import { useState } from "react";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  useVouchersAdmin,
  useVoucherAnalytics,
  useCreateManualVoucher,
} from "@/hooks/useVoucherAdmin";
import { Loader2, Ticket, Plus, BarChart3 } from "lucide-react";

/**
 * Admin panel for managing vouchers — list, filter, analytics, and manual creation.
 * Rendered as a tab inside AdminTokenomics.
 */
export function VouchersPanel() {
  const { t, i18n } = useTranslation();
  const lang = getTranslationLocale(i18n.language);

  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const { data: vouchers, isLoading: vouchersLoading } = useVouchersAdmin(statusFilter, pageSize, page * pageSize);
  const { data: analytics, isLoading: analyticsLoading } = useVoucherAnalytics();
  const createMutation = useCreateManualVoucher();

  // Dialog state for manual voucher creation
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ productId: "", reason: "", userId: "" });

  const handleCreate = async () => {
    if (!form.productId) return;
    await createMutation.mutateAsync({
      p_product_id: form.productId,
      p_reason: form.reason || undefined,
      p_user_id: form.userId || undefined,
    });
    setDialogOpen(false);
    setForm({ productId: "", reason: "", userId: "" });
  };

  const statusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "used": return "secondary" as const;
      case "expired": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <div className="space-y-6">
      {/* Analytics Cards */}
      {analyticsLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : analytics ? (
        <div className="grid md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("admin.vouchers.analytics.totalIssued")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.total_issued}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("admin.vouchers.analytics.activeCount")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{analytics.active_count}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("admin.vouchers.analytics.conversionRate")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.conversion_rate.toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("admin.vouchers.analytics.totalPointsSpent")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{analytics.total_points_spent.toLocaleString()}</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Voucher List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Ticket className="w-5 h-5" />
                {t("admin.vouchers.title")}
              </CardTitle>
              <CardDescription>{t("admin.vouchers.description")}</CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  {t("admin.vouchers.createManual")}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("admin.vouchers.createDialog.title")}</DialogTitle>
                  <DialogDescription>{t("admin.vouchers.createDialog.description")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>{t("admin.vouchers.createDialog.productId")}</Label>
                    <Input
                      value={form.productId}
                      onChange={(e) => setForm({ ...form, productId: e.target.value })}
                      placeholder={t("admin.vouchers.createDialog.productIdPlaceholder")}
                    />
                  </div>
                  <div>
                    <Label>{t("admin.vouchers.createDialog.userId")}</Label>
                    <Input
                      value={form.userId}
                      onChange={(e) => setForm({ ...form, userId: e.target.value })}
                      placeholder={t("admin.vouchers.createDialog.userIdPlaceholder")}
                    />
                  </div>
                  <div>
                    <Label>{t("admin.vouchers.createDialog.reason")}</Label>
                    <Textarea
                      value={form.reason}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                      placeholder={t("admin.vouchers.createDialog.reasonPlaceholder")}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleCreate}
                    disabled={!form.productId || createMutation.isPending}
                  >
                    {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {t("common.create")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter */}
          <div className="flex gap-4 mb-4">
            <div className="w-48">
              <Label className="mb-2 block">{t("admin.vouchers.filterByStatus")}</Label>
              <Select
                value={statusFilter || "all"}
                onValueChange={(v) => {
                  setStatusFilter(v === "all" ? undefined : v);
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  <SelectItem value="active">{t("admin.vouchers.status.active")}</SelectItem>
                  <SelectItem value="used">{t("admin.vouchers.status.used")}</SelectItem>
                  <SelectItem value="expired">{t("admin.vouchers.status.expired")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {vouchersLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.vouchers.table.code")}</TableHead>
                    <TableHead>{t("admin.vouchers.table.product")}</TableHead>
                    <TableHead>{t("admin.vouchers.table.user")}</TableHead>
                    <TableHead>{t("admin.vouchers.table.cost")}</TableHead>
                    <TableHead>{t("admin.vouchers.table.status")}</TableHead>
                    <TableHead>{t("admin.vouchers.table.created")}</TableHead>
                    <TableHead>{t("admin.vouchers.table.expires")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vouchers?.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-sm">{v.code}</TableCell>
                      <TableCell>{v.product_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.user_email}</TableCell>
                      <TableCell>{v.points_cost}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(v.status)}>{t(`admin.vouchers.status.${v.status}`)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(v.created_at).toLocaleDateString(lang)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(v.expires_at).toLocaleDateString(lang)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!vouchers || vouchers.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        {t("admin.vouchers.noVouchers")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex justify-between items-center mt-4">
                <p className="text-sm text-muted-foreground">
                  {t("admin.vouchers.page", { page: page + 1 })}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!vouchers || vouchers.length < pageSize}
                    onClick={() => setPage(p => p + 1)}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
