import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCart } from "@/hooks/useCart";
import { useDynamicTranslationsMap } from "@/hooks/useDynamicTranslations";
import { useSession } from "@/hooks/useSession";
import { toast } from "sonner";
import { safeError } from "@/lib/security/safeLogger";
import { useCurrency } from "@/hooks/useCurrency";
import { useCheckoutVoucher } from "@/hooks/useCheckoutVoucher";
import { ArrowLeft, Loader2, Lock, ShoppingBag, CreditCard, Building2 } from "lucide-react";
import {
  useCheckoutProfilePrefill,
  useCreateOrder,
  useCreateCheckoutSession,
  useCompanyData,
  usePaymentMethodsConfig,
  useSetupBankTransfer,
  useAvailableShippingMethods,
} from "@/hooks";
import type { ShippingMethod, ShippingPoint, ShippingCarrier } from "@/lib/schemas/shippingCheckoutSchemas";
import {
  CheckoutOrderSummary,
  CheckoutShippingSection,
  checkoutSchema,
  initialConsents,
  type PaymentMethodOption,
  type CheckoutConsents,
} from "./checkout/index";

export default function Checkout() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { items, total, loading: cartLoading, clearCart } = useCart();
  const { user, isLoading: authLoading } = useSession();
  const { preferredCurrency, convertFromBase, formatCurrency, formatPrice } = useCurrency();
  const isAuthenticated = !!user;
  const navigate = useNavigate();

  // Voucher logic via hook
  const {
    appliedVoucher,
    handleApplyVoucher,
    handleRemoveVoucher,
    isValidating: validateVoucherPending,
    setVoucherCode,
    voucherCode,
    voucherDiscount,
  } = useCheckoutVoucher({ convertFromBase, items, preferredCurrency });

  const productTranslationKeys = useMemo(() => {
    if (!Array.isArray(items)) return [];

    const keys = items
      .map((item) => item.product?.slug)
      .filter((slug): slug is string => typeof slug === "string" && slug.trim().length > 0)
      .map((slug) => `products.${slug}.name`);

    return Array.from(new Set(keys));
  }, [items]);

  const productTranslations = useDynamicTranslationsMap(productTranslationKeys, "products", "en");

  const getProductName = (product?: { slug?: string | null; name?: string | null }) => {
    const slug = typeof product?.slug === "string" ? product.slug.trim() : "";
    if (!slug) return product?.name || "";

    const key = `products.${slug}.name`;
    const translated = typeof productTranslations[key] === "string" ? productTranslations[key].trim() : "";
    return translated || product?.name || "";
  };

  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("packeta_pickup");
  const [selectedPoint, setSelectedPoint] = useState<ShippingPoint | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState<ShippingCarrier | null>(null);

  // Different delivery address support
  const [useDifferentDeliveryAddress, setUseDifferentDeliveryAddress] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState({
    address: "",
    city: "",
    postalCode: "",
    country: "CZ",
  });

  // Hooks for checkout data
  const createOrder = useCreateOrder();
  const createCheckoutSession = useCreateCheckoutSession();
  const { consentInterpolation } = useCompanyData();
  const { data: paymentMethodsConfig } = usePaymentMethodsConfig();
  const setupBankTransfer = useSetupBankTransfer();

  // Determine available and default payment method
  const cardEnabled = paymentMethodsConfig?.card_enabled ?? true;
  const bankTransferEnabled = paymentMethodsConfig?.bank_transfer_enabled ?? true;
  const defaultPaymentMethod = paymentMethodsConfig?.default_method ?? "bank_transfer";

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodOption>(
    (defaultPaymentMethod === "card" && cardEnabled) ? "card"
    : (defaultPaymentMethod === "bank_transfer" && bankTransferEnabled) ? "bank_transfer"
    : cardEnabled ? "card" : "bank_transfer"
  );

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
    country: "CZ",
  });

  // Fetch all available shipping methods from Packeta edge function
  const subtotalConverted = convertFromBase(total, preferredCurrency);
  const { data: availableMethods, isLoading: loadingMethods } = useAvailableShippingMethods({
    country: formData.country,
    currency: preferredCurrency,
    orderSubtotal: subtotalConverted,
    postalCode: formData.postalCode,
  });

  const { data: profilePrefill } = useCheckoutProfilePrefill(user?.id);

  // Pre-fill form with profile data
  useEffect(() => {
    if (!profilePrefill) return;

    const address = profilePrefill.address;
    const displayName = profilePrefill.display_name || "";
    const nameParts = displayName.split(" ");

    setFormData((prev) => ({
      ...prev,
      firstName: nameParts[0] || prev.firstName,
      lastName: nameParts.slice(1).join(" ") || prev.lastName,
      email: profilePrefill.email || user?.email || prev.email,
      phone: profilePrefill.phone || prev.phone,
      address: address?.street || prev.address,
      city: address?.city || prev.city,
      postalCode: address?.postalCode || prev.postalCode,
      country: address?.country || prev.country || "CZ",
    }));
  }, [profilePrefill, user?.email]);

  // Handle Stripe return
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    const orderId = searchParams.get('order_id');

    if (paymentStatus === 'success' && orderId) {
      clearCart();
      toast.success(t('checkout.messages.paymentSuccess'), {
        description: t('checkout.messages.paymentSuccessDesc'),
      });
      navigate('/member/orders');
    } else if (paymentStatus === 'cancelled') {
      toast.error(t('checkout.messages.paymentCancelled'), {
        description: t('checkout.messages.paymentCancelledDesc'),
      });
    }
  }, [searchParams, clearCart, navigate, t]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/auth");
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Calculate totals from available methods costs
  const shippingCost = availableMethods?.costs?.[shippingMethod] ?? 0;
  const totalWithShipping = Math.max(0, subtotalConverted + shippingCost - voucherDiscount);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCountryChange = useCallback((country: string) => {
    setFormData((prev) => ({ ...prev, country }));
    setSelectedPoint(null);
    setSelectedCarrier(null);
  }, []);

  const handleShippingMethodChange = useCallback((method: ShippingMethod) => {
    setShippingMethod(method);
    // Clear point selection when switching between categories
    const isPointBased = method === "packeta_pickup" || method === "carrier_pickup" || method === "packeta_zbox";
    const wasPointBased = shippingMethod === "packeta_pickup" || shippingMethod === "carrier_pickup" || shippingMethod === "packeta_zbox";
    if (isPointBased !== wasPointBased) {
      setSelectedPoint(null);
    }
  }, [shippingMethod]);

  const [consents, setConsents] = useState<CheckoutConsents>(initialConsents);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    if (!user || items.length === 0) return;

    // Validate consents
    const requiredConsents: (keyof typeof consents)[] = [
      "gdpr", "terms", "professional", "notMedicalAdvice",
      "research", "knowledgeCheck", "informedConsent", "commitment"
    ];

    const missingConsents = requiredConsents.filter(key => !consents[key]);
    if (missingConsents.length > 0) {
      setFormErrors({ consents: "required" });
      toast.error(t('checkout.messages.validationError'), {
        description: t('checkout.messages.consentsRequired'),
      });
      return;
    }

    // Validate shipping method requirements
    const needsPoint = shippingMethod === "packeta_pickup" || shippingMethod === "carrier_pickup" || shippingMethod === "packeta_zbox";
    if (needsPoint && !selectedPoint) {
      toast.error(t('checkout.messages.validationError'), {
        description: t('checkout.messages.selectPickupPoint'),
      });
      return;
    }

    const needsAddress = shippingMethod === "packeta_home" || shippingMethod === "carrier_home";
    if (needsAddress) {
      // Determine which address to validate based on delivery override
      const addressToValidate = useDifferentDeliveryAddress ? deliveryAddress : formData;
      if (!addressToValidate.address || !addressToValidate.city || !addressToValidate.postalCode) {
        setFormErrors({
          address: !addressToValidate.address ? "required" : "",
          city: !addressToValidate.city ? "required" : "",
          postalCode: !addressToValidate.postalCode ? "required" : "",
        });
        toast.error(t('checkout.messages.validationError'), {
          description: t('checkout.messages.addressRequired'),
        });
        return;
      }
    }

    // Validate form data with Zod
    const validationResult = checkoutSchema.safeParse(formData);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      validationResult.error.errors.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0] as string] = err.message;
        }
      });
      setFormErrors(errors);
      toast.error(t('checkout.messages.validationError'), {
        description: t('checkout.messages.validationErrorDesc'),
      });
      return;
    }

    setSubmitting(true);

    try {
      const validatedData = validationResult.data;

      // Build shipping address based on method
      const isHomeDelivery = shippingMethod === "packeta_home" || shippingMethod === "carrier_home";
      const effectiveAddress = isHomeDelivery && useDifferentDeliveryAddress
        ? deliveryAddress
        : { address: validatedData.address || '', city: validatedData.city || '', postalCode: validatedData.postalCode || '', country: validatedData.country };

      const shippingAddress = selectedPoint
        ? {
          firstName: validatedData.firstName,
          lastName: validatedData.lastName,
          email: validatedData.email,
          phone: validatedData.phone || "",
          pickupPointId: selectedPoint.id,
          pickupPointName: selectedPoint.name,
          street: selectedPoint.street,
          city: selectedPoint.city,
          postalCode: selectedPoint.zip,
          country: selectedPoint.country,
        }
        : {
          firstName: validatedData.firstName,
          lastName: validatedData.lastName,
          email: validatedData.email,
          phone: validatedData.phone || "",
          address: effectiveAddress.address,
          city: effectiveAddress.city,
          postalCode: effectiveAddress.postalCode,
          country: effectiveAddress.country,
        };

      const orderItems = items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        price_at_purchase: item.product?.price || 0,
      }));

      // Create order via hook
      const resolvedOrderId = await createOrder.mutateAsync({
        total: totalWithShipping,
        shippingAddress: shippingAddress,
        billingAddress: shippingAddress,
        shippingMethod: shippingMethod,
        packetaBranchId: selectedPoint?.id ?? null,
        carrierId: selectedCarrier?.id ?? null,
        carrierName: selectedCarrier?.displayName ?? null,
        currency: preferredCurrency,
        items: orderItems,
        paymentMethod: paymentMethod,
        voucherCode: appliedVoucher?.code,
      });

      if (paymentMethod === "bank_transfer") {
        // Setup bank transfer (generates variable symbol, sets IBAN/BIC/due_date)
        await setupBankTransfer.mutateAsync(resolvedOrderId);
        // Clear cart and redirect to bank transfer confirmation
        clearCart();
        navigate(`/checkout/bank-transfer/${resolvedOrderId}`);
      } else {
        // Create Stripe checkout session via hook
        const { url: checkoutUrl } = await createCheckoutSession.mutateAsync({
          orderId: resolvedOrderId,
          successUrl: `${window.location.origin}/checkout?payment=success&order_id=${resolvedOrderId}`,
          cancelUrl: `${window.location.origin}/checkout?payment=cancelled`,
        });

        // Redirect to Stripe Checkout (external payment gateway)
        window.location.href = checkoutUrl; // external
      }
    } catch (error) {
      safeError("Checkout.submit", error);
      toast.error(t('checkout.messages.error'), {
        description: t('checkout.messages.errorDesc'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || cartLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main>
          <section className="pt-32 pb-24">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
              <div className="max-w-md mx-auto text-center">
                <ShoppingBag className="h-16 w-16 text-muted-foreground mx-auto mb-6" />
                <h1 className="font-serif text-3xl font-bold text-foreground mb-4">
                  {t('checkout.cartEmpty')}
                </h1>
                <p className="text-muted-foreground mb-8">
                  {t('checkout.cartEmptyDescription')}
                </p>
                <Button asChild>
                  <Link to="/shop">{t('cart.browseProducts')}</Link>
                </Button>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        <section className="pt-32 pb-24">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('checkout.continueShopping')}
            </Link>

            <div className="grid lg:grid-cols-2 gap-12">
              {/* Checkout Form */}
              <div>
                <h1 className="font-serif text-3xl font-bold text-foreground mb-8">
                  {t('checkout.title')}
                </h1>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <h2 className="font-medium text-lg mb-4">{t('checkout.contactInfo')}</h2>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">{t('checkout.firstName')}</Label>
                          <Input
                            id="firstName"
                            name="firstName"
                            value={formData.firstName}
                            onChange={handleInputChange}
                            className={formErrors.firstName ? "border-destructive" : ""}
                          />
                          {formErrors.firstName && (
                            <p className="text-sm text-destructive">{t('checkout.validation.firstNameRequired')}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">{t('checkout.lastName')}</Label>
                          <Input
                            id="lastName"
                            name="lastName"
                            value={formData.lastName}
                            onChange={handleInputChange}
                            className={formErrors.lastName ? "border-destructive" : ""}
                          />
                          {formErrors.lastName && (
                            <p className="text-sm text-destructive">{t('checkout.validation.lastNameRequired')}</p>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">{t('checkout.email')}</Label>
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          className={formErrors.email ? "border-destructive" : ""}
                        />
                        {formErrors.email && (
                          <p className="text-sm text-destructive">{t('checkout.validation.emailInvalid')}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">{t('checkout.phone')}</Label>
                        <Input
                          id="phone"
                          name="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={handleInputChange}
                          placeholder={t("checkout.phonePlaceholder")}
                          className={formErrors.phone ? "border-destructive" : ""}
                        />
                        {formErrors.phone && (
                          <p className="text-sm text-destructive">{t('checkout.validation.phoneRequired')}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="address">{t('checkout.address')}</Label>
                        <Input
                          id="address"
                          name="address"
                          value={formData.address}
                          onChange={handleInputChange}
                          className={formErrors.address ? "border-destructive" : ""}
                        />
                        {formErrors.address && (
                          <p className="text-sm text-destructive">{t('checkout.validation.addressRequired')}</p>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="city">{t('checkout.city')}</Label>
                          <Input
                            id="city"
                            name="city"
                            value={formData.city}
                            onChange={handleInputChange}
                            className={formErrors.city ? "border-destructive" : ""}
                          />
                          {formErrors.city && (
                            <p className="text-sm text-destructive">{t('checkout.validation.cityRequired')}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="postalCode">{t('checkout.postalCode')}</Label>
                          <Input
                            id="postalCode"
                            name="postalCode"
                            value={formData.postalCode}
                            onChange={handleInputChange}
                            className={formErrors.postalCode ? "border-destructive" : ""}
                          />
                          {formErrors.postalCode && (
                            <p className="text-sm text-destructive">{t('checkout.validation.postalCodeInvalid')}</p>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="country">{t('checkout.country')}</Label>
                        <select
                          id="country"
                          name="country"
                          value={formData.country}
                          onChange={(e) => handleCountryChange(e.target.value)}
                          className="w-full h-10 px-3 rounded-md border border-input bg-background"
                        >
                          <option value="CZ">{t("checkout.countries.CZ")}</option>
                          <option value="SK">{t("checkout.countries.SK")}</option>
                          <option value="DE">{t("checkout.countries.DE")}</option>
                          <option value="AT">{t("checkout.countries.AT")}</option>
                          <option value="PL">{t("checkout.countries.PL")}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  {/* Shipping Method Selection + Pickup Points + Home Delivery */}
                  <CheckoutShippingSection
                    availableMethods={availableMethods}
                    billingAddress={formData}
                    carrier={selectedCarrier}
                    deliveryAddress={deliveryAddress}
                    formErrors={formErrors}
                    formatCurrency={formatCurrency}
                    loadingMethods={loadingMethods}
                    onCarrierChange={setSelectedCarrier}
                    onDeliveryAddressChange={(field, value) => setDeliveryAddress((prev) => ({ ...prev, [field]: value }))}
                    onPickupPointChange={setSelectedPoint}
                    onShippingMethodChange={handleShippingMethodChange}
                    onUseDifferentDeliveryAddressChange={setUseDifferentDeliveryAddress}
                    orderSubtotal={subtotalConverted}
                    preferredCurrency={preferredCurrency}
                    selectedPoint={selectedPoint}
                    shippingMethod={shippingMethod}
                    useDifferentDeliveryAddress={useDifferentDeliveryAddress}
                  />

                  <Separator />

                  {/* Payment Method Selection */}
                  {(cardEnabled || bankTransferEnabled) && (
                    <div>
                      <h2 className="font-medium text-lg mb-4">{t('checkout.payment.title')}</h2>
                      <RadioGroup
                        value={paymentMethod}
                        onValueChange={(value) => setPaymentMethod(value as PaymentMethodOption)}
                        className="space-y-3"
                      >
                        {cardEnabled && (
                          <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
                            <RadioGroupItem value="card" id="payment_card" />
                            <Label htmlFor="payment_card" className="flex-1 cursor-pointer">
                              <div className="flex items-center gap-2">
                                <CreditCard className="h-4 w-4 text-primary" />
                                <span>{t('checkout.payment.card')}</span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {t('checkout.payment.cardDesc')}
                              </p>
                            </Label>
                          </div>
                        )}
                        {bankTransferEnabled && (
                          <div className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/50">
                            <RadioGroupItem value="bank_transfer" id="payment_bank_transfer" />
                            <Label htmlFor="payment_bank_transfer" className="flex-1 cursor-pointer">
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-primary" />
                                <span>{t('checkout.payment.bankTransfer')}</span>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {t('checkout.payment.bankTransferDesc')}
                              </p>
                            </Label>
                          </div>
                        )}
                      </RadioGroup>
                    </div>
                  )}

                  <Separator />

                  {/* Consents */}
                  <div className="space-y-4">
                    <h2 className="font-medium text-lg mb-4">{t('checkout.consents.title')}</h2>

                    {[
                      { key: "gdpr", required: true },
                      { key: "terms", required: true },
                      { key: "professional", required: true },
                      { key: "notMedicalAdvice", required: true },
                      { key: "research", required: true },
                      { key: "knowledgeCheck", required: true },
                      { key: "informedConsent", required: true },
                      { key: "commitment", required: true },
                      { key: "marketing", required: false },
                    ].map(({ key, required }) => (
                      <div key={key} className="flex items-start space-x-2">
                        <Checkbox
                          id={`consent-${key}`}
                          checked={consents[key as keyof typeof consents]}
                          onCheckedChange={(checked) =>
                            setConsents(prev => ({ ...prev, [key]: checked === true }))
                          }
                        />
                        <Label
                          htmlFor={`consent-${key}`}
                          className={`text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 font-normal ${formErrors.consents && required && !consents[key as keyof typeof consents] ? "text-destructive" : ""}`}
                        >
                          {t(`legal.consents.${key}`, { ...consentInterpolation })}
                          {required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                      </div>
                    ))}
                    {formErrors.consents && (
                      <p className="text-sm text-destructive mt-2">{t('checkout.validation.consentsRequired')}</p>
                    )}
                  </div>

                  <div className="bg-muted/50 p-4 rounded-lg border border-border">
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      {paymentMethod === "card"
                        ? t('checkout.stripeSecure')
                        : t('checkout.payment.bankTransferSecure')}
                    </p>
                  </div>

                  <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('checkout.processing')}
                      </>
                    ) : paymentMethod === "card" ? (
                      `${t('checkout.proceedToPayment')} • ${formatCurrency(totalWithShipping, preferredCurrency)}`
                    ) : (
                      `${t('checkout.payment.placeOrderBankTransfer')} • ${formatCurrency(totalWithShipping, preferredCurrency)}`
                    )}
                  </Button>
                </form>
              </div>

              {/* Order Summary */}
              <CheckoutOrderSummary
                items={items}
                getProductName={getProductName}
                formatPrice={formatPrice}
                formatCurrency={formatCurrency}
                preferredCurrency={preferredCurrency}
                subtotalConverted={subtotalConverted}
                shippingCost={shippingCost}
                totalWithShipping={totalWithShipping}
                voucherDiscount={voucherDiscount}
                appliedVoucher={appliedVoucher}
                voucherCode={voucherCode}
                onVoucherCodeChange={setVoucherCode}
                onApplyVoucher={handleApplyVoucher}
                onRemoveVoucher={handleRemoveVoucher}
                validateVoucherPending={validateVoucherPending}
                shippingMethod={shippingMethod}
                selectedPickupPoint={selectedPoint ? { id: selectedPoint.id, name: selectedPoint.name, city: selectedPoint.city, street: selectedPoint.street, zip: selectedPoint.zip, country: selectedPoint.country } : null}
                paymentMethod={paymentMethod}
              />
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
