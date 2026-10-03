import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/hooks/useSession";
import { useRewardShopProducts, useWalletBalance } from "@/hooks/useRewardShop";
import { usePurchaseVoucher } from "@/hooks/useVoucher";
import { Coins, ShoppingBag, Loader2, CheckCircle } from "lucide-react";
import type { RewardShopProduct } from "@/hooks/useRewardShop";

/**
 * Member page for browsing and purchasing products with PLATFORM tokens.
 */
export default function MemberRewardShop() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: authLoading } = useSession();
  const { data: products, isLoading: productsLoading } = useRewardShopProducts();
  const { data: wallet, isLoading: walletLoading } = useWalletBalance();
  const purchaseMutation = usePurchaseVoucher();

  const [confirmProduct, setConfirmProduct] = useState<RewardShopProduct | null>(null);
  const [purchasedCode, setPurchasedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth", { state: { from: location }, replace: true });
    }
  }, [user, authLoading, navigate, location]);

  const platformBalance = wallet?.aisha_tokens ?? 0;

  const handlePurchase = async (product: RewardShopProduct) => {
    try {
      const result = await purchaseMutation.mutateAsync({
        productId: product.id,
        cost: product.token_price,
        tokenType: "aisha",
      });
      // result contains the voucher code
      if (result && typeof result === "object" && "code" in result) {
        setPurchasedCode((result as { code: string }).code);
      }
      setConfirmProduct(null);
    } catch {
      // Error handled by mutation's onError
    }
  };

  if (authLoading || productsLoading || walletLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 py-12 pt-24">
        <div className="container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-emerald-500/10">
                <ShoppingBag className="w-8 h-8 text-emerald-500" />
              </div>
              <div>
                <h1 className="text-2xl font-serif font-bold">{t("rewardShop.title")}</h1>
                <p className="text-muted-foreground">{t("rewardShop.subtitle")}</p>
              </div>
            </div>
            <Card className="px-4 py-2 bg-emerald-500/5 border-emerald-500/20">
              <div className="flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-500" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("rewardShop.yourBalance")}</p>
                  <p className="text-lg font-bold">{platformBalance.toLocaleString()} {t("rewardShop.tokenUnit")}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Products Grid */}
          {products && products.length > 0 ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product) => {
                const canAfford = platformBalance >= product.token_price;
                return (
                  <Card key={product.id} className="flex flex-col overflow-hidden">
                    {product.image_url && (
                      <div className="aspect-video w-full overflow-hidden bg-muted">
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <CardHeader className="flex-1">
                      <CardTitle className="text-lg">{product.name}</CardTitle>
                      {product.description && (
                        <CardDescription>{product.description}</CardDescription>
                      )}
                      {product.category && (
                        <Badge variant="outline" className="w-fit">{product.category}</Badge>
                      )}
                    </CardHeader>
                    <CardFooter className="flex items-center justify-between gap-2 border-t pt-4">
                      <div className="flex items-center gap-1 min-w-0">
                        <Coins className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span className="font-bold text-lg">{product.token_price}</span>
                        <span className="text-sm text-muted-foreground truncate">{t("rewardShop.tokenUnit")}</span>
                      </div>
                      <Button
                        size="sm"
                        className="shrink-0"
                        disabled={!canAfford || purchaseMutation.isPending}
                        onClick={() => setConfirmProduct(product)}
                      >
                        {canAfford
                          ? t("rewardShop.redeem")
                          : t("rewardShop.insufficientBalance")}
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="py-12 text-center">
              <CardContent>
                <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("rewardShop.noProducts")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Confirm Purchase Dialog */}
      <Dialog open={!!confirmProduct} onOpenChange={(open) => !open && setConfirmProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rewardShop.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("rewardShop.confirmDescription", {
                product: confirmProduct?.name,
                cost: confirmProduct?.token_price,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("rewardShop.currentBalance")}</span>
              <span className="font-semibold">{platformBalance.toLocaleString()} {t("rewardShop.tokenUnit")}</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-muted-foreground">{t("rewardShop.cost")}</span>
              <span className="font-semibold text-destructive">-{confirmProduct?.token_price} {t("rewardShop.tokenUnit")}</span>
            </div>
            <hr className="my-2" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("rewardShop.remaining")}</span>
              <span className="font-semibold">
                {(platformBalance - (confirmProduct?.token_price ?? 0)).toLocaleString()} {t("rewardShop.tokenUnit")}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmProduct(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => confirmProduct && handlePurchase(confirmProduct)}
              disabled={purchaseMutation.isPending}
            >
              {purchaseMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("rewardShop.confirmPurchase")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <Dialog open={!!purchasedCode} onOpenChange={(open) => !open && setPurchasedCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              {t("rewardShop.successTitle")}
            </DialogTitle>
            <DialogDescription>{t("rewardShop.successDescription")}</DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground mb-2">{t("rewardShop.yourVoucherCode")}</p>
            <p className="text-3xl font-mono font-bold tracking-wider">{purchasedCode}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setPurchasedCode(null)}>
              {t("common.close")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPurchasedCode(null);
                navigate("/member/vouchers");
              }}
            >
              {t("rewardShop.viewMyVouchers")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
