import { useEffect } from "react";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { useMyVouchers } from "@/hooks/useVoucher";
import { Ticket, Loader2, ShoppingBag, Clock, CheckCircle, XCircle } from "lucide-react";

/**
 * Member page showing all their vouchers (active, used, expired).
 */
export default function MemberMyVouchers() {
  const { t, i18n } = useTranslation();
  const lang = getTranslationLocale(i18n.language);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading } = useSession();
  const { data: vouchers, isLoading: vouchersLoading } = useMyVouchers();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, authLoading, navigate, location]);

  if (authLoading || vouchersLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "active": return <Clock className="w-4 h-4 text-green-500" />;
      case "used": return <CheckCircle className="w-4 h-4 text-blue-500" />;
      case "expired": return <XCircle className="w-4 h-4 text-muted-foreground" />;
      default: return null;
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "active": return "default" as const;
      case "used": return "secondary" as const;
      case "expired": return "destructive" as const;
      default: return "outline" as const;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12 pt-24">
        <div className="container max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Ticket className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-serif font-bold">{t("myVouchers.title")}</h1>
                <p className="text-muted-foreground">{t("myVouchers.subtitle")}</p>
              </div>
            </div>
            <Button variant="outline" asChild>
              <Link to="/member/reward-shop">
                <ShoppingBag className="w-4 h-4 mr-2" />
                {t("myVouchers.goToShop")}
              </Link>
            </Button>
          </div>

          {/* Voucher List */}
          {vouchers && vouchers.length > 0 ? (
            <div className="space-y-4">
              {vouchers.map((voucher) => (
                <Card key={voucher.id} className="overflow-hidden">
                  <div className="flex">
                    {/* Product Image */}
                    {voucher.product_image_url && (
                      <div className="w-32 h-32 flex-shrink-0 overflow-hidden bg-muted">
                        <img
                          src={voucher.product_image_url}
                          alt={voucher.product_name ?? ""}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex-1 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">
                            {voucher.product_name ?? t("myVouchers.unknownProduct")}
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {t("myVouchers.cost")}: {voucher.points_cost ?? 0} {t("myVouchers.tokenUnit")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusIcon(voucher.status)}
                          <Badge variant={statusBadge(voucher.status)}>
                            {t(`myVouchers.status.${voucher.status}`)}
                          </Badge>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div>
                          {voucher.status === "active" && (
                            <div className="bg-muted/50 rounded px-3 py-1 inline-block">
                              <span className="text-xs text-muted-foreground mr-2">{t("myVouchers.code")}:</span>
                              <span className="font-mono font-bold tracking-wider">{voucher.code}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {voucher.expires_at && (
                            <span>
                              {t("myVouchers.expiresAt")}: {new Date(voucher.expires_at).toLocaleDateString(lang)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="py-12 text-center">
              <CardContent>
                <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-2">{t("myVouchers.noVouchers")}</p>
                <p className="text-muted-foreground mb-4">{t("myVouchers.noVouchersDescription")}</p>
                <Button asChild>
                  <Link to="/member/reward-shop">
                    <ShoppingBag className="w-4 h-4 mr-2" />
                    {t("myVouchers.browseShop")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
