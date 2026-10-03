/**
 * Specialist earnings dashboard — revenue overview, period filter, itemized table.
 *
 * @module pages/partner/SpecialistEarnings
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSpecialistEarnings,
  type EarningsPeriod,
} from "@/hooks/useSpecialistEarnings";
import { useSession } from "@/hooks/useSession";
import { useCurrency } from "@/hooks/useCurrency";
import {
  Wallet,
  Clock,
  TrendingUp,
  ArrowLeft,
  Banknote,
} from "lucide-react";

const PAGE_SIZE = 20;

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  completed: "default",
  pending: "secondary",
  processing: "outline",
  failed: "destructive",
};

export default function SpecialistEarnings() {
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();
  const navigate = useNavigate();
  const { isLoading: authLoading } = useSession();
  const [period, setPeriod] = useState<EarningsPeriod>("month");
  const [page, setPage] = useState(0);

  const summary = useSpecialistEarnings(
    period,
    PAGE_SIZE,
    page * PAGE_SIZE
  );
  const { isLoading } = summary;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-foreground">
                {t("delivery.earnings.title")}
              </h1>
              <p className="text-muted-foreground mt-1">
                {t("delivery.earnings.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={period}
                onValueChange={(v) => {
                  setPeriod(v as EarningsPeriod);
                  setPage(0);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">
                    {t("delivery.earnings.period.month")}
                  </SelectItem>
                  <SelectItem value="quarter">
                    {t("delivery.earnings.period.quarter")}
                  </SelectItem>
                  <SelectItem value="year">
                    {t("delivery.earnings.period.year")}
                  </SelectItem>
                  <SelectItem value="all">
                    {t("delivery.earnings.period.all")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" onClick={() => navigate("/partner/dashboard")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t("consultantDashboard.backToPartner")}
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-8 w-32 mb-2" />
                    <Skeleton className="h-5 w-20" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <Wallet className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("delivery.earnings.totalEarned")}
                      </p>
                      <p className="text-2xl font-semibold">
                        {formatPrice(summary.totalEarned)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-yellow-500/10">
                      <Clock className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("delivery.earnings.totalPending")}
                      </p>
                      <p className="text-2xl font-semibold">
                        {formatPrice(summary.totalPending)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <TrendingUp className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("delivery.earnings.grossRevenue")}
                      </p>
                      <p className="text-2xl font-semibold">
                        {formatPrice(summary.grossRevenue)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Earnings Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Banknote className="h-5 w-5" />
                {t("delivery.earnings.table.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : summary.items.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Wallet className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p>{t("delivery.earnings.table.noData")}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t("delivery.earnings.table.date")}
                      </TableHead>
                      <TableHead>
                        {t("delivery.earnings.table.project")}
                      </TableHead>
                      <TableHead>
                        {t("delivery.earnings.table.type")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("delivery.earnings.table.gross")}
                      </TableHead>
                      <TableHead className="text-right">
                        {t("delivery.earnings.table.net")}
                      </TableHead>
                      <TableHead>
                        {t("delivery.earnings.table.status")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.items.map((item) => (
                      <TableRow key={item.revenue_id}>
                        <TableCell className="text-sm">
                          {new Date(item.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="font-medium text-sm">
                          {item.story_id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {t(`delivery.earnings.type.${item.revenue_type}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatPrice(item.gross_amount)}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatPrice(item.my_split)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={statusVariant[item.status] ?? "outline"}
                            className="text-xs"
                          >
                            {t(`delivery.earnings.status.${item.status}`)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Pagination */}
              {summary.items.length > 0 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    {t("common.previous")}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t("delivery.earnings.table.page", { page: page + 1 })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={summary.items.length < PAGE_SIZE}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("common.next")}
                  </Button>
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
